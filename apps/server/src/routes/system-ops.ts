/**
 * Residual system apply / ops routes (email·ssl·php apply, nginx, systemd,
 * services, self-update, export, migrate, readiness).
 * Extracted from system-controller (Wave D3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import {
  applyEmailStack,
  applyLetsEncrypt,
  applyPhpHosting,
  applyNginxSite,
  installControlPlaneSystemd,
  probeControlPlaneSystemd,
  getServiceMatrix,
  lifecycleServiceUnit,
  runSelfUpdate,
  upsertLetsEncryptRecord,
  listCertificatesView,
  dedupeCertificatesInStore,
  deleteCertificate,
  hardenDataDirPerms,
  ensureWebUiBuilt,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import { VERSION } from '../version.js';

export async function handleSystemOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // Defense Center / protection / geoip → routes/defense.ts (Wave C1)

  // real-ip/ips → routes/system-host.ts (Wave D2)

  if (!url.pathname.startsWith('/api/v1/system/') && url.pathname !== '/api/v1/updates/self/apply') {
    return false;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/email/apply') {
    // applyEmailStack is fail-closed when installPackages without EXECUTE
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      installPackages?: boolean;
      domainId?: string;
    };
    const domain = data.domain ?? 'example.com';
    const result = await applyEmailStack({
      dataDir: ctx.dataDir,
      domain,
      host: ctx.host,
      installPackages: data.installPackages,
    });
    // Write-back apply status onto matching email domain record (durable)
    const applyStatus = {
      status: result.ok ? 'applied' : 'failed',
      ok: result.ok,
      at: new Date().toISOString(),
      written: result.written,
      notes: result.notes,
      actor: user.username,
    };
    const emailRows = ctx.db.snapshot.email_domains as Array<Record<string, unknown>>;
    const match = emailRows.find(
      (e) =>
        (data.domainId && e.id === data.domainId) ||
        String(e.domain ?? '').toLowerCase() === domain.toLowerCase(),
    );
    if (match) {
      match.apply_status = applyStatus.status;
      match.last_apply = { ...applyStatus, serviceStatus: result.serviceStatus };
      match.updated_at = applyStatus.at;
      ctx.db.persist();
      if (typeof match.id === 'string') {
        ctx.email.markApplyStatus(match.id, {
          ok: result.ok,
          notes: result.notes,
          serviceStatus: result.serviceStatus,
        });
      }
    } else {
      // still record standalone apply job under settings for visibility
      ctx.settings.set(
        `email.apply.${domain}`,
        JSON.stringify({ ...applyStatus, serviceStatus: result.serviceStatus }),
      );
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.email.apply',
      detail: { ...result, applyStatus, domainId: match?.id },
      ok: result.ok,
    });
    sendOpsResult(res, {
      ...result,
      applyStatus,
      domainId: match?.id ?? null,
      serviceStatus: result.serviceStatus,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/ssl/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { domain?: string; email?: string; run?: boolean };
    const domain = data.domain ?? 'example.com';
    const email = data.email ?? 'admin@example.com';
    // Panel default: always attempt execution (run defaults true)
    const run = data.run !== false;
    const result = await applyLetsEncrypt({
      domain,
      email,
      host: ctx.host,
      run,
    });
    const certRow = upsertLetsEncryptRecord({
      db: ctx.db,
      domain,
      email,
      actor: user.username,
      ok: result.ok,
      run,
      executed: Boolean(result.executed && result.ok),
      commands: result.commands ?? [],
      notes: result.notes ?? [],
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.ssl.apply',
      detail: { ...result, certId: certRow.id, domain },
      ok: result.ok,
    });
    sendOpsResult(res, {
      ok: result.ok,
      executed: result.executed,
      blocked: result.blocked,
      blockReason: result.blockReason,
      blockMessage: result.blockMessage,
      notes: result.notes,
      steps: result.steps,
      certificate: certRow,
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/ssl/certificates') {
    ctx.auth.authenticate(getBearer(req));
    dedupeCertificatesInStore(ctx.db);
    sendJson(res, 200, { items: listCertificatesView(ctx.db, ctx.dataDir) });
    return true;
  }

  if (method === 'DELETE' && url.pathname.startsWith('/api/v1/system/ssl/certificates/')) {
    const user = ctx.auth.authenticate(getBearer(req));
    const idOrDomain = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const r = deleteCertificate(ctx.db, ctx.dataDir, idOrDomain);
    ctx.audit.append({
      actor: user.username,
      action: 'ssl.delete',
      resource: r.domain,
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r, { notFound: true });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/ssl/letsencrypt') {
    // Alias: prefer explicit execute flag
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      email?: string;
      execute?: boolean;
      run?: boolean;
    };
    const domain = data.domain ?? '';
    const email = data.email ?? `admin@${domain || 'example.com'}`;
    // Default execute from panel
    const run = data.execute !== false && data.run !== false;
    const result = await applyLetsEncrypt({ domain, email, host: ctx.host, run });
    const certRow = upsertLetsEncryptRecord({
      db: ctx.db,
      domain,
      email,
      actor: user.username,
      ok: result.ok,
      run,
      executed: Boolean(result.executed && result.ok),
      commands: result.commands ?? [],
      notes: result.notes ?? [],
    });
    sendOpsResult(res, {
      ok: result.ok,
      executed: result.executed,
      blocked: result.blocked,
      blockReason: result.blockReason,
      blockMessage: result.blockMessage,
      notes: result.notes,
      steps: result.steps,
      certificate: certRow,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/php/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      docRoot?: string;
      phpVersion?: string;
      poolName?: string;
      enableSite?: boolean;
    };
    const result = await applyPhpHosting({
      dataDir: ctx.dataDir,
      domain: data.domain ?? 'php.local',
      docRoot: data.docRoot ?? `${ctx.dataDir}/www/php`,
      phpVersion: data.phpVersion ?? '8.2',
      poolName: data.poolName ?? 'yskphp',
      host: ctx.host,
      enableSite: data.enableSite,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.php.apply',
      detail: result,
      ok: true,
    });
    sendJson(res, 200, result);
    return true;
  }

  // software + stack → routes/software.ts (Wave C3)

  // system db engines/redis/console → routes/system-db.ts (Wave D1)
  // ftps → routes/system-host.ts (Wave D2)

  // firewall + fail2ban → routes/firewall.ts (Wave C2)

  // host/panel-tls/power → routes/system-host.ts (Wave D2)

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/purge-cache') {
    const user = ctx.auth.authenticate(getBearer(req));
    const { purgeNginxCache } = await import('@ysk/core');
    const r = await purgeNginxCache({ host: ctx.host });
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.purge_cache',
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  // db dump/import → routes/system-db.ts (Wave D1)

  if (method === 'POST' && url.pathname === '/api/v1/system/nginx/site') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      serverName?: string;
      upstream?: string;
      ssl?: boolean;
      reload?: boolean;
    };
    const result = await applyNginxSite({
      dataDir: ctx.dataDir,
      serverName: data.serverName ?? 'app.local',
      upstream: data.upstream ?? 'http://127.0.0.1:3000',
      ssl: data.ssl,
      host: ctx.host,
      reload: data.reload,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.nginx.site',
      detail: result,
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/systemd/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { enable?: boolean };
    const cliPath = process.argv[1] ?? 'ysk-server';
    const result = await installControlPlaneSystemd({
      dataDir: ctx.dataDir,
      cliPath,
      host: ctx.host,
      enable: data.enable,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.systemd.install',
      detail: result,
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/systemd/status') {
    ctx.auth.authenticate(getBearer(req));
    const status = await probeControlPlaneSystemd(ctx.host, ctx.dataDir);
    sendJson(res, 200, status);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/services/matrix') {
    ctx.auth.authenticate(getBearer(req));
    const matrix = await getServiceMatrix(ctx.host);
    sendJson(res, 200, matrix);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/services/lifecycle') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      unit?: string;
      action?: 'start' | 'stop' | 'restart' | 'reload';
    };
    if (!data.unit || !data.action) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n0458')] });
      return true;
    }
    const result = await lifecycleServiceUnit(ctx.host, data.unit, data.action);
    ctx.audit.append({
      actor: user.username,
      action: 'system.services.lifecycle',
      detail: { unit: data.unit, action: data.action, ...result },
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/updates/self/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { apply?: boolean; latest?: string };
    // Panel always applies unless explicitly dry-run
    const apply = data.apply !== false;
    const result = await runSelfUpdate({
      currentVersion: VERSION,
      host: ctx.host,
      apply,
      latestOverride: data.latest,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'update.self.apply',
      detail: {
        applied: result.applied,
        ok: result.ok,
        checked: result.checked,
        updateAvailable: result.updateAvailable,
        channel: result.channel,
      },
      ok: result.ok,
    });
    // Honest HTTP: do not 200 when apply failed or channel check failed
    sendJson(res, result.ok ? 200 : result.checked === false ? 502 : 422, result);
    return true;
  }

  // —— Control-plane export + managed nginx + rebuild ——
  // Must live here: handleSystemRoutes is invoked before inline http-server routes.
  if (method === 'GET' && url.pathname === '/api/v1/system/export') {
    ctx.auth.authenticate(getBearer(req));
    const { exportControlPlaneSnapshot } = await import('@ysk/core');
    sendJson(res, 200, exportControlPlaneSnapshot(ctx.db));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/exports') {
    ctx.auth.authenticate(getBearer(req));
    const { listControlPlaneExports } = await import('@ysk/core');
    sendJson(res, 200, { items: listControlPlaneExports(ctx.dataDir) });
    return true;
  }
  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/exports/')) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    const { resolveExportFile } = await import('@ysk/core');
    const { createReadStream, existsSync } = await import('node:fs');
    const r = resolveExportFile(ctx.dataDir, name);
    if (!r.ok || !existsSync(r.path)) {
      sendJson(res, 404, { ok: false, notes: r.ok ? [tl('notes.auto.n0496')] : r.notes });
      return true;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    createReadStream(r.path).pipe(res);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/managed-nginx') {
    ctx.auth.authenticate(getBearer(req));
    const { listManagedNginxDetailed } = await import('@ysk/core');
    const { listWithQuery } = await import('../http/list-response.js');
    const all = listManagedNginxDetailed(ctx.dataDir) as Array<Record<string, unknown>>;
    const { items, meta } = listWithQuery(url, all, {
      text: (n) => [
        String(n.name ?? n.file ?? n.id ?? ''),
        String(n.domain ?? n.serverName ?? ''),
        String(n.path ?? ''),
      ],
    });
    sendJson(res, 200, { items, meta });
    return true;
  }
  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/managed-nginx/')) {
    ctx.auth.authenticate(getBearer(req));
    const name = decodeURIComponent(url.pathname.split('/').pop() || '');
    const { readManagedNginxConf } = await import('@ysk/core');
    const r = readManagedNginxConf(ctx.dataDir, name);
    sendOpsResult(res, r, { notFound: true });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/rebuild') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      syncNginx?: boolean;
      writeExport?: boolean;
      dryRun?: boolean;
    };
    const { rebuildManagedConfigs } = await import('@ysk/core');
    const r = await rebuildManagedConfigs({
      dataDir: ctx.dataDir,
      host: ctx.host,
      db: ctx.db,
      syncNginx: data.syncNginx,
      writeExport: data.writeExport !== false,
      dryRun: data.dryRun === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.rebuild',
      detail: {
        ok: r.ok,
        mode: r.mode,
        blocked: r.blocked,
        dryRun: r.dryRun,
        confCount: r.nginxConfs?.length,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  // —— Host full migrate (整機遷移) ——
  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/inventory') {
    ctx.auth.authenticate(getBearer(req));
    const { migrateInventory } = await import('@ysk/core');
    const r = await migrateInventory({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      yskVersion: VERSION,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/migrate/jobs') {
    ctx.auth.authenticate(getBearer(req));
    const { listMigrateJobs } = await import('@ysk/core');
    sendJson(res, 200, { ok: true, jobs: listMigrateJobs(ctx.dataDir) });
    return true;
  }

  if (method === 'GET' && url.pathname.startsWith('/api/v1/system/migrate/jobs/')) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop() || '';
    const { loadMigrateJob } = await import('@ysk/core');
    const job = loadMigrateJob(ctx.dataDir, id);
    if (!job) {
      sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0853')] });
      return true;
    }
    sendJson(res, 200, { ok: true, job });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/jobs') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      target?: string;
      port?: number;
      identityId?: string;
      identityFile?: string;
      /** one-shot; never stored */
      password?: string;
      maintenanceAccepted?: boolean;
      forceWipeTarget?: boolean;
      targetDataDir?: string;
      dryRun?: boolean;
      skipRemotePost?: boolean;
      jobId?: string;
      execute?: boolean;
    };
    const target = (data.target || '').trim();
    if (!target && !data.jobId) {
      sendJson(res, 400, {
        ok: false,
        notes: [tl('notes.auto.n1573')],
      });
      return true;
    }
    if (!data.execute && !data.dryRun) {
      sendJson(res, 403, {
        ok: false,
        blocked: true,
        notes: [tl('notes.auto.n1544')],
      });
      return true;
    }
    if (data.execute && !ctx.host.executeEnabled()) {
      sendOpsResult(res, {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: [tl('notes.auto.n0525')],
      });
      return true;
    }

    const { runSourceMigrateHost, loadMigrateJob } = await import('@ysk/core');
    type Auth =
      | { kind: 'identity'; privateKeyPath: string }
      | { kind: 'identityId'; dataDir: string; identityId: string }
      | { kind: 'password'; password: string }
      | { kind: 'agent' };
    let auth: Auth = { kind: 'agent' };
    let passwordForTempKey: string | undefined;
    if (data.identityFile) {
      auth = { kind: 'identity', privateKeyPath: data.identityFile };
    } else if (data.identityId) {
      auth = {
        kind: 'identityId',
        dataDir: ctx.dataDir,
        identityId: data.identityId,
      };
    } else if (data.password) {
      passwordForTempKey = data.password;
      auth = { kind: 'agent' };
    }

    let targetStr = target;
    if (!targetStr && data.jobId) {
      const prev = loadMigrateJob(ctx.dataDir, data.jobId);
      if (prev?.target) {
        targetStr = `${prev.target.user}@${prev.target.host}`;
        if (!data.port && prev.target.port) data.port = prev.target.port;
      }
    }
    if (!targetStr) {
      sendJson(res, 400, {
        ok: false,
        notes: [tl('notes.auto.n1574')],
      });
      return true;
    }

    const r = await runSourceMigrateHost({
      host: ctx.host,
      db: ctx.db,
      dataDir: ctx.dataDir,
      target: targetStr,
      port: data.port,
      auth,
      passwordForTempKey,
      maintenanceAccepted: data.maintenanceAccepted === true || data.execute === true,
      forceWipeTarget: data.forceWipeTarget === true,
      targetDataDir: data.targetDataDir,
      dryRun: data.dryRun === true,
      remotePost: data.skipRemotePost !== true,
      yskVersion: VERSION,
      jobId: data.jobId,
    });

    ctx.audit.append({
      actor: user.username,
      action: 'system.migrate.host',
      detail: {
        ok: r.ok,
        blocked: r.blocked,
        jobId: r.job?.id,
        target: target || undefined,
        dryRun: data.dryRun === true,
        phase: r.job?.phase,
      },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/migrate/post') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { jobId?: string };
    if (!data.jobId) {
      sendJson(res, 400, { ok: false, notes: [tl('notes.auto.n1563')] });
      return true;
    }
    if (!ctx.host.executeEnabled()) {
      sendOpsResult(res, {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: [tl('notes.auto.n0332')],
      });
      return true;
    }
    const { runLocalMigratePost } = await import('@ysk/core');
    const r = await runLocalMigratePost({
      host: ctx.host,
      dataDir: ctx.dataDir,
      jobId: data.jobId,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.migrate.post',
      detail: { ok: r.ok, jobId: data.jobId },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }



  if (method === 'POST' && url.pathname === '/api/v1/system/readiness/fix') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { action?: string };
    const action = String(data.action ?? '').trim();
    if (!action) {
      sendJson(res, 400, { ok: false, notes: ['action required'] });
      return true;
    }
    if (action === 'harden-datadir') {
      const result = hardenDataDirPerms(ctx.dataDir);
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          before: result.before,
          after: result.after,
          notes: result.notes,
        },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        before: result.before,
        after: result.after,
        notes: result.notes,
      });
      return true;
    }
    if (action === 'build-web-ui') {
      const result = await ensureWebUiBuilt({ dataDir: ctx.dataDir });
      ctx.audit.append({
        actor: user.username,
        action: 'system.readiness.fix',
        detail: {
          fixAction: action,
          path: result.path,
          notes: result.notes,
          codes: result.codes,
        },
        ok: result.ok,
      });
      // Prefer localized operator message when monorepo/package missing
      const notes =
        result.ok || !result.codes?.includes('NO_MONOREPO')
          ? result.notes
          : [
              tl('readiness.itemWebBuildManual'),
              ...result.notes,
            ];
      sendOpsResult(res, {
        ok: result.ok,
        action,
        path: result.path,
        notes,
        codes: result.codes,
      });
      return true;
    }
    sendJson(res, 400, {
      ok: false,
      notes: [`unknown readiness fix action: ${action}`],
      action,
    });
    return true;
  }


  return false;
}