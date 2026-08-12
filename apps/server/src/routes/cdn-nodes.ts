/**
 * CDN nodes registry + probe + drain.
 * Extracted from cdn.ts (Wave K3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from 'ysk-server-shared';
import { listWithQuery } from '../http/list-response.js';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleCdnNodesRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      // —— CDN nodes (PR-C1): registry + probe + drain ——
      if (method === 'GET' && url.pathname === '/api/v1/cdn/nodes') {
        ctx.auth.authenticate(getBearer(req));
        const { listCdnNodes } = await import('ysk-server-core');
        type Node = {
          name?: string;
          id?: string;
          region?: string;
          baseUrl?: string;
          status?: string;
        };
        const all = listCdnNodes(ctx.db) as unknown as Node[];
        const { items, meta } = listWithQuery(url, all, {
          text: (n: Node) => [
            String(n.name ?? ''),
            String(n.id ?? ''),
            String(n.region ?? ''),
            String(n.baseUrl ?? ''),
            String(n.status ?? ''),
          ],
        });
        sendJson(res, 200, { items, meta });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cdn/nodes') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as Record<string, unknown>;
        const { upsertCdnNode } = await import('ysk-server-core');
        const node = upsertCdnNode(ctx.db, {
          id: typeof data.id === 'string' ? data.id : undefined,
          name: String(data.name ?? ''),
          baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : undefined,
          fleetAgentId:
            typeof data.fleetAgentId === 'string' ? data.fleetAgentId : undefined,
          sshIdentityId:
            typeof data.sshIdentityId === 'string' ? data.sshIdentityId : undefined,
          sshHost: typeof data.sshHost === 'string' ? data.sshHost : undefined,
          sshPort:
            typeof data.sshPort === 'number'
              ? data.sshPort
              : Number(data.sshPort) || undefined,
          sshUsername:
            typeof data.sshUsername === 'string' ? data.sshUsername : undefined,
          remoteNginxConfDir:
            typeof data.remoteNginxConfDir === 'string'
              ? data.remoteNginxConfDir
              : undefined,
          roles: Array.isArray(data.roles) ? (data.roles as string[]) : undefined,
          region: typeof data.region === 'string' ? data.region : undefined,
          publicIpv4: Array.isArray(data.publicIpv4)
            ? (data.publicIpv4 as string[])
            : typeof data.publicIpv4 === 'string'
              ? String(data.publicIpv4)
                  .split(/[\s,]+/)
                  .filter(Boolean)
              : undefined,
          publicIpv6: Array.isArray(data.publicIpv6)
            ? (data.publicIpv6 as string[])
            : typeof data.publicIpv6 === 'string'
              ? String(data.publicIpv6)
                  .split(/[\s,]+/)
                  .filter(Boolean)
              : undefined,
          healthUrl: typeof data.healthUrl === 'string' ? data.healthUrl : undefined,
          weight: typeof data.weight === 'number' ? data.weight : Number(data.weight) || undefined,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.upsert',
          resource: node.id,
          detail: { name: node.name, roles: node.roles },
          ok: true,
        });
        sendJson(res, 200, { node });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/cdn/nodes/probe-all') {
        const user = ctx.auth.authenticate(getBearer(req));
        const { probeAllCdnNodes } = await import('ysk-server-core');
        const r = await probeAllCdnNodes(ctx.db);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.nodes.probe_all',
          detail: { ok: r.ok, count: r.items.length },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+$/)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { getCdnNode } = await import('ysk-server-core');
        const node = getCdnNode(ctx.db, id);
        if (!node) {
          sendJson(res, 404, { ok: false, notes: [tl('notes.auto.n0866')] });
          return true;
        }
        sendJson(res, 200, { node });
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { deleteCdnNode } = await import('ysk-server-core');
        const ok = deleteCdnNode(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.delete',
          resource: id,
          detail: { ok },
          ok });
        sendJson(res, ok ? 200 : 404, { ok });
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+\/probe$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const { probeCdnNode } = await import('ysk-server-core');
        const r = await probeCdnNode(ctx.db, id);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.probe',
          resource: id,
          detail: { ok: r.ok, method: r.method },
          ok: r.ok });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname.match(/^\/api\/v1\/cdn\/nodes\/[^/]+\/drain$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5];
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { draining?: boolean };
        const { setCdnNodeDrain } = await import('ysk-server-core');
        const node = setCdnNodeDrain(ctx.db, id, data.draining !== false);
        ctx.audit.append({
          actor: user.username,
          action: 'cdn.node.drain',
          resource: id,
          detail: { status: node.status },
          ok: true });
        sendJson(res, 200, { node });
        return true;
      }

  return false;
}
