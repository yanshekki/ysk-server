/**
 * DB HA cluster plan/apply/probe/install-peers (Wave Y1).
 * Extracted from db-clusters-actions.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
  statusFromOpsResult,
} from '../http/util.js';

export async function handleDbClustersLifecycleRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/plan$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const { planAndMaterializeDbCluster } = await import('ysk-server-core');
    const { cluster, plan } = planAndMaterializeDbCluster({
      db: ctx.db,
      dataDir: ctx.dataDir,
      clusterId: id,
      writeArtifacts: true });
    ctx.audit.append({
      actor: user.username,
      action: 'db.cluster.plan',
      resource: id,
      detail: { ok: plan.ok, steps: plan.steps.length, dryRun: true },
      ok: plan.ok });
    sendOpsResult(res, {
      ok: plan.ok,
      notes: plan.notes ?? [],
      cluster,
      plan });
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/apply$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      execute?: boolean;
      bootstrap?: boolean;
    };
    const { applyDbClusterLocal } = await import('ysk-server-core');
    const result = await applyDbClusterLocal({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      clusterId: id,
      // Panel: omit execute → dry-run write artifacts; explicit true → system
      execute: data.execute === true,
      bootstrap: data.bootstrap === true });
    ctx.audit.append({
      actor: user.username,
      action: 'db.cluster.apply',
      resource: id,
      detail: {
        ok: result.ok,
        dryRun: result.dryRun,
        executed: result.executed,
        blocked: result.blocked,
        written: result.written },
      ok: result.ok });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/probe$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req).catch(() => '{}');
    const data = JSON.parse(raw || '{}') as { peers?: boolean; identityId?: string };
    const peers =
      data.peers === true || url.searchParams.get('peers') === '1';
    const { probeDbCluster, probeDbClusterFull } = await import('ysk-server-core');
    const result = peers
      ? await probeDbClusterFull({
          db: ctx.db,
          host: ctx.host,
          clusterId: id,
          dataDir: ctx.dataDir,
          identityId: data.identityId || url.searchParams.get('identity') || undefined })
      : await probeDbCluster({
          db: ctx.db,
          host: ctx.host,
          clusterId: id });
    ctx.audit.append({
      actor: user.username,
      action: 'db.cluster.probe',
      resource: id,
      detail: {
        ok: result.ok,
        localOk: result.localOk,
        peers,
        status: result.cluster.status },
      ok: result.ok || result.localOk });
    sendJson(res, 200, result);
    return true;
  }
  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/install-peers$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      execute?: boolean;
      memberId?: string;
      restart?: boolean;
      identityId?: string;
    };
    const { installDbClusterOnPeers } = await import('ysk-server-core');
    const result = await installDbClusterOnPeers({
      db: ctx.db,
      dataDir: ctx.dataDir,
      host: ctx.host,
      clusterId: id,
      memberId: data.memberId,
      execute: data.execute === true,
      restart: data.restart !== false,
      identityId: data.identityId });
    ctx.audit.append({
      actor: user.username,
      action: 'db.cluster.install_peers',
      resource: id,
      detail: {
        ok: result.ok,
        dryRun: result.dryRun,
        installed: result.installed.length },
      ok: result.ok });
    sendJson(
      res,
      statusFromOpsResult(result),
      result,
    );
    return true;
  }

  return false;
}
