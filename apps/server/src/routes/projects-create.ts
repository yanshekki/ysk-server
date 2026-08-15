/**
 * Project wizard / create / delete (Wave Z2).
 * Extracted from projects-catalog.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleProjectsCreateRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/wizard/create') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      projectName?: string;
      domain?: string;
      runtime?: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
      runtimeVersion?: string;
      serverIp?: string;
      serverIpv6?: string;
      createDns?: boolean;
      createMail?: boolean;
      createDb?: boolean;
      dbName?: string;
      templateId?: string;
    };
    const { runCreateWizard } = await import('ysk-server-core');
    const r = await runCreateWizard({
      db: ctx.db,
      host: ctx.host,
      dataDir: ctx.dataDir,
      projects: ctx.projects,
      email: ctx.email,
      actor: user.username,
      actorUserId: user.id,
      body: {
        projectName: data.projectName ?? '',
        domain: data.domain,
        runtime: data.runtime,
        runtimeVersion: data.runtimeVersion,
        serverIp: data.serverIp,
        serverIpv6: data.serverIpv6,
        createDns: data.createDns,
        createMail: data.createMail,
        createDb: data.createDb,
        dbName: data.dbName,
        templateId: data.templateId,
      },
    });
    ctx.audit.append({
      actor: user.username,
      action: 'wizard.create',
      detail: r,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/projects') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      name?: string;
      domain?: string;
      domainAliases?: string[];
      runtime?: 'node' | 'php' | 'static' | 'python' | 'go' | 'rust';
      runtimeVersion?: string;
      env?: 'staging' | 'production';
      templateId?: string;
      forceTemplate?: boolean;
      /** Deploy + publish nginx after create (default true when templateId set) */
      goLive?: boolean;
      preferredPort?: number;
      /** Also create managed DNS zone for domain */
      createDnsZone?: boolean;
      /** Also register email domain */
      createMailDomain?: boolean;
      serverIp?: string;
      serverIpv6?: string;
      gitUrl?: string;
      gitBranch?: string;
    };
    const { assertCanCreateProject } = await import('ysk-server-core');
    assertCanCreateProject(ctx.db, user.id);
    const runtime = data.runtime ?? 'node';
    const { defaultRuntimeVersion, normalizeRuntimeVersion, assertGitUrl } = await import(
      'ysk-server-core'
    );
    const gitUrl = data.gitUrl?.trim() || undefined;
    const gitBranch = data.gitBranch?.trim() || undefined;
    if (gitUrl) assertGitUrl(gitUrl);
    const created = await ctx.projects.create({
      name: data.name ?? '',
      domain: data.domain,
      domainAliases: data.domainAliases,
      runtime,
      runtimeVersion: normalizeRuntimeVersion(
        runtime,
        data.runtimeVersion ?? defaultRuntimeVersion(runtime),
      ),
      env: data.env,
      actor: user.username,
      actorUserId: user.id,
      templateId: gitUrl ? undefined : data.templateId,
      forceTemplate: data.forceTemplate,
      preferredPort: data.preferredPort,
      gitUrl,
      gitBranch,
    });
    const extras: {
      dnsZoneId?: string;
      emailDomainId?: string;
      notes: string[];
      goLive?: { ok: boolean; notes: string[] };
    } = {
      notes: [],
    };
    // Template (or explicit goLive) → deploy + nginx in one shot.
    // Git-only create stores the remote; clone from the App tab (no empty deploy).
    const wantGoLive = gitUrl
      ? false
      : data.goLive === true || (data.goLive !== false && Boolean(data.templateId));
    if (wantGoLive) {
      try {
        const live = await ctx.projectOps.goLive(created.project.id, {
          actor: user.username,
          port: data.preferredPort,
        });
        extras.goLive = { ok: live.ok, notes: live.notes };
        extras.notes.push(...live.notes.slice(0, 12));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        extras.goLive = { ok: false, notes: [msg] };
        extras.notes.push(`goLive: ${msg}`);
      }
    }
    const { attachProjectCreateExtras } = await import('ysk-server-core');
    const linked = attachProjectCreateExtras({
      db: ctx.db,
      email: ctx.email,
      projectId: created.project.id,
      domain: data.domain,
      actor: user.username,
      createDnsZone: data.createDnsZone,
      createMailDomain: data.createMailDomain,
      serverIp: data.serverIp,
      serverIpv6: data.serverIpv6,
    });
    extras.dnsZoneId = linked.dnsZoneId;
    extras.emailDomainId = linked.emailDomainId;
    extras.notes.push(...linked.notes);
    // Refresh project after optional goLive so port/nginx_status are current
    const project = wantGoLive
      ? ctx.projects.get(created.project.id)
      : created.project;
    sendJson(res, 201, { ...created, project, extras });
    return true;
  }
  if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/projects\/[^/]+$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[4];
    let body: { confirmName?: string; removeFiles?: boolean } = {};
    try {
      const raw = await readBody(req);
      if (raw?.trim()) body = JSON.parse(raw) as typeof body;
    } catch {
      body = {};
    }
    // Also accept query params for simple clients
    if (url.searchParams.has('confirmName')) {
      body.confirmName = url.searchParams.get('confirmName') || undefined;
    }
    if (url.searchParams.has('removeFiles')) {
      body.removeFiles = url.searchParams.get('removeFiles') !== '0';
    }
    const result = await ctx.projects.delete(id, user.username, {
      confirmName: body.confirmName,
      removeFiles: body.removeFiles !== false,
    });
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
