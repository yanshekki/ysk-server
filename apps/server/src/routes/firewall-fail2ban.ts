/**
 * Fail2ban system routes (Wave V2).
 * Extracted from firewall.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyFail2ban } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleFirewallFail2banRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/system/fail2ban/status') {
    ctx.auth.authenticate(getBearer(req));
    const { getFail2banDeepStatus } = await import('@ysk/core');
    sendJson(
      res,
      200,
      await getFail2banDeepStatus({ host: ctx.host, dataDir: ctx.dataDir }),
    );
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      apply?: boolean;
      jails?: string[];
      bantime?: string;
      findtime?: string;
      maxretry?: number;
    };
    const result = await applyFail2ban({
      dataDir: ctx.dataDir,
      host: ctx.host,
      apply: data.apply,
      jails: data.jails,
      bantime: data.bantime,
      findtime: data.findtime,
      maxretry: data.maxretry,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.apply',
      detail: result,
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/service') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      action?: 'start' | 'stop' | 'restart' | 'reload' | 'enable';
    };
    const { fail2banService } = await import('@ysk/core');
    const r = await fail2banService(ctx.host, data.action ?? 'reload');
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.service',
      detail: { action: data.action, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/ban') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { jail?: string; ip?: string };
    const { fail2banBanIp } = await import('@ysk/core');
    const r = await fail2banBanIp(ctx.host, data.jail ?? 'sshd', data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.ban',
      detail: data,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  if (method === 'GET' && url.pathname === '/api/v1/system/fail2ban/banned') {
    ctx.auth.authenticate(getBearer(req));
    const jail = url.searchParams.get('jail') ?? undefined;
    const { fail2banBannedIps } = await import('@ysk/core');
    sendJson(res, 200, await fail2banBannedIps(ctx.host, jail || undefined));
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/unban') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { jail?: string; ip?: string };
    const { fail2banUnban } = await import('@ysk/core');
    const r = await fail2banUnban(ctx.host, data.jail ?? 'sshd', data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.unban',
      detail: data,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/fail2ban/ignoreip') {
    ctx.auth.authenticate(getBearer(req));
    const { readIgnoreIpList } = await import('@ysk/core');
    sendJson(res, 200, { items: readIgnoreIpList(ctx.dataDir) });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/fail2ban/ignoreip') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string; action?: 'add' | 'remove' };
    const { fail2banIgnoreIp } = await import('@ysk/core');
    const r = await fail2banIgnoreIp(
      ctx.host,
      ctx.dataDir,
      data.ip ?? '',
      data.action ?? 'add',
    );
    ctx.audit.append({
      actor: user.username,
      action: 'system.fail2ban.ignoreip',
      detail: data,
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

  return false;
}
