/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson } from '../http/util.js';

export type NavBookmarkProject = {
  id: string;
  label: string;
  domain?: string;
};
export type NavBookmarkEmail = {
  id: string;
  domain: string;
};
export type NavBookmarksState = {
  projects: NavBookmarkProject[];
  emailDomains: NavBookmarkEmail[];
};

function emptyNavBookmarks(): NavBookmarksState {
  return { projects: [], emailDomains: [] };
}

function navBookmarksKey(username: string): string {
  return `nav_bookmarks:${username || 'default'}`;
}

function sanitizeNavBookmarks(raw: unknown): NavBookmarksState {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const projects: NavBookmarkProject[] = [];
  const emailDomains: NavBookmarkEmail[] = [];
  if (Array.isArray(o.projects)) {
    for (const p of o.projects) {
      if (!p || typeof p !== 'object') continue;
      const r = p as Record<string, unknown>;
      const id = String(r.id ?? '').trim();
      if (!id) continue;
      projects.push({
        id,
        label: String(r.label ?? r.domain ?? id).trim() || id,
        domain: r.domain != null ? String(r.domain).trim() : undefined,
      });
      if (projects.length >= 30) break;
    }
  }
  if (Array.isArray(o.emailDomains)) {
    for (const e of o.emailDomains) {
      if (!e || typeof e !== 'object') continue;
      const r = e as Record<string, unknown>;
      const id = String(r.id ?? r.domain ?? '').trim();
      const domain = String(r.domain ?? r.id ?? '').trim();
      if (!id || !domain) continue;
      emailDomains.push({ id, domain });
      if (emailDomains.length >= 30) break;
    }
  }
  return { projects, emailDomains };
}

export async function handleSettingsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // —— Sidebar bookmarks: projects + email domains ——
      if (method === 'GET' && url.pathname === '/api/v1/nav/bookmarks') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = ctx.settings.getJson(navBookmarksKey(user.username));
        sendJson(res, 200, { ok: true, bookmarks: sanitizeNavBookmarks(raw) });
        return true;
      }
      if (method === 'PUT' && url.pathname === '/api/v1/nav/bookmarks') {
        const user = ctx.auth.authenticate(getBearer(req));
        const body = JSON.parse((await readBody(req)) || '{}') as {
          bookmarks?: unknown;
        };
        const next = sanitizeNavBookmarks(body.bookmarks ?? emptyNavBookmarks());
        ctx.settings.setJson(navBookmarksKey(user.username), next);
        ctx.audit.append({
          actor: user.username,
          action: 'nav.bookmarks.put',
          detail: {
            projects: next.projects.length,
            emailDomains: next.emailDomains.length,
          },
          ok: true,
        });
        sendJson(res, 200, { ok: true, bookmarks: next });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/nav/bookmarks/toggle') {
        const user = ctx.auth.authenticate(getBearer(req));
        const body = JSON.parse((await readBody(req)) || '{}') as {
          kind?: string;
          id?: string;
          label?: string;
          domain?: string;
        };
        const kind = body.kind === 'email' ? 'email' : body.kind === 'project' ? 'project' : '';
        const id = String(body.id ?? '').trim();
        if (!kind || !id) {
          sendJson(res, 400, { ok: false, message: 'kind and id required' });
          return true;
        }
        const cur = sanitizeNavBookmarks(
          ctx.settings.getJson(navBookmarksKey(user.username)),
        );
        let bookmarked = false;
        if (kind === 'project') {
          const i = cur.projects.findIndex((p) => p.id === id);
          if (i >= 0) {
            cur.projects.splice(i, 1);
            bookmarked = false;
          } else {
            cur.projects.unshift({
              id,
              label: String(body.label ?? body.domain ?? id).trim() || id,
              domain: body.domain != null ? String(body.domain).trim() : undefined,
            });
            cur.projects = cur.projects.slice(0, 30);
            bookmarked = true;
          }
        } else {
          const i = cur.emailDomains.findIndex((e) => e.id === id || e.domain === id);
          if (i >= 0) {
            cur.emailDomains.splice(i, 1);
            bookmarked = false;
          } else {
            const domain = String(body.domain ?? body.label ?? id).trim() || id;
            cur.emailDomains.unshift({ id, domain });
            cur.emailDomains = cur.emailDomains.slice(0, 30);
            bookmarked = true;
          }
        }
        ctx.settings.setJson(navBookmarksKey(user.username), cur);
        sendJson(res, 200, { ok: true, bookmarked, bookmarks: cur });
        return true;
      }

      if (method === 'GET' && url.pathname === '/api/v1/settings/security') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { requireCap } = await import('../http/rbac-guard.js');
        requireCap(ctx, user, 'security.policy');
        sendJson(res, 200, {
          ok: true,
          requireAdminTotp: ctx.auth.isAdminTotpRequired(),
          requireUserTotp: ctx.auth.isUserTotpRequired(),
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
          requireUserTotp?: boolean;
          requireAdminTotpStrict?: boolean;
          totp?: string;
        };
        try {
          if (
            data.requireAdminTotp === true ||
            data.requireUserTotp === true ||
            data.requireAdminTotpStrict === true
          ) {
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
        if (data.requireUserTotp !== undefined) {
          ctx.auth.setUserTotpRequired(Boolean(data.requireUserTotp), user.username);
        }
        if (data.requireAdminTotpStrict !== undefined) {
          ctx.db.snapshot.settings['security.require_admin_totp_strict'] =
            data.requireAdminTotpStrict ? '1' : '0';
          ctx.db.persist();
        }
        sendJson(res, 200, {
          ok: true,
          requireAdminTotp: ctx.auth.isAdminTotpRequired(),
          requireUserTotp: ctx.auth.isUserTotpRequired(),
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
            safetyLevel?: string;
            blockHosts?: string[];
            allowDangerousDownloads?: boolean;
            audioBridge?: boolean;
          }>('hostBrowse') ?? {};
        const caps = ctx.hostBrowse.capabilities();
        const safetyLevel =
          panel.safetyLevel === 'strict' ||
          panel.safetyLevel === 'relaxed' ||
          panel.safetyLevel === 'standard'
            ? panel.safetyLevel
            : 'standard';
        const { acceptedChromePathOrEmpty } = await import('ysk-server-core');
        sendJson(res, 200, {
          ok: true,
          settings: {
            engine: panel.engine ?? 'auto',
            chromePath: acceptedChromePathOrEmpty(panel.chromePath) ?? '',
            allowLoopback: Boolean(panel.allowLoopback),
            noSandbox: Boolean(panel.noSandbox),
            safetyLevel,
            blockHosts: Array.isArray(panel.blockHosts) ? panel.blockHosts : [],
            allowDangerousDownloads: Boolean(panel.allowDangerousDownloads),
            audioBridge: Boolean(panel.audioBridge),
          },
          capabilities: caps,
          envHints: {
            YSK_HOST_BROWSE_ENGINE: process.env.YSK_HOST_BROWSE_ENGINE ?? null,
            YSK_HOST_BROWSE_CHROME: process.env.YSK_HOST_BROWSE_CHROME ?? null,
            YSK_HOST_BROWSE_LOOPBACK: process.env.YSK_HOST_BROWSE_LOOPBACK ?? null,
            YSK_HOST_BROWSE_NO_SANDBOX: process.env.YSK_HOST_BROWSE_NO_SANDBOX ?? null,
            YSK_HOST_BROWSE_AUDIO: process.env.YSK_HOST_BROWSE_AUDIO ?? null,
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
          safetyLevel?: string;
          blockHosts?: string[] | string;
          allowDangerousDownloads?: boolean;
          audioBridge?: boolean;
        };
        const engine =
          data.engine === 'proxy' || data.engine === 'browser' || data.engine === 'auto'
            ? data.engine
            : 'auto';
        const safetyLevel =
          data.safetyLevel === 'strict' ||
          data.safetyLevel === 'relaxed' ||
          data.safetyLevel === 'standard'
            ? data.safetyLevel
            : 'standard';
        let blockHosts: string[] = [];
        if (Array.isArray(data.blockHosts)) {
          blockHosts = data.blockHosts
            .map((h) => String(h).trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 200);
        } else if (typeof data.blockHosts === 'string') {
          blockHosts = data.blockHosts
            .split(/[\n,]+/)
            .map((h) => h.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 200);
        }
        const { sanitizeChromePathInput } = await import('ysk-server-core');
        const next = {
          engine,
          chromePath: sanitizeChromePathInput(data.chromePath),
          allowLoopback: Boolean(data.allowLoopback),
          noSandbox: Boolean(data.noSandbox),
          safetyLevel,
          blockHosts,
          allowDangerousDownloads: Boolean(data.allowDangerousDownloads),
          audioBridge: Boolean(data.audioBridge),
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
            safetyLevel: next.safetyLevel,
            blockHosts: next.blockHosts.length,
            allowDangerousDownloads: next.allowDangerousDownloads,
            audioBridge: next.audioBridge,
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
