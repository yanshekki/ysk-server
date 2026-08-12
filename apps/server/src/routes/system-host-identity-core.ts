/**
 * Host overview / hostname / timezone (Wave R3).
 * Extracted from system-host-identity.ts. Behaviour preserved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tl } from '@yanshekki/shared';
import type { AppContext } from '../app-context.js';
import {
  getBearer,
  readBody,
  sendJson,
} from '../http/util.js';

export async function handleSystemHostIdentityCoreRoutes(
  ctx: AppContext,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  if (method === 'GET' && url.pathname === '/api/v1/system/host') {
    ctx.auth.authenticate(getBearer(req));
    const { collectHostOverview } = await import('@yanshekki/core');
    sendJson(res, 200, await collectHostOverview(ctx.host));
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/host-identity') {
    ctx.auth.authenticate(getBearer(req));
    const { collectHostOverview } = await import('@yanshekki/core');
    const o = await collectHostOverview(ctx.host);
    sendJson(res, 200, {
      hostname: o.identity.hostname,
      timezone: o.identity.timezone,
      prettyHostname: o.identity.prettyHostname,
      executeEnabled: o.caps.executeEnabled,
      isRoot: o.caps.isRoot,
    });
    return true;
  }
  if (method === 'GET' && url.pathname === '/api/v1/system/timezones') {
    ctx.auth.authenticate(getBearer(req));
    const { listHostTimezones, mergeTimezoneOptions, collectHostOverview } = await import(
      '@yanshekki/core'
    );
    const listed = await listHostTimezones(ctx.host);
    let current: string | null = null;
    try {
      const o = await collectHostOverview(ctx.host);
      current = o.identity.timezone;
    } catch {
      /* ignore */
    }
    sendJson(res, 200, {
      timezones: mergeTimezoneOptions(listed.timezones, current),
      current,
      source: listed.source,
    });
    return true;
  }
  if (method === 'POST' && url.pathname === '/api/v1/system/host-identity') {
    const user = ctx.auth.authenticate(getBearer(req));
    const raw = await readBody(req);
    const data = JSON.parse(raw || '{}') as {
      hostname?: string;
      timezone?: string;
      prettyHostname?: string;
    };
    const notes: string[] = [];
    if (!ctx.host.executeEnabled() || !ctx.host.isRoot()) {
      sendJson(res, 422, {
        ok: false,
        blocked: true,
        notes: [tl('notes.auto.n1190')],
      });
      return true;
    }
    let anyFail = false;
    if (data.hostname?.trim()) {
      const { setStaticHostname } = await import('@yanshekki/core');
      const r = await setStaticHostname(ctx.host, data.hostname.trim());
      if (r.ok) {
        notes.push(tl('system.identitySetHostname', { name: data.hostname.trim() }));
      } else {
        anyFail = true;
        notes.push(tl('notes.auto.t0795', { v0: r.detail }));
      }
    }
    // Always allow setting/clearing pretty (display) name when key is present
    if (data.prettyHostname !== undefined) {
      const { setPrettyHostname } = await import('@yanshekki/core');
      const pretty = String(data.prettyHostname ?? '').trim();
      const r = await setPrettyHostname(ctx.host, pretty);
      if (r.ok) {
        notes.push(
          pretty
            ? tl('system.identitySetPretty', { name: pretty })
            : tl('system.identityClearPretty'),
        );
      } else {
        anyFail = true;
        notes.push(tl('notes.auto.t0796', { v0: r.detail }));
      }
    }
    if (data.timezone?.trim()) {
      const tz = data.timezone.trim();
      const { isValidTimezoneId, listHostTimezones } = await import('@yanshekki/core');
      if (!isValidTimezoneId(tz)) {
        anyFail = true;
        notes.push(tl('notes.auto.t0797', { v0: 'invalid timezone id' }));
      } else {
        // Prefer host list; still allow well-formed IANA if list is fallback/short
        const listed = await listHostTimezones(ctx.host);
        if (listed.source === 'timedatectl' && !listed.timezones.includes(tz)) {
          anyFail = true;
          notes.push(tl('notes.auto.t0797', { v0: `not in host timezone list: ${tz}` }));
        } else {
          const r = await ctx.host.runCommand(['timedatectl', 'set-timezone', tz], {
            timeoutMs: 10_000,
          });
          if (r.exitCode === 0) {
            notes.push(tl('system.identitySetTimezone', { tz }));
          } else {
            anyFail = true;
            notes.push(tl('notes.auto.t0797', { v0: r.stderr || r.stdout }));
          }
        }
      }
    }
    ctx.audit.append({
      actor: user.username,
      action: 'system.host_identity',
      detail: data,
      ok: !anyFail,
    });
    sendJson(res, anyFail ? 422 : 200, { ok: !anyFail, notes });
    return true;
  }

  return false;
}
