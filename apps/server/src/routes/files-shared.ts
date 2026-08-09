/**
 * Shared file-manager helpers (root resolve, rate-limit, project chown).
 * Extracted from files-controller (Wave E1).
 */
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { publicFilesRoot, chownProjectPath } from '@ysk/core';
import type { UserDto } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { requireCap } from '../http/rbac-guard.js';

/** Public share + WebDAV auth: 10 fails / 15m → 15m lock */
export const PUBLIC_AUTH_RL = { maxFailures: 10, windowMs: 15 * 60_000, lockMs: 15 * 60_000 };

/**
 * Client IP for rate limits. Only trust X-Forwarded-For when
 * YSK_TRUST_PROXY=1 (or true) — otherwise spoofable.
 */
export function clientIp(req: IncomingMessage): string {
  const trust =
    process.env.YSK_TRUST_PROXY === '1' || process.env.YSK_TRUST_PROXY === 'true';
  if (trust) {
    const xf = req.headers['x-forwarded-for'];
    if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function resolveRoot(
  ctx: AppContext,
  rootParam: string,
  opts?: { user?: UserDto; /** Public share download — token already authorized */ skipCap?: boolean },
): {
  root: string;
  rootKey: string;
  owner?: { linuxUser: string; linuxGroup: string; homeDir: string };
} {
  if (rootParam === 'public' || !rootParam) {
    return { root: publicFilesRoot(ctx.dataDir), rootKey: 'public' };
  }
  if (rootParam.startsWith('project:')) {
    const projectId = rootParam.slice('project:'.length);
    // Multi-tenant: panel access requires files.project (admin has full pack)
    if (!opts?.skipCap) {
      if (!opts?.user) {
        throw Object.assign(new Error('authentication required for project files'), {
          httpStatus: 401,
        });
      }
      requireCap(ctx, opts.user, 'files.project');
    }
    const proj = ctx.projects.get(projectId);
    return {
      root: proj.homeDir,
      rootKey: rootParam,
      owner: {
        linuxUser: proj.linuxUser,
        linuxGroup: proj.linuxGroup || proj.linuxUser,
        homeDir: proj.homeDir } };
  }
  throw Object.assign(new Error('root must be public or project:<id>'), { httpStatus: 400 });
}

export async function chownProjectRels(
  ctx: AppContext,
  owner: { linuxUser: string; linuxGroup: string; homeDir: string } | undefined,
  relPaths: string[],
): Promise<{ chowned: boolean; notes: string[] }> {
  if (!owner?.linuxUser) return { chowned: false, notes: [] };
  const notes: string[] = [];
  let any = false;
  for (const rel of relPaths) {
    if (!rel || rel === '.' || rel === '/') continue;
    const abs = join(owner.homeDir, rel.replace(/^\/+/, ''));
    const r = await chownProjectPath(ctx.host, owner, abs);
    notes.push(...r.notes);
    if (r.ok) any = true;
  }
  return { chowned: any, notes };
}

