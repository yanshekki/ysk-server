/**
 * Validators (L1 nodes) — list / chains / disk / get + create / lifecycle.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  clearValidatorInstance,
  collectValidatorDisk,
  createValidatorInstance,
  getValidatorInstance,
  listValidatorChains,
  listValidatorInstances,
  logsValidatorInstance,
  restartValidatorInstance,
  setValidatorPolicy,
  startValidatorInstance,
  statusValidatorInstance,
  stopValidatorInstance,
  restoreAdaMithril,
  restoreValidatorSnapshot,
  pruneValidatorInstance,
  readValidatorCompose,
  switchValidatorNetwork,
  summarizeValidatorInstances,
  stakingChecklist,
  validatorContainerStats,
  writeValidatorCompose,
  loadValidatorSettings,
  saveValidatorSettings,
  snapshotOffer,
  upgradeValidatorInstance,
} from 'ysk-server-core';
import { ErrorCodes, isValidatorInstanceId } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import { requireAnyCap, requireCap } from '../http/rbac-guard.js';

const BASE = '/api/v1/validators';

const READ_CAPS = ['validators.read', 'validators.manage', 'validators.wipe'] as const;

function wantsExecute(ctx: AppContext, body: Record<string, unknown>): boolean {
  return ctx.host.executeEnabled() && body.execute !== false && body.dryRun !== true;
}

export async function handleValidatorsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (!url.pathname.startsWith(BASE)) return false;

  let user: ReturnType<AppContext['auth']['authenticate']>;
  try {
    user = ctx.auth.authenticate(getBearer(req));
    if (method === 'GET') requireAnyCap(ctx, user, READ_CAPS);
    else if (url.pathname.endsWith('/clear')) requireCap(ctx, user, 'validators.wipe');
    else requireCap(ctx, user, 'validators.manage');
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 403, {
      ok: false,
      code: err.code ?? ErrorCodes.FORBIDDEN,
      message: err.message ?? 'forbidden',
    });
    return true;
  }

  try {
    if (method === 'GET' && (url.pathname === BASE || url.pathname === `${BASE}/`)) {
      const { summaries } = await summarizeValidatorInstances({
        dataDir: ctx.dataDir,
        host: ctx.host,
      });
      sendJson(res, 200, {
        ok: true,
        instances: listValidatorInstances(ctx.dataDir),
        summaries,
        settings: loadValidatorSettings(ctx.dataDir),
        executeEnabled: ctx.host.executeEnabled(),
        isRoot: ctx.host.isRoot(),
      });
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/settings`) {
      sendJson(res, 200, { ok: true, settings: loadValidatorSettings(ctx.dataDir) });
      return true;
    }

    if (method === 'PATCH' && url.pathname === `${BASE}/settings`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const settings = saveValidatorSettings(ctx.dataDir, {
        autoClear: body.autoClear === true,
      });
      sendJson(res, 200, { ok: true, settings });
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/chains`) {
      sendJson(res, 200, { ok: true, chains: listValidatorChains() });
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/disk`) {
      const disk = await collectValidatorDisk({ dataDir: ctx.dataDir, host: ctx.host });
      sendJson(res, 200, { ok: true, disk });
      return true;
    }

    if (method === 'POST' && (url.pathname === BASE || url.pathname === `${BASE}/`)) {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const result = await createValidatorInstance({
        dataDir: ctx.dataDir,
        host: ctx.host,
        execute: wantsExecute(ctx, body),
        chain: String(body.chain ?? ''),
        network: String(body.network ?? ''),
        profile: String(body.profile ?? 'minimal'),
        slug: body.slug != null ? String(body.slug) : undefined,
        el: body.el != null ? String(body.el) : undefined,
        cl: body.cl != null ? String(body.cl) : undefined,
        mithril: body.mithril === true,
        dataPath: body.dataPath != null ? String(body.dataPath) : undefined,
        memory: body.memory != null ? String(body.memory) : undefined,
        cpus: body.cpus != null ? String(body.cpus) : undefined,
        rpcPort: body.rpcPort != null ? Number(body.rpcPort) : undefined,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'validators.install',
        detail: { id: result.instanceId, chain: body.chain, network: body.network },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }

    const rest = url.pathname.slice(BASE.length + 1);
    const [id, action] = rest.split('/');
    if (id && isValidatorInstanceId(id) && !action && method === 'GET') {
      const instance = getValidatorInstance(ctx.dataDir, id);
      if (!instance) {
        sendJson(res, 404, {
          ok: false,
          code: ErrorCodes.NOT_FOUND,
          message: 'validator instance not found',
        });
        return true;
      }
      sendJson(res, 200, { ok: true, instance });
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'status' && method === 'GET') {
      const status = await statusValidatorInstance({
        dataDir: ctx.dataDir,
        host: ctx.host,
        id,
      });
      sendJson(res, 200, { ok: true, ...status });
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'compose' && method === 'GET') {
      sendJson(res, 200, readValidatorCompose(ctx.dataDir, id));
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'compose' && method === 'PUT') {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = writeValidatorCompose({
        dataDir: ctx.dataDir,
        id,
        content: String(body.content ?? ''),
        execute: wantsExecute(ctx, body),
      });
      sendOpsResult(res, result);
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'stats' && method === 'GET') {
      const stats = await validatorContainerStats({
        dataDir: ctx.dataDir,
        host: ctx.host,
        id,
      });
      sendJson(res, 200, stats);
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'checklist' && method === 'GET') {
      const inst = getValidatorInstance(ctx.dataDir, id);
      if (!inst) {
        sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND });
        return true;
      }
      sendJson(res, 200, { ok: true, ...stakingChecklist(inst.chain), snapshot: snapshotOffer(inst.chain, inst.network) });
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'logs' && method === 'GET') {
      const tail = Number(url.searchParams.get('tail') ?? '200');
      const logs = await logsValidatorInstance({
        dataDir: ctx.dataDir,
        host: ctx.host,
        id,
        tail,
      });
      sendJson(res, 200, { ok: true, ...logs });
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'policy' && method === 'PATCH') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const r = setValidatorPolicy(ctx.dataDir, id, String(body.upgrade ?? body.policy ?? ''));
      ctx.audit.append({
        actor: user.username,
        action: 'validators.policy',
        detail: { id, policy: body.upgrade ?? body.policy },
        ok: r.ok,
      });
      sendJson(res, r.ok ? 200 : 422, { ok: r.ok, instance: r.instance, notes: r.notes });
      return true;
    }

    if (id && isValidatorInstanceId(id) && action && method === 'POST') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const exec = wantsExecute(ctx, body);
      const base = { dataDir: ctx.dataDir, host: ctx.host, execute: exec, id };
      let result;
      if (action === 'start') result = await startValidatorInstance(base);
      else if (action === 'stop') result = await stopValidatorInstance(base);
      else if (action === 'restart') result = await restartValidatorInstance(base);
      else if (action === 'update' || action === 'upgrade') {
        result = await upgradeValidatorInstance(base);
      } else if (action === 'prune') {
        result = await pruneValidatorInstance(base);
      } else if (action === 'switch-network') {
        result = await switchValidatorNetwork({
          ...base,
          network: String(body.network ?? ''),
          confirm: body.confirm != null ? String(body.confirm) : undefined,
        });
      } else if (action === 'snapshot') {
        result = await restoreValidatorSnapshot({
          ...base,
          confirm: body.confirm != null ? String(body.confirm) : undefined,
        });
      } else if (action === 'mithril') {
        result = await restoreAdaMithril({
          ...base,
          confirm: body.confirm != null ? String(body.confirm) : undefined,
        });
      } else if (action === 'clear') {
        result = await clearValidatorInstance({
          ...base,
          confirm: body.confirm != null ? String(body.confirm) : undefined,
          removeUnit: Boolean(body.removeUnit),
          restoreSnapshot: Boolean(body.restoreSnapshot),
        });
      } else {
        sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND, message: 'not found' });
        return true;
      }
      ctx.audit.append({
        actor: user.username,
        action: `validators.${action}`,
        detail: { id, execute: exec },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }

    sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND, message: 'not found' });
    return true;
  } catch (e) {
    const err = e as { httpStatus?: number; code?: string; message?: string };
    sendJson(res, err.httpStatus ?? 500, {
      ok: false,
      code: err.code ?? 'error',
      message: err.message ?? 'error',
    });
    return true;
  }
}
