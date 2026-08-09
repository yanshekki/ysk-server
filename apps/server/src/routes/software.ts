import { tl } from '@ysk/shared';
/**
 * Software catalog + stack install routes.
 * Extracted from system-controller (Wave C3). Behaviour preserved.
 */
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
  listStackPlans,
  listStackBundles,
  getStackStatus,
  installStack,
  uninstallStack,
  scanStack,
  expandComponents,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSoftwareRoutes(
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

  // —— Stack plans / install / uninstall (bundle wizard) ——
  if (method === 'GET' && url.pathname === '/api/v1/system/stack') {
    ctx.auth.authenticate(getBearer(req));
    const st = await getStackStatus({ host: ctx.host, dataDir: ctx.dataDir });
    sendJson(res, 200, {
      ok: true,
      ...st,
      executeEnabled: ctx.host.executeEnabled(),
      isRoot: ctx.host.isRoot(),
    });
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/stack/plans') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, {
      ok: true,
      plans: listStackPlans(),
      bundles: listStackBundles(),
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/expand') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      plan?: string;
      bundles?: string[];
      sqlServer?: 'mariadb' | 'mysql';
      clamav?: boolean;
    };
    const r = expandComponents(
      { plan: data.plan, bundles: data.bundles },
      { sqlServer: data.sqlServer, clamav: data.clamav },
    );
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/scan') {
    const user = ctx.auth.authenticate(getBearer(req));
    const scan = await scanStack({ host: ctx.host, dataDir: ctx.dataDir });
    ctx.audit.append({
      actor: user.username,
      action: 'system.stack.scan',
      detail: { components: Object.keys(scan.manifest.components).length },
      ok: true,
    });
    sendJson(res, 200, { ok: true, ...scan });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      plan?: string;
      bundles?: string[];
      sqlServer?: 'mariadb' | 'mysql';
      clamav?: boolean;
      dryRun?: boolean;
    };
    const result = await installStack({
      host: ctx.host,
      dataDir: ctx.dataDir,
      plan: data.plan,
      bundles: data.bundles,
      options: { sqlServer: data.sqlServer, clamav: data.clamav },
      dryRun: data.dryRun === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.stack.install',
      detail: {
        plan: data.plan,
        bundles: data.bundles,
        dryRun: data.dryRun,
        ok: result.ok,
        blocked: result.blocked,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result as unknown as Record<string, unknown>);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/stack/uninstall') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      all?: boolean;
      bundles?: string[];
      components?: string[];
      dataPolicy?: 'keep' | 'purge';
      removeProduct?: boolean;
      dryRun?: boolean;
    };
    const result = await uninstallStack({
      host: ctx.host,
      dataDir: ctx.dataDir,
      all: data.all,
      bundles: data.bundles,
      components: data.components,
      dataPolicy: data.dataPolicy ?? 'keep',
      removeProduct: data.removeProduct,
      dryRun: data.dryRun === true,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.stack.uninstall',
      detail: {
        all: data.all,
        bundles: data.bundles,
        components: data.components,
        dataPolicy: data.dataPolicy,
        dryRun: data.dryRun,
        ok: result.ok,
        blocked: result.blocked,
      },
      ok: result.ok,
    });
    sendOpsResult(res, result as unknown as Record<string, unknown>);
    return true;
  }


  return false;
}
