import { tl } from 'ysk-server-shared';
/**
 * Control-plane resource registries — list/create/update/delete entities
 * before optional system apply. Never fakes system success.
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ApplyStatus as SharedApplyStatus } from 'ysk-server-shared';
import type { JsonStore } from '../db/store.js';
import {
  renderNginxProxy,
  renderNginxStatic,
  renderNginxPhpFpm,
  requireNginxServerName,
} from './nginx-ssl.js';
import { writeManagedDnsZone } from './dns-zone.js';
import { planDnsZone } from './extras.js';
import { provisionMysqlDatabase } from './mysql-provision.js';
import { provisionPostgresDatabase } from './postgres-provision.js';
import { provisionRedisBinding } from './redis-provision.js';
import type { HostExecutor } from '../host/executor.js';

/**
 * Resource apply honesty (subset of ysk-server-shared ApplyStatus):
 * draft | written | planned | pending_execute | applied | failed
 * Prefer importing ApplyStatus from ysk-server-shared in new code.
 */
export type ApplyStatus = Extract<
  SharedApplyStatus,
  'draft' | 'written' | 'planned' | 'pending_execute' | 'applied' | 'failed'
>;

export type CollectionKey =
  | 'nginx_sites'
  | 'ftp_accounts'
  | 'mysql_databases'
  | 'mysql_users'
  | 'postgres_databases'
  | 'postgres_users'
  | 'redis_instances'
  | 'dns_zones'
  | 'dns_records'
  | 'certificates';

function now() {
  return new Date().toISOString();
}

function ensureArray(db: JsonStore, key: CollectionKey): Record<string, unknown>[] {
  const snap = db.snapshot as unknown as Record<string, unknown>;
  if (!Array.isArray(snap[key])) {
    snap[key] = [];
  }
  return snap[key] as Record<string, unknown>[];
}

export function listResources(db: JsonStore, key: CollectionKey): Record<string, unknown>[] {
  return [...ensureArray(db, key)];
}

export function getResource(
  db: JsonStore,
  key: CollectionKey,
  id: string,
): Record<string, unknown> | null {
  return ensureArray(db, key).find((r) => r.id === id) ?? null;
}

export function createResource(
  db: JsonStore,
  key: CollectionKey,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: randomUUID(),
    apply_status: 'draft',
    created_at: now(),
    updated_at: now(),
    ...input };
  ensureArray(db, key).unshift(row);
  db.persist();
  return row;
}

export function updateResource(
  db: JsonStore,
  key: CollectionKey,
  id: string,
  patch: Record<string, unknown>,
): Record<string, unknown> | null {
  const arr = ensureArray(db, key);
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return null;
  const next = {
    ...arr[i],
    ...patch,
    id: arr[i].id,
    created_at: arr[i].created_at,
    updated_at: now() };
  arr[i] = next;
  db.persist();
  return next;
}

export function deleteResource(db: JsonStore, key: CollectionKey, id: string): boolean {
  const arr = ensureArray(db, key);
  const i = arr.findIndex((r) => r.id === id);
  if (i < 0) return false;
  arr.splice(i, 1);
  db.persist();
  return true;
}

/**
 * Write nginx conf for a managed site under dataDir.
 * Status is **written** until system sync + nginx -t + reload succeed → **applied**.
 * Never marks applied for a dataDir-only write.
 */
export async function applyManagedNginxSite(
  db: JsonStore,
  dataDir: string,
  id: string,
  opts?: {
    host?: HostExecutor;
    execute?: boolean;
    /** e.g. /etc/nginx/conf.d */
    systemConfDir?: string;
  },
): Promise<{
  ok: boolean;
  site: Record<string, unknown> | null;
  notes: string[];
  blocked?: boolean;
  blockMessage?: string;
  executed?: boolean;
}> {
  const site = getResource(db, 'nginx_sites', id);
  if (!site) return { ok: false, site: null, notes: [tl('notes.auto.n0024')] };
  let serverName: string;
  try {
    serverName = requireNginxServerName(String(site.serverName ?? ''));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const updated = updateResource(db, 'nginx_sites', id, {
      apply_status: 'failed',
      last_apply_at: now(),
      last_error: msg,
    });
    return { ok: false, site: updated, notes: [msg] };
  }
  const kind = String(site.kind ?? 'proxy') as 'proxy' | 'static' | 'php';
  const dir = join(dataDir, 'nginx', 'conf.d');
  mkdirSync(dir, { recursive: true });
  const slug = serverName.replace(/[^a-zA-Z0-9._-]/g, '_') || id.slice(0, 8);
  const confPath = join(dir, `ysk_site_${slug}.conf`);
  const forceHttps = Boolean(site.forceHttps ?? site.force_https);
  const hsts = Boolean(site.hsts);
  const { resolveSiteTlsFiles } = await import('./ssl-certs.js');
  const tls = resolveSiteTlsFiles({ db, dataDir, serverName });
  const wantSsl = Boolean(site.ssl) || tls.ssl;
  const ssl = wantSsl && tls.ssl;
  const sslCertificate = tls.sslCertificate;
  const sslCertificateKey = tls.sslCertificateKey;
  const bodySize =
    site.clientMaxBody && site.clientMaxBody !== 'inherit'
      ? String(site.clientMaxBody)
      : undefined;
  const extraBody = bodySize ? `  client_max_body_size ${bodySize};\n` : '';
  const indexes = site.indexes === true;
  let conf = '';
  if (kind === 'static') {
    conf = renderNginxStatic({
      serverName,
      docRoot: String(site.root ?? join(dataDir, 'www', slug)),
      ssl,
      sslCertificate,
      sslCertificateKey,
      forceHttps: ssl && forceHttps,
      hsts: ssl && hsts,
    });
  } else if (kind === 'php') {
    conf = renderNginxPhpFpm({
      serverName,
      docRoot: String(site.root ?? join(dataDir, 'www', slug)),
      fpmSocket: String(site.socket ?? '/run/php/php8.2-fpm.sock'),
      ssl,
      sslCertificate,
      sslCertificateKey,
      forceHttps: ssl && forceHttps,
      hsts: ssl && hsts,
    });
  } else {
    conf = renderNginxProxy({
      serverName,
      upstream: String(site.upstream ?? 'http://127.0.0.1:3000'),
      ssl,
      sslCertificate,
      sslCertificateKey,
      cloudflareRealIp: Boolean(site.cloudflareRealIp ?? false),
      forceHttps: ssl && forceHttps,
      hsts: ssl && hsts,
    });
  }
  // Inject site-level body size / autoindex after server_name line
  if (extraBody || indexes) {
    conf = conf.replace(
      /server_name\s+[^;]+;/,
      (m) =>
        `${m}\n${extraBody}${indexes ? '  autoindex on;\n' : ''}`,
    );
  }
  writeFileSync(confPath, conf, 'utf8');
  const notes: string[] = [tl('notes.tpl.wroteManaged', { path: confPath })];

  const host = opts?.host;
  const wantSystem = opts?.execute !== false && Boolean(host);
  if (!wantSystem || !host) {
    const updated = updateResource(db, 'nginx_sites', id, {
      confPath,
      apply_status: 'written',
      last_apply_at: now(),
      notes: [...notes, tl('notes.auto.n0704')] });
    return {
      ok: true,
      site: updated,
      notes: [...notes, tl('notes.auto.n1238')],
      executed: false };
  }

  if (!host.executeEnabled()) {
    const updated = updateResource(db, 'nginx_sites', id, {
      confPath,
      apply_status: 'pending_execute',
      last_apply_at: now(),
      notes: [...notes, tl('notes.auto.n1584')] });
    return {
      ok: false,
      site: updated,
      notes: [...notes, tl('notes.auto.n1585')],
      blocked: true,
      blockMessage: tl('ops.blocked.needExecute'),
      executed: false };
  }

  const { syncNginxConfigs } = await import('./nginx-sync.js');
  const systemConfDir = opts?.systemConfDir ?? '/etc/nginx/conf.d';
  const sync = await syncNginxConfigs({
    dataDir,
    systemConfDir,
    host });
  notes.push(...sync.notes);

  if (!sync.tested) {
    const updated = updateResource(db, 'nginx_sites', id, {
      confPath,
      apply_status: 'failed',
      last_apply_at: now(),
      notes,
      last_error: sync.testOutput ?? 'nginx -t failed or skipped' });
    return {
      ok: false,
      site: updated,
      notes: [...notes, tl('notes.auto.n0339')],
      executed: true };
  }

  const reload = await host.runCommand(['systemctl', 'reload', 'nginx'], { timeoutMs: 30_000 });
  notes.push(
    reload.exitCode === 0
      ? tl('notes.auto.n0730')
      : tl('notes.tpl.reloadFailed2', { detail: (reload.stderr || reload.stdout).trim() }),
  );

  if (reload.exitCode !== 0) {
    const updated = updateResource(db, 'nginx_sites', id, {
      confPath,
      apply_status: 'failed',
      last_apply_at: now(),
      notes,
      last_error: reload.stderr || reload.stdout });
    return { ok: false, site: updated, notes, executed: true };
  }

  const updated = updateResource(db, 'nginx_sites', id, {
    confPath,
    apply_status: 'applied',
    last_apply_at: now(),
    notes: [...notes, tl('notes.auto.n0743')],
    last_error: null });
  return {
    ok: true,
    site: updated,
    notes: [...notes, tl('notes.auto.n0756')],
    executed: true };
}

export function revokeManagedNginxSite(
  db: JsonStore,
  id: string,
): { ok: boolean; notes: string[] } {
  const site = getResource(db, 'nginx_sites', id);
  if (!site) return { ok: false, notes: [tl('notes.notFound')] };
  const confPath = site.confPath ? String(site.confPath) : '';
  const notes: string[] = [];
  if (confPath && existsSync(confPath)) {
    try {
      unlinkSync(confPath);
      notes.push(tl('notes.tpl.removed', { name: confPath }));
    } catch (e) {
      notes.push(tl('notes.auto.t0424', { v0: (e instanceof Error ? e.message : String(e)) }));
    }
  }
  deleteResource(db, 'nginx_sites', id);
  notes.push(tl('notes.auto.n0796'));
  return { ok: true, notes };
}

export async function applyMysqlDatabase(
  db: JsonStore,
  id: string,
  host: HostExecutor,
  execute: boolean,
): Promise<{
  ok: boolean;
  notes: string[];
  result?: unknown;
  blocked?: boolean;
  blockMessage?: string;
  executed?: boolean;
}> {
  const row = getResource(db, 'mysql_databases', id);
  if (!row) return { ok: false, notes: [tl('notes.auto.n0867')] };
  const users = listResources(db, 'mysql_users').filter((u) => u.databaseId === id);
  const user = users[0];
  const result = await provisionMysqlDatabase({
    dbName: String(row.name),
    username: user ? String(user.username) : String(row.name),
    password: user ? String(user.password_plain ?? user.password ?? 'ChangeMe99!') : 'ChangeMe99!',
    host: user ? String(user.host ?? 'localhost') : 'localhost',
    hostExec: host,
    execute });
  const applied = Boolean(result.ok && result.executed);
  const status = applied
    ? 'applied'
    : result.requiresExecute || !result.executed
      ? 'pending_execute'
      : 'failed';
  updateResource(db, 'mysql_databases', id, {
    apply_status: status,
    last_apply: result,
    engine: row.engine ?? 'mysql' });
  if (user) {
    updateResource(db, 'mysql_users', String(user.id), {
      apply_status: status,
      engine: row.engine ?? user.engine ?? 'mysql' });
  }
  const blocked = Boolean(result.requiresExecute && !result.executed);
  return {
    ok: applied,
    executed: result.executed,
    blocked,
    blockMessage: blocked
      ? result.notes.find((n) => /權限|系統變更/.test(n)) ??
        tl('notes.db.needExecuteCreate')
      : undefined,
    notes: result.notes,
    result };
}

export async function applyPostgresDatabase(
  db: JsonStore,
  id: string,
  host: HostExecutor,
  execute: boolean,
): Promise<{ ok: boolean; notes: string[]; result?: unknown }> {
  const row = getResource(db, 'postgres_databases', id);
  if (!row) return { ok: false, notes: [tl('notes.auto.n0247')] };
  const users = listResources(db, 'postgres_users').filter((u) => u.databaseId === id);
  const user = users[0];
  const result = await provisionPostgresDatabase({
    dbName: String(row.name),
    username: user ? String(user.username) : String(row.name),
    password: user ? String(user.password_plain ?? 'ChangeMe99!') : 'ChangeMe99!',
    hostExec: host,
    execute });
  updateResource(db, 'postgres_databases', id, {
    apply_status: result.ok && result.executed ? 'applied' : 'planned',
    last_apply: result });
  return { ok: result.ok || !execute, notes: result.notes ?? [], result };
}

export async function applyRedisInstance(
  db: JsonStore,
  id: string,
  host: HostExecutor,
  execute: boolean,
): Promise<{
  ok: boolean;
  notes: string[];
  result?: unknown;
  blocked?: boolean;
  blockMessage?: string;
  executed?: boolean;
}> {
  const row = getResource(db, 'redis_instances', id);
  if (!row) return { ok: false, notes: [tl('notes.auto.n0861')] };
  const result = await provisionRedisBinding({
    projectId: String(row.projectId ?? row.name ?? id),
    dbIndex: Number(row.dbIndex ?? 0),
    hostExec: host,
    execute });
  const applied = Boolean(result.ok && (result.executed || result.reachable));
  const status = applied
    ? 'applied'
    : result.requiresExecute || !result.executed
      ? 'pending_execute'
      : 'failed';
  updateResource(db, 'redis_instances', id, {
    apply_status: status,
    last_apply: result });
  const blocked = Boolean(result.requiresExecute && !result.executed);
  return {
    ok: applied,
    executed: result.executed,
    blocked,
    blockMessage: blocked
      ? result.notes.find((n) => /權限|系統變更/.test(n)) ??
        tl('notes.auto.n0529')
      : undefined,
    notes: result.notes ?? [],
    result };
}

export async function applyDnsZone(
  db: JsonStore,
  dataDir: string,
  id: string,
  opts?: {
    host?: import('../host/executor.js').HostExecutor;
    /** default true when host provided */
    validate?: boolean;
    /** default true when host.executeEnabled */
    tryReload?: boolean;
  },
): Promise<{
  ok: boolean;
  notes: string[];
  result?: unknown;
  apply_status?: string;
  blocked?: boolean;
  blockMessage?: string;
}> {
  const zone = getResource(db, 'dns_zones', id);
  if (!zone) return { ok: false, notes: [tl('notes.auto.n0484')] };
  const zoneName = String(zone.zone);
  const serverIp = String(zone.serverIp ?? '127.0.0.1');
  const serverIpv6 = zone.serverIpv6 ? String(zone.serverIpv6).trim() : undefined;
  const records = listResources(db, 'dns_records').filter((r) => r.zoneId === id);
  const dataRecords = records.map((r) => ({
    type: String(r.type ?? 'A'),
    name: String(r.name ?? '@'),
    value: String(r.value ?? serverIp),
    ttl: Number(r.ttl ?? 300) }));
  const host = opts?.host;
  const canExecute = Boolean(host?.executeEnabled());
  const validate = opts?.validate ?? true;
  const tryReload = opts?.tryReload ?? canExecute;
  try {
    // Write zone file first. For PowerDNS BIND backend, plain `systemctl reload pdns`
    // without named.conf registration still leaves dig REFUSED (0 domains) — so we
    // register zones via syncPowerDnsBindZones when reloading is requested.
    const result = await writeManagedDnsZone({
      dataDir,
      zone: zoneName,
      serverIp,
      serverIpv6: serverIpv6 || undefined,
      mailHost: zone.mailHost ? String(zone.mailHost) : undefined,
      host,
      validate,
      // Defer nameserver reload until after PowerDNS BIND registration below
      tryReload: false,
      template: zone.template ? String(zone.template) : 'full',
      records: dataRecords.length ? dataRecords : undefined,
      nsName: zone.nsName ? String(zone.nsName) : undefined,
      ns2Name: zone.ns2Name ? String(zone.ns2Name) : undefined,
      hostmaster: zone.hostmaster ? String(zone.hostmaster) : undefined,
      ttl: zone.ttl != null ? Number(zone.ttl) : undefined,
      soaRefresh: zone.soaRefresh != null ? Number(zone.soaRefresh) : undefined,
      soaRetry: zone.soaRetry != null ? Number(zone.soaRetry) : undefined,
      soaExpire: zone.soaExpire != null ? Number(zone.soaExpire) : undefined,
      soaMinimum: zone.soaMinimum != null ? Number(zone.soaMinimum) : undefined,
    });

    const notes = [...(result.notes ?? [])];
    let applyStatus = result.applyStatus;
    let reloaded = Boolean(result.reloaded);
    let requiresExecute = Boolean(result.requiresExecute);

    if (result.ok && tryReload && host && result.validated !== false) {
      if (!canExecute) {
        notes.push(tl('notes.auto.n0988'));
        requiresExecute = true;
      } else {
        const { syncPowerDnsBindZones, probePowerDns } = await import('./powerdns-apply.js');
        const { digLocalAuthoritative } = await import('./dns-health.js');
        const { tryReloadClassicNameserver } = await import('./dns-zone.js');
        const probe = await probePowerDns(host);
        const pdnsPresent = Boolean(probe.available || probe.pdnsControl || probe.pdnsServer);

        if (pdnsPresent) {
          // PowerDNS: pure systemctl reload is NOT enough (BIND backend needs named.conf).
          // Never mark applied from reload alone.
          const sync = await syncPowerDnsBindZones({
            dataDir,
            host,
            apply: true,
          });
          notes.push(...sync.notes);
          if (sync.requiresExecute || sync.requiresRoot) {
            requiresExecute = true;
          }
          if (sync.ok && sync.mode === 'loaded') {
            // Post-condition: dig SOA + A for this zone's records (generic, not fixed hostnames)
            const dig = await digLocalAuthoritative({
              host,
              name: zoneName,
              type: 'SOA',
            });
            notes.push(...dig.notes);
            const { buildLocalAProbeNames } = await import('./dns-health.js');
            const relA = dataRecords
              .filter((r) => String(r.type).toUpperCase() === 'A')
              .map((r) => r.name)
              .slice(0, 5);
            let aOk = false;
            for (const aName of buildLocalAProbeNames(zoneName, relA)) {
              const aDig = await digLocalAuthoritative({
                host,
                name: aName,
                type: 'A',
              });
              if (aDig.ok && aDig.answers.length) {
                aOk = true;
                notes.push(`dig A ${aName} → ${aDig.answers[0]}`);
                break;
              }
            }
            if (dig.ok || aOk) {
              reloaded = true;
              applyStatus = 'applied';
              notes.push(tl('notes.dns.applyDigOk'));
              // P2-6: if :53 not open, hint firewall both
              try {
                const ss = await host.runCommand(
                  ['bash', '-c', 'ss -uln 2>/dev/null | grep -E ":53\\s" || true'],
                  { timeoutMs: 4_000 },
                );
                if (!(ss.stdout || '').includes(':53')) {
                  notes.push(tl('notes.dns.firewall53Hint'));
                }
              } catch {
                /* optional */
              }
            } else {
              applyStatus = 'written';
              notes.push(tl('notes.dns.applyDigFail'));
            }
          } else {
            applyStatus = 'written';
            notes.push(tl('notes.dns.applySyncIncomplete'));
          }
        } else {
          // Classic named/bind9 only (no PowerDNS tools) — rndc/systemctl reload is valid applied signal
          const cmdResults: Array<{ argv: string[]; exitCode: number; stderr: string }> = [];
          const classicOk = await tryReloadClassicNameserver(host, notes, cmdResults);
          if (classicOk) {
            reloaded = true;
            applyStatus = 'applied';
          } else {
            applyStatus = 'written';
          }
        }
      }
    } else if (result.ok && !tryReload) {
      notes.push(tl('notes.dns.writeOnlyHint'));
    }

    // Honest: applied only if nameserver reload/register + dig OK; else written
    updateResource(db, 'dns_zones', id, {
      apply_status: applyStatus,
      zonePath: result.zonePath,
      last_apply: { ...result, notes, reloaded, applyStatus },
      last_serial: result.serial,
      validated: result.validated,
      reloaded });
    // Mark records as same honesty level (written, not fake applied)
    for (const rec of records) {
      updateResource(db, 'dns_records', String(rec.id), {
        apply_status: applyStatus === 'applied' ? 'applied' : applyStatus === 'failed' ? 'failed' : 'written' });
    }
    const blocked = requiresExecute;
    return {
      ok: result.ok,
      notes,
      result: { ...result, notes, reloaded, applyStatus },
      apply_status: applyStatus,
      blocked,
      blockMessage: blocked
        ? tl('notes.auto.n0533')
        : undefined };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    updateResource(db, 'dns_zones', id, { apply_status: 'failed', last_error: msg });
    return { ok: false, notes: [msg], apply_status: 'failed' };
  }
}

export function seedDnsZoneRecords(
  db: JsonStore,
  zoneId: string,
  zone: string,
  serverIp: string,
  template?: string,
  serverIpv6?: string,
): void {
  const plan = planDnsZone({ zone, serverIp, serverIpv6, template });
  for (const rec of plan.records) {
    createResource(db, 'dns_records', {
      zoneId,
      type: rec.type,
      name: rec.name,
      value: rec.value,
      ttl: rec.ttl ?? 300,
      apply_status: 'draft' });
  }
}

/**
 * @deprecated Prefer applyFtpAccountReal from ftps-service (async, real vsftpd).
 * Sync fallback only writes managed files and marks pending — never fake applied.
 */
export function applyFtpAccount(
  db: JsonStore,
  dataDir: string,
  id: string,
): { ok: boolean; notes: string[]; applied?: boolean } {
  const acc = getResource(db, 'ftp_accounts', id);
  if (!acc) return { ok: false, notes: [tl('notes.auto.n0011')] };
  const home = String(acc.homePath ?? join(dataDir, 'ftps', 'homes', String(acc.username)));
  const absHome = home.startsWith('/') ? home : join(dataDir, home);
  if (absHome === '/' || absHome === '/etc' || absHome.startsWith('/etc/') || absHome === '/root') {
    return { ok: false, notes: [tl('notes.auto.n0878')] };
  }
  mkdirSync(home, { recursive: true });
  const mapPath = join(dataDir, 'ftps', 'virtual_users.map');
  mkdirSync(join(dataDir, 'ftps'), { recursive: true });
  const accounts = listResources(db, 'ftp_accounts');
  const lines = accounts.map((a) => {
    const h = String(a.homePath ?? join(dataDir, 'ftps', 'homes', String(a.username)));
    mkdirSync(h, { recursive: true });
    return `${a.username}:*:***:${h}`;
  });
  writeFileSync(mapPath, lines.join('\n') + '\n', 'utf8');
  updateResource(db, 'ftp_accounts', id, {
    apply_status: 'pending_execute',
    homePath: home,
    mapPath });
  return {
    ok: false,
    applied: false,
    notes: [
      tl('notes.auto.t0425', { v0: String(acc.username) }),
      tl('notes.auto.n0706'),
    ] };
}

export function deleteCertificateFiles(
  db: JsonStore,
  dataDir: string,
  id: string,
): { ok: boolean; notes: string[] } {
  const cert = getResource(db, 'certificates', id);
  if (!cert) return { ok: false, notes: [tl('notes.notFound')] };
  const notes: string[] = [];
  const domain = String(cert.domain ?? '');
  const certDir = join(dataDir, 'certs', domain);
  if (domain && existsSync(certDir)) {
    try {
      rmSync(certDir, { recursive: true, force: true });
      notes.push(tl('notes.tpl.removed', { name: certDir }));
    } catch (e) {
      notes.push(tl('notes.auto.t0426', { v0: (e instanceof Error ? e.message : String(e)) }));
    }
  }
  deleteResource(db, 'certificates', id);
  notes.push(tl('notes.auto.n0797'));
  return { ok: true, notes };
}
