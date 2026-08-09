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
      // User/package mutations moved to routes/admin.ts (domain ownership)
      if (method === 'GET' && url.pathname === '/api/v1/search') {
        ctx.auth.authenticate(getBearer(req));
        const q = url.searchParams.get('q') ?? '';
        const { globalSearch } = await import('@ysk/core');
        sendJson(res, 200, { items: globalSearch(ctx.db, q) });
        return true;
      }
      // —— Multi-CDN real client IP ——
      if (method === 'GET' && url.pathname === '/api/v1/system/real-ip') {
        ctx.auth.authenticate(getBearer(req));
        const {
          loadRealIpConfig,
          listRealIpProviders,
          realIpProviderSummary,
        } = await import('@ysk/core');
        const config = loadRealIpConfig(ctx.dataDir);
        sendJson(res, 200, {
          config,
          providers: realIpProviderSummary(),
          catalog: listRealIpProviders().map((p) => ({
            id: p.id,
            label: p.label,
            clientIpHeader: p.clientIpHeader,
            hasSources: Boolean(p.cidrSources?.ipv4 || p.cidrSources?.ipv6),
            snapshotCount: p.snapshotIpv4.length + p.snapshotIpv6.length,
          })),
        });
        return true;
      }
      if (method === 'PATCH' && url.pathname === '/api/v1/system/real-ip') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as Record<string, unknown>;
        const { patchRealIpConfig, applyRealIpArtifacts } = await import('@ysk/core');
        const config = patchRealIpConfig(ctx.dataDir, {
          defaultProvider: body.defaultProvider as never,
          trustMode: body.trustMode as never,
          enabledProviders: body.enabledProviders as never,
          customCidrs: body.customCidrs as never,
          customHeader: body.customHeader as never,
        });
        const art = await applyRealIpArtifacts({
          dataDir: ctx.dataDir,
          host: ctx.host,
          enableApacheRemoteIp: Boolean(body.enableApacheRemoteIp),
        });
        sendJson(res, 200, { ok: true, config, notes: art.notes, written: art.written });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/system/real-ip/refresh') {
        ctx.auth.authenticate(getBearer(req));
        const { refreshRealIpCidrs, applyRealIpArtifacts } = await import('@ysk/core');
        const r = await refreshRealIpCidrs({ dataDir: ctx.dataDir, host: ctx.host });
        const art = await applyRealIpArtifacts({ dataDir: ctx.dataDir });
        sendJson(res, 200, {
          ok: r.ok,
          config: r.config,
          updated: r.updated,
          notes: [...r.notes, ...art.notes],
        });
        return true;
      }

      if (method === 'GET' && url.pathname === '/api/v1/system/ips') {
        ctx.auth.authenticate(getBearer(req));
        const r = await ctx.host.runCommand(
          ['bash', '-c', "hostname -I 2>/dev/null || ip -4 -o addr show | awk '{print $4}'"],
          { timeoutMs: 5_000 },
        );
        const ips = (r.stdout || '')
          .split(/\s+/)
          .map((s) => s.trim())
          .filter(Boolean);
        sendJson(res, 200, { items: ips });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/dns\/zones\/[^/]+\/dnssec$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const zone = decodeURIComponent(url.pathname.split('/')[5] ?? '');
        const { generateDnssecKeys } = await import('@ysk/core');
        const r = await generateDnssecKeys({
          dataDir: ctx.dataDir,
          zone,
          host: ctx.host });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.dnssec.generate',
          resource: zone,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/dns\/zones\/[^/]+\/dnssec$/)) {
        ctx.auth.authenticate(getBearer(req));
        const zone = decodeURIComponent(url.pathname.split('/')[5] ?? '');
        const { listDnssecMaterial } = await import('@ysk/core');
        sendJson(res, 200, listDnssecMaterial(ctx.dataDir, zone));
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/sftp\/keys\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { removeSftpKey } = await import('@ysk/core');
        const r = removeSftpKey(ctx.db, ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'sftp.key.remove',
          resource: id,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/public$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getSshIdentity } = await import('@ysk/core');
        const identity = getSshIdentity(ctx.dataDir, id);
        if (!identity) {
          sendJson(res, 404, { ok: false, message: tl('notes.ssh.identityNotFound') });
          return true;
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.statusCode = 200;
        res.end(identity.publicKey.endsWith('\n') ? identity.publicKey : identity.publicKey + '\n');
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/export$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles?.includes('admin')) {
          sendJson(res, 403, {
            ok: false,
            code: 'YSK_FORBIDDEN',
            message: tl('notes.auto.n0281') });
          return true;
        }
        const rawBody = await readBody(req).catch(() => '{}');
        const expData = JSON.parse(rawBody || '{}') as { totp?: string };
        try {
          ctx.auth.requireStepUp(user.id, expData.totp);
        } catch (e) {
          if (e instanceof YskError) {
            sendJson(res, e.httpStatus || 403, {
              ok: false,
              code: e.code,
              message: e.message,
              needsStepUp: true });
            return true;
          }
          throw e;
        }
        const id = url.pathname.split('/')[5];
        const { exportSshIdentityPrivate } = await import('@ysk/core');
        const r = exportSshIdentityPrivate(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.export',
          resource: id,
          detail: { fingerprint: r.fingerprintSha256, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/install$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean };
        const { installSshIdentity } = await import('@ysk/core');
        const r = await installSshIdentity({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.install',
          resource: id,
          detail: {
            apply: data.apply === true,
            applied: r.applied,
            path: r.plannedPath,
            ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/uninstall$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean; purgeFiles?: boolean };
        const { uninstallSshIdentity } = await import('@ysk/core');
        const r = await uninstallSshIdentity({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          purgeFiles: data.purgeFiles !== false });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.uninstall',
          resource: id,
          detail: { apply: data.apply === true, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/test$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { target?: string; apply?: boolean };
        const { testSshIdentity } = await import('@ysk/core');
        const r = await testSshIdentity({
          dataDir: ctx.dataDir,
          id,
          target: data.target ?? '',
          apply: data.apply === true,
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.test',
          resource: id,
          detail: {
            target: data.target,
            apply: data.apply === true,
            ok: r.ok,
            dryRun: r.dryRun },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/rotate$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { revealPrivate?: boolean };
        const { rotateSshIdentity } = await import('@ysk/core');
        const r = rotateSshIdentity({
          dataDir: ctx.dataDir,
          id,
          revealPrivate: data.revealPrivate === true,
          db: ctx.db });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.rotate',
          resource: id,
          detail: {
            newId: r.newIdentity?.id,
            fingerprint: r.newIdentity?.fingerprintSha256,
            ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+\/authorize-self$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { authorizeSelfSshIdentity } = await import('@ysk/core');
        const r = await authorizeSelfSshIdentity({
          dataDir: ctx.dataDir,
          db: ctx.db,
          id,
          host: ctx.host });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.authorize_self',
          resource: id,
          detail: { keyId: r.keyId, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getSshIdentity } = await import('@ysk/core');
        const identity = getSshIdentity(ctx.dataDir, id);
        if (!identity) {
          sendJson(res, 404, { ok: false, message: tl('notes.ssh.identityNotFound') });
          return true;
        }
        sendJson(res, 200, { ok: true, identity });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssh\/identities\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const purgeDisk = url.searchParams.get('purgeDisk') === '1';
        const { deleteSshIdentity, uninstallSshIdentity } = await import('@ysk/core');
        if (purgeDisk) {
          await uninstallSshIdentity({
            dataDir: ctx.dataDir,
            id,
            apply: true,
            purgeFiles: true });
        }
        const r = deleteSshIdentity(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.identity.delete',
          resource: id,
          detail: { purgeDisk, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/confirm$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { code?: string };
        const { confirmSsh2fa } = await import('@ysk/core');
        const r = confirmSsh2fa(ctx.dataDir, id, data.code ?? '');
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.confirm',
          resource: id,
          detail: { ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/install$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean };
        const { installSsh2faFile } = await import('@ysk/core');
        const r = await installSsh2faFile({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          host: ctx.host,
          executeEnabled: ctx.host.executeEnabled() });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.install',
          resource: id,
          detail: { apply: data.apply === true, applied: r.applied, ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/uninstall$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { apply?: boolean };
        const { uninstallSsh2faFile } = await import('@ysk/core');
        const r = await uninstallSsh2faFile({
          dataDir: ctx.dataDir,
          id,
          apply: data.apply === true,
          retire: true });
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.uninstall',
          resource: id,
          detail: { ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+\/reveal$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        if (!user.roles?.includes('admin')) {
          sendJson(res, 403, { ok: false, code: 'YSK_FORBIDDEN', message: tl('notes.auto.n0561') });
          return true;
        }
        const id = url.pathname.split('/')[5];
        const { revealSsh2faSecret } = await import('@ysk/core');
        const r = revealSsh2faSecret(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.reveal',
          resource: id,
          detail: { ok: r.ok },
          ok: r.ok });
        sendOpsResult(res, r, { notFound: true });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/ssh\/2fa\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { retireSsh2fa, uninstallSsh2faFile } = await import('@ysk/core');
        if (url.searchParams.get('purgeFile') === '1') {
          await uninstallSsh2faFile({ dataDir: ctx.dataDir, id, apply: true, retire: true });
        } else {
          retireSsh2fa(ctx.dataDir, id);
        }
        ctx.audit.append({
          actor: user.username,
          action: 'ssh.2fa.retire',
          resource: id,
          detail: {},
          ok: true });
        sendJson(res, 200, { ok: true });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/auth\/webauthn\/credentials\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[6];
        const { deleteWebAuthnCredential } = await import('@ysk/core');
        const ok = deleteWebAuthnCredential(ctx.db, user.id, id);
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/auth\/devices\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { revokeRememberDevice } = await import('@ysk/core');
        const ok = revokeRememberDevice(ctx.db, user.id, id);
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/audit') {
        ctx.auth.authenticate(getBearer(req));
        const { listWithQuery } = await import('../http/list-response.js');
        const limitRaw = Number(url.searchParams.get('limit') || 200);
        const fetchN = Math.min(500, Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 200);
        type AuditRow = {
          actor?: string;
          action?: string;
          resource?: string;
          detail?: unknown;
        };
        const all = ctx.audit.listRecent(fetchN) as unknown as AuditRow[];
        const { items, meta } = listWithQuery(url, all, {
          text: (e: AuditRow) => [
            String(e.actor ?? ''),
            String(e.action ?? ''),
            String(e.resource ?? ''),
            JSON.stringify(e.detail ?? ''),
          ],
        });
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-history$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const limit = Math.min(50, Number(url.searchParams.get('limit') ?? 20) || 20);
        const items = ctx.audit.listForResource(id, {
          actionPrefix: 'project.deploy',
          limit });
        // Also include process deploys recorded as project.deploy_process / deploy_node / deploy_php
        const more = ctx.audit
          .listForResource(id, { limit: 80 })
          .filter((e) =>
            /deploy|git_deploy/.test(e.action),
          )
          .slice(0, limit);
        const merged = [...items, ...more]
          .filter(
            (e, i, arr) => arr.findIndex((x) => x.id === e.id) === i,
          )
          .sort(
            (a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
          .slice(0, limit);
        sendJson(res, 200, { items: merged });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/template$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { templateId?: string; force?: boolean };
        const result = ctx.projects.applyTemplate(
          id,
          data.templateId ?? 'node-starter',
          user.username,
          data.force,
        );
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          port?: number;
          entry?: string;
          skipBuild?: boolean;
          nodeVersion?: string;
          enableSystemd?: boolean;
          preferFpm?: boolean;
          forceBuiltin?: boolean;
          ssl?: boolean;
          reload?: boolean;
        };
        const proj = ctx.projects.get(id);
        const processRuntimes = new Set([
          'python',
          'go',
          'rust',
          'java',
          'kotlin',
          'bun',
        ]);
        const result =
          proj.runtime === 'php'
            ? await ctx.projectOps.deployPhp(id, {
                actor: user.username,
                port: data.port,
                preferFpm: data.preferFpm,
                forceBuiltin: data.forceBuiltin })
            : proj.runtime === 'static'
              ? await ctx.projectOps.deployStatic(id, {
                  actor: user.username,
                  ssl: data.ssl,
                  reload: data.reload })
              : processRuntimes.has(proj.runtime)
                ? await ctx.projectOps.deployProcess(id, {
                    actor: user.username,
                    port: data.port,
                    entry: data.entry,
                    skipBuild: data.skipBuild })
                : await ctx.projectOps.deployNode(id, {
                    actor: user.username,
                    port: data.port,
                    entry: data.entry,
                    nodeVersion: data.nodeVersion,
                    enableSystemd: data.enableSystemd });
        sendJson(res, result.ok ? 200 : 502, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-static$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { ssl?: boolean; reload?: boolean };
        const result = await ctx.projectOps.deployStatic(id, {
          actor: user.username,
          ssl: data.ssl,
          reload: data.reload });
        sendJson(res, result.ok ? 200 : 502, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-provision$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projects.provisionOsIsolation(id, user.username);
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.getOsUser(id);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          shell?: string;
          accountLocked?: boolean;
          memoryMax?: string;
          cpuQuotaPercent?: number;
          tasksMax?: number;
          limitNofile?: number;
          quotaMb?: number;
        };
        const result = await ctx.projectOps.patchOsUser(id, data, user.username);
        sendJson(res, result.ok || result.written ? 200 : 422, result);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/apply-limits$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.applyOsLimits(id, user.username);
        sendJson(res, result.ok || result.written ? 200 : 422, result);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/chown-home$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.chownOsHome(id, user.username);
        sendOpsResult(res, result);
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/os-user\/migrate$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { removePreviousHome?: boolean };
        const result = await ctx.projects.migrateOsIsolation(id, user.username, {
          removePreviousHome: data.removePreviousHome !== false });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/stop$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.stopNode(id, user.username);
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/publish-nginx$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          systemConfDir?: string;
          ssl?: boolean;
          forceHttps?: boolean;
          hsts?: boolean;
        };
        const result = await ctx.projectOps.publishNginx(id, {
          actor: user.username,
          systemConfDir: data.systemConfDir,
          ssl: data.ssl,
          forceHttps: data.forceHttps,
          hsts: data.hsts });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/purge-cache$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const { purgeNginxCache } = await import('@ysk/core');
        const r = await purgeNginxCache({ host: ctx.host });
        ctx.audit.append({
          actor: user.username,
          action: 'project.purge_cache',
          resource: id,
          detail: r,
          ok: r.ok });
        sendOpsResult(res, {
          ...r,
          projectId: id,
          notes: [
            ...r.notes,
            tl('notes.auto.n0695'),
          ] });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/suspend$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.suspend(id, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/unsuspend$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.unsuspend(id, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/network$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          domainAliases?: string[];
          forceHttps?: boolean;
          hsts?: boolean;
          siteRedirectUrl?: string | null;
          httpAuthUser?: string | null;
          httpAuthPass?: string | null;
          docRoot?: string | null;
          bindIp?: string | null;
          realIpProvider?: string | null;
          preferredPort?: number | null;
          publish?: boolean;
          ssl?: boolean;
        };
        const project = ctx.projects.updateNetwork(
          id,
          {
            domain: data.domain,
            domainAliases: data.domainAliases,
            forceHttps: data.forceHttps,
            hsts: data.hsts,
            siteRedirectUrl: data.siteRedirectUrl,
            httpAuthUser: data.httpAuthUser,
            httpAuthPass: data.httpAuthPass,
            docRoot: data.docRoot,
            bindIp: data.bindIp,
            realIpProvider: data.realIpProvider,
            preferredPort: data.preferredPort,
          },
          user.username,
        );
        if (data.publish) {
          const pub = await ctx.projectOps.publishNginx(id, {
            actor: user.username,
            ssl: data.ssl,
            forceHttps: data.forceHttps ?? project.forceHttps,
            hsts: data.hsts ?? project.hsts });
          sendJson(res, 200, { project, publish: pub });
          return true;
        }
        sendJson(res, 200, { project });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/nginx-conf$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const path = proj.nginxConfigPath;
        if (!path) {
          sendJson(res, 200, { content: '', path: null });
          return true;
        }
        try {
          const { readFileSync, existsSync } = await import('node:fs');
          const content = existsSync(path) ? readFileSync(path, 'utf8') : '';
          sendJson(res, 200, { content, path });
        } catch (e) {
          sendJson(res, 200, {
            content: '',
            path,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        sendJson(res, 200, { project: ctx.projects.get(id) });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        let body: { confirmName?: string; removeFiles?: boolean } = {};
        try {
          const raw = await readBody(req);
          if (raw?.trim()) body = JSON.parse(raw) as typeof body;
        } catch {
          body = {};
        }
        // Also accept query params for simple clients
        if (url.searchParams.has('confirmName')) {
          body.confirmName = url.searchParams.get('confirmName') || undefined;
        }
        if (url.searchParams.has('removeFiles')) {
          body.removeFiles = url.searchParams.get('removeFiles') !== '0';
        }
        const result = await ctx.projects.delete(id, user.username, {
          confirmName: body.confirmName,
          removeFiles: body.removeFiles !== false,
        });
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5];
        const probe = await probeAgentRuntime(kind, ctx.host);
        sendJson(res, 200, { runtime: probe });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/plan$/)) {
        ctx.auth.authenticate(getBearer(req));
        const kind = parseAgentKind(url.pathname.split('/')[5]);
        sendJson(res, 200, planAgentInstall(kind));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/unit$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const kind = parseAgentKind(url.pathname.split('/')[5]);
        const plan = planAgentInstall(kind);
        const unitsDir = join(ctx.dataDir, 'systemd');
        mkdirSync(unitsDir, { recursive: true });
        const unitName = `ysk-agent-${kind}.service`;
        const unitPath = join(unitsDir, unitName);
        const content = renderAgentSystemdUnit({
          kind,
          installPath: plan.runtime.installPath ?? `/opt/ysk-server/agents/${kind}`,
          nodePath: process.execPath });
        writeFileSync(unitPath, content, 'utf8');
        ctx.audit.append({
          actor: user.username,
          action: 'agent.unit.write',
          resource: kind,
          detail: { unitPath },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          unitPath,
          unitName,
          notes: [
            `Unit template written to ${unitPath}`,
            'Enable with root + YSK_EXECUTE: cp to /etc/systemd/system && systemctl enable --now',
          ] });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/agents\/runtimes\/[^/]+\/install$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const kind = parseAgentKind(url.pathname.split('/')[5]);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { execute?: boolean; enableUnit?: boolean };
        const result = await applyAgentInstall({
          dataDir: ctx.dataDir,
          kind,
          host: ctx.host,
          execute: data.execute,
          enableUnit: data.enableUnit,
          nodePath: process.execPath });
        ctx.audit.append({
          actor: user.username,
          action: 'agent.install',
          resource: kind,
          detail: {
            ok: result.ok,
            enabled: result.enabled,
            requiresExecute: result.requiresExecute,
            notes: result.notes },
          ok: result.ok });
        sendJson(res, result.ok || !data.execute ? 200 : 422, result);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/dashboard/summary') {
        ctx.auth.authenticate(getBearer(req));
        const projects = ctx.projects.list();
        const agentRuntimes = await probeAllAgentRuntimes(ctx.host);
        const lastDnsbl = ctx.settings.getJson<Record<string, unknown>>('last_dnsbl_run');
        const lastBackup = ctx.settings.getJson<Record<string, unknown>>('last_backup_run');
        const lastInventory = ctx.settings.getJson<Record<string, unknown>>('last_inventory');
        const relay = ctx.settings.get('email.smtp_relay');
        sendJson(res, 200, {
          projects: {
            total: projects.length,
            running: projects.filter((p) => p.processStatus === 'running').length,
            items: projects.slice(0, 8).map((p) => ({
              id: p.id,
              name: p.name,
              processStatus: p.processStatus,
              port: p.port })) },
          agents: {
            items: agentRuntimes.map((a) => ({
              kind: a.kind,
              name: a.name,
              status: a.status,
              unitActive: a.unitActive })) },
          email: {
            domains: ctx.email.list().length,
            lastDnsbl: lastDnsbl ?? null,
            smtpRelay: relay ? JSON.parse(relay) : loadSmtpRelaySettings(ctx.dataDir) },
          ops: {
            lastBackup: lastBackup ?? null,
            lastInventory: lastInventory
              ? { at: lastInventory.at, count: lastInventory.count }
              : null,
            scheduler: ctx.scheduler.list() } });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/notifications') {
        ctx.auth.authenticate(getBearer(req));
        const { collectNotifications } = await import('@ysk/core');
        const r = await collectNotifications({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          executeEnabled: ctx.host.executeEnabled(),
          lastBackup: ctx.settings.getJson<Record<string, unknown>>('last_backup_run'),
          lastDnsbl: ctx.settings.getJson<Record<string, unknown>>('last_dnsbl_run') });
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/system/apply-audit') {
        ctx.auth.authenticate(getBearer(req));
        const { auditApplyStatuses } = await import('@ysk/core');
        sendJson(res, 200, auditApplyStatuses(ctx.db));
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dns$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, ctx.email.getDnsBundle(id));
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/checks$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dnsApplied?: boolean;
          dmarcPresent?: boolean;
          ptrOk?: boolean;
          port25Open?: boolean | null;
        };
        sendJson(res, 200, ctx.email.updateChecks(id, data, user.username));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/test-send$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { from?: string; to?: string; subject?: string };
        const result = await ctx.email.testSend(
          id,
          { from: data.from ?? '', to: data.to ?? '', subject: data.subject },
          user.username,
        );
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, { items: ctx.email.listMailboxes(id) });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          localPart?: string;
          password?: string;
          provisionSystem?: boolean;
        };
        const result = await ctx.email.createMailbox(id, {
          localPart: data.localPart ?? '',
          password: data.password,
          provisionSystem: data.provisionSystem,
          actor: user.username,
          actorUserId: user.id,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (
        method === 'DELETE' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/mailboxes\/[^/]+$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const parts = url.pathname.split('/');
        const domainId = parts[5] ?? '';
        const mailboxId = parts[7] ?? '';
        const result = await ctx.email.deleteMailbox(domainId, mailboxId, user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'email.mailbox.delete',
          resource: result.address,
          detail: { domainId, mailboxId },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        sendJson(res, 200, { items: ctx.email.listAliases(id) });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          type?: 'alias' | 'forward' | 'catchall';
          localPart?: string;
          destinations?: string[];
        };
        const result = ctx.email.createAlias(id, {
          type: data.type ?? 'forward',
          localPart: data.localPart,
          destinations: data.destinations ?? [],
          actor: user.username });
        sendJson(res, 201, result);
        return true;
      }
      if (
        method === 'DELETE' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/aliases\/[^/]+$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const parts = url.pathname.split('/');
        const id = parts[5];
        const aliasId = parts[7];
        const result = ctx.email.deleteAlias(id, aliasId, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/flags$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          catchallAddress?: string | null;
          autoreplyEnabled?: boolean;
          autoreplySubject?: string;
          autoreplyBody?: string;
          rateLimitPerHour?: number | null;
          antispam?: boolean;
          suspended?: boolean;
          applySystem?: boolean;
        };
        const result = await ctx.email.updateDomainMailFlags(id, data, user.username);
        sendOpsResult(res, {
          ok: result.ok,
          apply_status: result.apply_status,
          notes: result.notes,
          written: result.written,
          blocked: result.blocked,
          blockMessage: result.blockMessage,
          commandResults: result.commandResults,
          domain: redactEmail(result.domain as unknown as Record<string, unknown>) });
        return true;
      }
      if (
        method === 'POST' &&
        url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/dovecot-passdb$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const domain = ctx.email.get(id);
        const result = writeDovecotPassdb({
          dataDir: ctx.dataDir,
          db: ctx.db,
          domain: domain.domain,
          domainId: id });
        ctx.audit.append({
          actor: user.username,
          action: 'email.dovecot_passdb',
          resource: domain.domain,
          detail: { mailboxCount: result.mailboxCount, written: result.written },
          ok: result.ok });
        sendOpsResult(res, result);
        return true;
      }
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
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/live-check$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const live = await runLiveEmailChecks({
          domain: d.domain,
          serverIp: d.server_ip,
          mailHostname: d.mail_hostname,
          dkimPublicKey: d.dkim_public_key,
          dkimSelector: d.dkim_selector });
        // Persist real probe results into domain health (not marketing scores)
        try {
          ctx.email.updateChecks(
            id,
            {
              dnsApplied: live.mx.ok && live.spf.ok && live.dkim.ok,
              dmarcPresent: live.dmarc.ok,
              ptrOk: live.ptr.ok,
              port25Open: live.port25.ok },
            user.username,
          );
        } catch {
          /* non-fatal */
        }
        sendJson(res, 200, {
          ...live,
          ok: live.health.score >= 60 && live.dnsbl.ok });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/policy$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          rateLimitPerHour?: number | null;
          antispam?: boolean;
          applySystem?: boolean;
        };
        const domain = ctx.email.get(id);
        await ctx.email.updateDomainMailFlags(
          id,
          {
            rateLimitPerHour: data.rateLimitPerHour,
            antispam: data.antispam },
          user.username,
        );
        const { applyMailDomainPolicy } = await import('@ysk/core');
        const r = await applyMailDomainPolicy({
          dataDir: ctx.dataDir,
          host: ctx.host,
          domain: domain.domain,
          rateLimitPerHour: data.rateLimitPerHour,
          antispam: data.antispam,
          applySystem: data.applySystem });
        ctx.audit.append({
          actor: user.username,
          action: 'email.domain.policy',
          resource: id,
          detail: r,
          ok: r.ok });
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
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/web-stats$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const { collectProjectWebStats, recordProjectDailyStats, readProjectDailyStats } =
          await import('@ysk/core');
        const stats = await collectProjectWebStats({
          host: ctx.host,
          dataDir: ctx.dataDir,
          projectId: id,
          homeDir: proj.homeDir,
          linuxUser: proj.linuxUser });
        const daily = recordProjectDailyStats(ctx.dataDir, id, stats);
        sendJson(res, 200, {
          ...stats,
          daily: daily.series,
          history: readProjectDailyStats(ctx.dataDir, id) });
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
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+\/warmup$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const d = ctx.email.get(id);
        const plan = planEmailWarmup({
          domain: d.domain,
          serverIp: d.server_ip,
          isNewIp: true });
        sendJson(res, 200, plan);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/node-apply$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          nodeVersion?: string;
          port?: number;
          enableService?: boolean;
        };
        // Low-level artifact write only; use POST .../deploy for real process
        const result = await applyNodeHosting({
          dataDir: ctx.dataDir,
          projectId: proj.id,
          projectName: proj.name,
          linuxUser: proj.linuxUser,
          homeDir: proj.homeDir,
          nodeVersion: data.nodeVersion ?? proj.runtimeVersion ?? '20',
          port: data.port ?? proj.port,
          host: ctx.host,
          enableService: data.enableService,
          nodeBinary: process.execPath });
        ctx.audit.append({
          actor: user.username,
          action: 'project.node_apply',
          resource: id,
          detail: result,
          ok: true });
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/wordpress-download$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          force?: boolean;
          forceConfig?: boolean;
          setup?: boolean;
          dbName?: string;
          dbUser?: string;
          dbPassword?: string;
          dbHost?: string;
        };
        // Default to full setup path (download + wp-config + chown + checklist)
        const useSetup = data.setup !== false;
        if (useSetup) {
          const { setupWordpress } = await import('@ysk/core');
          const result = await setupWordpress({
            host: ctx.host,
            homeDir: proj.homeDir,
            linuxUser: proj.linuxUser,
            linuxGroup: proj.linuxGroup || proj.linuxUser,
            force: data.force,
            forceConfig: data.forceConfig,
            dbName: data.dbName,
            dbUser: data.dbUser,
            dbPassword: data.dbPassword,
            dbHost: data.dbHost });
          ctx.audit.append({
            actor: user.username,
            action: 'project.wordpress_setup',
            resource: id,
            detail: { ...result, dbPassword: undefined },
            ok: result.ok });
          sendOpsResult(res, result);
          return true;
        }
        const result = await downloadWordpressCore({
          host: ctx.host,
          homeDir: proj.homeDir,
          force: data.force });
        ctx.audit.append({
          actor: user.username,
          action: 'project.wordpress_download',
          resource: id,
          detail: result,
          ok: result.ok });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/status$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const status = await ctx.projectOps.liveStatus(id);
        sendJson(res, 200, status);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/git-deploy$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          gitUrl?: string;
          branch?: string;
          redeploy?: boolean;
          entry?: string;
          skipBuild?: boolean;
        };
        const result = await ctx.projectOps.gitDeploy(id, {
          actor: user.username,
          gitUrl: data.gitUrl,
          branch: data.branch,
          redeploy: data.redeploy,
          entry: data.entry,
          skipBuild: data.skipBuild });
        sendJson(res, result.ok ? 200 : 502, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/env$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { env?: Record<string, string> };
        const result = ctx.projectOps.setEnv(id, data.env ?? {}, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/backup$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const result = await ctx.projectOps.backup(id, user.username);
        sendJson(res, result.ok ? 200 : 500, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/logs$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const extraDirs = proj.logExtraDirs ?? [];
        const nameFilter = url.searchParams.get('name') || undefined;
        const grep = url.searchParams.get('grep') || undefined;
        const files = listProjectLogs(proj.homeDir, {
          extraDirs,
          nameFilter });
        const { listProjectRelatedLogSources } = await import('@ysk/core');
        const related = listProjectRelatedLogSources({
          projectId: proj.id,
          linuxUser: proj.linuxUser,
          runtime: proj.runtime,
          dataDir: ctx.dataDir,
          phpVersion: proj.runtimeVersion });
        const file = url.searchParams.get('file');
        if (file) {
          const lines = Number(url.searchParams.get('lines') ?? 200);
          sendJson(res, 200, {
            files,
            extraDirs,
            related,
            tail: tailProjectLog(
              proj.homeDir,
              file,
              Number.isFinite(lines) ? lines : 200,
              2 * 1024 * 1024,
              { extraDirs, grep },
            ) });
          return true;
        }
        if (grep) {
          const result = searchProjectLogs(proj.homeDir, {
            extraDirs,
            nameFilter,
            grep });
          sendJson(res, 200, {
            files: result.files,
            hits: result.hits,
            notes: result.notes,
            extraDirs,
            related });
          return true;
        }
        sendJson(res, 200, { files, extraDirs, related });
        return true;
      }
      if (
        method === 'PUT' &&
        url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/log-dirs$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        let data: { dirs?: unknown } = {};
        try {
          data = raw ? (JSON.parse(raw) as { dirs?: unknown }) : {};
        } catch {
          sendJson(res, 400, { ok: false, message: tl('errors.http.jsonInvalid') });
          return true;
        }
        const result = ctx.projects.setLogExtraDirs(
          id,
          (data.dirs as string[]) ?? [],
          user.username,
        );
        sendJson(res, 200, {
          ok: true,
          project: result.project,
          extraDirs: result.project.logExtraDirs ?? [],
          notes: result.notes });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/ftp$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          username?: string;
          password?: string;
          homeSubdir?: 'app' | 'root';
        };
        const result = createProjectFtpAccount(ctx.db, {
          projectId: proj.id,
          projectHome: proj.homeDir,
          linuxUser: proj.linuxUser,
          linuxGroup: proj.linuxGroup || proj.linuxUser,
          username: data.username,
          password: data.password ?? '',
          homeSubdir: data.homeSubdir });
        // Best-effort chown jail when root (before vsftpd apply)
        if (
          result.ok &&
          ctx.host.executeEnabled() &&
          ctx.host.isRoot() &&
          proj.linuxUser &&
          result.account?.homePath
        ) {
          const { chownProjectPath } = await import('@ysk/core');
          const ch = await chownProjectPath(
            ctx.host,
            {
              linuxUser: proj.linuxUser,
              linuxGroup: proj.linuxGroup || proj.linuxUser,
              homeDir: proj.homeDir },
            String(result.account.homePath),
          );
          result.notes.push(...ch.notes);
        }
        ctx.audit.append({
          actor: user.username,
          action: 'project.ftp.create',
          resource: id,
          detail: result,
          ok: result.ok });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/resources$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          memoryMax?: string;
          cpuQuotaPercent?: number;
          tasksMax?: number;
          limitNofile?: number;
        };
        const result = ctx.projectOps.setResources(id, data, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/quota$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { quotaMb?: number };
        const result = await ctx.projectOps.setQuota(id, data.quotaMb ?? 1024, user.username);
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/quota$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        sendJson(res, 200, await ctx.projectOps.quotaStatus(id));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/php-fpm$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { enable?: boolean; phpVersion?: string };
        const phpVersion = data.phpVersion ?? proj.runtimeVersion ?? '8.2';
        if (data.phpVersion) {
          const prow = ctx.db.snapshot.projects.find((p) => p.id === id);
          if (prow) {
            prow.runtime_version = phpVersion;
            prow.updated_at = new Date().toISOString();
            ctx.db.persist();
          }
        }
        const {
          loadPhpIniSettings,
          loadProjectPhpIni,
          mergePhpIni,
          renderPhpAdminValueLines } = await import('@ysk/core');
        const adminValueLines = renderPhpAdminValueLines(
          mergePhpIni(
            loadPhpIniSettings(ctx.dataDir, phpVersion),
            loadProjectPhpIni(ctx.dataDir, id, phpVersion),
          ),
        );
        const result = await applyPhpFpmPool({
          dataDir: ctx.dataDir,
          poolName: proj.linuxUser,
          linuxUser: proj.linuxUser,
          phpVersion,
          host: ctx.host,
          enable: data.enable,
          adminValueLines });
        ctx.audit.append({
          actor: user.username,
          action: 'project.php_fpm',
          resource: id,
          detail: { ...result, phpVersion, adminValueCount: adminValueLines.length },
          ok: result.ok });
        sendJson(res, result.ok || !data.enable ? 200 : 422, {
          ...result,
          phpVersion,
          adminValueCount: adminValueLines.length,
          project: ctx.projects.get(id) });
        return true;
      }
      // —— Project-level PHP ini overrides ——
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/php-ini$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const version =
          url.searchParams.get('version') ?? proj.runtimeVersion ?? '8.2';
        const {
          getPhpIni,
          loadProjectPhpIni,
          mergePhpIni,
          loadPhpIniSettings,
          listPhpIniCatalog,
          renderPhpAdminValueLines } = await import('@ysk/core');
        const global = getPhpIni(ctx.dataDir, version);
        const project = loadProjectPhpIni(ctx.dataDir, id, version);
        const effective = mergePhpIni(loadPhpIniSettings(ctx.dataDir, version), project);
        sendJson(res, 200, {
          version,
          catalog: listPhpIniCatalog(),
          global: global.settings,
          project,
          effective,
          adminValuePreview: renderPhpAdminValueLines(effective),
          notes: [
            tl('notes.auto.n0698'),
            tl('notes.auto.n1503'),
          ] });
        return true;
      }
      if (method === 'PUT' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/php-ini$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const proj = ctx.projects.get(id);
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          values?: Record<string, string | number | boolean>;
          extra?: Record<string, string>;
          rawAppend?: string;
        };
        const { saveProjectPhpIni } = await import('@ysk/core');
        const result = saveProjectPhpIni(ctx.dataDir, id, {
          version: data.version ?? proj.runtimeVersion ?? '8.2',
          values: data.values ?? {},
          extra: data.extra ?? {},
          rawAppend: data.rawAppend ?? '' });
        ctx.audit.append({
          actor: user.username,
          action: 'project.php_ini.save',
          resource: id,
          detail: { written: result.written },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          settings: result.settings,
          written: result.written,
          notes: [tl('notes.auto.n0733')] });
        return true;
      }
      if (method === 'PATCH' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/runtime$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          runtimeVersion?: string;
          deployEntry?: string | null;
        };
        const p = ctx.db.snapshot.projects.find((x) => x.id === id);
        if (!p) {
          sendJson(res, 404, { ok: false, message: tl('notes.auto.n0004') });
          return true;
        }
        if (data.runtimeVersion) {
          p.runtime_version = normalizeRuntimeVersion(
            p.runtime,
            data.runtimeVersion.trim(),
          );
        }
        if (data.deployEntry !== undefined) {
          const v = data.deployEntry?.trim() || undefined;
          p.deploy_entry = v;
        }
        p.updated_at = new Date().toISOString();
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'project.runtime_version',
          resource: id,
          detail: {
            runtimeVersion: p.runtime_version,
            deployEntry: p.deploy_entry },
          ok: true });
        sendJson(res, 200, { project: ctx.projects.get(id) });
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/usage$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        sendJson(res, 200, await ctx.projectOps.quotaStatus(id));
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/deploy-php$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[4];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          port?: number;
          phpVersion?: string;
          enableApache?: boolean;
          preferFpm?: boolean;
          forceBuiltin?: boolean;
        };
        const result = await ctx.projectOps.deployPhp(id, {
          actor: user.username,
          port: data.port,
          phpVersion: data.phpVersion,
          enableApache: data.enableApache,
          preferFpm: data.preferFpm,
          forceBuiltin: data.forceBuiltin });
        sendJson(res, result.ok ? 200 : 502, result);
        return true;
      }
  return false;
}
