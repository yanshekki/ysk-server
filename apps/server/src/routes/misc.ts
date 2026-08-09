/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  YskError,
  type SystemRole,
  tl } from '@ysk/shared';
import {
  applyNodeHosting,
  writeDovecotPassdb,
  runLiveEmailChecks,
  createProjectFtpAccount,
  listProjectLogs,
  tailProjectLog,
  searchProjectLogs,
  applyPhpFpmPool,
  planEmailWarmup,
  probeAllAgentRuntimes,
  probeAgentRuntime,
  planAgentInstall,
  parseAgentKind,
  renderAgentSystemdUnit,
  applyAgentInstall,
  loadSmtpRelaySettings,
  downloadWordpressCore,
  normalizeRuntimeVersion } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
  statusFromOpsResult } from '../http/util.js';


function redactEmail<T extends { dkim_private_key?: string }>(e: T) {
  return { ...e, dkim_private_key: '***redacted***' };
}

export async function handleMiscRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // users/packages → admin; search; real-ip; dnssec; sftp/ssh → domain routes
      // webauthn/devices → auth; audit → audit
      // project detail/deploy/* → routes/projects.ts
      // agent runtime → agents; dashboard/notifications/apply-audit → dashboard
      // email domain mailboxes/aliases/… → email.ts
      // —— Runtime tuning (node/python/go/rust) ——
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/hosting\/runtimes\/(node|python|go|rust)\/tuning$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5] as 'node' | 'python' | 'go' | 'rust';
        const version = url.searchParams.get('version') ?? 'default';
        const {
          loadRuntimeTuning,
          listTuningCatalog,
          tuningToEnv } = await import('@ysk/core');
        const settings = loadRuntimeTuning(ctx.dataDir, kind, version);
        sendJson(res, 200, {
          kind,
          version: settings.version,
          catalog: listTuningCatalog(kind),
          settings,
          envPreview: tuningToEnv(settings),
          notes: [
            tl('notes.auto.n0577'),
            tl('notes.auto.n0472'),
          ] });
        return true;
      }
      if (
        method === 'PUT' &&
        url.pathname.match(/^\/api\/v1\/hosting\/runtimes\/(node|python|go|rust)\/tuning$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5] as 'node' | 'python' | 'go' | 'rust';
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          values?: Record<string, string | number | boolean>;
          env?: Record<string, string>;
        };
        const { saveRuntimeTuning, tuningToEnv, listTuningCatalog } = await import('@ysk/core');
        const result = saveRuntimeTuning(ctx.dataDir, {
          kind,
          version: data.version ?? 'default',
          values: data.values ?? {},
          env: data.env ?? {} });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.tuning.save',
          detail: { kind, version: result.settings.version, written: result.written },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          catalog: listTuningCatalog(kind),
          settings: result.settings,
          envPreview: tuningToEnv(result.settings),
          written: result.written,
          notes: [tl('notes.auto.n0767')] });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/approve$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, ctx.ai.approve(id, user.username));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/execute$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const task = await ctx.ai.execute(id, user.username, user.roles as SystemRole[]);
        sendJson(res, 200, task);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/cancel$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, ctx.ai.cancel(id, user.username));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ai\/tasks\/[^/]+\/steps\/[^/]+\/reject$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const parts = url.pathname.split('/');
        const id = parts[5];
        const stepId = parts[7];
        sendJson(res, 200, ctx.ai.rejectStep(id, stepId, user.username));
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssl\/certificates\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const idOrDomain = decodeURIComponent(url.pathname.split('/').pop() ?? '');
        const { deleteCertificate } = await import('@ysk/core');
        const r = deleteCertificate(ctx.db, ctx.dataDir, idOrDomain);
        ctx.audit.append({
          actor: user.username,
          action: 'ssl.delete',
          resource: r.domain,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      // Fleet routes live in routes/agents.ts (Wave F4)
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getCdnNode } = await import('@ysk/core');
        const node = getCdnNode(ctx.db, id);
        if (!node) {
          sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0866')] });
          return true;
        }
        sendJson(res, 200, { node });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteCdnNode } = await import('@ysk/core');
        const ok = deleteCdnNode(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.delete',
          resource: id,
          detail: { ok },
          ok });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+\/probe$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { probeCdnNode } = await import('@ysk/core');
        const r = await probeCdnNode(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.probe',
          resource: id,
          detail: { ok: r.ok, method: r.method },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+\/drain$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { draining?: boolean };
        const { setCdnNodeDrain } = await import('@ysk/core');
        const node = setCdnNodeDrain(ctx.db, id, data.draining !== false);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.drain',
          resource: id,
          detail: { status: node.status },
          ok: true });
        sendJson(res, 200, { node });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getCdnSite, readCdnSiteRenderedConf } = await import('@ysk/core');
        const site = getCdnSite(ctx.db, id);
        if (!site) {
          sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0024')] });
          return true;
        }
        const rendered = readCdnSiteRenderedConf(ctx.dataDir, id);
        sendJson(res, 200, { site, rendered });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteCdnSite } = await import('@ysk/core');
        const ok = deleteCdnSite(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.delete',
          resource: id,
          detail: { ok },
          ok });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/render$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dryRun?: boolean;
          projectOriginUrl?: string;
        };
        const { applyCdnSiteEdgeRender } = await import('@ysk/core');
        const r = await applyCdnSiteEdgeRender({
          db: ctx.db,
          dataDir: ctx.dataDir,
          siteId: id,
          host: ctx.host,
          dryRun: data.dryRun === true,
          projectOriginUrl: data.projectOriginUrl });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.render',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            contentHash: r.contentHash,
            dryRun: data.dryRun === true },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/apply$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          edgeNodeId?: string;
          skipDraining?: boolean;
          projectOriginUrl?: string;
        };
        const { fanOutCdnSite } = await import('@ysk/core');
        const r = await fanOutCdnSite({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          edgeNodeId: data.edgeNodeId,
          skipDraining: data.skipDraining,
          projectOriginUrl: data.projectOriginUrl,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.apply',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            edges: r.edges?.length },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/purge$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          edgeNodeId?: string;
          skipDraining?: boolean;
        };
        const { purgeCdnSite } = await import('@ysk/core');
        const r = await purgeCdnSite({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          edgeNodeId: data.edgeNodeId,
          skipDraining: data.skipDraining,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.purge',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            edges: r.edges?.length },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/dns-sync$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          probeFirst?: boolean;
          applyZone?: boolean;
        };
        const { syncCdnSiteDns } = await import('@ysk/core');
        const r = await syncCdnSiteDns({
          db: ctx.db,
          dataDir: ctx.dataDir,
          siteId: id,
          host: ctx.host,
          probeFirst: data.probeFirst,
          applyZone: data.applyZone });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.dns_sync',
          resource: id,
          detail: {
            ok: r.ok,
            strategy: r.strategy,
            ipv4: r.selectedIpv4,
            recordsTouched: r.recordsTouched },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/dns-records$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { listCdnManagedDnsRecords } = await import('@ysk/core');
        sendJson(res, 200, {
          items: listCdnManagedDnsRecords(ctx.db, id) });
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/ssl\/distribute$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          applyNginx?: boolean;
          edgeNodeId?: string;
          skipDraining?: boolean;
        };
        const { distributeCdnSiteSsl } = await import('@ysk/core');
        const r = await distributeCdnSiteSsl({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          applyNginx: data.applyNginx,
          edgeNodeId: data.edgeNodeId,
          skipDraining: data.skipDraining,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.ssl_distribute',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            domain: r.cert?.domain },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/ssl\/issue$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          email?: string;
          run?: boolean;
          distribute?: boolean;
        };
        const { issueCdnSiteLetsEncrypt } = await import('@ysk/core');
        const r = await issueCdnSiteLetsEncrypt({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          email: data.email ?? '',
          run: data.run,
          distribute: data.distribute,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.ssl_issue',
          resource: id,
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            executed: r.executed },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/cdn\/sites\/[^/]+\/ssl\/prepare-acme$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { prepareCdnSiteAcme } = await import('@ysk/core');
        const r = await prepareCdnSiteAcme({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          siteId: id,
          enqueue: (sessionId, payload) => ctx.fleet.enqueue(sessionId, payload) });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.site.ssl_prepare_acme',
          resource: id,
          detail: { ok: r.ok, apply_status: r.apply_status },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      // project ops → projects.ts
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
