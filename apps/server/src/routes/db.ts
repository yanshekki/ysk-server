/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
  statusFromOpsResult,
} from '../http/util.js';

export async function handleDbRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'POST' && url.pathname === '/api/v1/db/adminer/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          download?: boolean;
          applySystem?: boolean;
          /** When set, create a PHP project (Adminer / phpMyAdmin) instead of global dataDir site */
          asProject?: boolean;
          projectName?: string;
          tool?: 'adminer' | 'phpmyadmin';
          engine?: 'mysql' | 'mariadb';
        };
        // New path: create real project for DB browser
        if (data.asProject === true || data.projectName || data.tool === 'phpmyadmin') {
          const { createDbBrowserProject, normalizeDbBrowserTool, defaultDbBrowserProjectName } =
            await import('@ysk/core');
          const tool = normalizeDbBrowserTool(data.tool);
          const name =
            (data.projectName ?? '').trim() ||
            defaultDbBrowserProjectName(tool, data.engine);
          const r = await createDbBrowserProject({
            projects: ctx.projects,
            projectOps: ctx.projectOps,
            host: ctx.host,
            actor: user.username,
            actorUserId: user.id,
            name,
            domain: (data.domain ?? `${tool}.local`).trim(),
            tool,
            download: data.download !== false,
            engine: data.engine,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'db.browser.project_create',
            resource: r.projectId,
            detail: { tool, name, domain: data.domain, ok: r.ok },
            ok: r.ok,
          });
          sendOpsResult(res, r);
          return true;
        }
        // Legacy: managed dataDir adminer + nginx only
        const { applyAdminer } = await import('@ysk/core');
        const r = await applyAdminer({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain: data.domain,
          download: data.download !== false,
          applySystem: data.applySystem === true,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.adminer.apply',
          detail: r,
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/temp-users/expire') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { dropSystem?: boolean };
        const { expireTempDbUsers } = await import('@ysk/core');
        const r = await expireTempDbUsers({
          db: ctx.db,
          host: ctx.host,
          dropSystem: data.dropSystem !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.temp_user.expire',
          detail: r,
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/db/temp-users') {
        ctx.auth.authenticate(getBearer(req));
        const { listTempDbUsers } = await import('@ysk/core');
        sendJson(res, 200, { items: listTempDbUsers(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/temp-users') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          engine?: 'mysql' | 'mariadb' | 'postgres';
          database?: string;
          username?: string;
          ttlHours?: number;
          apply?: boolean;
        };
        const { createTempReadonlyUser } = await import('@ysk/core');
        const r = await createTempReadonlyUser({
          db: ctx.db,
          host: ctx.host,
          engine: data.engine ?? 'mysql',
          database: data.database ?? '',
          username: data.username,
          ttlHours: data.ttlHours,
          actor: user.username,
          apply: data.apply !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.temp_user.create',
          resource: data.database,
          detail: { ok: r.ok, username: r.user?.username, status: r.user?.apply_status },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/db/remote-hosts') {
        ctx.auth.authenticate(getBearer(req));
        const { listRemoteDbHosts } = await import('@ysk/core');
        sendJson(res, 200, { items: listRemoteDbHosts(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/remote-hosts') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          id?: string;
          engine?: 'mysql' | 'mariadb' | 'postgres';
          label?: string;
          host?: string;
          port?: number;
          username?: string;
          password?: string;
        };
        const { upsertRemoteDbHost } = await import('@ysk/core');
        const row = upsertRemoteDbHost(ctx.db, {
          id: data.id,
          engine: data.engine ?? 'mysql',
          label: data.label ?? data.host ?? '',
          host: data.host ?? '',
          port: data.port,
          username: data.username,
          password: data.password,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.remote_host.upsert',
          resource: row.id,
          detail: { host: row.host, engine: row.engine },
          ok: true,
        });
        sendJson(res, 200, { host: row });
        return true;
      }
      // —— DB HA clusters ——
      if (method === 'GET' && url.pathname === '/api/v1/db/clusters/overview') {
        ctx.auth.authenticate(getBearer(req));
        const { listDbClusters, firewallPortsForCluster } = await import('@ysk/core');
        const items = listDbClusters(ctx.db);
        sendJson(res, 200, {
          ok: true,
          count: items.length,
          items: items.map((c) => ({
            id: c.id,
            name: c.name,
            engine: c.engine,
            kind: c.kind,
            status: c.status,
            members: c.members.length,
            firewallPorts: firewallPortsForCluster(c.kind),
            updatedAt: c.updatedAt,
          })),
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/db/clusters') {
        ctx.auth.authenticate(getBearer(req));
        const { listDbClusters } = await import('@ysk/core');
        const engine = url.searchParams.get('engine') as
          | 'mysql'
          | 'mariadb'
          | 'postgres'
          | 'redis'
          | null;
        const items = listDbClusters(
          ctx.db,
          engine && ['mysql', 'mariadb', 'postgres', 'redis'].includes(engine)
            ? engine
            : undefined,
        );
        sendJson(res, 200, { ok: true, items });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/db/clusters') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          engine?: 'mysql' | 'mariadb' | 'postgres' | 'redis';
          kind?: string;
          members?: Array<{
            host: string;
            role?: string;
            port?: number;
            access?: 'local' | 'ssh' | 'fleet';
            label?: string;
            fleetAgentId?: string;
          }>;
          params?: Record<string, string | number | boolean>;
        };
        const { createDbCluster } = await import('@ysk/core');
        const cluster = createDbCluster(ctx.db, {
          name: data.name ?? '',
          engine: data.engine ?? 'mariadb',
          kind: (data.kind ?? 'mariadb-galera') as 'mariadb-galera',
          members: data.members,
          params: data.params,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'db.cluster.create',
          resource: cluster.id,
          detail: { name: cluster.name, kind: cluster.kind, members: cluster.members.length },
          ok: true,
        });
        sendJson(res, 201, { ok: true, cluster });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/temp-users\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { revokeTempDbUser } = await import('@ysk/core');
        const r = revokeTempDbUser(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.temp_user.revoke',
          resource: id,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }

      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/remote-hosts\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteRemoteDbHost } = await import('@ysk/core');
        const ok = deleteRemoteDbHost(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.remote_host.delete',
          resource: id,
          detail: { ok },
          ok });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getDbCluster, firewallPortsForCluster } = await import('@ysk/core');
        const cluster = getDbCluster(ctx.db, id);
        sendJson(res, 200, {
          ok: true,
          cluster,
          firewallPorts: firewallPortsForCluster(cluster.kind) });
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          params?: Record<string, string | number | boolean>;
          members?: Array<{
            id?: string;
            host: string;
            role?: string;
            port?: number;
            access?: 'local' | 'ssh' | 'fleet';
            label?: string;
            fleetAgentId?: string;
          }>;
          notes?: string[];
        };
        const { updateDbCluster, firewallPortsForCluster } = await import('@ysk/core');
        const cluster = updateDbCluster(ctx.db, id, {
          name: data.name,
          params: data.params,
          members: data.members as never,
          notes: data.notes });
        ctx.audit.append({
          actor: user.username,
          action: 'db.cluster.patch',
          resource: id,
          detail: { name: cluster.name, members: cluster.members.length },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          cluster,
          firewallPorts: firewallPortsForCluster(cluster.kind) });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/db\/clusters\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteDbCluster } = await import('@ysk/core');
        const ok = deleteDbCluster(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'db.cluster.delete',
          resource: id,
          detail: { ok, note: 'registry only; conf on disk not auto-removed' },
          ok });
        sendJson(res, ok ? 200 : 404, {
          ok,
          notes: ok
            ? [tl('notes.auto.n0738')]
            : [tl('notes.auto.n0856')] });
        return true;
      }
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
