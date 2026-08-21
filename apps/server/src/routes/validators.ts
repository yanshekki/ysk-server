/**
 * Validators (L1 nodes) — list / chains / disk / get + create / lifecycle.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  clearValidatorInstance,
  removeValidatorInstance,
  collectValidatorDisk,
  regenerateValidatorCompose,
  removeValidatorLeftover,
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
  stakingChecklistForInstance,
  collectValidatorNetIo,
  validatorContainerStats,
  writeValidatorCompose,
  loadValidatorSettings,
  saveValidatorSettings,
  snapshotOffer,
  upgradeValidatorInstance,
  collectValidatorSoftware,
  pullPinnedValidatorImage,
  listOfficialClientVersions,
  refreshOfficialReleases,
  ensureClientOfficialReleases,
  setValidatorClientVersion,
  findValidatorClient,
  attachAdaProducerKeys,
  detachAdaProducerKeys,
  enrichCardanoProducer,
} from 'ysk-server-core';
import { ErrorCodes, isValidatorInstanceId } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import { sendMaybeStreamedOps } from '../http/sse-ops.js';
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
    else if (
      method === 'DELETE' ||
      url.pathname.endsWith('/clear') ||
      url.pathname.endsWith('/delete') ||
      url.pathname.endsWith('/leftovers/remove')
    ) {
      requireCap(ctx, user, 'validators.wipe');
    } else requireCap(ctx, user, 'validators.manage');
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
        instances: listValidatorInstances(ctx.dataDir).map((i) =>
          enrichCardanoProducer(i, ctx.dataDir),
        ),
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

    if (method === 'GET' && url.pathname === `${BASE}/netio`) {
      const items = await collectValidatorNetIo({
        dataDir: ctx.dataDir,
        host: ctx.host,
      });
      sendJson(res, 200, { ok: true, items });
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/software`) {
      if (url.searchParams.get('refresh') === '1') {
        try {
          await refreshOfficialReleases({ dataDir: ctx.dataDir, force: true });
        } catch {
          /* keep last cache */
        }
      }
      const software = await collectValidatorSoftware({
        dataDir: ctx.dataDir,
        host: ctx.host,
      });
      sendJson(res, 200, { ok: true, ...software });
      return true;
    }

    {
      const ver = url.pathname.match(/^\/api\/v1\/validators\/clients\/([a-z0-9-]+)\/versions$/);
      if (method === 'GET' && ver) {
        const clientId = ver[1] ?? '';
        if (!findValidatorClient(clientId)) {
          sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND });
          return true;
        }
        try {
          await ensureClientOfficialReleases({
            dataDir: ctx.dataDir,
            clientId,
            force: url.searchParams.get('refresh') === '1',
          });
        } catch {
          /* keep last cache */
        }
        const network = url.searchParams.get('network') || undefined;
        sendJson(res, 200, {
          ok: true,
          ...listOfficialClientVersions({
            dataDir: ctx.dataDir,
            clientId,
            network,
          }),
        });
        return true;
      }
    }

    if (method === 'POST' && url.pathname === `${BASE}/software/pull`) {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      await sendMaybeStreamedOps({
        req,
        res,
        url,
        body,
        run: async (hooks) => {
          const result = await pullPinnedValidatorImage({
            host: ctx.host,
            dataDir: ctx.dataDir,
            execute: wantsExecute(ctx, body),
            image: String(body.image ?? body.ref ?? ''),
            tag: body.tag != null ? String(body.tag) : undefined,
            onLog: hooks.onLog,
            signal: hooks.signal,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'validators.software.pull',
            detail: { image: body.image ?? body.ref, tag: body.tag, ok: result.ok },
            ok: Boolean(result.ok),
          });
          return result;
        },
      });
      return true;
    }

    if (method === 'POST' && url.pathname === `${BASE}/leftovers/remove`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = removeValidatorLeftover({
        dataDir: ctx.dataDir,
        host: ctx.host,
        path: String(body.path ?? ''),
        confirm: String(body.confirm ?? ''),
        execute: wantsExecute(ctx, body),
      });
      sendOpsResult(res, result);
      return true;
    }

    if (method === 'POST' && (url.pathname === BASE || url.pathname === `${BASE}/`)) {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      await sendMaybeStreamedOps({
        req,
        res,
        url,
        body,
        run: async (hooks) => {
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
            elTag: body.elTag != null ? String(body.elTag) : undefined,
            clTag: body.clTag != null ? String(body.clTag) : undefined,
            nodeTag: body.nodeTag != null ? String(body.nodeTag) : undefined,
            mithril: body.mithril === true,
            dataPath: body.dataPath != null ? String(body.dataPath) : undefined,
            memory: body.memory != null ? String(body.memory) : undefined,
            cpus: body.cpus != null ? String(body.cpus) : undefined,
            rpcPort: body.rpcPort != null ? Number(body.rpcPort) : undefined,
            acceptLowDisk: body.acceptLowDisk === true,
            acceptLowMem: body.acceptLowMem === true,
            onLog: hooks.onLog,
            signal: hooks.signal,
          });
          ctx.audit.append({
            actor: user.username,
            action: 'validators.install',
            detail: { id: result.instanceId, chain: body.chain, network: body.network },
            ok: result.ok,
          });
          return result;
        },
      });
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
      sendJson(res, 200, { ok: true, instance: enrichCardanoProducer(instance, ctx.dataDir) });
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

    if (id && isValidatorInstanceId(id) && action === 'producer-keys' && method === 'POST') {
      const detach = rest.split('/')[2] === 'detach';
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      await sendMaybeStreamedOps({
        req,
        res,
        url,
        body,
        run: async (hooks) => {
          const hooked = {
            dataDir: ctx.dataDir,
            host: ctx.host,
            execute: wantsExecute(ctx, body),
            id,
            confirm: body.confirm != null ? String(body.confirm) : undefined,
            onLog: hooks.onLog,
            signal: hooks.signal,
          };
          if (detach) return detachAdaProducerKeys(hooked);
          return attachAdaProducerKeys({
            ...hooked,
            acceptMainnet: body.acceptMainnet === true,
            kes: body.kes != null ? String(body.kes) : undefined,
            vrf: body.vrf != null ? String(body.vrf) : undefined,
            opcert: body.opcert != null ? String(body.opcert) : undefined,
          });
        },
      });
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'compose' && method === 'GET') {
      sendJson(res, 200, readValidatorCompose(ctx.dataDir, id));
      return true;
    }

    if (id && isValidatorInstanceId(id) && action === 'rewrite-compose' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = regenerateValidatorCompose({
        dataDir: ctx.dataDir,
        id,
        execute: wantsExecute(ctx, body),
      });
      sendOpsResult(res, result);
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
      sendJson(res, 200, {
        ok: true,
        ...(await stakingChecklistForInstance(inst, ctx.dataDir)),
        snapshot: snapshotOffer(inst.chain, inst.network),
      });
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

    if (id && isValidatorInstanceId(id) && method === 'DELETE' && !action) {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const result = await removeValidatorInstance({
        dataDir: ctx.dataDir,
        host: ctx.host,
        execute: wantsExecute(ctx, body),
        id,
        confirm: body.confirm != null ? String(body.confirm) : id,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'validators.delete',
        detail: { id, execute: wantsExecute(ctx, body) },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }

    if (id && isValidatorInstanceId(id) && action && method === 'POST') {
      const raw = await readBody(req);
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      const exec = wantsExecute(ctx, body);
      const base = { dataDir: ctx.dataDir, host: ctx.host, execute: exec, id };
      const known = new Set([
        'start',
        'stop',
        'restart',
        'update',
        'upgrade',
        'prune',
        'switch-network',
        'snapshot',
        'mithril',
        'clear',
        'delete',
        'set-version',
      ]);
      if (!known.has(action)) {
        sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND, message: 'not found' });
        return true;
      }
      await sendMaybeStreamedOps({
        req,
        res,
        url,
        body,
        run: async (hooks) => {
          const hooked = { ...base, onLog: hooks.onLog, signal: hooks.signal };
          let result;
          if (action === 'start') result = await startValidatorInstance(hooked);
          else if (action === 'stop') result = await stopValidatorInstance(hooked);
          else if (action === 'restart') result = await restartValidatorInstance(hooked);
          else if (action === 'update' || action === 'upgrade') {
            result = await upgradeValidatorInstance(hooked);
          } else if (action === 'set-version') {
            result = await setValidatorClientVersion({
              ...hooked,
              clientId: String(body.clientId ?? ''),
              tag: String(body.tag ?? ''),
              confirm: String(body.confirm ?? ''),
              acceptMainnet: body.acceptMainnet === true,
            });
          } else if (action === 'prune') {
            result = await pruneValidatorInstance(hooked);
          } else if (action === 'switch-network') {
            result = await switchValidatorNetwork({
              ...hooked,
              network: String(body.network ?? ''),
              confirm: body.confirm != null ? String(body.confirm) : undefined,
            });
          } else if (action === 'snapshot') {
            result = await restoreValidatorSnapshot({
              ...hooked,
              confirm: body.confirm != null ? String(body.confirm) : undefined,
            });
          } else if (action === 'mithril') {
            result = await restoreAdaMithril({
              ...hooked,
              confirm: body.confirm != null ? String(body.confirm) : undefined,
            });
          } else if (action === 'delete') {
            result = await removeValidatorInstance({
              ...hooked,
              confirm: body.confirm != null ? String(body.confirm) : undefined,
            });
          } else {
            result = await clearValidatorInstance({
              ...hooked,
              confirm: body.confirm != null ? String(body.confirm) : undefined,
              removeUnit: Boolean(body.removeUnit),
              restoreSnapshot: Boolean(body.restoreSnapshot),
            });
          }
          ctx.audit.append({
            actor: user.username,
            action: `validators.${action}`,
            detail: { id, execute: exec },
            ok: result.ok,
          });
          return result;
        },
      });
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
