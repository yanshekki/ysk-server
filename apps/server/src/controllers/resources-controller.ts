import { tl } from '@ysk/shared';
/**
 * Managed resource CRUD routes — nginx, ftp, mysql, postgres, redis, dns, certificates.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  applyManagedNginxSite,
  revokeManagedNginxSite,
  applyMysqlDatabase,
  applyPostgresDatabase,
  applyRedisInstance,
  applyDnsZone,
  seedDnsZoneRecords,
  hashFtpPassword,
  isCryptPasswordHash,
  type CollectionKey } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

/** Never return secrets to the panel list/detail API. */
export function redactResourceSecrets(
  key: CollectionKey,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (key !== 'ftp_accounts' && key !== 'mysql_users' && key !== 'postgres_users') {
    return row;
  }
  const {
    password_plain: _pp,
    password: _p,
    password_hash: _ph,
    ...rest
  } = row;
  return {
    ...rest,
    passwordSet: Boolean(
      (typeof _ph === 'string' && _ph.length > 0) ||
        (typeof _pp === 'string' && _pp.length > 0) ||
        (typeof _p === 'string' && _p.length > 0),
    ),
  };
}

/** Hash FTP plaintext on write so plain is never stored long-term. */
function normalizeFtpPasswordFields(data: Record<string, unknown>): Record<string, unknown> {
  const plain = String(data.password_plain ?? data.password ?? '').trim();
  if (!plain) {
    const next = { ...data };
    delete next.password_plain;
    delete next.password;
    return next;
  }
  const hash = hashFtpPassword(plain);
  const next = { ...data };
  delete next.password_plain;
  delete next.password;
  if (isCryptPasswordHash(hash)) {
    next.password_hash = hash;
  } else {
    // keep plain only if hash failed (apply path will warn) — still avoid bare password key
    next.password_plain = plain;
  }
  return next;
}

const COLLECTIONS: Record<string, CollectionKey> = {
  'nginx/sites': 'nginx_sites',
  'ftp/accounts': 'ftp_accounts',
  'mysql/databases': 'mysql_databases',
  'mysql/users': 'mysql_users',
  'postgres/databases': 'postgres_databases',
  'postgres/users': 'postgres_users',
  'redis/instances': 'redis_instances',
  'dns/zones': 'dns_zones',
  'dns/records': 'dns_records',
  'ssl/certs': 'certificates' };

function parseCollection(pathname: string): {
  key: CollectionKey | null;
  id: string | null;
  action: string | null;
  prefix: string | null;
} {
  // /api/v1/resources/<prefix...> or /api/v1/resources/<prefix...>/:id(/action)
  if (!pathname.startsWith('/api/v1/resources/')) {
    return { key: null, id: null, action: null, prefix: null };
  }
  const rest = pathname.slice('/api/v1/resources/'.length);
  const parts = rest.split('/').filter(Boolean);
  // try longest prefix match
  for (let len = Math.min(parts.length, 2); len >= 1; len--) {
    const prefix = parts.slice(0, len).join('/');
    if (COLLECTIONS[prefix]) {
      const id = parts[len] ?? null;
      const action = parts[len + 1] ?? null;
      return { key: COLLECTIONS[prefix], id, action, prefix };
    }
  }
  return { key: null, id: null, action: null, prefix: null };
}

export async function handleResourcesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/resources')) return false;

  const user = ctx.auth.authenticate(getBearer(req));
  const { key, id, action, prefix } = parseCollection(url.pathname);
  if (!key || !prefix) {
    sendJson(res, 404, { ok: false, message: tl('notes.auto.n0966') });
    return true;
  }

  // LIST
  if (method === 'GET' && !id) {
    // SSL: never expose raw multi-row junk — use disk+store view
    if (key === 'certificates') {
      const { listCertificatesView, dedupeCertificatesInStore } = await import('@ysk/core');
      dedupeCertificatesInStore(ctx.db);
      sendJson(res, 200, { items: listCertificatesView(ctx.db, ctx.dataDir) });
      return true;
    }
    let items = listResources(ctx.db, key) as Array<Record<string, unknown>>;
    const zoneId = url.searchParams.get('zoneId');
    const databaseId = url.searchParams.get('databaseId');
    const engine = url.searchParams.get('engine');
    if (zoneId) items = items.filter((r) => r.zoneId === zoneId);
    if (databaseId) items = items.filter((r) => r.databaseId === databaseId);
    if (engine) {
      items = items.filter((r) => String(r.engine ?? 'mysql') === engine);
    }
    const { listWithQuery } = await import('../http/list-response.js');
    const { items: filtered, meta } = listWithQuery(url, items, {
      text: (r) =>
        Object.values(r)
          .filter((v) => typeof v === 'string' || typeof v === 'number')
          .map(String),
    });
    sendJson(res, 200, {
      items: filtered.map((r) => redactResourceSecrets(key, r as Record<string, unknown>)),
      meta,
    });
    return true;
  }

  // GET one
  if (method === 'GET' && id && !action) {
    const row = getResource(ctx.db, key, id);
    if (!row) {
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0004') });
      return true;
    }
    sendJson(res, 200, {
      item: redactResourceSecrets(key, row as Record<string, unknown>),
    });
    return true;
  }

  // CREATE
  if (method === 'POST' && !id) {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as Record<string, unknown>;
    if (key === 'certificates') {
      sendJson(res, 400, {
        ok: false,
        message: tl('notes.auto.n1379') });
      return true;
    }
    // DNS zone: seed template records
    if (key === 'dns_zones') {
      const zone = String(data.zone ?? '').trim();
      const serverIp = String(data.serverIp ?? '127.0.0.1');
      const serverIpv6 = data.serverIpv6
        ? String(data.serverIpv6).trim()
        : undefined;
      const template = String(data.template ?? 'full');
      if (!zone) {
        sendJson(res, 400, { ok: false, message: tl('notes.auto.n1392') });
        return true;
      }
      const nsName = data.nsName ? String(data.nsName).trim() : undefined;
      const ttlRaw = data.ttl != null ? Number(data.ttl) : undefined;
      const ttl =
        ttlRaw != null && Number.isFinite(ttlRaw) && ttlRaw >= 0
          ? Math.floor(ttlRaw)
          : 300;
      const row = createResource(ctx.db, key, {
        zone,
        serverIp,
        ...(serverIpv6 ? { serverIpv6 } : {}),
        mailHost: data.mailHost,
        backend: data.backend ?? 'bind',
        template,
        ...(nsName ? { nsName } : {}),
        ttl,
        apply_status: 'draft' });
      seedDnsZoneRecords(
        ctx.db,
        String(row.id),
        zone,
        serverIp,
        template,
        serverIpv6,
      );
      ctx.audit.append({
        actor: user.username,
        action: 'resources.create',
        resource: prefix,
        detail: { id: row.id, zone, template },
        ok: true });
      sendJson(res, 201, { item: row });
      return true;
    }
    // MySQL DB: optional create linked user
    if (key === 'mysql_databases') {
      const name = String(data.name ?? '').trim();
      if (!name) {
        sendJson(res, 400, { ok: false, message: tl('notes.needName') });
        return true;
      }
      const eng = data.engine === 'mariadb' ? 'mariadb' : 'mysql';
      const row = createResource(ctx.db, key, {
        name,
        charset: data.charset ?? 'utf8mb4',
        projectId: data.projectId,
        engine: eng,
        apply_status: 'draft' });
      if (data.createUser && data.username && data.password) {
        createResource(ctx.db, 'mysql_users', {
          username: data.username,
          host: data.host ?? 'localhost',
          password_plain: data.password,
          databaseId: row.id,
          privileges: data.privileges ?? ['ALL'],
          engine: eng,
          apply_status: 'draft' });
      }
      ctx.audit.append({
        actor: user.username,
        action: 'resources.create',
        resource: prefix,
        detail: { id: row.id, name },
        ok: true });
      sendJson(res, 201, { item: row });
      return true;
    }
    if (key === 'postgres_databases') {
      const name = String(data.name ?? '').trim();
      if (!name) {
        sendJson(res, 400, { ok: false, message: tl('notes.needName') });
        return true;
      }
      const row = createResource(ctx.db, key, {
        name,
        projectId: data.projectId,
        apply_status: 'draft' });
      if (data.createUser && data.username && data.password) {
        createResource(ctx.db, 'postgres_users', {
          username: data.username,
          password_plain: data.password,
          databaseId: row.id,
          apply_status: 'draft' });
      }
      sendJson(res, 201, { item: row });
      return true;
    }

    const createData =
      key === 'ftp_accounts'
        ? normalizeFtpPasswordFields({ ...data, apply_status: data.apply_status ?? 'draft' })
        : { ...data, apply_status: data.apply_status ?? 'draft' };
    const row = createResource(ctx.db, key, createData);
    ctx.audit.append({
      actor: user.username,
      action: 'resources.create',
      resource: prefix,
      detail: { id: row.id },
      ok: true });
    sendJson(res, 201, {
      item: redactResourceSecrets(key, row as Record<string, unknown>),
    });
    return true;
  }

  // PATCH
  if (method === 'PATCH' && id && !action) {
    const raw = await readBody(req);
    let data = JSON.parse(raw || '{}') as Record<string, unknown>;
    delete data.id;
    if (key === 'ftp_accounts') {
      data = normalizeFtpPasswordFields(data);
    }
    const row = updateResource(ctx.db, key, id, data);
    if (!row) {
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0004') });
      return true;
    }
    ctx.audit.append({
      actor: user.username,
      action: 'resources.update',
      resource: `${prefix}/${id}`,
      detail: { ...data, password_plain: undefined, password: undefined, password_hash: data.password_hash ? '[set]' : undefined },
      ok: true });
    sendJson(res, 200, {
      item: redactResourceSecrets(key, row as Record<string, unknown>),
    });
    return true;
  }

  // DELETE
  if (method === 'DELETE' && id && !action) {
    if (key === 'nginx_sites') {
      const r = revokeManagedNginxSite(ctx.db, id);
      ctx.audit.append({
        actor: user.username,
        action: 'resources.delete',
        resource: `${prefix}/${id}`,
        detail: r,
        ok: r.ok });
      sendOpsResult(res, r, { notFound: true });
      return true;
    }
    if (key === 'certificates') {
      const { deleteCertificate } = await import('@ysk/core');
      const r = deleteCertificate(ctx.db, ctx.dataDir, id);
      sendOpsResult(res, r, { notFound: true });
      return true;
    }
    if (key === 'dns_zones') {
      const zoneRow = getResource(ctx.db, 'dns_zones', id);
      const zoneName = zoneRow ? String(zoneRow.zone ?? '') : '';
      // cascade records
      for (const rec of listResources(ctx.db, 'dns_records').filter((r) => r.zoneId === id)) {
        deleteResource(ctx.db, 'dns_records', String(rec.id));
      }
      // Drop managed zone files + re-sync PowerDNS named.conf (avoid answering deleted zones)
      if (zoneName) {
        try {
          const { removeManagedDnsZoneFiles, syncPowerDnsBindZones } = await import('@ysk/core');
          const rm = removeManagedDnsZoneFiles(ctx.dataDir, zoneName);
          ctx.audit.append({
            actor: user.username,
            action: 'dns.zone_file.remove',
            resource: zoneName,
            detail: rm,
            ok: rm.ok,
          });
          if (ctx.host.executeEnabled() && ctx.host.isRoot()) {
            const sync = await syncPowerDnsBindZones({
              dataDir: ctx.dataDir,
              host: ctx.host,
              apply: true,
            });
            ctx.audit.append({
              actor: user.username,
              action: 'dns.powerdns.unbind',
              resource: zoneName,
              detail: { ok: sync.ok, mode: sync.mode, zones: sync.zones },
              ok: sync.ok,
            });
          }
        } catch {
          /* best-effort cleanup */
        }
      }
    }
    if (key === 'mysql_databases') {
      for (const u of listResources(ctx.db, 'mysql_users').filter((r) => r.databaseId === id)) {
        deleteResource(ctx.db, 'mysql_users', String(u.id));
      }
    }
    if (key === 'postgres_databases') {
      for (const u of listResources(ctx.db, 'postgres_users').filter((r) => r.databaseId === id)) {
        deleteResource(ctx.db, 'postgres_users', String(u.id));
      }
    }
    const ok = deleteResource(ctx.db, key, id);
    ctx.audit.append({
      actor: user.username,
      action: 'resources.delete',
      resource: `${prefix}/${id}`,
      detail: { ok },
      ok });
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }

  // APPLY
  if (method === 'POST' && id && action === 'apply') {
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { execute?: boolean };
    // Panel always executes unless explicitly dry-run
    const execute = data.execute !== false;

    if (key === 'nginx_sites') {
      const r = await applyManagedNginxSite(ctx.db, ctx.dataDir, id, {
        host: ctx.host,
        execute,
        systemConfDir: '/etc/nginx/conf.d' });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'mysql_databases') {
      const r = await applyMysqlDatabase(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'postgres_databases') {
      const r = await applyPostgresDatabase(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'redis_instances') {
      const r = await applyRedisInstance(ctx.db, id, ctx.host, execute);
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'dns_zones') {
      const r = await applyDnsZone(ctx.db, ctx.dataDir, id, {
        host: ctx.host,
        validate: true,
        tryReload: execute });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'ftp_accounts') {
      const { applyFtpAccountReal } = await import('@ysk/core');
      const r = await applyFtpAccountReal({
        db: ctx.db,
        dataDir: ctx.dataDir,
        host: ctx.host,
        id });
      sendOpsResult(res, r);
      return true;
    }
    if (key === 'certificates') {
      sendJson(res, 410, {
        ok: false,
        notes: ['Use POST /api/v1/ssl/upload or /api/v1/ssl/letsencrypt — marking applied is disabled'] });
      return true;
    }

    sendJson(res, 400, { ok: false, message: tl('notes.auto.n1040') });
    return true;
  }

  return false;
}
