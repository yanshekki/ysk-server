/**
 * Runtime addons/plugins/latest catalog.
 * Extracted from hosting-runtimes-core.ts (Wave P1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listSupportedRuntimes,
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

export async function handleHostingRuntimesPluginsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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

  return false;
}
