/**
 * CLI: vpn — full parity with panel VPN surface.
 *
 *   status | monitor | ensure | presets
 *   peers list|add|delete|config
 *   clients list|import|up|down|delete|autostart
 *   firewall open
 */
import { createVpnService, parseEngine, syncServiceExposure, vpnPortBindings } from 'ysk-server-core';
import { readFileSync } from 'node:fs';
import { cliPositionals } from '../cli-argv.js';
import type { AppContext } from '../app-context.js';

export type CliHelpers = {
  printJson: (data: unknown) => void;
  getOpt: (args: string[], name: string) => string | undefined;
  hasFlag: (args: string[], name: string) => boolean;
  wantsHostExecute: (args: string[]) => boolean;
  exitFromResult: (r: {
    ok?: boolean;
    blocked?: boolean;
    requiresExecute?: boolean;
  }) => number;
};

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

export async function runVpnCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = cliPositionals(args);
  // tokens[0] === 'vpn'
  const sub = tokens[1] ?? 'status';
  const vpn = createVpnService(ctx.dataDir, ctx.host);

  if (sub === 'status' || sub === 'info') {
    const st = await vpn.status();
    const serverPeers = [
      ...vpn.listServerPeers('wireguard'),
      ...vpn.listServerPeers('openvpn'),
      ...vpn.listServerPeers('outline'),
    ];
    const clientProfiles = await vpn.refreshClientStatuses(vpn.listClientProfiles());
    h.printJson({
      ok: true,
      ...st,
      serverPeers,
      clientProfiles,
      portPresets: vpn.portPresets(),
    });
    return 0;
  }

  if (sub === 'monitor') {
    const engineRaw = h.getOpt(args, '--engine');
    const engine = engineRaw ? parseEngine(engineRaw) : undefined;
    const snap = await vpn.monitor(engine ? { engine } : undefined);
    h.printJson({ ok: true, ...snap });
    return 0;
  }

  if (sub === 'presets' || sub === 'port-presets') {
    const engineRaw = h.getOpt(args, '--engine');
    const engine = engineRaw ? parseEngine(engineRaw) : undefined;
    h.printJson({
      ok: true,
      items: vpn.portPresets(engine),
    });
    return 0;
  }

  if (sub === 'ensure' || sub === 'server-ensure') {
    const blocked = needExecute(
      h,
      args,
      'Plan only: pass --execute (and YSK_EXECUTE=1) to apply VPN server config on the host.',
    );
    if (blocked !== null) return blocked;

    const engine = parseEngine(h.getOpt(args, '--engine') ?? 'wireguard');
    const portRaw = h.getOpt(args, '--port') ?? h.getOpt(args, '--listen-port');
    const listenPort = portRaw ? Number(portRaw) : undefined;
    const protoRaw = h.getOpt(args, '--proto');
    const proto = protoRaw === 'tcp' ? 'tcp' : protoRaw === 'udp' ? 'udp' : undefined;
    const accessModeRaw = h.getOpt(args, '--access-mode');
    const accessMode =
      accessModeRaw === 'full' || accessModeRaw === 'lan' || accessModeRaw === 'custom'
        ? accessModeRaw
        : undefined;
    const lanCidrs = h.getOpt(args, '--lan-cidrs')?.split(',').map((s) => s.trim()).filter(Boolean);
    const customCidrs = h
      .getOpt(args, '--custom-cidrs')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const r = await vpn.ensureServer({
      engine,
      listenPort: Number.isFinite(listenPort) ? listenPort : undefined,
      endpoint: h.getOpt(args, '--endpoint'),
      dns: h.getOpt(args, '--dns'),
      proto,
      accessMode,
      lanCidrs,
      customCidrs,
    });
    h.printJson(r);
    return h.exitFromResult(r);
  }

  if (sub === 'stop') {
    const blocked = needExecute(
      h,
      args,
      'Plan only: pass --execute (and YSK_EXECUTE=1) to stop the VPN server on the host.',
    );
    if (blocked !== null) return blocked;
    const engine = parseEngine(h.getOpt(args, '--engine') ?? 'wireguard');
    const r = await vpn.stopServer({ engine });
    h.printJson(r);
    return h.exitFromResult(r);
  }

  if (sub === 'peers' || sub === 'server-clients' || sub === 'server-peers') {
    const action = tokens[2] ?? 'list';
    const engine = parseEngine(h.getOpt(args, '--engine') ?? 'wireguard');

    if (action === 'list') {
      const peers = vpn.listServerPeers(engine);
      h.printJson({ ok: true, engine, peers, meta: { total: peers.length } });
      return 0;
    }

    if (action === 'add' || action === 'create') {
      const blocked = needExecute(h, args, 'Pass --execute to create a peer on the host.');
      if (blocked !== null) return blocked;
      const name = h.getOpt(args, '--name') ?? tokens[3];
      if (!name?.trim()) {
        process.stderr.write(
          'Usage: ysk-server vpn peers add --name NAME [--engine wireguard|openvpn|outline] --execute\n',
        );
        return 2;
      }
      const r = await vpn.addServerPeer({ name: name.trim(), engine });
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'delete' || action === 'rm' || action === 'remove') {
      const blocked = needExecute(h, args, 'Pass --execute to delete a peer on the host.');
      if (blocked !== null) return blocked;
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vpn peers delete --id PEER_ID --execute\n');
        return 2;
      }
      const r = await vpn.deleteServerPeer(id.trim());
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'config' || action === 'export' || action === 'conf') {
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vpn peers config --id PEER_ID [--out FILE]\n');
        return 2;
      }
      const conf = vpn.getServerPeerConfig(id.trim());
      if (!conf) {
        h.printJson({ ok: false, notes: ['Peer config not found'] });
        return 4;
      }
      const out = h.getOpt(args, '--out');
      if (out) {
        const { writeFileSync } = await import('node:fs');
        writeFileSync(out, conf.config.endsWith('\n') ? conf.config : conf.config + '\n', 'utf8');
        h.printJson({ ok: true, filename: conf.filename, written: out });
        return 0;
      }
      if (h.hasFlag(args, '--raw') || !h.hasFlag(args, '--json')) {
        process.stdout.write(conf.config.endsWith('\n') ? conf.config : conf.config + '\n');
        return 0;
      }
      h.printJson({ ok: true, filename: conf.filename, config: conf.config });
      return 0;
    }

    process.stderr.write(
      'Usage: ysk-server vpn peers list|add|delete|config [--engine …] [--name …] [--id …] [--execute]\n',
    );
    return 2;
  }

  if (sub === 'clients' || sub === 'client' || sub === 'profiles') {
    const action = tokens[2] ?? 'list';

    if (action === 'list') {
      const items = await vpn.refreshClientStatuses(vpn.listClientProfiles());
      h.printJson({ ok: true, items, meta: { total: items.length } });
      return 0;
    }

    if (action === 'import' || action === 'add' || action === 'create') {
      const name = h.getOpt(args, '--name') ?? tokens[3];
      const confPath = h.getOpt(args, '--file') ?? h.getOpt(args, '--conf-file');
      const confInline = h.getOpt(args, '--conf');
      if (!name?.trim()) {
        process.stderr.write(
          'Usage: ysk-server vpn clients import --name NAME --file PATH [--engine …] [--autostart] \n',
        );
        return 2;
      }
      let conf = confInline;
      if (!conf && confPath) {
        try {
          conf = readFileSync(confPath, 'utf8');
        } catch (e) {
          h.printJson({
            ok: false,
            notes: [e instanceof Error ? e.message : String(e)],
          });
          return 1;
        }
      }
      if (!conf?.trim()) {
        process.stderr.write('Provide --file PATH or --conf "…" with client config text.\n');
        return 2;
      }
      const engineRaw = h.getOpt(args, '--engine');
      const r = await vpn.importClientProfile({
        name: name.trim(),
        conf,
        engine: engineRaw ? parseEngine(engineRaw) : undefined,
        autostart: h.hasFlag(args, '--autostart'),
      });
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'up') {
      const blocked = needExecute(h, args, 'Pass --execute to bring the client profile up.');
      if (blocked !== null) return blocked;
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vpn clients up --id PROFILE_ID --execute\n');
        return 2;
      }
      const r = await vpn.clientUp(id.trim());
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'down') {
      const blocked = needExecute(h, args, 'Pass --execute to bring the client profile down.');
      if (blocked !== null) return blocked;
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vpn clients down --id PROFILE_ID --execute\n');
        return 2;
      }
      const r = await vpn.clientDown(id.trim());
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'delete' || action === 'rm' || action === 'remove') {
      const blocked = needExecute(h, args, 'Pass --execute to delete the client profile.');
      if (blocked !== null) return blocked;
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write('Usage: ysk-server vpn clients delete --id PROFILE_ID --execute\n');
        return 2;
      }
      const r = await vpn.deleteClientProfile(id.trim());
      h.printJson(r);
      return h.exitFromResult(r);
    }

    if (action === 'autostart') {
      const id = h.getOpt(args, '--id') ?? tokens[3];
      if (!id?.trim()) {
        process.stderr.write(
          'Usage: ysk-server vpn clients autostart --id PROFILE_ID --on|--off [--execute]\n',
        );
        return 2;
      }
      const on = h.hasFlag(args, '--on');
      const off = h.hasFlag(args, '--off');
      if (on === off) {
        process.stderr.write('Specify exactly one of --on or --off.\n');
        return 2;
      }
      const r = await vpn.setClientAutostart(id.trim(), on);
      h.printJson(r);
      return h.exitFromResult(r);
    }

    process.stderr.write(
      'Usage: ysk-server vpn clients list|import|up|down|delete|autostart [--id …] [--file …] [--execute]\n',
    );
    return 2;
  }

  if (sub === 'firewall') {
    const action = tokens[2] ?? 'open';
    if (action !== 'open') {
      process.stderr.write(
        'Usage: ysk-server vpn firewall open --port N [--proto udp|tcp|both] [--engine …] --execute\n',
      );
      return 2;
    }
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to open the VPN port via service exposure (ysk-svc).',
    );
    if (blocked !== null) return blocked;

    const portRaw = h.getOpt(args, '--port') ?? tokens[3];
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      process.stderr.write(
        'Usage: ysk-server vpn firewall open --port N [--proto udp|tcp|both] [--engine …] --execute\n',
      );
      return 2;
    }
    const protoRaw = (h.getOpt(args, '--proto') ?? 'udp').toLowerCase();
    const proto =
      protoRaw === 'tcp' ? 'tcp' : protoRaw === 'both' ? 'both' : 'udp';
    const engine = parseEngine(h.getOpt(args, '--engine') ?? 'wireguard');
    const exp = await syncServiceExposure({
      host: ctx.host,
      dataDir: ctx.dataDir,
      serviceId: engine,
      ports: vpnPortBindings(
        port,
        proto === 'both' ? 'both' : proto === 'tcp' ? 'tcp' : 'udp',
      ),
      reason: 'manual',
      requireDecision: false,
    });
    h.printJson({
      ok: exp.ok,
      blocked: exp.blocked,
      notes: exp.notes,
      apply_status: exp.blocked ? 'blocked' : exp.ok ? 'applied' : 'failed',
      port,
      proto,
      engine,
    });
    return h.exitFromResult(exp);
  }

  process.stderr.write(
    'Usage: ysk-server vpn status|monitor|ensure|stop|presets|peers|clients|firewall [--execute] [--json]\n',
  );
  return 2;
}
