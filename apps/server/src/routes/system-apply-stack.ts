/**
 * System apply — email/ssl/php + nginx (Wave R1).
 * Extracted from system-apply.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyEmailStack,
  applyLetsEncrypt,
  applyPhpHosting,
  applyNginxSite,
  upsertLetsEncryptRecord,
  listCertificatesView,
  dedupeCertificatesInStore,
  deleteCertificate,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSystemApplyStackRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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

  return false;
}
