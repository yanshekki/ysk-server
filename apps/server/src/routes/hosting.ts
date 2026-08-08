import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  listManagedNginxConfs,
  planDnsZone,
  listManagedDnsZones,
  applyPowerDnsZone,
  powerDnsStatus,
  installPowerDnsPackages,
  probeRuntimes,
  planOrInstallRuntime,
  listSupportedRuntimes,
  defaultRuntimeVersion,
  runtimePluginsCatalogWithProbe,
  getRuntimeLatestHint,
  applyPublicFileServer,
  planFirewall,
  planPublicFileServer,
  probeEndpoint,
  renderMysqlProvisionSql,
  syncNginxConfigs,
  provisionMysqlDatabase,
  applyCloudflareDns,
  persistDnsZoneApply,
  provisionRedisBinding,
  provisionPostgresDatabase,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/runtimes/tools') {
        ctx.auth.authenticate(getBearer(req));
        const { probeRuntimeTools } = await import('@ysk/core');
        sendJson(res, 200, await probeRuntimeTools(ctx.host));
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/runtimes') {
        ctx.auth.authenticate(getBearer(req));
        const supported = listSupportedRuntimes();
        const probe = await probeRuntimes(ctx.host, { dataDir: ctx.dataDir });
        sendJson(res, 200, { supported, probe });
        return true;
      }

      // —— PM2 + YSK project process fleet (Node/Bun Processes tab) ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/pm2/status') {
        ctx.auth.authenticate(getBearer(req));
        const { collectPm2Snapshot } = await import('@ysk/core');
        const snap = await collectPm2Snapshot(ctx.host);
        sendJson(res, 200, snap);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/pm2/startup') {
        ctx.auth.authenticate(getBearer(req));
        const { probePm2Startup } = await import('@ysk/core');
        sendJson(res, 200, await probePm2Startup(ctx.host));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/pm2/startup') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as { action?: string };
        const action = body.action || 'install';
        if (action === 'save') {
          const { applyPm2Save } = await import('@ysk/core');
          sendJson(res, 200, await applyPm2Save(ctx.host));
          return true;
        }
        if (action === 'install') {
          const { applyPm2StartupInstall } = await import('@ysk/core');
          sendJson(res, 200, await applyPm2StartupInstall(ctx.host));
          return true;
        }
        sendJson(res, 400, {
          error: { code: 'VALIDATION', message: 'action must be install|save' },
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/pm2/action') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as {
          action?: string;
          name?: string;
          appName?: string;
        };
        const action = body.action;
        const name = String(body.name || body.appName || '').trim();
        if (
          action !== 'restart' &&
          action !== 'reload' &&
          action !== 'stop' &&
          action !== 'delete'
        ) {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'action must be restart|reload|stop|delete' },
          });
          return true;
        }
        if (!name) {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'name required' },
          });
          return true;
        }
        const { applyPm2AppAction } = await import('@ysk/core');
        const result = await applyPm2AppAction({
          host: ctx.host,
          appName: name,
          action,
        });
        // Always 200 with ok flag — Processes tab needs notes on blocked/fail
        sendJson(res, 200, result);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/process-fleet') {
        ctx.auth.authenticate(getBearer(req));
        const { collectProcessFleet } = await import('@ysk/core');
        const runtimes = (url.searchParams.get('runtimes') || 'node,bun')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const fleet = await collectProcessFleet(ctx.host, ctx.db, { runtimes });
        sendJson(res, 200, fleet);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/process-fleet/systemd-action') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const body = JSON.parse(raw || '{}') as {
          action?: string;
          projectId?: string;
        };
        const action = body.action;
        const projectId = String(body.projectId || '').trim();
        if (action !== 'restart' && action !== 'stop') {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'action must be restart|stop' },
          });
          return true;
        }
        if (!projectId) {
          sendJson(res, 400, {
            error: { code: 'VALIDATION', message: 'projectId required' },
          });
          return true;
        }
        const { applySystemdProjectAction } = await import('@ysk/core');
        const result = await applySystemdProjectAction({
          host: ctx.host,
          db: ctx.db,
          projectId,
          action,
        });
        sendJson(res, 200, result);
        return true;
      }
      if (
        method === 'GET' &&
        (url.pathname === '/api/v1/hosting/pm2/stream' ||
          url.pathname === '/api/v1/hosting/process-fleet/stream')
      ) {
        ctx.auth.authenticate(getBearer(req));
        const { collectProcessFleet } = await import('@ysk/core');
        const intervalSec = Math.max(
          1,
          Math.min(10, Number(url.searchParams.get('interval') || 2)),
        );
        const runtimes = (url.searchParams.get('runtimes') || 'node,bun')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const useFleet = url.pathname.includes('process-fleet');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`: ysk-process-fleet-stream\n\n`);
        let closed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const maxTicks = Math.min(300, Math.floor((10 * 60) / intervalSec));
        let ticks = 0;
        const send = (event: string, data: unknown) => {
          if (closed || res.writableEnded) return;
          try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          } catch {
            closed = true;
          }
        };
        const tick = async () => {
          if (closed) return;
          ticks += 1;
          try {
            const fleet = await collectProcessFleet(ctx.host, ctx.db, { runtimes });
            // Legacy pm2/stream clients expect Pm2Snapshot shape
            send('tick', useFleet ? fleet : fleet.pm2);
          } catch (e) {
            send('error', {
              message: e instanceof Error ? e.message : 'process fleet stream error',
            });
          }
          if (ticks >= maxTicks) {
            send('end', { reason: 'max_duration' });
            closed = true;
            try {
              res.end();
            } catch {
              /* */
            }
            return;
          }
          if (!closed) {
            timer = setTimeout(() => void tick(), intervalSec * 1000);
          }
        };
        req.on('close', () => {
          closed = true;
          if (timer) clearTimeout(timer);
        });
        void tick();
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/runtimes/install') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          kind?: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
          version?: string;
          install?: boolean;
          /** PHP extension ids (mysql, gd, redis, …) — see phpExtensionCatalogDto */
          extensions?: string[];
          /** Companion tools: node pm2, python poetry, go air, … */
          plugins?: string[];
          /** Live SSE log stream for the panel terminal */
          stream?: boolean;
        };
        const kind = data.kind ?? 'node';
        // Defaults only when client omits version — not "latest" SSOT
        const defaultVer = defaultRuntimeVersion(kind);
        const wantStream =
          data.stream === true ||
          String(req.headers.accept || '').includes('text/event-stream') ||
          url.searchParams.get('stream') === '1';

        if (wantStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(`: ysk-runtime-install-stream\n\n`);
          let closed = false;
          const abortCtl = new AbortController();
          const send = (event: string, payload: unknown) => {
            if (closed || res.writableEnded) return;
            try {
              res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
            } catch {
              closed = true;
            }
          };
          req.on('close', () => {
            closed = true;
            // Kill apt/bash install so dpkg is not left locked by orphan processes
            try {
              abortCtl.abort();
            } catch {
              /* */
            }
          });
          send('status', { phase: 'planning', kind, version: data.version ?? defaultVer });
          try {
            const result = await planOrInstallRuntime({
              dataDir: ctx.dataDir,
              host: ctx.host,
              kind,
              version: data.version ?? defaultVer,
              install: data.install,
              extensions: kind === 'php' ? data.extensions : undefined,
              plugins: kind !== 'php' ? data.plugins : undefined,
              abortSignal: abortCtl.signal,
              onLog: (ev) => {
                if (!closed) send('log', { stream: ev.stream, line: ev.line, at: new Date().toISOString() });
              },
            });
            ctx.audit.append({
              actor: user.username,
              action: 'hosting.runtime.install',
              detail: {
                kind: result.kind,
                version: result.version,
                ok: result.ok,
                install: Boolean(data.install),
                blocked: Boolean(result.blocked),
                extensions: result.extensionIds,
                packages: result.packages,
                plugins: result.pluginIds,
                stream: true,
              },
              ok: result.ok,
            });
            const phase = result.blocked
              ? 'blocked'
              : result.ok
                ? 'done'
                : 'failed';
            send('status', { phase });
            send('result', result);
            send('end', { reason: 'complete', ok: result.ok });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            send('status', { phase: 'failed' });
            send('result', {
              ok: false,
              kind,
              version: data.version ?? defaultVer,
              notes: [message],
              written: [],
              commandResults: [],
              requiresExecute: false,
              requiresRoot: false,
            });
            send('end', { reason: 'error', message });
          }
          if (!res.writableEnded) {
            try {
              res.end();
            } catch {
              /* */
            }
          }
          return true;
        }

        const result = await planOrInstallRuntime({
          dataDir: ctx.dataDir,
          host: ctx.host,
          kind,
          version: data.version ?? defaultVer,
          install: data.install,
          extensions: kind === 'php' ? data.extensions : undefined,
          plugins: kind !== 'php' ? data.plugins : undefined,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.install',
          detail: {
            kind: result.kind,
            version: result.version,
            ok: result.ok,
            install: Boolean(data.install),
            blocked: Boolean(result.blocked),
            extensions: result.extensionIds,
            packages: result.packages,
            plugins: result.pluginIds,
          },
          ok: result.ok,
        });
        // Honest ops status (403 blocked / 422 failed) + full body notes for UI
        sendOpsResult(res, result);
        return true;
      }
      /** Switch active default for multi-version Go / Rust (no reinstall) */
      if (method === 'POST' && url.pathname === '/api/v1/hosting/runtimes/switch') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          kind?: 'go' | 'rust';
          version?: string;
        };
        const { switchRuntimeDefault } = await import('@ysk/core');
        const result = await switchRuntimeDefault({
          host: ctx.host,
          kind: data.kind ?? 'go',
          version: data.version ?? (data.kind === 'rust' ? 'stable' : '1.22'),
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.switch',
          detail: {
            kind: result.kind,
            version: result.version,
            ok: result.ok,
            blocked: Boolean(result.blocked),
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      // —— Unified addons catalog: PHP extensions OR companion plugins ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/runtimes/addons') {
        ctx.auth.authenticate(getBearer(req));
        const kind = (url.searchParams.get('kind') ?? 'node') as
          | 'node'
          | 'php'
          | 'python'
          | 'go'
          | 'rust'
          | 'java'
          | 'kotlin'
          | 'bun';
        const version = url.searchParams.get('version') ?? undefined;
        if (kind === 'php') {
          const { phpExtensionCatalogWithProbe } = await import('@ysk/core');
          const ext = await phpExtensionCatalogWithProbe(version ?? '8.2', ctx.host);
          sendJson(res, 200, {
            kind: 'php',
            mode: 'extensions' as const,
            version: ext.version,
            items: ext.extensions.map((e) => ({
              id: e.id,
              label: e.label,
              hint: e.hint,
              group: e.group,
              recommended: e.recommended,
              required: e.required,
              package: e.package,
              installed: Boolean(e.installed),
            })),
            defaults: ext.defaults,
          });
          return true;
        }
        const catalog = await runtimePluginsCatalogWithProbe(kind, ctx.host);
        sendJson(res, 200, {
          kind: catalog.kind,
          mode: 'plugins' as const,
          items: catalog.plugins.map((p) => ({
            id: p.id,
            label: p.label,
            hint: p.hint,
            group: p.group,
            recommended: p.recommended,
            required: p.required,
            installer: p.installer,
            bins: p.bins,
            installed: p.installed,
          })),
          defaults: catalog.defaults,
        });
        return true;
      }
      // —— Optional remote latest hint (cached 24h) ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/runtimes/latest') {
        ctx.auth.authenticate(getBearer(req));
        const kind = (url.searchParams.get('kind') ?? 'node') as
          | 'node'
          | 'php'
          | 'python'
          | 'go'
          | 'rust'
          | 'java'
          | 'kotlin'
          | 'bun';
        const refresh = url.searchParams.get('refresh') === '1';
        const supported = listSupportedRuntimes();
        const panelSupported = (supported as Record<string, string[]>)[kind] ?? [];
        const hint = await getRuntimeLatestHint({
          dataDir: ctx.dataDir,
          kind,
          panelSupported,
          refresh,
        });
        sendJson(res, 200, hint);
        return true;
      }
      // —— Install companion plugins only (no full runtime) ——
      if (method === 'POST' && url.pathname === '/api/v1/hosting/runtimes/plugins/install') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          kind?: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
          plugins?: string[];
          stream?: boolean;
        };
        const kind = data.kind ?? 'node';
        if (kind === 'php') {
          sendOpsResult(res, {
            ok: false,
            notes: ['PHP uses extensions via runtime install, not companion plugins'],
          });
          return true;
        }
        const { installRuntimePlugins } = await import('@ysk/core');
        const plugins = Array.isArray(data.plugins) ? data.plugins : [];
        const wantStream =
          data.stream === true ||
          String(req.headers.accept || '').includes('text/event-stream') ||
          url.searchParams.get('stream') === '1';

        if (wantStream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          res.write(`: ysk-plugins-install-stream\n\n`);
          let closed = false;
          const abortCtl = new AbortController();
          const send = (event: string, payload: unknown) => {
            if (closed || res.writableEnded) return;
            try {
              res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
            } catch {
              closed = true;
            }
          };
          req.on('close', () => {
            closed = true;
            try {
              abortCtl.abort();
            } catch {
              /* */
            }
          });
          send('status', { phase: 'running', kind, plugins });
          try {
            const result = await installRuntimePlugins({
              dataDir: ctx.dataDir,
              host: ctx.host,
              kind,
              plugins,
              abortSignal: abortCtl.signal,
              onLog: (ev) => {
                if (!closed)
                  send('log', {
                    stream: ev.stream,
                    line: ev.line,
                    at: new Date().toISOString(),
                  });
              },
            });
            ctx.audit.append({
              actor: user.username,
              action: 'hosting.runtime.plugins.install',
              detail: {
                kind: result.kind,
                plugins: result.pluginIds,
                ok: result.ok,
                blocked: Boolean(result.blocked),
                stream: true,
              },
              ok: result.ok,
            });
            send('status', {
              phase: result.blocked ? 'blocked' : result.ok ? 'done' : 'failed',
            });
            send('result', result);
            send('end', { reason: 'complete', ok: result.ok });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            send('status', { phase: 'failed' });
            send('result', { ok: false, kind, notes: [message], pluginIds: plugins });
            send('end', { reason: 'error', message });
          }
          if (!res.writableEnded) {
            try {
              res.end();
            } catch {
              /* */
            }
          }
          return true;
        }

        const result = await installRuntimePlugins({
          dataDir: ctx.dataDir,
          host: ctx.host,
          kind,
          plugins,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.plugins.install',
          detail: {
            kind: result.kind,
            plugins: result.pluginIds,
            ok: result.ok,
            blocked: Boolean(result.blocked),
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      // —— Uninstall companion plugins (pm2, poetry, …) ——
      if (method === 'POST' && url.pathname === '/api/v1/hosting/runtimes/plugins/uninstall') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          kind?: 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun';
          plugins?: string[];
        };
        const kind = data.kind ?? 'node';
        if (kind === 'php') {
          sendOpsResult(res, {
            ok: false,
            notes: ['PHP uses extension management, not companion plugins'],
          });
          return true;
        }
        const { uninstallRuntimePlugins } = await import('@ysk/core');
        const result = await uninstallRuntimePlugins({
          dataDir: ctx.dataDir,
          host: ctx.host,
          kind,
          plugins: Array.isArray(data.plugins) ? data.plugins : [],
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.plugins.uninstall',
          detail: {
            kind: result.kind,
            plugins: result.pluginIds,
            ok: result.ok,
            blocked: Boolean(result.blocked),
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      // —— Runtime companion plugins (pm2, poetry, maven, …) ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/runtimes/plugins') {
        ctx.auth.authenticate(getBearer(req));
        const kind = (url.searchParams.get('kind') ?? 'node') as
          | 'node'
          | 'php'
          | 'python'
          | 'go'
          | 'rust'
          | 'java'
          | 'kotlin'
          | 'bun';
        if (kind === 'php') {
          // PHP uses /php/extensions for apt modules
          sendJson(res, 200, { kind: 'php', plugins: [], defaults: [], useExtensions: true });
          return true;
        }
        const catalog = await runtimePluginsCatalogWithProbe(kind, ctx.host);
        sendJson(res, 200, catalog);
        return true;
      }
      // —— PHP extension catalog (version-aware apt names) ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/php/extensions') {
        ctx.auth.authenticate(getBearer(req));
        const version = url.searchParams.get('version') ?? '8.2';
        const { phpExtensionCatalogWithProbe } = await import('@ysk/core');
        sendJson(res, 200, await phpExtensionCatalogWithProbe(version, ctx.host));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/php/extensions/uninstall') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          extensions?: string[];
        };
        const { uninstallPhpExtensions } = await import('@ysk/core');
        const result = await uninstallPhpExtensions({
          host: ctx.host,
          version: data.version ?? '8.2',
          extensions: Array.isArray(data.extensions) ? data.extensions : [],
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.php.extensions.uninstall',
          detail: {
            version: result.version,
            extensions: result.extensionIds,
            ok: result.ok,
            blocked: Boolean(result.blocked),
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      // —— Global PHP php.ini (panel-managed) ——
      if (method === 'GET' && url.pathname === '/api/v1/hosting/php/ini') {
        ctx.auth.authenticate(getBearer(req));
        const { getPhpIni } = await import('@ysk/core');
        const version = url.searchParams.get('version') ?? '8.2';
        sendJson(res, 200, getPhpIni(ctx.dataDir, version));
        return true;
      }
      if (method === 'PUT' && url.pathname === '/api/v1/hosting/php/ini') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          values?: Record<string, string | number | boolean>;
          extra?: Record<string, string>;
          rawAppend?: string;
        };
        const { savePhpIniSettings } = await import('@ysk/core');
        const result = savePhpIniSettings(ctx.dataDir, {
          version: data.version ?? '8.2',
          values: data.values ?? {},
          extra: data.extra ?? {},
          rawAppend: data.rawAppend ?? '',
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.php.ini.save',
          detail: { version: result.settings.version, written: result.written },
          ok: true,
        });
        sendJson(res, 200, {
          ok: true,
          settings: result.settings,
          managedIniPath: result.managedIniPath,
          written: result.written,
          notes: [
            tl('notes.auto.n0765'),
            tl('notes.auto.n1422'),
          ],
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/php/ini/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { version?: string };
        const { applyPhpIniSystem } = await import('@ysk/core');
        const result = await applyPhpIniSystem({
          dataDir: ctx.dataDir,
          version: data.version ?? '8.2',
          host: ctx.host,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.php.ini.apply',
          detail: result,
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/nginx') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, {
          files: listManagedNginxConfs(ctx.dataDir),
          dataDir: ctx.dataDir,
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/nginx/sync') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          systemConfDir?: string;
          dryRun?: boolean;
        };
        const result = await syncNginxConfigs({
          dataDir: ctx.dataDir,
          systemConfDir: data.systemConfDir,
          host: ctx.host,
          dryRun: data.dryRun,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'nginx.sync',
          detail: result,
          ok: result.ok !== false,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/probe') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { host?: string; port?: number };
        const r = await probeEndpoint(data.host ?? '127.0.0.1', data.port ?? 3306);
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/mysql-plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dbName?: string;
          username?: string;
          password?: string;
        };
        sendJson(
          res,
          200,
          renderMysqlProvisionSql({
            dbName: data.dbName ?? 'app',
            username: data.username ?? 'appuser',
            password: data.password,
          }),
        );
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          serverIpv6?: string;
        };
        sendJson(
          res,
          200,
          planDnsZone({
            zone: data.zone ?? 'example.com',
            serverIp: data.serverIp ?? '1.2.3.4',
            serverIpv6: data.serverIpv6,
          }),
        );
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/zone-file') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          serverIpv6?: string;
          mailHost?: string;
          validate?: boolean;
          /** default true: register into PowerDNS after write (needs EXECUTE+root) */
          load?: boolean;
        };
        const wantLoad = data.load !== false;
        // Align with panel apply: write zone file, then optional PowerDNS BIND load
        const result = await applyPowerDnsZone({
          dataDir: ctx.dataDir,
          host: ctx.host,
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          serverIpv6: data.serverIpv6,
          mailHost: data.mailHost,
          load: wantLoad,
          rewriteZone: true,
        });
        const applyStatus =
          result.mode === 'loaded'
            ? 'applied'
            : result.mode === 'plan'
              ? 'written'
              : result.ok
                ? 'written'
                : 'failed';
        ctx.db.snapshot.dns_zones = [
          {
            id: randomUUID(),
            zone: result.zone,
            provider: wantLoad ? 'powerdns' : 'bind-file',
            zonePath: result.zonePath,
            mode: result.mode,
            apply_status: applyStatus,
            loadMethod: result.loadMethod,
            ok: result.ok,
            updated_at: new Date().toISOString(),
            actor: user.username,
          },
          ...ctx.db.snapshot.dns_zones.filter(
            (z) =>
              !(
                String(z.zone) === result.zone &&
                (z.provider === 'bind-file' || z.provider === 'powerdns')
              ),
          ),
        ].slice(0, 50);
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: wantLoad ? 'dns.zone_file.write_load' : 'dns.zone_file.write',
          resource: result.zone,
          detail: {
            zonePath: result.zonePath,
            mode: result.mode,
            loadMethod: result.loadMethod,
            ok: result.ok,
          },
          ok: result.ok || result.mode === 'plan',
        });
        sendOpsResult(res, {
          ...result,
          applyStatus,
          // plan-only write still HTTP-ok for operators previewing
          ok: result.ok || result.mode === 'plan',
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/zone-files') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { items: listManagedDnsZones(ctx.dataDir) });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/powerdns/status') {
        ctx.auth.authenticate(getBearer(req));
        const status = await powerDnsStatus({ dataDir: ctx.dataDir, host: ctx.host });
        sendJson(res, 200, status);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/install') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          install?: boolean;
          localAddress?: string;
        };
        const result = await installPowerDnsPackages({
          dataDir: ctx.dataDir,
          host: ctx.host,
          install: data.install,
          localAddress: data.localAddress,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.powerdns.install',
          detail: { ok: result.ok, install: Boolean(data.install) },
          ok: result.ok,
        });
        sendJson(res, result.ok || !data.install ? 200 : 422, result);
        return true;
      }
      /** Fix pdns EADDRINUSE: bind public IP only (not 0.0.0.0 vs systemd-resolved) */
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/heal') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          localAddress?: string;
          resyncZones?: boolean;
        };
        const { healPowerDnsListener } = await import('@ysk/core');
        const result = await healPowerDnsListener({
          host: ctx.host,
          localAddress: data.localAddress,
          dataDir: ctx.dataDir,
          resyncZones: data.resyncZones,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.powerdns.heal',
          detail: {
            ok: result.ok,
            localAddress: result.localAddress,
            unitActive: result.unitActive,
            listenUdp53: result.listenUdp53,
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/powerdns/load') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          mailHost?: string;
          load?: boolean;
        };
        const result = await applyPowerDnsZone({
          dataDir: ctx.dataDir,
          host: ctx.host,
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          mailHost: data.mailHost,
          load: data.load,
        });
        ctx.db.snapshot.dns_zones = [
          {
            id: randomUUID(),
            zone: result.zone,
            provider: 'powerdns',
            zonePath: result.zonePath,
            mode: result.mode,
            ok: result.ok,
            updated_at: new Date().toISOString(),
            actor: user.username,
          },
          ...ctx.db.snapshot.dns_zones.filter(
            (z) => !(String(z.zone) === result.zone && z.provider === 'powerdns'),
          ),
        ].slice(0, 50);
        ctx.db.persist();
        ctx.audit.append({
          actor: user.username,
          action: 'dns.powerdns.load',
          resource: result.zone,
          detail: { mode: result.mode, ok: result.ok, zonePath: result.zonePath },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/dns/cloudflare/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          zone?: string;
          serverIp?: string;
          serverIpv6?: string;
          mailHost?: string;
          token?: string;
          dryRun?: boolean;
        };
        const result = await applyCloudflareDns({
          zone: data.zone ?? 'example.com',
          serverIp: data.serverIp ?? '203.0.113.10',
          serverIpv6: data.serverIpv6,
          mailHost: data.mailHost,
          token: data.token,
          dryRun: data.dryRun,
        });
        persistDnsZoneApply(ctx.db, result, user.username);
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cloudflare.apply',
          resource: result.zoneName,
          detail: {
            ok: result.ok,
            dryRun: result.dryRun,
            created: result.created.length,
            errors: result.errors,
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/dns/zones') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, { items: ctx.db.snapshot.dns_zones });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/firewall/plan') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { allowSmtp?: boolean };
        sendJson(res, 200, planFirewall({ allowSmtp: data.allowSmtp }));
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/files/plan') {
        ctx.auth.authenticate(getBearer(req));
        sendJson(res, 200, planPublicFileServer({}));
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/files/status') {
        ctx.auth.authenticate(getBearer(req));
        const { probePublicFileServer } = await import('@ysk/core');
        sendJson(res, 200, probePublicFileServer({ dataDir: ctx.dataDir, host: ctx.host }));
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/files/apply') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          serverName?: string;
          quotaMb?: number;
          reload?: boolean;
        };
        const result = await applyPublicFileServer({
          dataDir: ctx.dataDir,
          host: ctx.host,
          serverName: data.serverName ?? 'files.local',
          quotaMb: data.quotaMb,
          reload: data.reload,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.public_files.apply',
          resource: result.serverName,
          detail: {
            ok: result.ok,
            nginxPath: result.nginxPath,
            publicRoot: result.publicRoot,
            nginxReloaded: result.nginxReloaded,
            live: result.live,
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/redis-provision') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          projectId?: string;
          dbIndex?: number;
          maxmemoryMb?: number;
          host?: string;
          port?: number;
          execute?: boolean;
        };
        const result = await provisionRedisBinding({
          hostExec: ctx.host,
          projectId: data.projectId ?? 'shared',
          dbIndex: data.dbIndex,
          maxmemoryMb: data.maxmemoryMb,
          redisHost: data.host,
          redisPort: data.port,
          // Panel: omit execute → apply; explicit false → dry-run
          execute: data.execute !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.redis.provision',
          detail: result,
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/postgres-provision') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dbName?: string;
          username?: string;
          password?: string;
          host?: string;
          port?: number;
          execute?: boolean;
        };
        const result = await provisionPostgresDatabase({
          dbName: data.dbName ?? 'app',
          username: data.username ?? 'appuser',
          password: data.password ?? '',
          host: data.host,
          port: data.port,
          hostExec: ctx.host,
          // Panel: omit execute → apply; explicit false → dry-run
          execute: data.execute !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.postgres.provision',
          detail: { ...result, password: undefined },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/hosting/db/mysql-provision') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          dbName?: string;
          username?: string;
          password?: string;
          host?: string;
          execute?: boolean;
        };
        const result = await provisionMysqlDatabase({
          dbName: data.dbName ?? 'app',
          username: data.username ?? 'appuser',
          password: data.password ?? '',
          host: data.host,
          hostExec: ctx.host,
          execute: data.execute !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.mysql.provision',
          detail: { ...result, password: undefined },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }
  return false;
}
