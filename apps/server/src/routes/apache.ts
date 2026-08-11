/**
 * Apache sites + settings API.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  listMergedApacheSites,
  listApacheSites,
  createApacheSite,
  updateApacheSite,
  deleteApacheSite,
  applyApacheSite,
  loadApacheSettings,
  saveApacheSettings,
  applyApacheSettings,
  applyPhpHosting,
  resolveProjectDocRoot,
  readApacheSiteConf,
  removeApacheArtifact,
  cleanupApacheServerNameConflicts,
  type ApacheSiteRow,
} from '@ysk/core';
import { ErrorCodes } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';

export async function handleApacheRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/v1/hosting/apache')) return false;

  try {
    if (method === 'GET' && url.pathname === '/api/v1/hosting/apache/sites') {
      ctx.auth.authenticate(getBearer(req));
      const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
      const items = listMergedApacheSites({ dataDir: ctx.dataDir, projects });
      const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const source = url.searchParams.get('source');
      const projectId = url.searchParams.get('projectId');
      let filtered: ApacheSiteRow[] = items;
      if (source === 'project' || source === 'standalone' || source === 'artifact') {
        filtered = filtered.filter((r: ApacheSiteRow) => r.source === source);
      }
      if (projectId) {
        filtered = filtered.filter((r: ApacheSiteRow) => r.projectId === projectId);
      }
      if (q) {
        filtered = filtered.filter(
          (r: ApacheSiteRow) =>
            r.serverName.toLowerCase().includes(q) ||
            (r.projectName ?? '').toLowerCase().includes(q) ||
            r.target.toLowerCase().includes(q),
        );
      }
      sendJson(res, 200, { items: filtered, total: filtered.length });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/hosting/apache/sites') {
      const user = ctx.auth.authenticate(getBearer(req));
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as {
        serverName?: string;
        kind?: string;
        upstream?: string;
        root?: string;
        ssl?: boolean;
      };
      const item = createApacheSite(ctx.dataDir, {
        serverName: data.serverName ?? '',
        kind:
          data.kind === 'static' || data.kind === 'php' ? data.kind : 'proxy',
        upstream: data.upstream,
        root: data.root,
        ssl: data.ssl,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'apache.site.create',
        resource: item.id,
        detail: { serverName: item.serverName, kind: item.kind },
        ok: true,
      });
      sendJson(res, 201, { item });
      return true;
    }

    if (method === 'GET' && url.pathname === '/api/v1/hosting/apache/settings') {
      ctx.auth.authenticate(getBearer(req));
      sendJson(res, 200, { settings: loadApacheSettings(ctx.dataDir) });
      return true;
    }

    if (method === 'PATCH' && url.pathname === '/api/v1/hosting/apache/settings') {
      const user = ctx.auth.authenticate(getBearer(req));
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as Record<string, unknown>;
      const settings = saveApacheSettings(ctx.dataDir, data as never);
      ctx.audit.append({
        actor: user.username,
        action: 'apache.settings.patch',
        detail: { keys: Object.keys(data) },
        ok: true,
      });
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    if (
      method === 'POST' &&
      url.pathname === '/api/v1/hosting/apache/sites/cleanup-conflicts'
    ) {
      const user = ctx.auth.authenticate(getBearer(req));
      const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
      const result = await cleanupApacheServerNameConflicts({
        dataDir: ctx.dataDir,
        host: ctx.host,
        projects,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'apache.sites.cleanup_conflicts',
        detail: { ok: result.ok, removed: result.removed },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ...result,
        apply_status: result.blocked
          ? 'blocked'
          : result.ok
            ? 'applied'
            : 'failed',
      });
      return true;
    }

    if (method === 'POST' && url.pathname === '/api/v1/hosting/apache/settings/apply') {
      const user = ctx.auth.authenticate(getBearer(req));
      const raw = await readBody(req);
      const data = JSON.parse(raw || '{}') as Record<string, unknown>;
      const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
      const result = await applyApacheSettings({
        dataDir: ctx.dataDir,
        host: ctx.host,
        patch: Object.keys(data).length ? (data as never) : undefined,
        projects,
      });
      if (result.ok && !result.blocked) {
        try {
          const { syncServiceExposure } = await import('@ysk/core');
          const exp = await syncServiceExposure({
            host: ctx.host,
            dataDir: ctx.dataDir,
            serviceId: 'apache',
            ports: [
              { role: 'http', port: '80', proto: 'tcp' },
              { role: 'https', port: '443', proto: 'tcp' },
            ],
            reason: 'apply',
            requireDecision: false,
          });
          if (exp.notes?.length) {
            (result as { notes?: string[] }).notes = [
              ...((result as { notes?: string[] }).notes ?? []),
              ...exp.notes.slice(0, 3),
            ];
          }
        } catch {
          /* non-fatal */
        }
      }
      ctx.audit.append({
        actor: user.username,
        action: 'apache.settings.apply',
        detail: { ok: result.ok, blocked: result.blocked },
        ok: result.ok,
      });
      sendOpsResult(res, {
        ...result,
        apply_status: result.blocked ? 'blocked' : result.ok ? 'applied' : 'failed',
      });
      return true;
    }

    const siteMatch = url.pathname.match(
      /^\/api\/v1\/hosting\/apache\/sites\/([^/]+)(?:\/(apply|settings|conf))?$/,
    );
    if (siteMatch) {
      const id = decodeURIComponent(siteMatch[1] ?? '');
      const action = siteMatch[2];

      if (method === 'GET' && action === 'conf') {
        ctx.auth.authenticate(getBearer(req));
        if (id.startsWith('project:')) {
          const projectId = id.slice('project:'.length);
          const project = ctx.projects.get(projectId);
          const linuxUser = project?.linuxUser ?? '';
          const path = linuxUser
            ? join(ctx.dataDir, 'apache', 'sites', `ysk-${linuxUser}.conf`)
            : null;
          sendJson(res, 200, { path, content: readApacheSiteConf(path) });
          return true;
        }
        if (id.startsWith('artifact:')) {
          const file = id.slice('artifact:'.length).replace(/[/\\]/g, '');
          const path = join(ctx.dataDir, 'apache', 'sites', file);
          sendJson(res, 200, { path, content: readApacheSiteConf(path) });
          return true;
        }
        const rec = listApacheSites(ctx.dataDir).find((s) => s.id === id);
        sendJson(res, 200, {
          path: rec?.confPath ?? null,
          content: readApacheSiteConf(rec?.confPath),
        });
        return true;
      }

      if (method === 'PATCH' && !action) {
        if (id.startsWith('project:') || id.startsWith('artifact:')) {
          sendJson(res, 400, {
            ok: false,
            code: ErrorCodes.VALIDATION,
            message: 'Project/artifact Apache sites are managed via the project',
          });
          return true;
        }
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        const item = updateApacheSite(ctx.dataDir, id, data as never);
        sendJson(res, 200, { item });
        return true;
      }

      if (method === 'DELETE' && !action) {
        if (id.startsWith('project:')) {
          sendJson(res, 400, {
            ok: false,
            code: ErrorCodes.VALIDATION,
            message: 'Project Apache sites are managed via the project',
          });
          return true;
        }
        if (id.startsWith('artifact:')) {
          const user = ctx.auth.authenticate(getBearer(req));
          const projects = ctx.projects
            .list()
            .map((p) => ({ ...p }) as Record<string, unknown>);
          const result = await removeApacheArtifact({
            dataDir: ctx.dataDir,
            host: ctx.host,
            fileOrId: id,
            projects,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'apache.artifact.remove',
            resource: id,
            detail: { ok: result.ok, removed: result.removed, code: result.code },
            ok: result.ok,
          });
          if (!result.ok) {
            const status =
              result.code === 'not_found'
                ? 404
                : result.code === 'owned' || result.code === 'invalid'
                  ? 409
                  : 400;
            sendJson(res, status, {
              ok: false,
              code: ErrorCodes.VALIDATION,
              message: result.notes[0] ?? 'remove failed',
              notes: result.notes,
            });
            return true;
          }
          sendOpsResult(res, {
            ...result,
            apply_status: result.blocked
              ? 'blocked'
              : result.ok
                ? 'applied'
                : 'failed',
          });
          return true;
        }
        const user = ctx.auth.authenticate(getBearer(req));
        const ok = deleteApacheSite(ctx.dataDir, id);
        ctx.audit.append({
          actor: user.username,
          action: 'apache.site.delete',
          resource: id,
          detail: { ok },
          ok,
        });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }

      if (method === 'POST' && action === 'apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        if (id.startsWith('project:')) {
          const projectId = id.slice('project:'.length);
          const row = ctx.projects.get(projectId);
          if (!row || row.runtime !== 'php') {
            sendJson(res, 404, {
              ok: false,
              code: ErrorCodes.NOT_FOUND,
              message: 'PHP project not found',
            });
            return true;
          }
          const domain = row.domain ?? `${row.linuxUser}.local`;
          const aliases = (row.domainAliases || [])
            .map((a: string) => String(a).trim())
            .filter(Boolean);
          const docRoot = resolveProjectDocRoot({
            home_dir: row.homeDir,
            doc_root: row.docRoot,
          } as Parameters<typeof resolveProjectDocRoot>[0]);
          const projects = ctx.projects
            .list()
            .map((p) => ({ ...p }) as Record<string, unknown>);
          const result = await applyPhpHosting({
            dataDir: ctx.dataDir,
            domain,
            serverAliases: aliases,
            docRoot,
            phpVersion: row.runtimeVersion || '8.2',
            poolName: row.linuxUser,
            host: ctx.host,
            enableSite: true,
            projects,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'apache.site.apply',
            resource: id,
            detail: { ok: result.ok, projectId },
            ok: result.ok,
          });
          sendOpsResult(res, {
            ...result,
            apply_status: result.ok
              ? result.siteEnabled
                ? 'applied'
                : 'written'
              : 'failed',
          });
          return true;
        }
        if (id.startsWith('artifact:')) {
          sendJson(res, 400, {
            ok: false,
            code: ErrorCodes.VALIDATION,
            message: 'Artifact conf — re-apply from project or recreate standalone site',
          });
          return true;
        }
        const result = await applyApacheSite({
          dataDir: ctx.dataDir,
          host: ctx.host,
          id,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'apache.site.apply',
          resource: id,
          detail: { ok: result.ok, blocked: result.blocked },
          ok: result.ok,
        });
        sendOpsResult(res, {
          ...result,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }

      if (method === 'PATCH' && action === 'settings') {
        if (id.startsWith('project:') || id.startsWith('artifact:')) {
          sendJson(res, 400, {
            ok: false,
            code: ErrorCodes.VALIDATION,
            message: 'Project Apache settings are managed via the project',
          });
          return true;
        }
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        updateApacheSite(ctx.dataDir, id, data as never);
        const result = await applyApacheSite({
          dataDir: ctx.dataDir,
          host: ctx.host,
          id,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'apache.site.settings',
          resource: id,
          detail: { keys: Object.keys(data), ok: result.ok, blocked: result.blocked },
          ok: result.ok,
        });
        sendOpsResult(res, {
          ...result,
          apply_status: result.blocked
            ? 'blocked'
            : result.ok
              ? 'applied'
              : 'failed',
        });
        return true;
      }
    }

    sendJson(res, 404, {
      ok: false,
      code: ErrorCodes.NOT_FOUND,
      message: 'not found',
    });
    return true;
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 500, {
      ok: false,
      code: err.code ?? ErrorCodes.INTERNAL,
      message: err.message ?? String(e),
    });
    return true;
  }
}
