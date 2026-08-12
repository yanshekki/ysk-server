/**
 * CDN edge fan-out apply + purge (PR-C3).
 * SSH/scp conf to each edge, nginx -t + reload; purge cache dirs.
 * Honesty: partial when any edge fails; draining edges skipped by default.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ErrorCodes,
  YskError,
  type ApplyStatus,
  type CdnNodeDto,
  type CdnSiteDto,  tl} from '@yanshekki/shared';
import type { JsonStore } from '../../db/store.js';
import type { HostExecutor } from '../../host/executor.js';
import {
  applyCdnSiteEdgeRender,
  renderCdnEdgeNginxConf } from './edge-render.js';
import type {
  CdnFleetApplyPayload,
  CdnFleetEnqueueFn,
  CdnFleetPurgePayload } from './fleet-payload.js';
import { getCdnNode } from './nodes.js';
import { getCdnSite, patchCdnSiteStatus } from './sites.js';
import { edgeSslPaths } from './ssl.js';
import { shellBinExists } from '../software-probe/index.js';

export type { CdnFleetEnqueueFn } from './fleet-payload.js';

/** Public URL of shield edge for other edges to proxy_pass */
export function resolveShieldUpstreamUrl(
  site: CdnSiteDto,
  shield: CdnNodeDto,
): string {
  if (shield.baseUrl?.trim()) {
    return shield.baseUrl.replace(/\/$/, '');
  }
  const ip = shield.publicIpv4[0] || shield.publicIpv6[0];
  if (ip) {
    const scheme = site.ssl?.mode && site.ssl.mode !== 'off' ? 'https' : 'http';
    // IPv6 needs brackets
    const host = ip.includes(':') ? `[${ip}]` : ip;
    return `${scheme}://${host}`;
  }
  return 'http://127.0.0.1:80';
}

export type CdnEdgeApplyItem = {
  edgeNodeId: string;
  name: string;
  apply_status: ApplyStatus;
  method: 'local' | 'ssh' | 'fleet' | 'skip';
  notes: string[];
  reloaded?: boolean;
};

export type CdnFanOutResult = {
  ok: boolean;
  apply_status: ApplyStatus;
  siteId: string;
  contentHash?: string;
  notes: string[];
  written?: string[];
  edges: CdnEdgeApplyItem[];
  edge_status: Record<string, ApplyStatus>;
  blocked?: boolean;
  requiresExecute?: boolean;
};

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
  if (!t) return true; // no remote target → treat as local control-plane edge
  const h = t.host.toLowerCase();
  return (
    h === '127.0.0.1' ||
    h === 'localhost' ||
    h === '::1' ||
    h === '0.0.0.0'
  );
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

function sshBaseArgv(
  target: { host: string; port: number; username: string },
  identityPath?: string,
): string[] {
  const base = ['ssh'];
  if (identityPath) {
    base.push(
      '-i',
      identityPath,
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ConnectTimeout=12',
    );
  } else {
    base.push(
      '-o',
      'StrictHostKeyChecking=no',
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=12',
    );
  }
  base.push('-p', String(target.port), `${target.username}@${target.host}`);
  return base;
}

async function sshRun(
  host: HostExecutor,
  target: { host: string; port: number; username: string },
  remoteCmd: string,
  identityPath?: string,
  timeoutMs = 45_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const argv = [
    ...sshBaseArgv(target, identityPath),
    'bash',
    '-lc',
    remoteCmd,
  ];
  const r = await host.runCommand(argv, { timeoutMs });
  return {
    exitCode: r.exitCode,
    stdout: r.stdout || '',
    stderr: r.stderr || '' };
}


const REMOTE_NGINX_RELOAD = [
  `if ! ${shellBinExists('nginx')}; then echo NGINX_NONE; exit 1; fi`,
  'if ! nginx -t >/tmp/ysk-nginx-t.out 2>&1; then echo NGINX_TEST_FAIL; cat /tmp/ysk-nginx-t.out; exit 1; fi',
  'if systemctl reload nginx >/dev/null 2>&1 || nginx -s reload >/dev/null 2>&1; then echo NGINX_RELOAD_OK; exit 0; fi',
  'echo NGINX_RELOAD_FAIL; exit 1',
].join('; ');

/**
 * Fan-out site conf to all (or one) edge nodes.
 */
export async function fanOutCdnSite(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir: string;
  siteId: string;
  /** Limit to one edge */
  edgeNodeId?: string;
  /** Skip draining nodes (default true) */
  skipDraining?: boolean;
  projectOriginUrl?: string;
  /** Force re-render before fan-out (default true) */
  renderFirst?: boolean;
  /**
   * Fleet enqueue (control plane). When set, edges with fleetAgentId and no SSH
   * queue conf apply to the agent. Queued ≠ edge nginx applied.
   */
  enqueue?: CdnFleetEnqueueFn;
}): Promise<CdnFanOutResult> {
  const site = getCdnSite(input.db, input.siteId);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404,
      details: { id: input.siteId } });
  }

  // Honesty split:
  // - conf render + fleet enqueue = control-plane only (no EXECUTE required)
  // - local nginx reload / SSH edge apply = host mutation (needs EXECUTE)
  const canHostMutate = input.host.executeEnabled();
  const notes: string[] = [];
  if (!canHostMutate) {
    notes.push(
      tl('notes.auto.n1126') +
        ' — fleet queue + conf write still allowed; local/SSH reload blocked',
    );
  }

  let confPath = join(input.dataDir, 'cdn', 'sites', site.id, 'edge.conf');
  let contentHash: string | undefined;
  const written: string[] = [];

  if (input.renderFirst !== false || !existsSync(confPath)) {
    const rendered = await applyCdnSiteEdgeRender({
      db: input.db,
      dataDir: input.dataDir,
      siteId: site.id,
      host: input.host,
      dryRun: false,
      projectOriginUrl: input.projectOriginUrl });
    confPath = rendered.confPath || confPath;
    contentHash = rendered.contentHash;
    written.push(...rendered.written);
    notes.push(...rendered.notes.filter((n) => !/未 fan-out/.test(n)));
    notes.push(`render contentHash=${rendered.contentHash}`);
  }

  if (!existsSync(confPath)) {
    return {
      ok: false,
      apply_status: 'failed',
      siteId: site.id,
      notes: [tl('notes.auto.n0851')],
      edges: [],
      edge_status: {} };
  }

  const edgeIds = site.edgeNodeIds.filter(
    (id) => !input.edgeNodeId || id === input.edgeNodeId,
  );
  if (!edgeIds.length) {
    return {
      ok: false,
      apply_status: 'failed',
      siteId: site.id,
      notes: [tl('notes.auto.n1301')],
      edges: [],
      edge_status: {} };
  }

  const confBasename = `ysk-cdn-${site.id.slice(0, 8)}.conf`;
  const edges: CdnEdgeApplyItem[] = [];
  const edge_status: Record<string, ApplyStatus> = {
    ...site.edge_status };

  // Origin shield URL for non-shield edges (PR-C7)
  let shieldUrl: string | undefined;
  if (site.originShieldNodeId) {
    const shieldNode = getCdnNode(input.db, site.originShieldNodeId);
    if (shieldNode) {
      shieldUrl = resolveShieldUpstreamUrl(site, shieldNode);
      notes.push(
        `origin shield=${shieldNode.name} upstream=${shieldUrl}`,
      );
    } else {
      notes.push(
        tl('notes.auto.t0722', { v0: (site.originShieldNodeId) }),
      );
    }
  }

  for (const eid of edgeIds) {
    const node = getCdnNode(input.db, eid);
    if (!node) {
      const item: CdnEdgeApplyItem = {
        edgeNodeId: eid,
        name: eid,
        apply_status: 'failed',
        method: 'skip',
        notes: [tl('notes.cdn.nodeMissing')] };
      edges.push(item);
      edge_status[eid] = 'failed';
      continue;
    }

    if (input.skipDraining !== false && node.status === 'draining') {
      const item: CdnEdgeApplyItem = {
        edgeNodeId: eid,
        name: node.name,
        apply_status: 'planned',
        method: 'skip',
        notes: [tl('notes.auto.n1256')] };
      edges.push(item);
      edge_status[eid] = 'planned';
      notes.push(`${node.name}: skip draining`);
      continue;
    }

    // Per-edge conf when origin shield is configured
    let edgeConfPath = confPath;
    if (site.originShieldNodeId) {
      const isShield = site.originShieldNodeId === eid;
      const sslPaths =
        site.ssl?.mode && site.ssl.mode !== 'off'
          ? edgeSslPaths(site.id)
          : undefined;
      const rendered = renderCdnEdgeNginxConf({
        site,
        projectOriginUrl: input.projectOriginUrl,
        sslPaths,
        shieldUpstreamUrl: isShield ? undefined : shieldUrl,
        isShieldEdge: isShield,
        forEdgeNodeId: eid });
      const edgeDir = join(
        input.dataDir,
        'cdn',
        'sites',
        site.id,
        'edges',
      );
      mkdirSync(edgeDir, { recursive: true });
      edgeConfPath = join(edgeDir, `${eid.slice(0, 8)}.conf`);
      writeFileSync(edgeConfPath, rendered.conf, 'utf8');
      contentHash = rendered.contentHash;
      written.push(edgeConfPath);
      notes.push(
        `${node.name}: ${isShield ? 'shield conf' : 'via-shield conf'} hash=${rendered.contentHash}`,
      );
    }

    // Fleet-only edge (no SSH target): enqueue conf for agent — never mark applied here
    if (node.fleetAgentId?.trim() && !resolveSshTarget(node)) {
      const item = applyFleetEdgeEnqueue({
        node,
        siteId: site.id,
        confPath: edgeConfPath,
        confBasename,
        enqueue: input.enqueue });
      edges.push(item);
      edge_status[eid] = item.apply_status;
      notes.push(
        `${node.name}: fleet ${item.apply_status} — ${item.notes[0] ?? ''}`,
      );
      continue;
    }

    // Prefer SSH when both fleetAgentId and SSH exist (sync apply)
    if (node.fleetAgentId?.trim() && resolveSshTarget(node)) {
      notes.push(
        tl('notes.auto.t0723', { v0: (node.name) }),
      );
    }

    if (isLocalEdge(node)) {
      if (!canHostMutate) {
        // Still write conf under dataDir nginx/conf.d (control-plane managed path)
        const item = await applyLocalEdge({
          host: input.host,
          dataDir: input.dataDir,
          confPath: edgeConfPath,
          confBasename,
          node,
          siteId: site.id,
          skipReload: true,
        });
        edges.push(item);
        edge_status[eid] = item.apply_status;
        notes.push(
          `${node.name}: ${item.apply_status} (local conf write, no reload without EXECUTE)`,
        );
        continue;
      }
      const item = await applyLocalEdge({
        host: input.host,
        dataDir: input.dataDir,
        confPath: edgeConfPath,
        confBasename,
        node,
        siteId: site.id });
      edges.push(item);
      edge_status[eid] = item.apply_status;
      notes.push(
        `${node.name}: ${item.apply_status} (${item.method}) — ${item.notes[0] ?? ''}`,
      );
      continue;
    }

    if (!canHostMutate) {
      const item: CdnEdgeApplyItem = {
        edgeNodeId: eid,
        name: node.name,
        apply_status: 'blocked',
        method: 'ssh',
        notes: [tl('notes.auto.n1126') + ' — SSH edge apply requires YSK_EXECUTE=1'],
      };
      edges.push(item);
      edge_status[eid] = 'blocked';
      notes.push(`${node.name}: blocked (SSH needs EXECUTE)`);
      continue;
    }

    const target = resolveSshTarget(node)!;
    const item = await applySshEdge({
      host: input.host,
      dataDir: input.dataDir,
      confPath: edgeConfPath,
      confBasename,
      node,
      target,
      siteId: site.id });
    edges.push(item);
    edge_status[eid] = item.apply_status;
    notes.push(
      `${node.name}@${target.host}: ${item.apply_status} — ${item.notes[0] ?? ''}`,
    );
  }

  const applied = edges.filter((e) => e.apply_status === 'applied').length;
  const failed = edges.filter((e) => e.apply_status === 'failed').length;
  const blockedN = edges.filter((e) => e.apply_status === 'blocked').length;
  const fleetQueued = edges.filter(
    (e) => e.method === 'fleet' && e.apply_status === 'written',
  ).length;
  const writtenOnly = edges.filter((e) => e.apply_status === 'written').length;
  const skipped = edges.filter(
    (e) => e.apply_status === 'planned' || e.method === 'skip',
  ).length;

  let apply_status: ApplyStatus;
  let ok: boolean;
  let blocked: boolean | undefined;
  if (applied === edges.length && edges.length > 0) {
    apply_status = 'applied';
    ok = true;
    notes.push(tl('notes.auto.n0582'));
  } else if (blockedN > 0 && applied === 0 && failed === 0 && writtenOnly === 0) {
    apply_status = 'blocked';
    ok = false;
    blocked = true;
    notes.push(
      tl('notes.auto.t0724', { v0: (blockedN) }),
    );
  } else if (applied > 0) {
    apply_status = 'partial';
    ok = false;
    notes.push(
      `partial：applied=${applied} written=${writtenOnly} failed=${failed} blocked=${blockedN} skipped=${skipped}`,
    );
  } else if (writtenOnly > 0 && failed === 0 && (blockedN === 0 || writtenOnly + skipped === edges.length)) {
    // conf written under dataDir and/or fleet queued — not live nginx-applied
    apply_status = 'written';
    ok = true;
    notes.push(
      fleetQueued > 0
        ? tl('notes.auto.t0725', { v0: fleetQueued })
        : `written=${writtenOnly} (conf under dataDir; not host-applied)`,
    );
  } else if (failed === 0 && skipped === edges.length) {
    apply_status = 'written';
    ok = true;
    notes.push(tl('notes.auto.n1076'));
  } else {
    apply_status = 'failed';
    ok = false;
    notes.push(tl('notes.auto.n0583'));
  }

  patchCdnSiteStatus(input.db, site.id, {
    apply_status,
    edge_status });

  return {
    ok,
    apply_status,
    siteId: site.id,
    contentHash,
    notes,
    written,
    edges,
    edge_status,
    ...(blocked ? { blocked: true } : {}) };
}

/**
 * Enqueue conf apply to fleet agent. Never marks applied (agent must ack).
 */
function applyFleetEdgeEnqueue(input: {
  node: CdnNodeDto;
  siteId: string;
  confPath: string;
  confBasename: string;
  enqueue?: CdnFleetEnqueueFn;
}): CdnEdgeApplyItem {
  const sessionId = input.node.fleetAgentId!.trim();
  if (!input.enqueue) {
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'blocked',
      method: 'fleet',
      notes: [
        tl('notes.auto.t0726', { v0: (sessionId) }),
      ] };
  }
  if (!existsSync(input.confPath)) {
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'failed',
      method: 'fleet',
      notes: [tl('notes.auto.t0727', { v0: (input.confPath) })] };
  }
  let confContent: string;
  try {
    confContent = readFileSync(input.confPath, 'utf8');
  } catch (e) {
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'failed',
      method: 'fleet',
      notes: [
        tl('notes.auto.t0728', { v0: (e instanceof Error ? e.message : String(e)) }),
      ] };
  }
  const remoteDir =
    input.node.remoteNginxConfDir?.trim() || '/etc/nginx/conf.d';
  const payload: CdnFleetApplyPayload = {
    op: 'cdn.edge.apply',
    siteId: input.siteId,
    edgeNodeId: input.node.id,
    confBasename: input.confBasename,
    confContent,
    remoteDir,
    cacheDir: `/var/cache/ysk-cdn/${input.siteId}` };
  try {
    const cmd = input.enqueue(sessionId, payload);
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'written',
      method: 'fleet',
      notes: [
        `fleet command queued ${cmd.id.slice(0, 8)}… → session ${sessionId.slice(0, 8)}…`,
        tl('notes.auto.n0398'),
      ],
      reloaded: false };
  } catch (e) {
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'failed',
      method: 'fleet',
      notes: [
        tl('notes.auto.t0729', { v0: (e instanceof Error ? e.message : String(e)) }),
      ] };
  }
}

async function applyLocalEdge(input: {
  host: HostExecutor;
  dataDir: string;
  confPath: string;
  confBasename: string;
  node: CdnNodeDto;
  siteId: string;
  /** Write conf only — no nginx -t / reload (degraded / no EXECUTE) */
  skipReload?: boolean;
}): Promise<CdnEdgeApplyItem> {
  const notes: string[] = [];
  const confDir =
    input.node.remoteNginxConfDir?.trim() ||
    join(input.dataDir, 'nginx', 'conf.d');
  try {
    mkdirSync(confDir, { recursive: true });
    const dest = join(confDir, input.confBasename);
    const { readFileSync } = await import('node:fs');
    writeFileSync(dest, readFileSync(input.confPath, 'utf8'), 'utf8');
    notes.push(`local conf → ${dest}`);

    if (input.skipReload) {
      notes.push('skipReload: conf written under dataDir only');
      return {
        edgeNodeId: input.node.id,
        name: input.node.name,
        apply_status: 'written',
        method: 'local',
        notes,
        reloaded: false,
      };
    }

    // ensure cache dir
    const cacheDir = `/var/cache/ysk-cdn/${input.siteId}`;
    await input.host.runCommand(['mkdir', '-p', cacheDir], {
      timeoutMs: 5_000 });

    if (!input.host.pathExists('/usr/sbin/nginx') && !input.host.pathExists('/usr/bin/nginx')) {
      notes.push(tl('notes.auto.n1000'));
      return {
        edgeNodeId: input.node.id,
        name: input.node.name,
        apply_status: 'written',
        method: 'local',
        notes,
        reloaded: false };
    }

    const t = await input.host.runCommand(['nginx', '-t'], {
      timeoutMs: 15_000 });
    if (t.exitCode !== 0) {
      notes.push(
        tl('notes.auto.t0730', { v0: ((t.stderr || t.stdout).slice(0, 120)) }),
      );
      return {
        edgeNodeId: input.node.id,
        name: input.node.name,
        apply_status: 'failed',
        method: 'local',
        notes,
        reloaded: false };
    }
    const r = await input.host.runCommand(
      ['bash', '-c', 'systemctl reload nginx 2>/dev/null || nginx -s reload'],
      { timeoutMs: 15_000 },
    );
    if (r.exitCode === 0) {
      notes.push('local nginx reload OK');
      return {
        edgeNodeId: input.node.id,
        name: input.node.name,
        apply_status: 'applied',
        method: 'local',
        notes,
        reloaded: true };
    }
    notes.push(tl('notes.tpl.reloadFailed', { detail: (r.stderr || r.stdout).slice(0, 100) }));
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'partial',
      method: 'local',
      notes,
      reloaded: false };
  } catch (e) {
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'failed',
      method: 'local',
      notes: [e instanceof Error ? e.message : String(e)] };
  }
}

async function applySshEdge(input: {
  host: HostExecutor;
  dataDir: string;
  confPath: string;
  confBasename: string;
  node: CdnNodeDto;
  target: { host: string; port: number; username: string };
  siteId: string;
}): Promise<CdnEdgeApplyItem> {
  const notes: string[] = [];
  const identityPath = await resolveIdentityPath(
    input.dataDir,
    input.node.sshIdentityId,
  );
  const remoteDir =
    input.node.remoteNginxConfDir?.trim() || '/etc/nginx/conf.d';
  const remoteConf = `${remoteDir}/${input.confBasename}`;
  const cacheDir = `/var/cache/ysk-cdn/${input.siteId}`;

  // mkdir remote
  const mk = await sshRun(
    input.host,
    input.target,
    `mkdir -p ${JSON.stringify(remoteDir)} ${JSON.stringify(cacheDir)}`,
    identityPath,
    20_000,
  );
  if (mk.exitCode !== 0) {
    notes.push(
      tl('notes.auto.t0731', { v0: ((mk.stderr || mk.stdout).slice(0, 120)) }),
    );
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'failed',
      method: 'ssh',
      notes };
  }

  const scpArgv = [
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
    String(input.target.port),
    input.confPath,
    `${input.target.username}@${input.target.host}:${remoteConf}`,
  ];
  const scp = await input.host.runCommand(scpArgv, { timeoutMs: 60_000 });
  if (scp.exitCode !== 0) {
    notes.push(
      tl('notes.auto.t0732', { v0: ((scp.stderr || scp.stdout).slice(0, 120)) }),
    );
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'failed',
      method: 'ssh',
      notes };
  }
  notes.push(`scp → ${remoteConf}`);

  const reload = await sshRun(
    input.host,
    input.target,
    REMOTE_NGINX_RELOAD,
    identityPath,
    30_000,
  );
  if (reload.exitCode === 0 && /NGINX_RELOAD_OK/.test(reload.stdout)) {
    notes.push('remote nginx -t + reload OK');
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'applied',
      method: 'ssh',
      notes,
      reloaded: true };
  }
  if (/NGINX_NONE/.test(reload.stdout)) {
    notes.push(tl('notes.auto.n1485'));
    return {
      edgeNodeId: input.node.id,
      name: input.node.name,
      apply_status: 'partial',
      method: 'ssh',
      notes,
      reloaded: false };
  }
  notes.push(
    tl('notes.auto.t0733', { v0: ((reload.stderr || reload.stdout).slice(0, 140)) }),
  );
  return {
    edgeNodeId: input.node.id,
    name: input.node.name,
    apply_status: 'partial',
    method: 'ssh',
    notes,
    reloaded: false };
}

/**
 * Purge proxy_cache on all edges for a site.
 */
export async function purgeCdnSite(input: {
  db: JsonStore;
  host: HostExecutor;
  dataDir: string;
  siteId: string;
  edgeNodeId?: string;
  skipDraining?: boolean;
  /** Fleet enqueue for fleet-only edges */
  enqueue?: CdnFleetEnqueueFn;
}): Promise<CdnFanOutResult> {
  const site = getCdnSite(input.db, input.siteId);
  if (!site) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.cdn.siteNotFound'), {
      httpStatus: 404,
      details: { id: input.siteId } });
  }

  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      apply_status: 'blocked',
      siteId: site.id,
      notes: [tl('notes.auto.n1132')],
      edges: [],
      edge_status: {} };
  }

  const cacheDir = `/var/cache/ysk-cdn/${site.id}`;
  const notes: string[] = [`purge cache path ${cacheDir}`];
  const edges: CdnEdgeApplyItem[] = [];
  const edge_status: Record<string, ApplyStatus> = { ...site.edge_status };
  const edgeIds = site.edgeNodeIds.filter(
    (id) => !input.edgeNodeId || id === input.edgeNodeId,
  );

  const purgeCmd = [
    `if [ -d ${JSON.stringify(cacheDir)} ]; then`,
    `  find ${JSON.stringify(cacheDir)} -type f -delete 2>/dev/null;`,
    `  echo PURGE_OK;`,
    `else`,
    `  mkdir -p ${JSON.stringify(cacheDir)}; echo PURGE_EMPTY;`,
    `fi`,
  ].join(' ');

  for (const eid of edgeIds) {
    const node = getCdnNode(input.db, eid);
    if (!node) {
      edges.push({
        edgeNodeId: eid,
        name: eid,
        apply_status: 'failed',
        method: 'skip',
        notes: [tl('notes.cdn.nodeMissing')] });
      continue;
    }
    if (input.skipDraining !== false && node.status === 'draining') {
      edges.push({
        edgeNodeId: eid,
        name: node.name,
        apply_status: 'planned',
        method: 'skip',
        notes: [tl('notes.auto.n0043')] });
      notes.push(`${node.name}: skip draining`);
      continue;
    }

    // Fleet-only (no SSH): enqueue purge for agent
    if (node.fleetAgentId?.trim() && !resolveSshTarget(node)) {
      const sessionId = node.fleetAgentId.trim();
      if (!input.enqueue) {
        edges.push({
          edgeNodeId: eid,
          name: node.name,
          apply_status: 'blocked',
          method: 'fleet',
          notes: [
            tl('notes.auto.t0734', { v0: (sessionId) }),
          ] });
        notes.push(`${node.name}: fleet purge blocked`);
        continue;
      }
      const payload: CdnFleetPurgePayload = {
        op: 'cdn.edge.purge',
        siteId: site.id,
        edgeNodeId: eid,
        cacheDir };
      try {
        const cmd = input.enqueue(sessionId, payload);
        edges.push({
          edgeNodeId: eid,
          name: node.name,
          apply_status: 'written',
          method: 'fleet',
          notes: [
            `fleet purge queued ${cmd.id.slice(0, 8)}…`,
            tl('notes.auto.n0397'),
          ] });
        notes.push(`${node.name}: fleet purge queued`);
      } catch (e) {
        edges.push({
          edgeNodeId: eid,
          name: node.name,
          apply_status: 'failed',
          method: 'fleet',
          notes: [
            tl('notes.auto.t0735', { v0: (e instanceof Error ? e.message : String(e)) }),
          ] });
        notes.push(`${node.name}: fleet purge enqueue failed`);
      }
      continue;
    }

    if (isLocalEdge(node)) {
      const r = await input.host.runCommand(['bash', '-c', purgeCmd], {
        timeoutMs: 30_000 });
      const ok =
        r.exitCode === 0 &&
        (/PURGE_OK/.test(r.stdout) || /PURGE_EMPTY/.test(r.stdout));
      edges.push({
        edgeNodeId: eid,
        name: node.name,
        apply_status: ok ? 'applied' : 'failed',
        method: 'local',
        notes: [
          ok
            ? /PURGE_EMPTY/.test(r.stdout)
              ? tl('notes.auto.n0319')
              : 'local cache purged'
            : tl('notes.auto.t0736', { v0: ((r.stderr || r.stdout).slice(0, 100)) }),
        ] });
      notes.push(
        `${node.name}: ${ok ? 'purged' : 'purge failed'}`,
      );
      continue;
    }

    const target = resolveSshTarget(node);
    if (!target) {
      edges.push({
        edgeNodeId: eid,
        name: node.name,
        apply_status: 'failed',
        method: 'skip',
        notes: [tl('notes.auto.n1066')] });
      continue;
    }
    const identityPath = await resolveIdentityPath(
      input.dataDir,
      node.sshIdentityId,
    );
    const r = await sshRun(
      input.host,
      target,
      purgeCmd,
      identityPath,
      40_000,
    );
    const ok =
      r.exitCode === 0 &&
      (/PURGE_OK/.test(r.stdout) || /PURGE_EMPTY/.test(r.stdout));
    edges.push({
      edgeNodeId: eid,
      name: node.name,
      apply_status: ok ? 'applied' : 'failed',
      method: 'ssh',
      notes: [
        ok
          ? `remote purge OK @ ${target.host}`
          : tl('notes.auto.t0737', { v0: ((r.stderr || r.stdout).slice(0, 100)) }),
      ] });
    notes.push(
      `${node.name}@${target.host}: ${ok ? 'purged' : 'purge failed'}`,
    );
  }

  const applied = edges.filter((e) => e.apply_status === 'applied').length;
  const failed = edges.filter((e) => e.apply_status === 'failed').length;
  const blockedN = edges.filter((e) => e.apply_status === 'blocked').length;
  const fleetQueued = edges.filter(
    (e) => e.method === 'fleet' && e.apply_status === 'written',
  ).length;
  let apply_status: ApplyStatus;
  let ok: boolean;
  let blocked: boolean | undefined;
  if (applied === edges.length && edges.length > 0) {
    apply_status = 'applied';
    ok = true;
    notes.push(tl('notes.auto.n0584'));
  } else if (blockedN > 0 && applied === 0 && failed === 0 && fleetQueued === 0) {
    apply_status = 'blocked';
    ok = false;
    blocked = true;
    notes.push(tl('notes.auto.n0291'));
  } else if (applied > 0) {
    apply_status = 'partial';
    ok = false;
    notes.push(
      `purge partial：ok=${applied} fleetQueued=${fleetQueued} fail=${failed} blocked=${blockedN}`,
    );
  } else if (fleetQueued > 0 && failed === 0 && blockedN === 0) {
    apply_status = 'written';
    ok = true;
    notes.push(
      tl('notes.auto.t0738', { v0: (fleetQueued) }),
    );
  } else {
    apply_status = 'failed';
    ok = false;
    notes.push(tl('notes.auto.n0395'));
  }

  // purge does not change site apply_status to failed — keep prior deploy status
  // only annotate via notes; optionally leave edge_status untouched for deploy
  return {
    ok,
    apply_status,
    siteId: site.id,
    notes,
    edges,
    edge_status,
    ...(blocked ? { blocked: true } : {}) };
}
