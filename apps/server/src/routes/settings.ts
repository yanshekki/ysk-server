/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson } from '../http/util.js';

export async function handleSettingsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/settings/security') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { requireCap } = await import('../http/rbac-guard.js');
        requireCap(ctx, user, 'security.policy');
        sendJson(res, 200, {
          ok: true,
          requireAdminTotp: ctx.auth.isAdminTotpRequired(),
          requireAdminTotpStrict:
            ctx.db.snapshot.settings['security.require_admin_totp_strict'] === '1' });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/settings/security') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { requireCap } = await import('../http/rbac-guard.js');
        requireCap(ctx, user, 'security.policy');
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          requireAdminTotp?: boolean;
          requireAdminTotpStrict?: boolean;
          totp?: string;
        };
        try {
          if (data.requireAdminTotp === true || data.requireAdminTotpStrict === true) {
            ctx.auth.requireStepUp(user.id, data.totp);
          }
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
        if (data.requireAdminTotp !== undefined) {
          ctx.auth.setAdminTotpRequired(Boolean(data.requireAdminTotp), user.username);
        }
        if (data.requireAdminTotpStrict !== undefined) {
          ctx.db.snapshot.settings['security.require_admin_totp_strict'] =
            data.requireAdminTotpStrict ? '1' : '0';
          ctx.db.persist();
        }
        sendJson(res, 200, {
          ok: true,
          requireAdminTotp: ctx.auth.isAdminTotpRequired(),
          requireAdminTotpStrict:
            ctx.db.snapshot.settings['security.require_admin_totp_strict'] === '1' });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/settings/llm') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          baseUrl?: string;
          apiKey?: string;
          model?: string;
        };
        ctx.settings.setJson('llm', data);
        ctx.reloadLlm();
        ctx.audit.append({
          actor: user.username,
          action: 'settings.llm',
          detail: { baseUrl: data.baseUrl, model: data.model },
          ok: true });
        sendJson(res, 200, { ok: true, llm: data, transport: data.baseUrl ? 'http' : 'echo' });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/settings/llm') {
        ctx.auth.authenticate(getBearer(req));
        const llm = ctx.settings.getJson<{ baseUrl?: string }>('llm') ?? {};
        sendJson(res, 200, {
          llm,
          transport: llm.baseUrl || process.env.YSK_LLM_BASE_URL ? 'http' : 'echo' });
        return true;
      }

      // —— Host Browse panel settings (override process env) ——
      if (method === 'GET' && url.pathname === '/api/v1/settings/host-browse') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { requireCap } = await import('../http/rbac-guard.js');
        requireCap(ctx, user, 'network.browse');
        const panel =
          ctx.settings.getJson<{
            engine?: string;
            chromePath?: string;
            allowLoopback?: boolean;
            noSandbox?: boolean;
          }>('hostBrowse') ?? {};
        const caps = ctx.hostBrowse.capabilities();
        sendJson(res, 200, {
          ok: true,
          settings: {
            engine: panel.engine ?? 'auto',
            chromePath: panel.chromePath ?? '',
            allowLoopback: Boolean(panel.allowLoopback),
            noSandbox: Boolean(panel.noSandbox),
          },
          capabilities: caps,
          envHints: {
            YSK_HOST_BROWSE_ENGINE: process.env.YSK_HOST_BROWSE_ENGINE ?? null,
            YSK_HOST_BROWSE_CHROME: process.env.YSK_HOST_BROWSE_CHROME ?? null,
            YSK_HOST_BROWSE_LOOPBACK: process.env.YSK_HOST_BROWSE_LOOPBACK ?? null,
            YSK_HOST_BROWSE_NO_SANDBOX: process.env.YSK_HOST_BROWSE_NO_SANDBOX ?? null,
          },
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/settings/host-browse') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { requireCap } = await import('../http/rbac-guard.js');
        requireCap(ctx, user, 'network.browse');
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          engine?: string;
          chromePath?: string;
          allowLoopback?: boolean;
          noSandbox?: boolean;
        };
        const engine =
          data.engine === 'proxy' || data.engine === 'browser' || data.engine === 'auto'
            ? data.engine
            : 'auto';
        const next = {
          engine,
          chromePath: String(data.chromePath ?? '').trim(),
          allowLoopback: Boolean(data.allowLoopback),
          noSandbox: Boolean(data.noSandbox),
        };
        ctx.settings.setJson('hostBrowse', next);
        await ctx.hostBrowse.applyConfigChanged();
        ctx.audit.append({
          actor: user.username,
          action: 'settings.host_browse',
          detail: {
            engine: next.engine,
            chromePath: next.chromePath ? '[set]' : '',
            allowLoopback: next.allowLoopback,
            noSandbox: next.noSandbox,
          },
          ok: true,
        });
        sendJson(res, 200, {
          ok: true,
          settings: next,
          capabilities: ctx.hostBrowse.capabilities(),
        });
        return true;
      }

  return false;
}
