/**
 * Stack plans / install / uninstall (Wave U2).
 * Extracted from software.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  listStackPlans,
  listStackBundles,
  getStackStatus,
  installStack,
  uninstallStack,
  scanStack,
  expandComponents,
} from '@ysk-server/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleSoftwareStackRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
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
