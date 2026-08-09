/**
 * Hosting runtimes — install/switch/addons/plugins/PHP/tuning.
 * Extracted from hosting.ts (Wave G2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import {
  probeRuntimes,
  planOrInstallRuntime,
  listSupportedRuntimes,
  defaultRuntimeVersion,
  runtimePluginsCatalogWithProbe,
  getRuntimeLatestHint,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingRuntimesRoutes(
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
      if (
        method === 'GET' &&
        url.pathname.match(/^\/api\/v1\/hosting\/runtimes\/(node|python|go|rust)\/tuning$/)
      ) {
        ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5] as 'node' | 'python' | 'go' | 'rust';
        const version = url.searchParams.get('version') ?? 'default';
        const {
          loadRuntimeTuning,
          listTuningCatalog,
          tuningToEnv } = await import('@ysk/core');
        const settings = loadRuntimeTuning(ctx.dataDir, kind, version);
        sendJson(res, 200, {
          kind,
          version: settings.version,
          catalog: listTuningCatalog(kind),
          settings,
          envPreview: tuningToEnv(settings),
          notes: [
            tl('notes.auto.n0577'),
            tl('notes.auto.n0472'),
          ] });
        return true;
      }
      if (
        method === 'PUT' &&
        url.pathname.match(/^\/api\/v1\/hosting\/runtimes\/(node|python|go|rust)\/tuning$/)
      ) {
        const user = ctx.auth.authenticate(getBearer(req));
        const kind = url.pathname.split('/')[5] as 'node' | 'python' | 'go' | 'rust';
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          version?: string;
          values?: Record<string, string | number | boolean>;
          env?: Record<string, string>;
        };
        const { saveRuntimeTuning, tuningToEnv, listTuningCatalog } = await import('@ysk/core');
        const result = saveRuntimeTuning(ctx.dataDir, {
          kind,
          version: data.version ?? 'default',
          values: data.values ?? {},
          env: data.env ?? {} });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.tuning.save',
          detail: { kind, version: result.settings.version, written: result.written },
          ok: true });
        sendJson(res, 200, {
          ok: true,
          catalog: listTuningCatalog(kind),
          settings: result.settings,
          envPreview: tuningToEnv(result.settings),
          written: result.written,
          notes: [tl('notes.auto.n0767')] });
        return true;
      }


  return false;
}
