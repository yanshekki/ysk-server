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
  previewSoftwareUninstall,
  uninstallSoftware,
} from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

function wantsSse(
  req: IncomingMessage,
  url: URL,
  data: { stream?: boolean },
): boolean {
  return (
    Boolean(data.stream) ||
    String(req.headers.accept || '').includes('text/event-stream') ||
    url.searchParams.get('stream') === '1'
  );
}

function beginSse(res: ServerResponse, tag: string) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`: ${tag}\n\n`);
  let closed = false;
  const send = (event: string, payload: unknown) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch {
      closed = true;
    }
  };
  return {
    send,
    close: () => {
      closed = true;
    },
    isClosed: () => closed,
  };
}

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

  if (method === 'POST' && url.pathname === '/api/v1/system/software/uninstall-preview') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      ids?: string[];
      feature?: string;
      dataPolicy?: 'keep' | 'purge';
    };
    const preview = await previewSoftwareUninstall({
      host: ctx.host,
      feature: data.feature,
      ids: data.ids,
      dataPolicy: data.dataPolicy,
    });
    sendJson(res, 200, preview);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/software/uninstall') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      ids?: string[];
      feature?: string;
      dataPolicy?: 'keep' | 'purge';
      confirmPhrase?: string;
      stream?: boolean;
    };
    const stream = wantsSse(req, url, data);

    const run = async (hooks?: {
      onLog?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void;
    }) => {
      const result = await uninstallSoftware({
        host: ctx.host,
        feature: data.feature,
        ids: data.ids,
        dataPolicy: data.dataPolicy,
        confirmPhrase: data.confirmPhrase,
        onLog: hooks?.onLog,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'system.software.uninstall',
        detail: {
          feature: data.feature,
          ids: data.ids,
          dataPolicy: data.dataPolicy,
          ok: result.ok,
        },
        ok: result.ok,
      });
      return result;
    };

    if (stream) {
      const sse = beginSse(res, 'ysk-software-uninstall-stream');
      req.on('close', () => sse.close());
      try {
        const result = await run({
          onLog: (streamName, line) => {
            sse.send('log', { stream: streamName, line, at: new Date().toISOString() });
          },
        });
        sse.send('result', result);
      } catch (e) {
        sse.send('result', {
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
      }
      res.end();
      return true;
    }

    const result = await run();
    sendOpsResult(res, result);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/software/install') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      ids?: string[];
      feature?: string;
      stream?: boolean;
    };
    const stream = wantsSse(req, url, data);

    const run = async (hooks?: {
      onLog?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void;
    }) => {
      hooks?.onLog?.('status', 'install start');
      let result: Record<string, unknown>;
      if (data.feature) {
        result = (await installForFeature({
          host: ctx.host,
          feature: data.feature,
          dataDir: ctx.dataDir,
          onLog: hooks?.onLog,
        })) as unknown as Record<string, unknown>;
      } else {
        const ids = data.ids ?? [];
        result = (await installSoftwareBatch({
          host: ctx.host,
          ids,
          dataDir: ctx.dataDir,
          onLog: hooks?.onLog,
        })) as unknown as Record<string, unknown>;
      }
      hooks?.onLog?.(
        'status',
        result.ok ? 'install done' : 'install finished with errors',
      );
      ctx.audit.append({
        actor: user.username,
        action: 'system.software.install',
        detail: { feature: data.feature, ids: data.ids, ok: result.ok },
        ok: Boolean(result.ok),
      });
      return result;
    };

    if (stream) {
      const sse = beginSse(res, 'ysk-software-install-stream');
      req.on('close', () => sse.close());
      try {
        const result = await run({
          onLog: (streamName, line) => {
            sse.send('log', { stream: streamName, line, at: new Date().toISOString() });
          },
        });
        sse.send('result', result);
      } catch (e) {
        sse.send('result', {
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
      }
      res.end();
      return true;
    }

    const result = await run();
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

  if (method === 'POST' && url.pathname.match(/^\/api\/v1\/system\/software\/[^/]+\/uninstall$/)) {
    const user = ctx.auth.authenticate(getBearer(req));
    const id = url.pathname.split('/')[5];
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      dataPolicy?: 'keep' | 'purge';
      confirmPhrase?: string;
      stream?: boolean;
    };
    const stream = wantsSse(req, url, data);
    const run = async (hooks?: {
      onLog?: (stream: 'stdout' | 'stderr' | 'status', line: string) => void;
    }) => {
      const result = await uninstallSoftware({
        host: ctx.host,
        ids: id ? [id] : [],
        dataPolicy: data.dataPolicy,
        confirmPhrase: data.confirmPhrase,
        onLog: hooks?.onLog,
      });
      ctx.audit.append({
        actor: user.username,
        action: 'system.software.uninstall.one',
        detail: { id, ok: result.ok },
        ok: result.ok,
      });
      return result;
    };
    if (stream) {
      const sse = beginSse(res, 'ysk-software-uninstall-one-stream');
      req.on('close', () => sse.close());
      try {
        const result = await run({
          onLog: (streamName, line) => {
            sse.send('log', { stream: streamName, line, at: new Date().toISOString() });
          },
        });
        sse.send('result', result);
      } catch (e) {
        sse.send('result', {
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
      }
      res.end();
      return true;
    }
    sendOpsResult(res, await run());
    return true;
  }

  return false;
}
