/**
 * DB HA cluster plan/apply/probe/fleet/bundle.
 * Extracted from db-clusters.ts (Wave Q1). Behaviour preserved.
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

export async function handleDbClustersActionsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/plan$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { planAndMaterializeDbCluster } = await import('@ysk/core');
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
        const { applyDbClusterLocal } = await import('@ysk/core');
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
        const { probeDbCluster, probeDbClusterFull } = await import('@ysk/core');
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
        const { installDbClusterOnPeers } = await import('@ysk/core');
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+\/artifacts$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { listDbClusterArtifacts } = await import('@ysk/core');
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
        const { bundleDbClusterArtifacts } = await import('@ysk/core');
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
        const { bundleDbClusterArtifacts } = await import('@ysk/core');
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
        const { pushDbClusterToPeers } = await import('@ysk/core');
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
        const { dispatchDbClusterFleet } = await import('@ysk/core');
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
