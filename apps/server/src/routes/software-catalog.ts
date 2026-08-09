/**
 * Software catalog probe / versions / install (Wave U2).
 * Extracted from software.ts. Behaviour preserved.
 */
import { tl } from '@ysk/shared';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  probeAllSoftware,
  installSoftware,
  installSoftwareBatch,
  installForFeature,
  getSoftware,
  collectCatalogSoftwareUpgrades,
  resolveSoftwareVersionStatus,
  resolveSoftwareVersionBatch,
  listVersionDiscoveryIds,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSoftwareCatalogRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  // —— Catalog apt upgrade status (software hub cards) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/software/upgrades') {
    ctx.auth.authenticate(getBearer(req));
    const items = await collectCatalogSoftwareUpgrades(ctx.host);
    const upgradableCount = items.filter((i) => i.upgradable).length;
    sendJson(res, 200, { items, upgradableCount });
    return true;
  }

  // —— Dynamic version discovery (no hardcoded latest versions) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/software/versions') {
    ctx.auth.authenticate(getBearer(req));
    const refresh = url.searchParams.get('refresh') === '1';
    const id = (url.searchParams.get('id') ?? '').trim();
    const idsParam = (url.searchParams.get('ids') ?? '').trim();
    if (idsParam) {
      const ids = idsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 40);
      const items = await resolveSoftwareVersionBatch({
        host: ctx.host,
        dataDir: ctx.dataDir,
        ids: ids.length ? ids : listVersionDiscoveryIds().slice(0, 40),
        refresh,
      });
      sendJson(res, 200, {
        items,
        upgradableCount: items.filter((i) => i.upgradable).length,
      });
      return true;
    }
    if (!id) {
      sendJson(res, 400, {
        ok: false,
        message: 'id or ids query required',
        knownIds: listVersionDiscoveryIds(),
      });
      return true;
    }
    const status = await resolveSoftwareVersionStatus({
      host: ctx.host,
      dataDir: ctx.dataDir,
      id,
      refresh,
    });
    sendJson(res, 200, status);
    return true;
  }

  // —— Unified one-click software install ——
  if (method === 'GET' && url.pathname === '/api/v1/system/software') {
    ctx.auth.authenticate(getBearer(req));
    const feature = url.searchParams.get('feature') ?? undefined;
    const items = await probeAllSoftware(ctx.host, feature);
    const missing = items.filter((i) => !i.installed);
    sendJson(res, 200, {
      items,
      missing,
      ready: missing.length === 0,
    });
    return true;
  }

  if (
    method === 'GET' &&
    url.pathname.match(/^\/api\/v1\/system\/software\/[^/]+$/) &&
    !url.pathname.endsWith('/install')
  ) {
    ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/').pop()!;
    const spec = getSoftware(id);
    if (!spec) {
      sendJson(res, 404, { ok: false, message: tl('notes.auto.n0969') });
      return true;
    }
    const items = await probeAllSoftware(ctx.host);
    const status = items.find((i) => i.id === id);
    sendJson(res, 200, {
      status,
      spec: { id: spec.id, title: spec.title, packages: spec.aptPackages },
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/software/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ids?: string[]; feature?: string };
    let result: Record<string, unknown>;
    if (data.feature) {
      result = (await installForFeature({
        host: ctx.host,
        feature: data.feature,
        dataDir: ctx.dataDir,
      })) as unknown as Record<string, unknown>;
    } else {
      const ids = data.ids ?? [];
      result = (await installSoftwareBatch({
        host: ctx.host,
        ids,
        dataDir: ctx.dataDir,
      })) as unknown as Record<string, unknown>;
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.software.install',
      detail: { feature: data.feature, ids: data.ids, ok: result.ok },
      ok: Boolean(result.ok),
    });
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/software\/[^/]+\/install$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const result = await installSoftware({
      host: ctx.host,
      id,
      dataDir: ctx.dataDir,
      enableUnits: true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.software.install.one',
      detail: { id, ok: result.ok },
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }

  return false;
}
