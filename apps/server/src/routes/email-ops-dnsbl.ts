/**
 * Email DNSBL checks + warmup plan (Wave AC1).
 * Extracted from email-ops.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@ysk-server/shared';
import {
  checkIpDnsbl,
  planEmailWarmup,
} from '@ysk-server/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleEmailOpsDnsblRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'POST' && url.pathname === '/api/v1/email/dnsbl/multi') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ips?: string[] };
    const { checkMultipleIpsDnsbl } = await import('@ysk-server/core');
    const r = await checkMultipleIpsDnsbl(data.ips ?? []);
    sendJson(res, 200, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/dnsbl/check') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string };
    const ip = data.ip?.trim();
    if (!ip) {
      sendJson(res, 400, {
        ok: false,
        code: 'YSK_VALIDATION',
        message: tl('notes.auto.n1400'),
      });
      return true;
    }
    const report = await checkIpDnsbl(ip);
    sendJson(res, 200, report);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/email/dnsbl/last') {
    ctx.auth.authenticate(getBearer(req));
    sendJson(res, 200, {
      last: ctx.settings.getJson('last_dnsbl_run') ?? null,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/email/warmup') {
    ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      domain?: string;
      serverIp?: string;
      isNewIp?: boolean;
    };
    const plan = planEmailWarmup({
      domain: data.domain ?? 'example.com',
      serverIp: data.serverIp ?? '203.0.113.10',
      isNewIp: data.isNewIp,
    });
    sendJson(res, 200, plan);
    return true;
  }

  return false;
}
