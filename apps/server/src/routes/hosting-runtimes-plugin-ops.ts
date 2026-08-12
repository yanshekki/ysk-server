/**
 * Runtime companion plugin install/uninstall (Wave W3).
 * Extracted from hosting-runtimes-plugins.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingRuntimesPluginOpsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
    const { installRuntimePlugins } = await import('ysk-server-core');
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
    const { uninstallRuntimePlugins } = await import('ysk-server-core');
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

  return false;
}
