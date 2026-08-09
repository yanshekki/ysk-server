/**
 * Firewall + Fail2ban system routes.
 * Extracted from system-controller (Wave C2). Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyFirewall, applyFail2ban } from '@ysk/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleFirewallRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {

  if (method === 'GET' && url.pathname === '/api/v1/system/firewall/status') {
    ctx.auth.authenticate(getBearer(req));
    const { probeFirewallDeep } = await import('@ysk/core');
    const st = (await probeFirewallDeep(ctx.host)) as Record<string, unknown>;
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q && Array.isArray(st.numberedRules)) {
      const { listWithQuery } = await import('../http/list-response.js');
      const rules = st.numberedRules as Array<Record<string, unknown>>;
      const { items, meta } = listWithQuery(url, rules, {
        text: (r) => [
          String(r.num ?? ''),
          String(r.action ?? ''),
          String(r.to ?? ''),
          String(r.from ?? ''),
          String(r.raw ?? ''),
        ],
      });
      sendJson(res, 200, { ...st, numberedRules: items, rulesMeta: meta });
      return true;
    }
    sendJson(res, 200, st);
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/apply') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      allowSmtp?: boolean;
      apply?: boolean;
      extraTcpPorts?: number[];
      extraPortSpecs?: string[];
    };
    const result = await applyFirewall({
      host: ctx.host,
      dataDir: ctx.dataDir,
      allowSmtp: data.allowSmtp,
      apply: data.apply,
      extraTcpPorts: data.extraTcpPorts,
      extraPortSpecs: data.extraPortSpecs,
    });
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.apply',
      detail: result,
      ok: result.ok,
    });
    sendOpsResult(res, result);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/enable') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { enabled?: boolean };
    const { firewallSetEnabled } = await import('@ysk/core');
    const r = await firewallSetEnabled(ctx.host, data.enabled !== false);
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.enable',
      detail: { enabled: data.enabled !== false, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/deny') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string };
    const { firewallDenyIp } = await import('@ysk/core');
    const r = await firewallDenyIp(ctx.host, data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.deny',
      detail: { ip: data.ip, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/delete-deny') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { ip?: string };
    const { firewallDeleteDenyIp } = await import('@ysk/core');
    const r = await firewallDeleteDenyIp(ctx.host, data.ip ?? '');
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.delete_deny',
      detail: { ip: data.ip, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/delete-rule') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as { num?: number };
    const { firewallDeleteRuleNumber } = await import('@ysk/core');
    const r = await firewallDeleteRuleNumber(ctx.host, Number(data.num));
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.delete_rule',
      detail: { num: data.num, ...r },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/firewall/service-ports') {
    ctx.auth.authenticate(getBearer(req));
    const { listFirewallPortChips, YSK_SERVICE_PORTS } = await import('@ysk/shared');
    sendJson(res, 200, {
      ok: true,
      chips: listFirewallPortChips(),
      catalog: YSK_SERVICE_PORTS,
    });
    return true;
  }

  if (method === 'POST' && url.pathname === '/api/v1/system/firewall/allow-port') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      port?: number | string;
      proto?: 'tcp' | 'udp' | 'both';
      /** Optional source IP or CIDR — port only open to this source */
      from?: string;
    };
    const { firewallAllowPort } = await import('@ysk/core');
    // number | "80" | "30000:30100" | "53/udp" (proto from body wins if set)
    const portArg =
      typeof data.port === 'number'
        ? data.port
        : String(data.port ?? '')
            .trim()
            .replace(/\/(tcp|udp)$/i, '');
    const protoRaw = String(data.proto ?? 'tcp').toLowerCase();
    const proto: 'tcp' | 'udp' | 'both' =
      protoRaw === 'udp' ? 'udp' : protoRaw === 'both' || protoRaw === 'any' ? 'both' : 'tcp';
    const fromArg = String(data.from ?? '').trim() || undefined;
    const r = await firewallAllowPort(ctx.host, portArg, proto, fromArg);
    ctx.audit.append({
      actor: user.username,
      action: 'system.firewall.allow_port',
      detail: { port: portArg, proto, from: fromArg },
      ok: r.ok,
    });
    sendOpsResult(res, r);
    return true;
  }

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
