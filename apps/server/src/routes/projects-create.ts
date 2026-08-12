/**
 * Project wizard / create / delete (Wave Z2).
 * Extracted from projects-catalog.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@yanshekki/shared';
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
    const { runCreateWizard } = await import('@yanshekki/core');
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
    };
    const { assertCanCreateProject } = await import('@yanshekki/core');
    assertCanCreateProject(ctx.db, user.id);
    const runtime = data.runtime ?? 'node';
    const { defaultRuntimeVersion, normalizeRuntimeVersion } = await import('@yanshekki/core');
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
      templateId: data.templateId,
      forceTemplate: data.forceTemplate,
      preferredPort: data.preferredPort,
    });
    const extras: {
      dnsZoneId?: string;
      emailDomainId?: string;
      notes: string[];
      goLive?: { ok: boolean; notes: string[] };
    } = {
      notes: [],
    };
    // Template (or explicit goLive) → deploy + nginx in one shot
    const wantGoLive =
      data.goLive === true || (data.goLive !== false && Boolean(data.templateId));
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
    const domain = (data.domain ?? '').trim().toLowerCase();
    const serverIp = (data.serverIp ?? '127.0.0.1').trim();
    const serverIpv6 = data.serverIpv6?.trim() || undefined;
    if (domain && data.createDnsZone) {
      try {
        const { createResource, seedDnsZoneRecords } = await import('@yanshekki/core');
        const zoneRow = createResource(ctx.db, 'dns_zones', {
          zone: domain,
          serverIp,
          ...(serverIpv6 ? { serverIpv6 } : {}),
          backend: 'bind',
          template: 'web',
          apply_status: 'draft',
          projectId: created.project.id,
        });
        seedDnsZoneRecords(
          ctx.db,
          String(zoneRow.id),
          domain,
          serverIp,
          'web',
          serverIpv6,
        );
        extras.dnsZoneId = String(zoneRow.id);
        extras.notes.push(tl('notes.auto.t0785', { v0: (domain) }));
      } catch (e) {
        extras.notes.push(
          tl('notes.auto.t0786', { v0: (e instanceof Error ? e.message : String(e)) }),
        );
      }
    }
    if (domain && data.createMailDomain) {
      try {
        const mail = ctx.email.create({
          domain,
          serverIp,
          serverIpv6,
          actor: user.username,
        });
        extras.emailDomainId = String(
          (mail as { domain?: { id?: string } }).domain?.id ??
            (mail as { id?: string }).id ??
            '',
        );
        extras.notes.push(tl('notes.auto.t0787', { v0: (domain) }));
      } catch (e) {
        extras.notes.push(
          tl('notes.auto.t0788', { v0: (e instanceof Error ? e.message : String(e)) }),
        );
      }
    }
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
