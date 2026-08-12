/**
 * Runtime addons / latest / plugins catalog (Wave W3).
 * Extracted from hosting-runtimes-plugins.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listSupportedRuntimes,
  runtimePluginsCatalogWithProbe,
  getRuntimeLatestHint,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  sendJson,
} from '../http/util.js';

export async function handleHostingRuntimesAddonsRoutes(
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
      const { phpExtensionCatalogWithProbe } = await import('@yanshekki/core');
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
