import { tl } from '@ysk/shared';
/**
 * HTTP routes — extracted from http-server (Wave2 R2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleDnsRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/dns/external-checklist') {
        ctx.auth.authenticate(getBearer(req));
        const domain = (url.searchParams.get('domain') ?? '').trim().toLowerCase();
        const scope = (url.searchParams.get('scope') ?? 'full') as 'mail' | 'web' | 'full';
        if (!domain) {
          sendJson(res, 400, { ok: false, message: tl('notes.auto.n0259') });
          return true;
        }
        const { buildExternalTodos } = await import('@ysk/core');
        const mailHostname =
          ctx.email.list().find((d) => d.domain === domain)?.mail_hostname || `mail.${domain}`;
        const items = buildExternalTodos({
          domain,
          mailHostname,
          scope: scope === 'web' || scope === 'mail' ? scope : 'full',
        });
        sendJson(res, 200, {
          domain,
          scope,
          items,
          notes: [tl('notes.auto.n1039')],
        });
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/dns/cluster/peers') {
        ctx.auth.authenticate(getBearer(req));
        const { listDnsClusterPeers } = await import('@ysk/core');
        sendJson(res, 200, { items: listDnsClusterPeers(ctx.db) });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/peers') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          host?: string;
          username?: string;
          port?: number;
          path?: string;
          label?: string;
          id?: string;
          sshIdentityId?: string;
        };
        const { upsertDnsClusterPeer } = await import('@ysk/core');
        const peer = upsertDnsClusterPeer(ctx.db, {
          id: data.id,
          host: data.host ?? '',
          username: data.username ?? '',
          port: data.port,
          path: data.path,
          label: data.label,
          sshIdentityId: data.sshIdentityId,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cluster.peer',
          resource: peer.id,
          detail: { host: peer.host },
          ok: true,
        });
        sendJson(res, 200, { peer });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/push') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          peerId?: string;
          /** default true: remote reload after scp */
          reload?: boolean;
          probeAfter?: boolean;
        };
        const { pushDnsZonesToCluster } = await import('@ysk/core');
        const r = await pushDnsZonesToCluster({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          peerId: data.peerId,
          reload: data.reload,
          probeAfter: data.probeAfter,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cluster.push',
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            peerCount: r.peers?.length,
            notes: r.notes?.slice(0, 8),
          },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/reload') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { peerId?: string };
        const { reloadDnsClusterPeers } = await import('@ysk/core');
        const r = await reloadDnsClusterPeers({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          peerId: data.peerId,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cluster.reload',
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            peerCount: r.peers?.length,
          },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/cluster/probe') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as { peerId?: string };
        const { probeDnsClusterPeers } = await import('@ysk/core');
        const r = await probeDnsClusterPeers({
          db: ctx.db,
          host: ctx.host,
          dataDir: ctx.dataDir,
          peerId: data.peerId,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'dns.cluster.probe',
          detail: {
            ok: r.ok,
            apply_status: r.apply_status,
            peerCount: r.peers?.length,
          },
          ok: r.ok,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'GET' && url.pathname === '/api/v1/dns/health') {
        ctx.auth.authenticate(getBearer(req));
        const digName = (url.searchParams.get('name') ?? '').trim() || undefined;
        const { probeDnsServiceHealth } = await import('@ysk/core');
        const r = await probeDnsServiceHealth({
          dataDir: ctx.dataDir,
          host: ctx.host,
          digName,
        });
        sendJson(res, 200, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/probe-local') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          type?: string;
        };
        const { digLocalAuthoritative } = await import('@ysk/core');
        const r = await digLocalAuthoritative({
          host: ctx.host,
          name: data.name ?? '',
          type: data.type ?? 'SOA',
        });
        sendOpsResult(res, {
          ok: r.ok,
          notes: r.notes,
          answers: r.answers,
          method: r.method,
          name: data.name,
        });
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/lookup') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          name?: string;
          type?: 'A' | 'AAAA' | 'MX' | 'TXT' | 'CNAME' | 'NS';
          server?: string;
        };
        const { lookupDns } = await import('@ysk/core');
        const r = await lookupDns({
          host: ctx.host,
          name: data.name ?? '',
          type: data.type ?? 'A',
          server: data.server,
        });
        sendOpsResult(res, r);
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/dns/validate') {
        ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          records?: Array<{ type: string; name: string; value: string; ttl?: number }>;
        };
        const { validateDnsRecordSet, hasDnsErrors } = await import('@ysk/core');
        const issues = validateDnsRecordSet(data.records ?? []);
        sendJson(res, 200, {
          ok: !hasDnsErrors(issues),
          issues,
          notes: hasDnsErrors(issues)
            ? [tl('notes.auto.n0649')]
            : issues.length
              ? [tl('notes.auto.n0575')]
              : [tl('notes.auto.n1609')],
        });
        return true;
      }
  return false;
}
