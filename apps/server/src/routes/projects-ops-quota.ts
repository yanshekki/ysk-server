/**
 * Project ftp / resources / quota / php-fpm / php-ini / usage (Wave V3).
 * Extracted from projects-ops-data.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import {
  applyPhpFpmPool,
  createProjectFtpAccount,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleProjectsOpsQuotaRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
  if (method === 'GET' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+\/usage$/)) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    sendJson(res, 200, await ctx.projectOps.quotaStatus(id));
    return true;
  }

  return false;
}
