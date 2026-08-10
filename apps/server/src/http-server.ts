/**
 * Control-plane HTTP(S) API — dispatcher.
 * Route bodies live in `./routes/*` and `./controllers/*` (Wave2 R2).
 * When config.tlsEnabled + cert/key files exist, binds HTTPS on the same port.
 */

import { createServer as createNodeHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNodeHttpsServer, type Server as HttpsServer } from 'node:https';
import { runWithLocaleAsync, tl } from '@ysk/shared';
import { loadPanelTlsOptions } from '@ysk/core';
import type { AppContext } from './app-context.js';
import {
  localeFromRequest,
  parseUrl,
  sendError,
  sendJson,
} from './http/util.js';
import { enforceMutatingRouteCaps } from './http/rbac-guard.js';
import { enforceApiKeyReadOnly, enforceMustChangePassword } from './http/auth-guards.js';
import { resolveWebRoot, tryServeStatic } from './http/static.js';
import { handleFilesRoutes } from './controllers/files-controller.js';
import { handleSystemRoutes } from './controllers/system-controller.js';
import { handleResourcesRoutes } from './controllers/resources-controller.js';
import { handleLogsRoutes } from './controllers/logs-controller.js';
import { handleMetricsRoutes } from './controllers/metrics-controller.js';
import { handleNetworkRoutes } from './controllers/network-controller.js';
import {
  handleAdminRoutes,
  handleAgentsRoutes,
  handleAiRoutes,
  handleAuditRoutes,
  handleAuthRoutes,
  handleBackupsRoutes,
  handleCdnRoutes,
  handleCronRoutes,
  handleDashboardRoutes,
  handleDbRoutes,
  handleDefenseRoutes,
  handleDnsRoutes,
  handleEmailRoutes,
  handleFilesPublicRoutes,
  handleFirewallRoutes,
  handleHostingRoutes,
  handleMiscRoutes,
  handleProjectsRoutes,
  handlePublicRoutes,
  handleRbacRoutes,
  handleSearchRoutes,
  handleSettingsRoutes,
  handleSoftwareRoutes,
  handleSshRoutes,
  handleSslRoutes,
  handleSystemDbRoutes,
  handleSystemHostRoutes,
  handleToolsRoutes,
  handleUpdatesRoutes,
} from './routes/index.js';
import { handleTerminalRoutes } from './routes/terminal.js';
import { handleHostBrowseRoutes } from './routes/host-browse.js';
import { handleVpnRoutes } from './routes/vpn.js';
import { handleVncRoutes } from './routes/vnc.js';
import { attachTerminalWebSocket } from './terminal/ws-handler.js';
import { attachHostBrowseWebSocket } from './host-browse/ws-handler.js';

export type ControlPlaneServer = HttpServer | HttpsServer;

export type CreateServerResult = {
  server: ControlPlaneServer;
  /** True when HTTPS materials loaded and server is TLS */
  https: boolean;
};

function attachRequestHandler(ctx: AppContext, webRoot: string | null) {
  return (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = parseUrl(req);
    // Accept-Language (web i18n) + optional ?locale= — avoids double authenticate
    const locale = localeFromRequest(req, url);

    void runWithLocaleAsync(locale, async () => {
      try {
        // rate window for protection heuristics
        ctx.requestHits.push(Date.now());
        if (ctx.requestHits.length > 10_000) {
          const cutoff = Date.now() - 60_000;
          ctx.requestHits = ctx.requestHits.filter((t) => t >= cutoff);
        }

        const method = req.method ?? 'GET';

        // Capability gate for critical mutating APIs (before any domain handler)
        enforceMutatingRouteCaps(ctx, req, method, url.pathname);
        // API key scope: read-only keys cannot mutate
        enforceApiKeyReadOnly(ctx, req, method, url.pathname);
        // Bootstrap weak password: force change before other APIs
        enforceMustChangePassword(ctx, req, method, url.pathname);

        // Modular controllers first (WebDAV needs OPTIONS/PROPFIND — Wave E1 public first)
        if (await handleFilesPublicRoutes(ctx, req, res, url, method)) return;
        if (await handleFilesRoutes(ctx, req, res, url, method)) return;

        if (method === 'OPTIONS') {
          return sendJson(res, 204, {});
        }

        if (await handleResourcesRoutes(ctx, req, res, url, method)) return;
        if (await handleLogsRoutes(ctx, req, res, url, method)) return;
        if (await handleMetricsRoutes(ctx, req, res, url, method)) return;
        if (await handleNetworkRoutes(ctx, req, res, url, method)) return;
        // Domain slices before system (C1–C3 · D1 system-db · D2 system-host)
        if (await handleDefenseRoutes(ctx, req, res, url, method)) return;
        if (await handleFirewallRoutes(ctx, req, res, url, method)) return;
        if (await handleSoftwareRoutes(ctx, req, res, url, method)) return;
        if (await handleSystemDbRoutes(ctx, req, res, url, method)) return;
        if (await handleSystemHostRoutes(ctx, req, res, url, method)) return;
        if (await handleSystemRoutes(ctx, req, res, url, method)) return;
        if (
          await handleTerminalRoutes(
            ctx,
            req,
            res,
            url,
            method,
            ctx.terminalTickets,
          )
        )
          return;
        if (await handleHostBrowseRoutes(ctx, req, res, url, method)) return;
        if (await handleVpnRoutes(ctx, req, res, url, method)) return;
        if (await handleVncRoutes(ctx, req, res, url, method)) return;

        // Domain route modules (extracted from former monolithic handler)
        if (await handlePublicRoutes(ctx, req, res, url, method)) return;
        if (await handleAuthRoutes(ctx, req, res, url, method)) return;
        if (await handleRbacRoutes(ctx, req, res, url, method)) return;
        if (await handleSettingsRoutes(ctx, req, res, url, method)) return;
        if (await handleAdminRoutes(ctx, req, res, url, method)) return;
        if (await handleAuditRoutes(ctx, req, res, url, method)) return;
        if (await handleDashboardRoutes(ctx, req, res, url, method)) return;
        if (await handleSearchRoutes(ctx, req, res, url, method)) return;
        if (await handleSshRoutes(ctx, req, res, url, method)) return;
        if (await handleProjectsRoutes(ctx, req, res, url, method)) return;
        if (await handleAgentsRoutes(ctx, req, res, url, method)) return;
        if (await handleEmailRoutes(ctx, req, res, url, method)) return;
        if (await handleToolsRoutes(ctx, req, res, url, method)) return;
        // handleDefenseRoutes already run above (before system)
        if (await handleAiRoutes(ctx, req, res, url, method)) return;
        if (await handleUpdatesRoutes(ctx, req, res, url, method)) return;
        if (await handleBackupsRoutes(ctx, req, res, url, method)) return;
        if (await handleSslRoutes(ctx, req, res, url, method)) return;
        if (await handleDnsRoutes(ctx, req, res, url, method)) return;
        if (await handleCdnRoutes(ctx, req, res, url, method)) return;
        if (await handleDbRoutes(ctx, req, res, url, method)) return;
        if (await handleHostingRoutes(ctx, req, res, url, method)) return;
        if (await handleCronRoutes(ctx, req, res, url, method)) return;
        // Catch-all residual (interleaved historical paths)
        if (await handleMiscRoutes(ctx, req, res, url, method)) return;

        // Static Web UI (SPA) — after all API routes
        if (tryServeStatic(req, res, url.pathname, webRoot)) {
          return;
        }

        return sendJson(res, 404, {
          ok: false,
          code: 'YSK_NOT_FOUND',
          message: tl('errors.http.notFoundRoute', {
            method,
            path: url.pathname,
          }),
          webUi: Boolean(webRoot),
        });
      } catch (err) {
        return sendError(res, err);
      }
    });
  };
}

/**
 * Create control-plane server (HTTP or HTTPS from config.tls*).
 * Prefer createControlPlaneServer; createHttpServer kept for tests.
 */
export function createControlPlaneServer(ctx: AppContext): CreateServerResult {
  const webRoot = resolveWebRoot(ctx.webRoot);
  const handler = attachRequestHandler(ctx, webRoot);
  const tls = loadPanelTlsOptions(ctx.config);
  let server: ControlPlaneServer;
  let https = false;
  if (tls) {
    server = createNodeHttpsServer(tls, handler);
    https = true;
  } else {
    if (ctx.config?.tlsEnabled) {
      const requireTls =
        ctx.config.tlsHttpsOnly ||
        process.env.YSK_REQUIRE_TLS === '1' ||
        process.env.YSK_REQUIRE_TLS === 'true';
      if (requireTls) {
        throw new Error(
          'tlsEnabled/tlsHttpsOnly but cert/key missing or unreadable — refusing plain HTTP (set YSK_ALLOW_HTTP=1 only for lab)',
        );
      }
      // Config wants TLS but files missing — fall back to HTTP with stderr warning
      process.stderr.write(
        '[ysk-server] tlsEnabled but cert/key missing or unreadable — serving plain HTTP\n',
      );
    }
    if (
      process.env.YSK_ALLOW_HTTP !== '1' &&
      process.env.YSK_ALLOW_HTTP !== 'true' &&
      ctx.config?.tlsHttpsOnly
    ) {
      throw new Error(
        'tlsHttpsOnly is set but TLS materials unavailable — refusing plain HTTP',
      );
    }
    server = createNodeHttpServer(handler);
  }
  // Interactive browser terminal (WebSocket upgrade)
  attachTerminalWebSocket(server, ctx, ctx.terminalTickets);
  attachHostBrowseWebSocket(server, ctx, ctx.hostBrowseLiveTickets);
  return { server, https };
}

export type DualListenResult = {
  https: boolean;
  primary: { host: string; port: number; scheme: 'http' | 'https' };
  /** Plain HTTP companion (redirect or full API) when TLS dual mode */
  http?: { host: string; port: number };
  servers: ControlPlaneServer[];
};

/**
 * Bind primary server (+ optional dual HTTP when TLS is on).
 * Dual HTTP defaults to listenPort-1 with 301 → HTTPS (config.tlsHttpRedirect).
 */
function boundPort(server: ControlPlaneServer, fallback: number): number {
  const addr = server.address();
  if (addr && typeof addr === 'object' && typeof addr.port === 'number') return addr.port;
  return fallback;
}

export async function listenControlPlane(
  ctx: AppContext,
  host: string,
  port: number,
): Promise<DualListenResult> {
  const { server, https } = createControlPlaneServer(ctx);
  await listen(server, host, port);
  const actualPort = boundPort(server, port);
  const servers: ControlPlaneServer[] = [server];
  const primary = {
    host,
    port: actualPort,
    scheme: (https ? 'https' : 'http') as 'http' | 'https',
  };

  if (!https || !ctx.config) {
    return { https, primary, servers };
  }

  // Bootstrap / production IP install: HTTPS only — no companion HTTP API
  if (ctx.config.tlsHttpsOnly) {
    process.stdout.write(
      '[ysk-server] tlsHttpsOnly — no dual HTTP (panel is HTTPS-only)\n',
    );
    return { https, primary, servers };
  }

  const { defaultHttpListenPort } = await import('@ysk/core');
  // When primary used ephemeral 0, pick another free port (0) for dual HTTP
  const wantHttp =
    ctx.config.httpListenPort ??
    (port === 0 ? 0 : defaultHttpListenPort(actualPort));
  if (wantHttp !== 0 && wantHttp === actualPort) {
    process.stderr.write(
      '[ysk-server] httpListenPort equals HTTPS port — skip dual HTTP\n',
    );
    return { https, primary, servers };
  }

  const redirect = ctx.config.tlsHttpRedirect !== false;
  const panelHost = ctx.config.panelDomain?.trim();
  const httpHandler = redirect
    ? (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        const path = req.url || '/';
        // Keep ACME / health on plain HTTP without redirect
        if (
          path.startsWith('/.well-known/') ||
          path === '/health' ||
          path.startsWith('/api/v1/health')
        ) {
          return attachRequestHandler(ctx, resolveWebRoot(ctx.webRoot))(req, res);
        }
        const hostHeader = panelHost || String(req.headers.host || host).split(':')[0];
        const loc = `https://${hostHeader}:${actualPort}${path}`;
        res.writeHead(301, { Location: loc, 'Content-Length': '0' });
        res.end();
      }
    : attachRequestHandler(ctx, resolveWebRoot(ctx.webRoot));

  const httpServer = createNodeHttpServer(httpHandler);
  // Full-API dual HTTP (no redirect) needs the same terminal WS upgrade as primary.
  if (!redirect) {
    attachTerminalWebSocket(httpServer, ctx, ctx.terminalTickets);
    attachHostBrowseWebSocket(httpServer, ctx, ctx.hostBrowseLiveTickets);
  }
  try {
    await listen(httpServer, host, wantHttp);
    const httpPort = boundPort(httpServer, wantHttp);
    servers.push(httpServer);
    process.stdout.write(
      `[ysk-server] dual HTTP on ${host}:${httpPort}` +
        (redirect ? ` → https :${actualPort}\n` : ' (full API)\n'),
    );
    return {
      https,
      primary,
      http: { host, port: httpPort },
      servers,
    };
  } catch (err) {
    process.stderr.write(
      `[ysk-server] dual HTTP bind failed on :${wantHttp}: ${err instanceof Error ? err.message : err}\n`,
    );
    return { https, primary, servers };
  }
}

/** @deprecated use createControlPlaneServer — returns HTTP server only for tests */
export function createHttpServer(ctx: AppContext): HttpServer {
  return createControlPlaneServer(ctx).server as HttpServer;
}

export async function listen(
  server: ControlPlaneServer,
  host: string,
  port: number,
): Promise<{ host: string; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  return { host, port };
}
