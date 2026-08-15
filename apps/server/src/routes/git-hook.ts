/**
 * Inbound Git push hook — no panel session.
 * POST /api/v1/hooks/git/:projectId
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { readBody, sendJson } from '../http/util.js';
import {
  classifyGitHookEvent,
  extractGitHookPushRef,
  gitHookRateLimited,
  hookPushMatchesTrackedRef,
  isGitHookProjectId,
  readGitHookSecret,
  verifyGitHookAuth,
} from 'ysk-server-core';

export async function handleGitHookRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  const m = /^\/api\/v1\/hooks\/git\/([^/]+)$/.exec(url.pathname);
  if (!m) return false;
  if (method === 'GET' || method === 'HEAD') {
    sendJson(res, 405, { ok: false, notes: ['POST only'] });
    return true;
  }
  if (method !== 'POST') return false;
  const id = m[1] ?? '';
  if (!isGitHookProjectId(id)) {
    sendJson(res, 404, { ok: false });
    return true;
  }
  const store = ctx.db.snapshot.projects.find((p) => p.id === id);
  if (!store) {
    sendJson(res, 404, { ok: false });
    return true;
  }
  const raw = await readBody(req);
  const secret = readGitHookSecret(ctx.dataDir, id);
  if (!secret || !verifyGitHookAuth(req.headers, raw, secret)) {
    sendJson(res, 401, { ok: false });
    return true;
  }
  if (!store.git_hook_enabled) {
    sendJson(res, 403, { ok: false, notes: ['disabled'] });
    return true;
  }
  const ev = classifyGitHookEvent(req.headers, raw);
  if (ev === 'ping') {
    sendJson(res, 200, { ok: true, skipped: 'ping' });
    return true;
  }
  if (ev === 'other') {
    sendJson(res, 200, { ok: true, skipped: 'event' });
    return true;
  }
  const pushRef = extractGitHookPushRef(raw);
  if (!hookPushMatchesTrackedRef(pushRef, store.git_branch)) {
    sendJson(res, 200, { ok: true, skipped: 'ref' });
    return true;
  }
  if (gitHookRateLimited(id)) {
    sendJson(res, 200, { ok: true, skipped: 'rate' });
    return true;
  }
  try {
    const result = await ctx.projectOps.gitDeploy(id, {
      actor: 'git-hook',
      redeploy: true,
    });
    sendJson(res, 200, {
      ok: result.ok,
      notes: result.notes?.slice(0, 12),
      commit: result.git?.commit,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, 200, { ok: false, notes: [msg] });
  }
  return true;
}
