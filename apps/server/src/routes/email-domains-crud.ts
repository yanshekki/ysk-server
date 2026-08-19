/**
 * Email domains list/create/delete.
 * Extracted from email-domains.ts (Wave P3). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { YskError } from 'ysk-server-shared';
import { listWithQuery } from '../http/list-response.js';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

function redactEmail<T extends { dkim_private_key?: string }>(e: T) {
  return { ...e, dkim_private_key: '***redacted***' };
}

export async function handleEmailDomainsCrudRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
      if (method === 'GET' && url.pathname === '/api/v1/email/domains') {
        ctx.auth.authenticate(getBearer(req));
        type Dom = {
          domain?: string;
          id?: string;
          server_ip?: string;
          apply_status?: string;
        };
        const all = ctx.email.list().map(redactEmail) as Dom[];
        const { items, meta } = listWithQuery(
          url,
          all,
          {
            text: (d: Dom) => [
              String(d.domain ?? ''),
              String(d.id ?? ''),
              String(d.server_ip ?? ''),
            ],
            predicates: {
              status: (d: Dom, v: string) => {
                const s = String(d.apply_status ?? 'draft').toLowerCase();
                if (v === 'draft') return s === 'draft' || s === 'written' || !s;
                return s === v;
              },
            },
            facetOf: {
              status: (d: Dom) => String(d.apply_status ?? 'draft').toLowerCase() || 'draft',
            },
            sortOf: {
              domain: (a: Dom, b: Dom) =>
                String(a.domain ?? '').localeCompare(String(b.domain ?? '')),
            },
          },
          {
            enums: {
              status: ['applied', 'written', 'draft', 'failed'],
            },
            sortFields: ['domain'],
          },
        );
        sendJson(res, 200, { items, meta, allTotal: all.length });
        return true;
      }
      if (method === 'GET' && /^\/api\/v1\/email\/domains\/[^/]+$/.test(url.pathname)) {
        ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5] ?? '';
        try {
          sendJson(res, 200, { domain: redactEmail(ctx.email.get(id)) });
        } catch (e) {
          const status = e instanceof YskError ? e.httpStatus || 404 : 404;
          const code = e instanceof YskError ? e.code : 'YSK_NOT_FOUND';
          const message = e instanceof Error ? e.message : 'Not found';
          sendJson(res, status, { ok: false, code, message });
        }
        return true;
      }
      if (method === 'POST' && url.pathname === '/api/v1/email/domains') {
        const user = ctx.auth.authenticate(getBearer(req));
        const raw = await readBody(req);
        const data = JSON.parse(raw || '{}') as {
          domain?: string;
          serverIp?: string;
          serverIpv6?: string;
          mailHostname?: string;
        };
        const created = ctx.email.create({
          domain: data.domain ?? '',
          serverIp: data.serverIp ?? '',
          serverIpv6: data.serverIpv6,
          mailHostname: data.mailHostname,
          actor: user.username,
        });
        sendJson(res, 201, created);
        return true;
      }
      if (method === 'DELETE' && url.pathname.match(/^\/api\/v1\/email\/domains\/[^/]+$/)) {
        const user = ctx.auth.authenticate(getBearer(req));
        const id = url.pathname.split('/')[5] ?? '';
        let body: { confirmName?: string; removeData?: boolean } = {};
        try {
          const raw = await readBody(req);
          if (raw?.trim()) body = JSON.parse(raw) as typeof body;
        } catch {
          body = {};
        }
        if (url.searchParams.has('confirmName')) {
          body.confirmName = url.searchParams.get('confirmName') || undefined;
        }
        if (url.searchParams.has('removeData')) {
          body.removeData = url.searchParams.get('removeData') !== '0';
        }
        const result = ctx.email.deleteDomain(id, user.username, {
          confirmName: body.confirmName,
          removeData: body.removeData !== false,
        });
        ctx.audit.append({
          actor: user.username,
          action: 'email.domain.delete',
          resource: result.domain,
          detail: {
            id,
            removedMailboxes: result.removedMailboxes,
            removedAliases: result.removedAliases,
            removeData: body.removeData !== false,
          },
          ok: result.ok,
        });
        sendOpsResult(res, result);
        return true;
      }

  return false;
}
