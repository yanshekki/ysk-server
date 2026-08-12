/**
 * CDN SSL: resolve certs, LE issue (http-01), distribute PEM to edges (PR-C6).
 * Honesty: certbot success ≠ all edges TLS-ready until distribute+reload.
 */

import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErrorCodes,
  YskError,
  type ApplyStatus,
  type CdnNodeDto,
  type CdnSiteDto,  tl} from 'ysk-server-shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import {
  findCertForDomain,
  resolveManagedCertPaths } from '../ssl-certs.js';
import { planLetsEncrypt } from '../nginx-ssl.js';
import {
  applyCdnSiteEdgeRender,
  type CdnEdgeSslPaths } from './edge-render.js';
import { fanOutCdnSite, type CdnEdgeApplyItem, type CdnFanOutResult } from './fan-out.js';
import { getCdnNode } from './nodes.js';
import { getCdnSite, upsertCdnSite } from './sites.js';

export type CdnCertResolve = {
  ok: boolean;
  domain: string;
  fullchain: string;
  privkey: string;
  provider: 'upload' | 'letsencrypt' | 'unknown';
  certId?: string;
  notes: string[];
};

/** Edge-local cert directory */
export function edgeCertDir(siteId: string): string {
  return `/etc/ysk-cdn/certs/${siteId}`;
}

export function edgeSslPaths(siteId: string): CdnEdgeSslPaths {
  const dir = edgeCertDir(siteId);
  return {
    fullchain: `${dir}/fullchain.pem`,
    privkey: `${dir}/privkey.pem`,
    acmeWebroot: `/var/www/ysk-cdn-acme/${siteId}`,
    redirectHttp: true };
}

/**
 * Resolve source certificate files for a CDN site.
 */
export function resolveCdnSiteCertificate(input: {
  db: JsonStore;
  dataDir: string;
  site: CdnSiteDto;
}): CdnCertResolve {
  const notes: string[] = [];
  const primary = input.site.domains[0];
  if (!primary) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n0042'), { httpStatus: 400 });
  }

  // By certId
  if (input.site.ssl?.certId) {
    const row = (input.db.snapshot.certificates as Array<Record<string, unknown>>).find(
      (c) => String(c.id) === input.site.ssl.certId,
    );
    if (row) {
      const domain = String(row.domain ?? primary);
      const managed = resolveManagedCertPaths(input.dataDir, domain);
      const fullchain = managed.exists
        ? managed.fullchain
        : String(row.fullchain_path ?? '');
      const privkey = managed.exists
        ? managed.privkey
        : String(row.privkey_path ?? '');
      if (fullchain && privkey && existsSync(fullchain) && existsSync(privkey)) {
        return {
          ok: true,
          domain,
          fullchain,
          privkey,
          provider:
            row.provider === 'letsencrypt' ? 'letsencrypt' : 'upload',
          certId: String(row.id),
          notes: [tl('notes.auto.t0714', { v0: String(row.id), v1: String(domain) })] };
      }
      notes.push(tl('notes.auto.t0715', { v0: String(row.id), v1: String(fullchain) }));
    } else {
      notes.push(tl('notes.auto.t0716', { v0: (input.site.ssl.certId) }));
    }
  }

  // Match primary domain in store / disk
  for (const d of input.site.domains) {
    const managed = resolveManagedCertPaths(input.dataDir, d);
    if (managed.exists) {
      const row = findCertForDomain(input.db, d);
      return {
        ok: true,
        domain: d,
        fullchain: managed.fullchain,
        privkey: managed.privkey,
        provider: row?.provider === 'letsencrypt' ? 'letsencrypt' : 'upload',
        certId: row?.id,
        notes: [tl('notes.auto.t0717', { v0: (d) })] };
    }
    const leFull = `/etc/letsencrypt/live/${d}/fullchain.pem`;
    const leKey = `/etc/letsencrypt/live/${d}/privkey.pem`;
    if (existsSync(leFull) && existsSync(leKey)) {
      return {
        ok: true,
        domain: d,
        fullchain: leFull,
        privkey: leKey,
        provider: 'letsencrypt',
        notes: [tl('notes.auto.t0718', { v0: (d) })] };
    }
  }

  return {
    ok: false,
    domain: primary,
    fullchain: '',
    privkey: '',
    provider: 'unknown',
    notes: [
      ...notes,
      tl('notes.auto.n0858'),
    ] };
}

function resolveSshTarget(node: CdnNodeDto): {
  host: string;
  port: number;
  username: string;
} | null {
  const host =
    node.sshHost?.trim() ||
    node.publicIpv4[0] ||
    (node.baseUrl
      ? (() => {
          try {
            return new URL(node.baseUrl).hostname;
          } catch {
            return '';
          }
        })()
      : '');
  if (!host) return null;
  return {
    host,
    port: node.sshPort && node.sshPort > 0 ? node.sshPort : 22,
    username: node.sshUsername?.trim() || 'root' };
}

function isLocalEdge(node: CdnNodeDto): boolean {
  const t = resolveSshTarget(node);
  if (!t) return true;
  const h = t.host.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

async function resolveIdentityPath(
  dataDir: string | undefined,
  identityId?: string,
): Promise<string | undefined> {
  if (!identityId || !dataDir) return undefined;
  try {
    const { resolveIdentityKeyPath } = await import(
      '../../security/ssh-identity/ops.js'
    );
    const r = resolveIdentityKeyPath(dataDir, identityId);
    return r.ok ? r.path : undefined;
  } catch {
    return undefined;
  }
}

async function scpFile(
  host: HostExecutor,
  local: string,
  target: { host: string; port: number; username: string },
  remotePath: string,
  identityPath?: string,
): Promise<{ ok: boolean; note: string }> {
  const argv = [
    'scp',
    ...(identityPath
      ? [
          '-i',
          identityPath,
          '-o',
          'IdentitiesOnly=yes',
          '-o',
          'BatchMode=yes',
          '-o',
          'StrictHostKeyChecking=accept-new',
        ]
      : ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes']),
    '-P',
    String(target.port),
    local,
    `${target.username}@${target.host}:${remotePath}`,
  ];
  const r = await host.runCommand(argv, { timeoutMs: 60_000 });
  if (r.exitCode !== 0) {
    return {
      ok: false,
      note: tl('notes.auto.t0719', { v0: ((r.stderr || r.stdout).slice(0, 100)) }) };
  }
  return { ok: true, note: `scp → ${remotePath}` };
}

/**
 * Copy fullchain+privkey to every edge; re-render TLS conf; optional fan-out.
 */
export async function distributeCdnSiteSsl(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir: string;
  siteId: string;
  /** Also fan-out nginx conf + reload (default true) */
  applyNginx?: boolean;
  skipDraining?: boolean;
  edgeNodeId?: string;
  /** Pass-through for fleet-only edges */
  enqueue?: import('./fleet-payload.js').CdnFleetEnqueueFn;
}): Promise<CdnFanOutResult & { cert?: CdnCertResolve }> {
  const site = getCdnSite(input.db, input.siteId);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404 });
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      siteId: site.id,
      notes: [tl('notes.auto.n1146')],
      edges: [],
      edge_status: {} };
  }

  const cert = resolveCdnSiteCertificate({
    db: input.db,
    dataDir: input.dataDir,
    site });
  if (!cert.ok) {
    return {
      ok: false,
      apply_status: 'failed',
      siteId: site.id,
      notes: cert.notes,
      edges: [],
      edge_status: {},
      cert };
  }

  const notes = [...cert.notes];
  const remoteDir = edgeCertDir(site.id);
  const edges: CdnEdgeApplyItem[] = [];
  const edge_status: Record<string, ApplyStatus> = { ...site.edge_status };
  const edgeIds = site.edgeNodeIds.filter(
    (id) => !input.edgeNodeId || id === input.edgeNodeId,
  );

  // Stage copy under dataDir for local edges
  const localStage = join(input.dataDir, 'cdn', 'sites', site.id, 'certs');
  mkdirSync(localStage, { recursive: true });
  const stageFull = join(localStage, 'fullchain.pem');
  const stageKey = join(localStage, 'privkey.pem');
  copyFileSync(cert.fullchain, stageFull);
  copyFileSync(cert.privkey, stageKey);

  for (const eid of edgeIds) {
    const node = getCdnNode(input.db, eid);
    if (!node) {
      edges.push({
        edgeNodeId: eid,
        name: eid,
        apply_status: 'failed',
        method: 'skip',
        notes: [tl('notes.cdn.nodeMissing')] });
      edge_status[eid] = 'failed';
      continue;
    }
    if (input.skipDraining !== false && node.status === 'draining') {
      edges.push({
        edgeNodeId: eid,
        name: node.name,
        apply_status: 'planned',
        method: 'skip',
        notes: [tl('notes.auto.n0043')] });
      continue;
    }

    if (isLocalEdge(node)) {
      try {
        mkdirSync(remoteDir, { recursive: true });
        copyFileSync(stageFull, `${remoteDir}/fullchain.pem`);
        copyFileSync(stageKey, `${remoteDir}/privkey.pem`);
        // also ensure acme webroot
        mkdirSync(`/var/www/ysk-cdn-acme/${site.id}`, { recursive: true });
        edges.push({
          edgeNodeId: eid,
          name: node.name,
          apply_status: 'written',
          method: 'local',
          notes: [`local certs → ${remoteDir}`] });
        notes.push(`${node.name}: certs written local`);
      } catch (e) {
        edges.push({
          edgeNodeId: eid,
          name: node.name,
          apply_status: 'failed',
          method: 'local',
          notes: [e instanceof Error ? e.message : String(e)] });
        edge_status[eid] = 'failed';
      }
      continue;
    }

    const target = resolveSshTarget(node);
    if (!target) {
      edges.push({
        edgeNodeId: eid,
        name: node.name,
        apply_status: 'failed',
        method: 'skip',
        notes: [tl('notes.auto.n1065')] });
      edge_status[eid] = 'failed';
      continue;
    }
    const identityPath = await resolveIdentityPath(
      input.dataDir,
      node.sshIdentityId,
    );
    // mkdir remote
    const mk = await input.host.runCommand(
      [
        'ssh',
        ...(identityPath
          ? [
              '-i',
              identityPath,
              '-o',
              'IdentitiesOnly=yes',
              '-o',
              'BatchMode=yes',
              '-o',
              'StrictHostKeyChecking=accept-new',
            ]
          : ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes']),
        '-p',
        String(target.port),
        `${target.username}@${target.host}`,
        'bash',
        '-lc',
        `mkdir -p ${JSON.stringify(remoteDir)} ${JSON.stringify(`/var/www/ysk-cdn-acme/${site.id}`)} && chmod 755 ${JSON.stringify(remoteDir)}`,
      ],
      { timeoutMs: 20_000 },
    );
    if (mk.exitCode !== 0) {
      edges.push({
        edgeNodeId: eid,
        name: node.name,
        apply_status: 'failed',
        method: 'ssh',
        notes: [tl('notes.auto.t0720', { v0: ((mk.stderr || mk.stdout).slice(0, 80)) })] });
      edge_status[eid] = 'failed';
      continue;
    }
    const a = await scpFile(
      input.host,
      stageFull,
      target,
      `${remoteDir}/fullchain.pem`,
      identityPath,
    );
    const b = await scpFile(
      input.host,
      stageKey,
      target,
      `${remoteDir}/privkey.pem`,
      identityPath,
    );
    // tighten key perms
    await input.host.runCommand(
      [
        'ssh',
        ...(identityPath
          ? ['-i', identityPath, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes']
          : ['-o', 'BatchMode=yes']),
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-p',
        String(target.port),
        `${target.username}@${target.host}`,
        'bash',
        '-lc',
        `chmod 644 ${JSON.stringify(`${remoteDir}/fullchain.pem`)} && chmod 600 ${JSON.stringify(`${remoteDir}/privkey.pem`)}`,
      ],
      { timeoutMs: 15_000 },
    );

    const ok = a.ok && b.ok;
    edges.push({
      edgeNodeId: eid,
      name: node.name,
      apply_status: ok ? 'written' : 'failed',
      method: 'ssh',
      notes: [a.note, b.note] });
    edge_status[eid] = ok ? 'written' : 'failed';
    notes.push(`${node.name}@${target.host}: ${ok ? 'certs ok' : 'certs fail'}`);
  }

  // Bind certId on site if resolved
  if (cert.certId && site.ssl.certId !== cert.certId) {
    upsertCdnSite(input.db, {
      ...site,
      name: site.name,
      ssl: {
        mode: site.ssl.mode === 'off' ? 'upload' : site.ssl.mode,
        certId: cert.certId } });
  }

  // Re-render with TLS paths
  const sslPaths = edgeSslPaths(site.id);
  await applyCdnSiteEdgeRender({
    db: input.db,
    dataDir: input.dataDir,
    siteId: site.id,
    host: input.host,
    sslPaths });
  notes.push(tl('notes.auto.n0809'));

  if (input.applyNginx !== false) {
    const fo = await fanOutCdnSite({
      db: input.db,
      host: input.host,
      dataDir: input.dataDir,
      siteId: site.id,
      edgeNodeId: input.edgeNodeId,
      skipDraining: input.skipDraining,
      renderFirst: false,
      enqueue: input.enqueue });
    notes.push(...fo.notes.map((n) => `nginx: ${n}`));
    // merge edge status: cert written + nginx applied
    for (const e of fo.edges) {
      const prev = edges.find((x) => x.edgeNodeId === e.edgeNodeId);
      if (prev && prev.apply_status !== 'failed') {
        if (e.apply_status === 'applied') {
          prev.apply_status = 'applied';
          prev.reloaded = e.reloaded;
          prev.notes.push(...e.notes);
        } else if (e.apply_status === 'failed') {
          prev.apply_status = 'partial';
          prev.notes.push(...e.notes);
        } else {
          prev.notes.push(...e.notes);
        }
      }
      edge_status[e.edgeNodeId] = prev?.apply_status ?? e.apply_status;
    }
    notes.push(...fo.notes.slice(-3));
  }

  const applied = edges.filter((e) => e.apply_status === 'applied').length;
  const writtenN = edges.filter((e) => e.apply_status === 'written').length;
  const failed = edges.filter((e) => e.apply_status === 'failed').length;
  let apply_status: ApplyStatus;
  let ok: boolean;
  if (applied === edges.length && edges.length > 0) {
    apply_status = 'applied';
    ok = true;
  } else if (applied + writtenN > 0 && failed < edges.length) {
    apply_status = applied > 0 ? 'partial' : 'written';
    ok = applied > 0 || writtenN === edges.length;
  } else {
    apply_status = 'failed';
    ok = false;
  }

  notes.push(
    tl('notes.tpl.sslDistributeNote'),
  );

  return {
    ok,
    apply_status,
    siteId: site.id,
    notes,
    edges,
    edge_status,
    cert };
}

/**
 * Prepare ACME HTTP conf (webroot) and fan-out — step before certbot.
 */
export async function prepareCdnSiteAcme(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir: string;
  siteId: string;
  enqueue?: import('./fleet-payload.js').CdnFleetEnqueueFn;
}): Promise<CdnFanOutResult> {
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      siteId: input.siteId,
      notes: [tl('notes.auto.n1176')],
      edges: [],
      edge_status: {} };
  }
  const site = getCdnSite(input.db, input.siteId);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404 });
  }
  mkdirSync(`/var/www/ysk-cdn-acme/${site.id}`, { recursive: true });
  await applyCdnSiteEdgeRender({
    db: input.db,
    dataDir: input.dataDir,
    siteId: site.id,
    host: input.host,
    acmeOnly: true,
    sslPaths: {
      fullchain: '',
      privkey: '',
      acmeWebroot: `/var/www/ysk-cdn-acme/${site.id}` } });
  return fanOutCdnSite({
    db: input.db,
    host: input.host,
    dataDir: input.dataDir,
    siteId: site.id,
    renderFirst: false,
    enqueue: input.enqueue });
}

/**
 * Issue Let’s Encrypt (http-01 preferred) on control plane, then distribute.
 */
export async function issueCdnSiteLetsEncrypt(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir: string;
  siteId: string;
  email: string;
  /** default true: run certbot when EXECUTE */
  run?: boolean;
  /** After issue, distribute to edges (default true) */
  distribute?: boolean;
  enqueue?: import('./fleet-payload.js').CdnFleetEnqueueFn;
}): Promise<{
  ok: boolean;
  apply_status: ApplyStatus;
  siteId: string;
  notes: string[];
  commands: string[];
  executed?: boolean;
  distribute?: CdnFanOutResult;
  blocked?: boolean;
  requiresExecute?: boolean;
}> {
  const site = getCdnSite(input.db, input.siteId);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404 });
  }
  const email = input.email.trim();
  if (!email || !email.includes('@')) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.auto.n1578'), {
      httpStatus: 400 });
  }

  const mode = site.ssl?.mode || 'le_http01';
  const primary = site.domains[0];
  const notes: string[] = [];
  const commands: string[] = [];

  if (mode === 'le_dns01' || primary.startsWith('*.')) {
    const plan = planLetsEncrypt({
      domain: primary.startsWith('*.') ? primary : `*.${primary}`,
      email,
      provider: 'letsencrypt',
      challenge: 'dns-01' });
    commands.push(...plan.commands);
    notes.push(...plan.notes);
    notes.push(tl('notes.auto.n0253'));
    return {
      ok: true,
      apply_status: 'planned',
      siteId: site.id,
      notes,
      commands,
      executed: false };
  }

  // http-01 via webroot
  const webroot = `/var/www/ysk-cdn-acme/${site.id}`;
  const dFlags = site.domains.map((d) => `-d ${d}`).join(' ');
  const cmd = `certbot certonly --webroot -w ${webroot} ${dFlags} --email ${email} --agree-tos --non-interactive --keep-until-expiring`;
  commands.push(cmd);
  notes.push(tl('notes.auto.n0304'));

  if (input.run === false) {
    return {
      ok: true,
      apply_status: 'planned',
      siteId: site.id,
      notes: [...notes, 'dry plan only（run=false）'],
      commands,
      executed: false };
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      siteId: site.id,
      notes: [tl('notes.auto.n1158')],
      commands };
  }

  // Prepare ACME conf first
  const prep = await prepareCdnSiteAcme({
    db: input.db,
    host: input.host,
    dataDir: input.dataDir,
    siteId: site.id });
  notes.push(...prep.notes.map((n) => `acme-prep: ${n}`));

  mkdirSync(webroot, { recursive: true });
  const r = await input.host.runCommand(['bash', '-c', cmd], {
    timeoutMs: 180_000 });
  const executed = true;
  if (r.exitCode !== 0) {
    notes.push(
      tl('notes.auto.t0721', { v0: ((r.stderr || r.stdout).slice(0, 200)) }),
    );
    return {
      ok: false,
      apply_status: 'failed',
      siteId: site.id,
      notes,
      commands,
      executed };
  }
  notes.push(tl('notes.auto.n0236'));

  // Point site ssl mode
  upsertCdnSite(input.db, {
    ...site,
    name: site.name,
    ssl: { mode: 'le_http01', certId: site.ssl?.certId } });

  let dist: CdnFanOutResult | undefined;
  if (input.distribute !== false) {
    dist = await distributeCdnSiteSsl({
      db: input.db,
      host: input.host,
      dataDir: input.dataDir,
      siteId: site.id,
      enqueue: input.enqueue });
    notes.push(...dist.notes.map((n) => `distribute: ${n}`));
  }

  return {
    ok: dist ? dist.ok : true,
    apply_status: dist?.apply_status ?? 'written',
    siteId: site.id,
    notes,
    commands,
    executed,
    distribute: dist };
}
