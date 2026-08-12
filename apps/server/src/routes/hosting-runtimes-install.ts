/**
 * Runtime tools/list/install/switch.
 * Extracted from hosting-runtimes-core.ts (Wave P1). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  probeRuntimes,
  planOrInstallRuntime,
  listSupportedRuntimes,
  defaultRuntimeVersion,
} from 'ysk-server-core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingRuntimesInstallRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/runtimes/tools') {
        ctx.auth.authenticate(getBearer(req));
        const { probeRuntimeTools } = await import('ysk-server-core');
        sendJson(res, 200, await probeRuntimeTools(ctx.host));
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/runtimes') {
        ctx.auth.authenticate(getBearer(req));
        const supported = listSupportedRuntimes();
        const probe = await probeRuntimes(ctx.host, { dataDir: ctx.dataDir });
        const { loadPanelRuntimeDefaults } = await import('ysk-server-core');
        const panelDefaults = loadPanelRuntimeDefaults(ctx.dataDir);
        sendJson(res, 200, { supported, probe, panelDefaults });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/hosting/runtimes/panel-defaults') {
        ctx.auth.authenticate(getBearer(req));
        const { loadPanelRuntimeDefaults } = await import('ysk-server-core');
        sendJson(res, 200, {
          ok: true,
          defaults: loadPanelRuntimeDefaults(ctx.dataDir),
        });
        return true;
      }
      if (method === 'PUT' && url.pathname === '/api/v1/hosting/runtimes/panel-defaults') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { kind?: string; version?: string };
        const kind = String(data.kind ?? '').trim();
        const version = String(data.version ?? '').trim();
        if (!kind || !version) {
          sendJson(res, 400, { ok: false, notes: ['kind and version required'] });
          return true;
        }
        const { savePanelRuntimeDefault } = await import('ysk-server-core');
        const defaults = savePanelRuntimeDefault(
          ctx.dataDir,
          kind as 'node' | 'php' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun',
          version,
        );
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.panelDefault',
          detail: { kind, version },
          ok: true,
        });
        sendJson(res, 200, { ok: true, defaults });
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
      if (method === 'POST' && url.pathname === '/api/v1/hosting/runtimes/switch') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          kind?: 'go' | 'rust' | 'node' | 'bun' | 'php' | 'python' | 'java' | 'kotlin';
          version?: string;
        };
        const { switchRuntimeDefault } = await import('ysk-server-core');
        const kind = data.kind ?? 'go';
        const fallback =
          kind === 'rust'
            ? 'stable'
            : kind === 'node'
              ? '20'
              : kind === 'bun'
                ? 'latest'
                : '1.22';
        const result = await switchRuntimeDefault({
          host: ctx.host,
          kind,
          version: data.version ?? fallback,
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
      if (method === 'POST' && url.pathname === '/api/v1/hosting/runtimes/uninstall') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          kind?: 'go' | 'rust' | 'node' | 'bun' | 'php' | 'python' | 'java' | 'kotlin';
          version?: string;
        };
        const { uninstallRuntimeVersion } = await import('ysk-server-core');
        const kind = data.kind ?? 'node';
        const version = String(data.version ?? '').trim();
        if (!version) {
          sendJson(res, 400, { ok: false, notes: ['version required'] });
          return true;
        }
        const result = await uninstallRuntimeVersion({
          host: ctx.host,
          kind,
          version,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'hosting.runtime.uninstall',
          detail: {
            kind: result.kind,
            version: result.version,
            ok: result.ok,
            blocked: Boolean(result.blocked),
            removedPath: result.removedPath,
            clearedHostDefault: result.clearedHostDefault,
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }

  return false;
}
