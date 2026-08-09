/**
 * DNS cluster peers / push / reload / probe (Wave X2).
 * Extracted from dns.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDnsClusterRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/dns/cluster/peers') {
    ctx.auth.authenticate(getBearer(req));
    const { listDnsClusterPeers } = await import('@ysk/core');
    sendJson(res, 200, { items: listDnsClusterPeers(ctx.db) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/peers') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      host?: string;
      username?: string;
      port?: number;
      path?: string;
      label?: string;
      id?: string;
      sshIdentityId?: string;
    };
    const { upsertDnsClusterPeer } = await import('@ysk/core');
    const peer = upsertDnsClusterPeer(ctx.db, {
      id: data.id,
      host: data.host ?? '',
      username: data.username ?? '',
      port: data.port,
      path: data.path,
      label: data.label,
      sshIdentityId: data.sshIdentityId,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'dns.cluster.peer',
      resource: peer.id,
      detail: { host: peer.host },
      ok: true,
    });
    sendJson(res, 200, { peer });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/push') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      peerId?: string;
      /** default true: remote reload after scp */
      reload?: boolean;
      probeAfter?: boolean;
    };
    const { pushDnsZonesToCluster } = await import('@ysk/core');
    const r = await pushDnsZonesToCluster({
      db: ctx.db,
      host: ctx.host,
      dataDir: ctx.dataDir,
      peerId: data.peerId,
      reload: data.reload,
      probeAfter: data.probeAfter,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'dns.cluster.push',
      detail: {
        ok: r.ok,
        apply_status: r.apply_status,
        peerCount: r.peers?.length,
        notes: r.notes?.slice(0, 8),
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/reload') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { peerId?: string };
    const { reloadDnsClusterPeers } = await import('@ysk/core');
    const r = await reloadDnsClusterPeers({
      db: ctx.db,
      host: ctx.host,
      dataDir: ctx.dataDir,
      peerId: data.peerId,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'dns.cluster.reload',
      detail: {
        ok: r.ok,
        apply_status: r.apply_status,
        peerCount: r.peers?.length,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/probe') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { peerId?: string };
    const { probeDnsClusterPeers } = await import('@ysk/core');
    const r = await probeDnsClusterPeers({
      db: ctx.db,
      host: ctx.host,
      dataDir: ctx.dataDir,
      peerId: data.peerId,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'dns.cluster.probe',
      detail: {
        ok: r.ok,
        apply_status: r.apply_status,
        peerCount: r.peers?.length,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/dns\/cluster\/peers\/[^/]+$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[6];
    const { deleteDnsClusterPeer } = await import('@ysk/core');
    const ok = deleteDnsClusterPeer(ctx.db, id);
    ctx.audit.append({
      actor: user.username,
      action: 'dns.cluster.peer.delete',
      resource: id,
      detail: { ok },
      ok });
    sendJson(res, ok ? 200 : 404, { ok });
    return true;
  }

  return false;
}
