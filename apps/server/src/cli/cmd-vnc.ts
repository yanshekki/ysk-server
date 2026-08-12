/**
 * CLI: vnc — full parity with panel VNC surface (except interactive browser canvas).
 *
 *   status | settings
 *   accounts list|create|update|password|start|stop|delete
 *   connection | firewall | novnc start|stop
 *   clients list|create|update|up|down|delete
 *   share create|info|revoke
 *   session mint  (ticket prep for browser/proxy — no live viewer)
 */
import {
  createVncService,
  createVncShareLink,
  getVncShareLink,
  revokeVncShareLink,
} from '@yanshekki/core';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

function needExecute(
  h: CliHelpers,
  args: string[],
  msg: string,
): number | null {
  if (h.wantsHostExecute(args)) return null;
  h.printJson({
    ok: false,
    blocked: true,
    dryRun: true,
    notes: [msg],
  });
  return 3;
}

function optId(h: CliHelpers, args: string[], tokens: string[], at: number): string | undefined {
  return h.getOpt(args, '--id') ?? tokens[at];
}

export async function runVncCommand(
  ctx: AppContext,
  args: string[],
  json: boolean,
  h: CliHelpers,
): Promise<number> {
  void json;
  const tokens = args.filter((a) => !a.startsWith('-'));
  const sub = tokens[1] ?? 'status';
  const vnc = createVncService(ctx.dataDir, ctx.host);

  if (sub === 'status' || sub === 'info') {
    const st = await vnc.status();
    h.printJson({ ok: true, ...st });
    return 0;
  }

  if (sub === 'settings') {
    const action = tokens[2] ?? 'get';
    if (action === 'get' || action === 'show') {
      h.printJson({ ok: true, settings: vnc.loadSettings() });
      return 0;
    }
    if (action === 'set' || action === 'patch') {
      const patch: Record<string, unknown> = {};
      const desktop = h.getOpt(args, '--desktop');
      if (desktop) patch.defaultDesktop = desktop;
      const geometry = h.getOpt(args, '--geometry');
      if (geometry) patch.defaultGeometry = geometry;
      const depthRaw = h.getOpt(args, '--depth');
      if (depthRaw) patch.defaultDepth = Number(depthRaw);
      const rfbBind = h.getOpt(args, '--rfb-bind');
      if (rfbBind === 'localhost' || rfbBind === 'all') patch.defaultRfbBind = rfbBind;
      if (h.hasFlag(args, '--autostart')) patch.defaultAutostart = true;
      if (h.hasFlag(args, '--no-autostart')) patch.defaultAutostart = false;
      const dmin = h.getOpt(args, '--display-min');
      if (dmin) patch.displayMin = Number(dmin);
      const dmax = h.getOpt(args, '--display-max');
      if (dmax) patch.displayMax = Number(dmax);
      if (Object.keys(patch).length === 0) {
        process.stderr.write(
          'Usage: ysk-server vnc settings set [--desktop xfce|terminal] [--geometry WxH] [--depth 24] [--rfb-bind localhost|all] [--autostart|--no-autostart]\n',
        );
        return 2;
      }
      const settings = vnc.saveSettings(patch as Parameters<typeof vnc.saveSettings>[0]);
      h.printJson({ ok: true, settings });
      return 0;
    }
    process.stderr.write('Usage: ysk-server vnc settings get|set [flags]\n');
    return 2;
  }

  if (sub === 'accounts' || sub === 'list') {
    const action = sub === 'list' ? 'list' : (tokens[2] ?? 'list');

    if (action === 'list') {
      const items = await vnc.listAccounts();
      h.printJson({ ok: true, items, meta: { total: items.length } });
      return 0;
    }

    if (action === 'create') {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to create the Linux user + VNC account (needs YSK_EXECUTE=1).',
      );
      if (blocked !== null) return blocked;
      const name = h.getOpt(args, '--name') ?? tokens[3];
      if (!name?.trim()) {
        process.stderr.write(
          'Usage: ysk-server vnc accounts create --name NAME [--password …] [--desktop …] [--geometry …] [--rfb-bind …] [--start] --execute\n',
        );
        return 2;
      }
      try {
        const depthRaw = h.getOpt(args, '--depth');
        const displayRaw = h.getOpt(args, '--display');
        const r = await vnc.createAccount({
          name: name.trim(),
          password: h.getOpt(args, '--password') ?? undefined,
          desktop: (h.getOpt(args, '--desktop') as 'xfce' | 'terminal' | undefined) ?? undefined,
          geometry: h.getOpt(args, '--geometry') ?? undefined,
          depth: depthRaw ? Number(depthRaw) : undefined,
          rfbBind: (h.getOpt(args, '--rfb-bind') as 'localhost' | 'all' | undefined) ?? undefined,
          autostart: h.hasFlag(args, '--autostart') ? true : undefined,
          display: displayRaw ? Number(displayRaw) : undefined,
          start: h.hasFlag(args, '--start'),
        });
        h.printJson(r);
        return h.exitFromResult(r);
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 1;
      }
    }

    if (action === 'update' || action === 'patch') {
      const id = optId(h, args, tokens, 3);
      if (!id?.trim()) {
        process.stderr.write(
          'Usage: ysk-server vnc accounts update --id ID [--name …] [--desktop …] [--geometry …] [--rfb-bind …] [--autostart|--no-autostart]\n',
        );
        return 2;
      }
      const patch: {
        name?: string;
        desktop?: 'xfce' | 'terminal';
        geometry?: string;
        depth?: number;
        rfbBind?: 'localhost' | 'all';
        autostart?: boolean;
      } = {};
      const name = h.getOpt(args, '--name');
      if (name) patch.name = name;
      const desktop = h.getOpt(args, '--desktop');
      if (desktop === 'xfce' || desktop === 'terminal') patch.desktop = desktop;
      const geometry = h.getOpt(args, '--geometry');
      if (geometry) patch.geometry = geometry;
      const depthRaw = h.getOpt(args, '--depth');
      if (depthRaw) patch.depth = Number(depthRaw);
      const rfbBind = h.getOpt(args, '--rfb-bind');
      if (rfbBind === 'localhost' || rfbBind === 'all') patch.rfbBind = rfbBind;
      if (h.hasFlag(args, '--autostart')) patch.autostart = true;
      if (h.hasFlag(args, '--no-autostart')) patch.autostart = false;
      try {
        const r = await vnc.updateAccount(id.trim(), patch);
        h.printJson(r);
        return h.exitFromResult(r);
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 4;
      }
    }

    if (action === 'password' || action === 'passwd') {
      const blocked = needExecute(h, args, 'Pass --execute to set VNC password on the host.');
      if (blocked !== null) return blocked;
      const id = optId(h, args, tokens, 3);
      const password = h.getOpt(args, '--password') ?? tokens[4];
      if (!id?.trim() || !password) {
        process.stderr.write(
          'Usage: ysk-server vnc accounts password --id ID --password SECRET --execute\n',
        );
        return 2;
      }
      try {
        const r = await vnc.setPassword(id.trim(), password);
        h.printJson(r);
        return h.exitFromResult(r);
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 1;
      }
    }

    if (action === 'start' || action === 'stop' || action === 'delete' || action === 'rm') {
      const id = optId(h, args, tokens, 3);
      if (!id?.trim()) {
        process.stderr.write(`Usage: ysk-server vnc accounts ${action} --id ACCOUNT_ID --execute\n`);
        return 2;
      }
      const blocked = needExecute(h, args, `Pass --execute to ${action} VNC account on the host.`);
      if (blocked !== null) return blocked;
      try {
        let r;
        if (action === 'start') r = await vnc.startAccount(id.trim());
        else if (action === 'stop') r = await vnc.stopAccount(id.trim());
        else
          r = await vnc.deleteAccount(id.trim(), {
            removeLinuxUser: h.hasFlag(args, '--purge-user'),
          });
        h.printJson(r);
        return h.exitFromResult(r);
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 1;
      }
    }

    process.stderr.write(
      'Usage: ysk-server vnc accounts list|create|update|password|start|stop|delete [--id …] [--name …] [--execute]\n',
    );
    return 2;
  }

  if (sub === 'firewall') {
    const id = optId(h, args, tokens, 2);
    if (!id?.trim()) {
      process.stderr.write('Usage: ysk-server vnc firewall --id ACCOUNT_ID --execute\n');
      return 2;
    }
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to open the RFB port in UFW (ysk-svc:vnc-…).',
    );
    if (blocked !== null) return blocked;
    const r = await vnc.openFirewallForAccount(id.trim());
    h.printJson(r);
    return h.exitFromResult(r);
  }

  if (sub === 'novnc') {
    const action = tokens[2] ?? 'status';
    const id = optId(h, args, tokens, 3);
    if (!id?.trim() || (action !== 'start' && action !== 'stop')) {
      process.stderr.write('Usage: ysk-server vnc novnc start|stop --id ACCOUNT_ID --execute\n');
      return 2;
    }
    const blocked = needExecute(h, args, `Pass --execute to ${action} noVNC for the account.`);
    if (blocked !== null) return blocked;
    const r =
      action === 'start'
        ? await vnc.startNovncForAccount(id.trim())
        : await vnc.stopNovncForAccount(id.trim());
    h.printJson(r);
    return h.exitFromResult(r);
  }

  if (sub === 'connection' || sub === 'connect-info') {
    const id = optId(h, args, tokens, 2);
    if (!id?.trim()) {
      process.stderr.write('Usage: ysk-server vnc connection --id ACCOUNT_ID\n');
      return 2;
    }
    try {
      const r = await vnc.getConnection(id.trim());
      h.printJson(r);
      return r.ok ? 0 : 1;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 4;
    }
  }

  if (sub === 'clients' || sub === 'client' || sub === 'profiles') {
    const action = tokens[2] ?? 'list';

    if (action === 'list') {
      const items = vnc.listClientProfiles();
      h.printJson({ ok: true, items, meta: { total: items.length } });
      return 0;
    }

    if (action === 'create' || action === 'add') {
      const name = h.getOpt(args, '--name') ?? tokens[3];
      const host = h.getOpt(args, '--host');
      const portRaw = h.getOpt(args, '--port');
      if (!name?.trim() || !host?.trim() || !portRaw) {
        process.stderr.write(
          'Usage: ysk-server vnc clients create --name NAME --host HOST --port N [--path user_reachable|server_proxy] [--password …]\n',
        );
        return 2;
      }
      const port = Number(portRaw);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        process.stderr.write('Invalid --port\n');
        return 2;
      }
      const pathRaw = h.getOpt(args, '--path');
      try {
        const profile = vnc.createClientProfile({
          name: name.trim(),
          host: host.trim(),
          port,
          path:
            pathRaw === 'server_proxy' || pathRaw === 'user_reachable'
              ? pathRaw
              : undefined,
          connectHost: h.getOpt(args, '--connect-host') ?? undefined,
          password: h.getOpt(args, '--password') ?? undefined,
          autostart: h.hasFlag(args, '--autostart'),
        });
        h.printJson({ ok: true, profile });
        return 0;
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 1;
      }
    }

    if (action === 'update' || action === 'patch') {
      const id = optId(h, args, tokens, 3);
      if (!id?.trim()) {
        process.stderr.write(
          'Usage: ysk-server vnc clients update --id ID [--name …] [--host …] [--port …] [--path …]\n',
        );
        return 2;
      }
      const patch: {
        name?: string;
        host?: string;
        port?: number;
        path?: 'user_reachable' | 'server_proxy';
        connectHost?: string | null;
        password?: string | null;
        autostart?: boolean;
      } = {};
      const name = h.getOpt(args, '--name');
      if (name) patch.name = name;
      const host = h.getOpt(args, '--host');
      if (host) patch.host = host;
      const portRaw = h.getOpt(args, '--port');
      if (portRaw) patch.port = Number(portRaw);
      const pathRaw = h.getOpt(args, '--path');
      if (pathRaw === 'server_proxy' || pathRaw === 'user_reachable') patch.path = pathRaw;
      if (h.hasFlag(args, '--clear-connect-host')) patch.connectHost = null;
      else if (h.getOpt(args, '--connect-host') != null)
        patch.connectHost = h.getOpt(args, '--connect-host')!;
      if (h.hasFlag(args, '--clear-password')) patch.password = null;
      else if (h.getOpt(args, '--password') != null)
        patch.password = h.getOpt(args, '--password')!;
      if (h.hasFlag(args, '--autostart')) patch.autostart = true;
      if (h.hasFlag(args, '--no-autostart')) patch.autostart = false;
      try {
        const profile = vnc.updateClientProfile(id.trim(), patch);
        h.printJson({ ok: true, profile });
        return 0;
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 4;
      }
    }

    if (action === 'up') {
      const blocked = needExecute(h, args, 'Pass --execute for client up (may need host tools).');
      if (blocked !== null) return blocked;
      const id = optId(h, args, tokens, 3);
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vnc clients up --id PROFILE_ID --execute\n');
        return 2;
      }
      const pathRaw = h.getOpt(args, '--path');
      const r = await vnc.clientUp(
        id.trim(),
        pathRaw === 'server_proxy' || pathRaw === 'user_reachable' ? pathRaw : undefined,
      );
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'down') {
      const blocked = needExecute(h, args, 'Pass --execute for client down.');
      if (blocked !== null) return blocked;
      const id = optId(h, args, tokens, 3);
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vnc clients down --id PROFILE_ID --execute\n');
        return 2;
      }
      const r = await vnc.clientDown(id.trim());
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'delete' || action === 'rm' || action === 'remove') {
      const id = optId(h, args, tokens, 3);
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vnc clients delete --id PROFILE_ID\n');
        return 2;
      }
      const r = await vnc.deleteClientProfile(id.trim());
      h.printJson(r);
      return h.exitFromResult(r);
    }

    process.stderr.write(
      'Usage: ysk-server vnc clients list|create|update|up|down|delete [--id …] [--name …] [--host …] [--port …]\n',
    );
    return 2;
  }

  if (sub === 'share') {
    const action = tokens[2] ?? 'create';

    if (action === 'create') {
      const kindRaw = h.getOpt(args, '--kind') ?? 'account';
      const kind = kindRaw === 'client' ? 'client' : 'account';
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write(
          'Usage: ysk-server vnc share create --id TARGET_ID [--kind account|client] [--ttl-minutes N] [--full-control]\n',
        );
        return 2;
      }
      try {
        // Resolve label via prepareBrowserSession without requiring live RFB if blocked
        let label = id.trim();
        try {
          const prepared = await vnc.prepareBrowserSession({ kind, id: id.trim() });
          if (prepared.label) label = prepared.label;
        } catch {
          /* use id as label */
        }
        const ttlMin = h.getOpt(args, '--ttl-minutes');
        const ttlMs = ttlMin ? Number(ttlMin) * 60_000 : undefined;
        const share = createVncShareLink({
          dataDir: ctx.dataDir,
          kind,
          targetId: id.trim(),
          label,
          createdBy: 'cli',
          viewOnly: !h.hasFlag(args, '--full-control'),
          ttlMs: Number.isFinite(ttlMs) ? ttlMs : undefined,
        });
        const path = `/vnc?share=${encodeURIComponent(share.token)}`;
        h.printJson({
          ok: true,
          token: share.token,
          path,
          viewOnly: share.viewOnly,
          expiresAt: new Date(share.expiresAt).toISOString(),
          label: share.label,
        });
        return 0;
      } catch (e) {
        h.printJson({
          ok: false,
          notes: [e instanceof Error ? e.message : String(e)],
        });
        return 1;
      }
    }

    if (action === 'info' || action === 'get') {
      const token = h.getOpt(args, '--token') ?? tokens[3];
      if (!token?.trim()) {
        process.stderr.write('Usage: ysk-server vnc share info --token TOKEN\n');
        return 2;
      }
      const share = getVncShareLink(ctx.dataDir, token.trim());
      if (!share) {
        h.printJson({ ok: false, notes: ['share link expired or missing'] });
        return 4;
      }
      h.printJson({
        ok: true,
        label: share.label,
        viewOnly: share.viewOnly,
        kind: share.kind,
        targetId: share.targetId,
        expiresAt: new Date(share.expiresAt).toISOString(),
      });
      return 0;
    }

    if (action === 'revoke' || action === 'delete' || action === 'rm') {
      const token = h.getOpt(args, '--token') ?? tokens[3];
      if (!token?.trim()) {
        process.stderr.write('Usage: ysk-server vnc share revoke --token TOKEN\n');
        return 2;
      }
      const ok = revokeVncShareLink(ctx.dataDir, token.trim());
      h.printJson({ ok, notes: ok ? ['revoked'] : ['share not found'] });
      return ok ? 0 : 4;
    }

    process.stderr.write(
      'Usage: ysk-server vnc share create|info|revoke [--id …] [--token …]\n',
    );
    return 2;
  }

  if (sub === 'session' || sub === 'sessions') {
    const action = tokens[2] ?? 'mint';
    if (action !== 'mint' && action !== 'create' && action !== 'prepare') {
      process.stderr.write(
        'Usage: ysk-server vnc session mint --id TARGET_ID [--kind account|client]\n',
      );
      return 2;
    }
    const kindRaw = h.getOpt(args, '--kind') ?? 'account';
    const kind = kindRaw === 'client' ? 'client' : 'account';
    const id = optId(h, args, tokens, 3);
    if (!id?.trim()) {
      process.stderr.write(
        'Usage: ysk-server vnc session mint --id TARGET_ID [--kind account|client] [--execute]\n',
      );
      return 2;
    }
    // Host may need to start account RFB — honour --execute via ctx.executeEnabled
    try {
      const prepared = await vnc.prepareBrowserSession({ kind, id: id.trim() });
      h.printJson({
        ok: prepared.ok,
        blocked: prepared.blocked,
        requiresExecute: prepared.requiresExecute,
        notes: prepared.notes,
        label: prepared.label,
        rfbHost: prepared.rfbHost,
        rfbPort: prepared.rfbPort,
        hasPasswordHint: Boolean(prepared.passwordHint),
        // Interactive canvas remains panel-only; this mints connection metadata for operators/scripts.
        panelOnly: {
          browserViewer: true,
          note: 'Use panel WS /api/v1/vnc/sessions for ticketed browser proxy; CLI exposes prepare metadata only.',
        },
      });
      return prepared.ok ? 0 : prepared.blocked ? 3 : 1;
    } catch (e) {
      h.printJson({
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
      });
      return 1;
    }
  }

  process.stderr.write(
    'Usage: ysk-server vnc status|settings|accounts|connection|firewall|novnc|clients|share|session [--execute] [--json]\n',
  );
  return 2;
}
