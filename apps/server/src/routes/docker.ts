/**
 * Docker engine control plane — inventory + honesty-gated mutations.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  dockerComposeAction,
  dockerComposeLogs,
  dockerContainerAction,
  dockerContainerLogs,
  dockerCreateNetwork,
  dockerCreateVolume,
  dockerEngineControl,
  dockerEngineStatus,
  dockerPrune,
  dockerPull,
  dockerRemoveImage,
  dockerRemoveNetwork,
  dockerRemoveVolume,
  dockerRun,
  dockerSystemDf,
  getDockerDaemonSettings,
  inspectDocker,
  listDockerComposeProjects,
  listDockerContainers,
  listDockerImages,
  listDockerNetworks,
  listDockerVolumes,
  patchDockerDaemon,
} from 'ysk-server-core';
import { ErrorCodes, isDockerComposeAction, isDockerContainerAction, isDockerEngineAction } from 'ysk-server-shared';
import type { AppContext } from '../app-context.js';
import { getBearer, readBody, sendJson, sendOpsResult } from '../http/util.js';
import { requireAnyCap, requireCap } from '../http/rbac-guard.js';

const BASE = '/api/v1/docker';
const READ_CAPS = ['docker.read', 'docker.manage', 'docker.wipe'] as const;

function wantsExecute(ctx: AppContext, body: Record<string, unknown>): boolean {
  return ctx.host.executeEnabled() && body.execute !== false && body.dryRun !== true;
}

function ctxOf(ctx: AppContext, body: Record<string, unknown>) {
  return { host: ctx.host, dataDir: ctx.dataDir, execute: wantsExecute(ctx, body) };
}

export async function handleDockerRoutes(
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
      url.pathname === `${BASE}/prune` ||
      url.pathname.endsWith('/remove') ||
      /\/volumes\/[^/]+\/remove$/.test(url.pathname)
    ) {
      requireCap(ctx, user, 'docker.wipe');
    } else requireCap(ctx, user, 'docker.manage');
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
      const status = await dockerEngineStatus({ host: ctx.host, dataDir: ctx.dataDir });
      sendJson(res, 200, {
        ok: true,
        status,
        executeEnabled: ctx.host.executeEnabled(),
        isRoot: ctx.host.isRoot(),
      });
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/containers`) {
      sendJson(res, 200, {
        ok: true,
        items: await listDockerContainers({ host: ctx.host, all: url.searchParams.get('all') !== '0' }),
      });
      return true;
    }

    if (method === 'POST' && url.pathname === `${BASE}/containers`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerRun({
        ...ctxOf(ctx, body),
        req: {
          image: String(body.image ?? ''),
          name: body.name != null ? String(body.name) : undefined,
          ports: Array.isArray(body.ports) ? (body.ports as never) : undefined,
          env: body.env && typeof body.env === 'object' ? (body.env as Record<string, string>) : undefined,
          restart: body.restart != null ? String(body.restart) as never : undefined,
          network: body.network != null ? String(body.network) : undefined,
          volumes: Array.isArray(body.volumes) ? (body.volumes as never) : undefined,
        },
      });
      ctx.audit.append({ actor: user.username, action: 'docker.container', detail: { op: 'run' }, ok: result.ok });
      sendOpsResult(res, result);
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/images`) {
      sendJson(res, 200, { ok: true, items: await listDockerImages(ctx.host) });
      return true;
    }

    if (method === 'POST' && url.pathname === `${BASE}/images/pull`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerPull({ ...ctxOf(ctx, body), image: String(body.image ?? '') });
      ctx.audit.append({ actor: user.username, action: 'docker.container', detail: { op: 'pull' }, ok: result.ok });
      sendOpsResult(res, result);
      return true;
    }

    if (method === 'POST' && url.pathname === `${BASE}/images/remove`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerRemoveImage({ ...ctxOf(ctx, body), id: String(body.id ?? body.image ?? '') });
      ctx.audit.append({ actor: user.username, action: 'docker.container', detail: { op: 'rmi' }, ok: result.ok });
      sendOpsResult(res, result);
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/volumes`) {
      sendJson(res, 200, { ok: true, items: await listDockerVolumes({ host: ctx.host }) });
      return true;
    }

    if (method === 'POST' && url.pathname === `${BASE}/volumes`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerCreateVolume({ ...ctxOf(ctx, body), name: String(body.name ?? '') });
      sendOpsResult(res, result);
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/networks`) {
      sendJson(res, 200, { ok: true, items: await listDockerNetworks({ host: ctx.host }) });
      return true;
    }

    if (method === 'POST' && url.pathname === `${BASE}/networks`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerCreateNetwork({ ...ctxOf(ctx, body), name: String(body.name ?? '') });
      sendOpsResult(res, result);
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/compose`) {
      sendJson(res, 200, {
        ok: true,
        items: await listDockerComposeProjects({ host: ctx.host, dataDir: ctx.dataDir }),
      });
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/df`) {
      sendJson(res, 200, { ok: true, items: await dockerSystemDf(ctx.host) });
      return true;
    }

    if (method === 'GET' && url.pathname === `${BASE}/daemon`) {
      sendJson(res, 200, { ok: true, daemon: getDockerDaemonSettings() });
      return true;
    }

    if (method === 'PATCH' && url.pathname === `${BASE}/daemon`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await patchDockerDaemon({
        ...ctxOf(ctx, body),
        patch: {
          logDriver: body.logDriver != null ? String(body.logDriver) : undefined,
          logMaxSize: body.logMaxSize != null ? String(body.logMaxSize) : undefined,
          logMaxFile: body.logMaxFile != null ? String(body.logMaxFile) : undefined,
          liveRestore: typeof body.liveRestore === 'boolean' ? body.liveRestore : undefined,
          registryMirrors: Array.isArray(body.registryMirrors)
            ? body.registryMirrors.map((x) => String(x))
            : undefined,
          insecureRegistries: Array.isArray(body.insecureRegistries)
            ? body.insecureRegistries.map((x) => String(x))
            : undefined,
        },
      });
      ctx.audit.append({ actor: user.username, action: 'docker.daemon', detail: {}, ok: result.ok });
      sendOpsResult(res, result);
      return true;
    }

    if (method === 'POST' && url.pathname === `${BASE}/prune`) {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerPrune({
        ...ctxOf(ctx, body),
        scope: String(body.scope ?? ''),
        confirm: body.confirm != null ? String(body.confirm) : undefined,
      });
      ctx.audit.append({ actor: user.username, action: 'docker.prune', detail: { scope: body.scope }, ok: result.ok });
      sendOpsResult(res, result);
      return true;
    }

    const rest = url.pathname.slice(BASE.length + 1);
    const parts = rest.split('/').filter(Boolean);

    if (parts[0] === 'engine' && parts[1] && method === 'POST') {
      const action = parts[1];
      if (!isDockerEngineAction(action)) {
        sendJson(res, 400, { ok: false, code: ErrorCodes.VALIDATION, message: 'bad engine action' });
        return true;
      }
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerEngineControl({ ...ctxOf(ctx, body), action });
      ctx.audit.append({ actor: user.username, action: 'docker.engine', detail: { action }, ok: result.ok });
      sendOpsResult(res, result);
      return true;
    }

    if (parts[0] === 'containers' && parts[1] && parts[2] === 'logs' && method === 'GET') {
      const logs = await dockerContainerLogs({
        host: ctx.host,
        id: decodeURIComponent(parts[1]),
        tail: Number(url.searchParams.get('tail') ?? '200'),
      });
      sendJson(res, 200, { ok: true, ...logs });
      return true;
    }

    if (parts[0] === 'containers' && parts[1] && !parts[2] && method === 'GET') {
      const inspect = await inspectDocker({ host: ctx.host, id: decodeURIComponent(parts[1]) });
      sendJson(res, inspect.ok ? 200 : 404, { ok: inspect.ok, inspect: inspect.raw, notes: inspect.notes });
      return true;
    }

    if (parts[0] === 'containers' && parts[1] && parts[2] && method === 'POST') {
      const action = parts[2] === 'remove' ? 'remove' : parts[2];
      if (!isDockerContainerAction(action)) {
        sendJson(res, 400, { ok: false, code: ErrorCodes.VALIDATION, message: 'bad container action' });
        return true;
      }
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerContainerAction({
        ...ctxOf(ctx, body),
        id: decodeURIComponent(parts[1]),
        action,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'docker.container',
        detail: { id: parts[1], op: action },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }

    if (parts[0] === 'volumes' && parts[1] && parts[2] === 'remove' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerRemoveVolume({
        ...ctxOf(ctx, body),
        name: decodeURIComponent(parts[1]),
      });
      sendOpsResult(res, result);
      return true;
    }

    if (parts[0] === 'networks' && parts[1] && parts[2] === 'remove' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerRemoveNetwork({
        ...ctxOf(ctx, body),
        id: decodeURIComponent(parts[1]),
      });
      sendOpsResult(res, result);
      return true;
    }

    if (parts[0] === 'compose' && parts[1] && parts[2] === 'logs' && method === 'GET') {
      const logs = await dockerComposeLogs({
        host: ctx.host,
        dataDir: ctx.dataDir,
        project: decodeURIComponent(parts[1]),
        tail: Number(url.searchParams.get('tail') ?? '200'),
      });
      sendJson(res, 200, { ok: true, ...logs });
      return true;
    }

    if (parts[0] === 'compose' && parts[1] && parts[2] && method === 'POST') {
      const action = parts[2];
      if (!isDockerComposeAction(action)) {
        sendJson(res, 400, { ok: false, code: ErrorCodes.VALIDATION, message: 'bad compose action' });
        return true;
      }
      const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
      const result = await dockerComposeAction({
        ...ctxOf(ctx, body),
        project: decodeURIComponent(parts[1]),
        action,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'docker.container',
        detail: { project: parts[1], op: action },
        ok: result.ok,
      });
      sendOpsResult(res, result);
      return true;
    }

    sendJson(res, 404, { ok: false, code: ErrorCodes.NOT_FOUND, message: 'not found' });
    return true;
  } catch (e) {
    sendJson(res, 500, {
      ok: false,
      code: ErrorCodes.INTERNAL,
      message: e instanceof Error ? e.message : 'docker route failed',
    });
    return true;
  }
}
