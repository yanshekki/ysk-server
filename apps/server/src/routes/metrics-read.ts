/**
 * Metrics read — host/projects/processes/top/detail (Wave AB3).
 * Extracted from metrics.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import { getBearer, sendJson, sendOpsResult } from '../http/util.js';

export async function handleMetricsReadRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/metrics') {
    ctx.auth.authenticate(getBearer(req));
    const { collectMetricsDeep } = await import('@yanshekki/core');
    const m = await collectMetricsDeep(ctx.host);
    sendJson(res, 200, m);
    return true;
  }

  /** Per-project disk usage (real du on home_dir) */
  if (method === 'GET' && url.pathname === '/api/v1/metrics/projects') {
    ctx.auth.authenticate(getBearer(req));
    const { collectProjectsDiskUsage } = await import('@yanshekki/core');
    const projects = ctx.projects.list().map((p) => ({
      id: p.id,
      name: p.name,
      domain: p.domain,
      homeDir: p.homeDir,
      quotaMb: p.quotaMb,
    }));
    const limit = Number(url.searchParams.get('limit') || 50);
    const snap = await collectProjectsDiskUsage({
      host: ctx.host,
      projects,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    sendJson(res, 200, snap);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/metrics/processes') {
    ctx.auth.authenticate(getBearer(req));
    const { collectProcessSnapshot } = await import('@yanshekki/core');
    const sortRaw = url.searchParams.get('sort') || 'cpu';
    const sort =
      sortRaw === 'mem' || sortRaw === 'time' || sortRaw === 'pid'
        ? sortRaw
        : 'cpu';
    const limit = Number(url.searchParams.get('limit') || 40);
    const includeTop = url.searchParams.get('top') === '1';
    const includeHeader = url.searchParams.get('header') !== '0';
    const snap = await collectProcessSnapshot(ctx.host, {
      sort,
      limit,
      includeTop,
      includeHeader,
    });
    sendOpsResult(res, snap);
    return true;
  }

  /** Standalone top header (load/tasks/cpu/mem) */
  if (method === 'GET' && url.pathname === '/api/v1/metrics/top') {
    ctx.auth.authenticate(getBearer(req));
    const { collectTopHeader } = await import('@yanshekki/core');
    const header = await collectTopHeader(ctx.host);
    sendOpsResult(res, header);
    return true;
  }

  /** GET process detail from /proc */
  const detailMatch = url.pathname.match(
    /^\/api\/v1\/metrics\/processes\/(\d+)$/,
  );
  if (method === 'GET' && detailMatch) {
    ctx.auth.authenticate(getBearer(req));
    const { collectProcessDetail } = await import('@yanshekki/core');
    const detail = await collectProcessDetail(ctx.host, detailMatch[1]);
    sendOpsResult(res, detail);
    return true;
  }

  return false;
}
