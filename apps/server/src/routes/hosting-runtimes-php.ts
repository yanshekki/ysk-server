/**
 * PHP extensions/ini + runtime tuning.
 * Extracted from hosting-runtimes.ts (Wave N2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleHostingRuntimesPhpRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
