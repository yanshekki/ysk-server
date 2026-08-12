/**
 * DB HA cluster artifacts / bundle / push / fleet (Wave Y1).
 * Extracted from db-clusters-actions.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDbClustersFleetRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/artifacts$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { listDbClusterArtifacts } = await import('@ysk-server/core');
    const r = listDbClusterArtifacts({
      db: ctx.db,
      dataDir: ctx.dataDir,
      clusterId: id });
    sendJson(res, r.ok ? 200 : 404, {
      ok: r.ok,
      cluster: r.cluster,
      artifactDir: r.artifactDir,
      files: r.files.map((f) => ({
        relativePath: f.relativePath,
        bytes: f.bytes })),
      notes: r.notes });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/bundle$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { bundleDbClusterArtifacts } = await import('@ysk-server/core');
    const r = bundleDbClusterArtifacts({
      db: ctx.db,
      dataDir: ctx.dataDir,
      clusterId: id });
    ctx.audit.append({
      actor: user.username,
      action: 'db.cluster.bundle',
      resource: id,
      detail: { ok: r.ok, bytes: r.bytes, path: r.bundlePath },
      ok: r.ok });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/bundle\/download$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { bundleDbClusterArtifacts } = await import('@ysk-server/core');
    const r = bundleDbClusterArtifacts({
      db: ctx.db,
      dataDir: ctx.dataDir,
      clusterId: id });
    if (!r.ok || !r.bundlePath) {
      sendJson(res, 404, { ok: false, notes: r.notes });
      return true;
    }
    // Path must stay under dataDir/clusters
    if (!r.bundlePath.startsWith(ctx.dataDir) || r.bundlePath.includes('..')) {
      sendJson(res, 403, { ok: false, notes: ['invalid path'] });
      return true;
    }
    const { createReadStream, statSync } = await import('node:fs');
    const st = statSync(r.bundlePath);
    const fname = `ysk-cluster-${id.slice(0, 8)}.tar.gz`;
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Length': st.size,
      'Content-Disposition': `attachment; filename="${fname}"` });
    createReadStream(r.bundlePath).pipe(res);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/push$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      execute?: boolean;
      memberId?: string;
      identityId?: string;
    };
    const { pushDbClusterToPeers } = await import('@ysk-server/core');
    const result = await pushDbClusterToPeers({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      clusterId: id,
      memberId: data.memberId,
      execute: data.execute === true,
      identityId: data.identityId });
    ctx.audit.append({
      actor: user.username,
      action: 'db.cluster.push',
      resource: id,
      detail: {
        ok: result.ok,
        dryRun: result.dryRun,
        executed: result.executed,
        blocked: result.blocked,
        targets: result.targets.length },
      ok: result.ok });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/fleet$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      execute?: boolean;
      memberId?: string;
      op?: 'apply' | 'probe' | 'plan' | 'sync';
      edgeExecute?: boolean;
    };
    const { dispatchDbClusterFleet } = await import('@ysk-server/core');
    const result = dispatchDbClusterFleet({
      db: ctx.db,
      clusterId: id,
      memberId: data.memberId,
      op: data.op ?? 'apply',
      execute: data.execute === true,
      edgeExecute: data.edgeExecute === true,
      enqueue:
        data.execute === true
          ? (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload)
          : undefined });
    ctx.audit.append({
      actor: user.username,
      action: 'db.cluster.fleet',
      resource: id,
      detail: {
        ok: result.ok,
        dryRun: result.dryRun,
        queued: result.queued.length,
        op: data.op ?? 'apply' },
      ok: result.ok });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
