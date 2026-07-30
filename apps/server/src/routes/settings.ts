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
  return false;
}
