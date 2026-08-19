/**
 * System apply — email + SSL/LE certificates (Wave Y3).
 * Extracted from system-apply-stack.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  applyEmailStack,
  applyLetsEncrypt,
  applyManagedNginxSite,
  upsertLetsEncryptRecord,
  listCertificatesView,
  listResources,
  updateResource,
  dedupeCertificatesInStore,
  deleteCertificate,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

async function rewriteNginxSslAfterLe(
  ctx: AppContext,
  domain: string,
  ok: boolean,
  executed: boolean,
): Promise<void> {
  if (!ok || !executed) return;
  const want = domain.trim().toLowerCase();
  if (!want) return;
  for (const site of listResources(ctx.db, 'nginx_sites')) {
    const names = String(site.serverName ?? '')
      .toLowerCase()
      .split(/\s+/);
    if (!names.includes(want)) continue;
    updateResource(ctx.db, 'nginx_sites', String(site.id), { ssl: true, forceHttps: true });
    await applyManagedNginxSite(ctx.db, ctx.dataDir, String(site.id), {
      host: ctx.host,
      execute: true,
    });
  }
}

export async function handleSystemApplyTlsRoutes(
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
    // Auto-open mail ports (postfix + dovecot) via service exposure
    if (result.ok) {
      try {
        const { syncMailServiceExposure } = await import('ysk-server-core');
        const exp = await syncMailServiceExposure({
          host: ctx.host,
          dataDir: ctx.dataDir,
          reason: data.installPackages ? 'start' : 'apply',
        });
        if (exp.notes.length) {
          result.notes = [...(result.notes ?? []), ...exp.notes.slice(0, 4)];
        }
      } catch {
        /* non-fatal */
      }
    }
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
    await rewriteNginxSslAfterLe(ctx, domain, result.ok, Boolean(result.executed && result.ok));
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
    await rewriteNginxSslAfterLe(ctx, domain, result.ok, Boolean(result.executed && result.ok));
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

  return false;
}
