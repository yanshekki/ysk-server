/**
 * Host firewall (UFW-style) routes (Wave V2).
 * Extracted from firewall.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { applyFirewall } from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
  sendOpsResult,
} from '../http/util.js';

export async function handleFirewallUfwRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/system/firewall/status') {
    ctx.auth.authenticate(getBearer(req));
    const { probeFirewallDeep } = await import('@yanshekki/core');
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
    const { firewallSetEnabled } = await import('@yanshekki/core');
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
    const { firewallDenyIp } = await import('@yanshekki/core');
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
    const { firewallDeleteDenyIp } = await import('@yanshekki/core');
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
    const { firewallDeleteRuleNumber } = await import('@yanshekki/core');
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
    const { listFirewallPortChips, YSK_SERVICE_PORTS } = await import('@yanshekki/shared');
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
    const { firewallAllowPort } = await import('@yanshekki/core');
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

  return false;
}
