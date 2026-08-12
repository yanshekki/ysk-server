/**
 * CLI: apache — sites + settings parity with panel Apache hosting.
 *
 *   sites list|create|update|delete|apply|conf
 *   settings get|set|apply
 *   cleanup-conflicts
 */
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
  syncServiceExposure,
} from 'ysk-server-core';
import { join } from 'node:path';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

function needExecute(
  h: CliHelpers,
  args: string[],
  msg: string,
): number | null {
  if (h.wantsHostExecute(args)) return null;
  h.printJson({ ok: false, blocked: true, dryRun: true, notes: [msg] });
  return 3;
}

export async function runApacheCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'sites';

  if (sub === 'sites' || sub === 'list' || sub === 'status') {
    const action =
      sub === 'list' || sub === 'status' ? 'list' : (tokens[2] ?? 'list');

    if (action === 'list' || action === 'ls') {
      const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
      let items = listMergedApacheSites({ dataDir: ctx.dataDir, projects });
      const q = (h.getOpt(args, '--q') ?? h.getOpt(args, '--query') ?? '').trim().toLowerCase();
      const source = h.getOpt(args, '--source');
      const projectId = h.getOpt(args, '--project-id') ?? h.getOpt(args, '--projectId');
      if (source === 'project' || source === 'standalone' || source === 'artifact') {
        items = items.filter((r) => r.source === source);
      }
      if (projectId) items = items.filter((r) => r.projectId === projectId);
      if (q) {
        items = items.filter(
          (r) =>
            r.serverName.toLowerCase().includes(q) ||
            (r.projectName ?? '').toLowerCase().includes(q) ||
            r.target.toLowerCase().includes(q),
        );
      }
      h.printJson({ ok: true, items, total: items.length });
      return 0;
    }

    if (action === 'create' || action === 'add') {
      const serverName = h.getOpt(args, '--server-name') ?? h.getOpt(args, '--domain') ?? tokens[3];
      if (!serverName?.trim()) {
        process.stderr.write(
          'Usage: ysk-server apache sites create --server-name HOST [--kind proxy|static|php] [--upstream …] [--root …] [--ssl]\n',
        );
        return 2;
      }
      const kindRaw = h.getOpt(args, '--kind') ?? 'proxy';
      const kind =
        kindRaw === 'static' || kindRaw === 'php' ? kindRaw : 'proxy';
      try {
        const item = createApacheSite(ctx.dataDir, {
          serverName: serverName.trim(),
          kind,
          upstream: h.getOpt(args, '--upstream'),
          root: h.getOpt(args, '--root'),
          ssl: h.hasFlag(args, '--ssl'),
        });
        h.printJson({ ok: true, item });
        return 0;
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 1;
      }
    }

    if (action === 'update' || action === 'patch') {
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write(
          'Usage: ysk-server apache sites update --id ID [--server-name …] [--kind …] [--upstream …] [--root …]\n',
        );
        return 2;
      }
      if (id.startsWith('project:') || id.startsWith('artifact:')) {
        h.printJson({
          ok: false,
          notes: ['Project/artifact Apache sites are managed via the project'],
        });
        return 2;
      }
      const patch: Record<string, unknown> = {};
      const sn = h.getOpt(args, '--server-name') ?? h.getOpt(args, '--domain');
      if (sn) patch.serverName = sn;
      const kind = h.getOpt(args, '--kind');
      if (kind) patch.kind = kind;
      const upstream = h.getOpt(args, '--upstream');
      if (upstream != null) patch.upstream = upstream;
      const root = h.getOpt(args, '--root');
      if (root != null) patch.root = root;
      if (h.hasFlag(args, '--ssl')) patch.ssl = true;
      if (h.hasFlag(args, '--no-ssl')) patch.ssl = false;
      if (h.hasFlag(args, '--force-https')) patch.forceHttps = true;
      if (h.hasFlag(args, '--no-force-https')) patch.forceHttps = false;
      try {
        const item = updateApacheSite(ctx.dataDir, id.trim(), patch as never);
        h.printJson({ ok: true, item });
        return 0;
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 4;
      }
    }

    if (action === 'delete' || action === 'rm' || action === 'remove') {
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server apache sites delete --id ID [--execute for artifacts]\n');
        return 2;
      }
      if (id.startsWith('project:')) {
        h.printJson({
          ok: false,
          notes: ['Project Apache sites are managed via the project'],
        });
        return 2;
      }
      if (id.startsWith('artifact:')) {
        const blocked = needExecute(
          h,
          args,
          'Pass --execute to remove unclaimed Apache artifact conf from host.',
        );
        if (blocked !== null) return blocked;
        const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
        const result = await removeApacheArtifact({
          dataDir: ctx.dataDir,
          host: ctx.host,
          fileOrId: id.trim(),
          projects,
        });
        h.printJson(result);
        return h.exitFromResult(result);
      }
      const ok = deleteApacheSite(ctx.dataDir, id.trim());
      h.printJson({ ok });
      return ok ? 0 : 4;
    }

    if (action === 'apply') {
      const blocked = needExecute(h, args, 'Pass --execute to apply Apache site to the host.');
      if (blocked !== null) return blocked;
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server apache sites apply --id ID --execute\n');
        return 2;
      }
      if (id.startsWith('project:')) {
        const projectId = id.slice('project:'.length);
        const row = ctx.projects.get(projectId);
        if (!row || row.runtime !== 'php') {
          h.printJson({ ok: false, notes: ['PHP project not found'] });
          return 4;
        }
        const domain = row.domain ?? `${row.linuxUser}.local`;
        const aliases = (row.domainAliases || [])
          .map((a: string) => String(a).trim())
          .filter(Boolean);
        const docRoot = resolveProjectDocRoot({
          home_dir: row.homeDir,
          doc_root: row.docRoot,
        } as Parameters<typeof resolveProjectDocRoot>[0]);
        const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
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
        h.printJson(result);
        return h.exitFromResult(result);
      }
      if (id.startsWith('artifact:')) {
        h.printJson({
          ok: false,
          notes: ['Artifact conf — re-apply from project or recreate standalone site'],
        });
        return 2;
      }
      const result = await applyApacheSite({
        dataDir: ctx.dataDir,
        host: ctx.host,
        id: id.trim(),
      });
      h.printJson(result);
      return h.exitFromResult(result);
    }

    if (action === 'conf' || action === 'show-conf') {
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server apache sites conf --id ID\n');
        return 2;
      }
      if (id.startsWith('project:')) {
        const projectId = id.slice('project:'.length);
        const project = ctx.projects.get(projectId);
        const linuxUser = project?.linuxUser ?? '';
        const path = linuxUser
          ? join(ctx.dataDir, 'apache', 'sites', `ysk-${linuxUser}.conf`)
          : null;
        h.printJson({ ok: true, path, content: readApacheSiteConf(path) });
        return 0;
      }
      if (id.startsWith('artifact:')) {
        const file = id.slice('artifact:'.length).replace(/[/\\]/g, '');
        const path = join(ctx.dataDir, 'apache', 'sites', file);
        h.printJson({ ok: true, path, content: readApacheSiteConf(path) });
        return 0;
      }
      const rec = listApacheSites(ctx.dataDir).find((s) => s.id === id.trim());
      h.printJson({
        ok: true,
        path: rec?.confPath ?? null,
        content: readApacheSiteConf(rec?.confPath),
      });
      return 0;
    }

    if (action === 'cleanup-conflicts' || action === 'cleanup') {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to remove conflicting Apache ServerName confs on host.',
      );
      if (blocked !== null) return blocked;
      const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
      const result = await cleanupApacheServerNameConflicts({
        dataDir: ctx.dataDir,
        host: ctx.host,
        projects,
      });
      h.printJson(result);
      return h.exitFromResult(result);
    }

    process.stderr.write(
      'Usage: ysk-server apache sites list|create|update|delete|apply|conf|cleanup-conflicts [--execute]\n',
    );
    return 2;
  }

  if (sub === 'settings') {
    const action = tokens[2] ?? 'get';
    if (action === 'get' || action === 'show') {
      h.printJson({ ok: true, settings: loadApacheSettings(ctx.dataDir) });
      return 0;
    }
    if (action === 'set' || action === 'patch') {
      const patch: Record<string, unknown> = {};
      if (h.hasFlag(args, '--gzip')) patch.gzip = true;
      if (h.hasFlag(args, '--no-gzip')) patch.gzip = false;
      if (h.hasFlag(args, '--server-tokens')) patch.serverTokens = true;
      if (h.hasFlag(args, '--no-server-tokens')) patch.serverTokens = false;
      if (h.hasFlag(args, '--http2')) patch.http2 = true;
      if (h.hasFlag(args, '--no-http2')) patch.http2 = false;
      const body = h.getOpt(args, '--client-max-body');
      if (body) patch.clientMaxBody = body;
      const keepalive = h.getOpt(args, '--keepalive');
      if (keepalive) patch.keepalive = keepalive;
      const accessLog = h.getOpt(args, '--access-log');
      if (accessLog === 'on' || accessLog === 'off') patch.accessLog = accessLog;
      if (Object.keys(patch).length === 0) {
        process.stderr.write(
          'Usage: ysk-server apache settings set [--gzip|--no-gzip] [--http2|--no-http2] [--client-max-body 10m] …\n',
        );
        return 2;
      }
      const settings = saveApacheSettings(ctx.dataDir, patch as never);
      h.printJson({ ok: true, settings });
      return 0;
    }
    if (action === 'apply') {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to apply Apache global settings on the host.',
      );
      if (blocked !== null) return blocked;
      const projects = ctx.projects.list().map((p) => ({ ...p }) as Record<string, unknown>);
      const result = await applyApacheSettings({
        dataDir: ctx.dataDir,
        host: ctx.host,
        projects,
      });
      if (result.ok && !result.blocked) {
        try {
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
      h.printJson(result);
      return h.exitFromResult(result);
    }
    process.stderr.write('Usage: ysk-server apache settings get|set|apply [--execute]\n');
    return 2;
  }

  process.stderr.write(
    'Usage: ysk-server apache sites|settings [sub…] [--execute] [--json]\n',
  );
  return 2;
}
