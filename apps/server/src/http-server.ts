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
  handleAuthRoutes,
  handleBackupsRoutes,
  handleCdnRoutes,
  handleCronRoutes,
  handleDbRoutes,
  handleDefenseRoutes,
  handleDnsRoutes,
  handleEmailRoutes,
  handleHostingRoutes,
  handleMiscRoutes,
  handleProjectsRoutes,
  handlePublicRoutes,
  handleRbacRoutes,
  handleSettingsRoutes,
  handleSshRoutes,
  handleSslRoutes,
  handleToolsRoutes,
  handleUpdatesRoutes,
} from './routes/index.js';

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

        // Modular controllers first (WebDAV needs OPTIONS/PROPFIND)
        if (await handleFilesRoutes(ctx, req, res, url, method)) return;

        if (method === 'OPTIONS') {
          return sendJson(res, 204, {});
        }

        if (await handleResourcesRoutes(ctx, req, res, url, method)) return;
        if (await handleLogsRoutes(ctx, req, res, url, method)) return;
        if (await handleMetricsRoutes(ctx, req, res, url, method)) return;
        if (await handleNetworkRoutes(ctx, req, res, url, method)) return;
        if (await handleSystemRoutes(ctx, req, res, url, method)) return;

        // Domain route modules (extracted from former monolithic handler)
        if (await handlePublicRoutes(ctx, req, res, url, method)) return;
        if (await handleAuthRoutes(ctx, req, res, url, method)) return;
        if (await handleRbacRoutes(ctx, req, res, url, method)) return;
        if (await handleSettingsRoutes(ctx, req, res, url, method)) return;
        if (await handleAdminRoutes(ctx, req, res, url, method)) return;
        if (await handleSshRoutes(ctx, req, res, url, method)) return;
        if (await handleProjectsRoutes(ctx, req, res, url, method)) return;
        if (await handleAgentsRoutes(ctx, req, res, url, method)) return;
        if (await handleEmailRoutes(ctx, req, res, url, method)) return;
        if (await handleToolsRoutes(ctx, req, res, url, method)) return;
        if (await handleDefenseRoutes(ctx, req, res, url, method)) return;
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
  if (tls) {
    return { server: createNodeHttpsServer(tls, handler), https: true };
  }
  if (ctx.config?.tlsEnabled) {
    // Config wants TLS but files missing — fall back to HTTP with stderr warning
    process.stderr.write(
      '[ysk-server] tlsEnabled but cert/key missing or unreadable — serving plain HTTP\n',
    );
  }
  return { server: createNodeHttpServer(handler), https: false };
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
