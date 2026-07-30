/**
 * Control-plane HTTP API — dispatcher.
 * Route bodies live in `./routes/*` and `./controllers/*` (Wave2 R2).
 */

import { createServer, type Server } from 'node:http';
import { runWithLocaleAsync, tl } from '@ysk/shared';
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

export function createHttpServer(ctx: AppContext): Server {
  const webRoot = resolveWebRoot(ctx.webRoot);

  return createServer((req, res) => {
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
  });
}

export async function listen(
  server: Server,
  host: string,
  port: number,
): Promise<{ host: string; port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  return { host, port };
}
