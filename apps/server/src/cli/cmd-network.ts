/**
 * CLI: network — service exposure + real-ip (panel Network / System).
 *
 *   exposure list|get|put|sync
 *   real-ip status|set|refresh   (also top-level `real-ip`)
 */
import {
  listDesired,
  getServiceExposureStatus,
  putServiceExposure,
  syncServiceExposure,
  loadRealIpConfig,
  listRealIpProviders,
  realIpProviderSummary,
  patchRealIpConfig,
  applyRealIpArtifacts,
  refreshRealIpCidrs,
} from 'ysk-server-core';
import { YSK_SERVICE_PORTS, defaultPortsForService } from 'ysk-server-shared';
import { cliPositionals } from '../cli-argv.js';
import type { AppContext } from '../app-context.js';
import type { CliHelpers } from './cmd-vpn.js';

function needExecute(
  h: CliHelpers,
  args: string[],
  msg: string,
): number | null {
  if (h.wantsHostExecute(args)) return null;
  h.printJson({ ok: false, blocked: true, dryRun: true, notes: [msg] });
  return 3;
}

/** Host UFW probe may throw FORBIDDEN without EXECUTE — degrade to desired-only. */
async function safeExposureStatus(
  ctx: AppContext,
  serviceId: string,
  notes: string[],
): Promise<Record<string, unknown>> {
  try {
    return (await getServiceExposureStatus(
      ctx.host,
      ctx.dataDir,
      serviceId,
    )) as unknown as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (notes.length < 3) notes.push(msg.slice(0, 200));
    const { ensureDesired, loadExposureStore } = await import('ysk-server-core');
    const store = loadExposureStore(ctx.dataDir);
    const desired = ensureDesired(store, serviceId);
    return {
      desired,
      liveRules: [],
      inSync: false,
      defaultMode: desired.mode,
      blockedProbe: true,
    };
  }
}

export async function runNetworkCommand(
  ctx: AppContext,
  args: string[],
  _json: boolean,
  h: CliHelpers,
): Promise<number> {
  void _json;
  const tokens = cliPositionals(args);
  // tokens[0] === 'network' | 'real-ip' | 'exposure'
  const root = tokens[0];

  if (root === 'real-ip') {
    return runRealIp(ctx, args, tokens.slice(1), h);
  }

  const sub = tokens[1] ?? 'exposure';

  if (sub === 'exposure' || sub === 'service-exposure' || sub === 'svc') {
    return runExposure(ctx, args, tokens.slice(2), h);
  }

  if (sub === 'real-ip') {
    return runRealIp(ctx, args, tokens.slice(2), h);
  }

  // bare `network` → exposure list
  if (tokens.length <= 1) {
    return runExposure(ctx, args, ['list'], h);
  }

  process.stderr.write(
    'Usage: ysk-server network exposure list|get|put|sync\n' +
      '       ysk-server network real-ip status|set|refresh\n' +
      '       ysk-server real-ip status|set|refresh\n',
  );
  return 2;
}

async function runExposure(
  ctx: AppContext,
  args: string[],
  tokens: string[],
  h: CliHelpers,
): Promise<number> {
  const action = tokens[0] ?? 'list';

  if (action === 'list' || action === 'ls' || action === 'status') {
    const desired = listDesired(ctx.dataDir);
    const known = [...new Set(YSK_SERVICE_PORTS.map((p) => p.service))];
    const items = [];
    const notes: string[] = [];
    for (const sid of known) {
      items.push({
        serviceId: sid,
        ...(await safeExposureStatus(ctx, sid, notes)),
        catalogPorts: defaultPortsForService(sid),
      });
    }
    for (const d of desired) {
      if (known.includes(d.serviceId)) continue;
      items.push({
        serviceId: d.serviceId,
        ...(await safeExposureStatus(ctx, d.serviceId, notes)),
      });
    }
    h.printJson({
      ok: true,
      items,
      meta: { total: items.length },
      notes: notes.slice(0, 5),
    });
    return 0;
  }

  if (action === 'get' || action === 'show') {
    const serviceId = h.getOpt(args, '--service') ?? h.getOpt(args, '--id') ?? tokens[1];
    if (!serviceId?.trim()) {
      process.stderr.write('Usage: ysk-server network exposure get --service SERVICE_ID\n');
      return 2;
    }
    const notes: string[] = [];
    const st = await safeExposureStatus(ctx, serviceId.trim(), notes);
    h.printJson({ ok: true, serviceId: serviceId.trim(), ...st, notes });
    return 0;
  }

  if (action === 'put' || action === 'set') {
    const serviceId = h.getOpt(args, '--service') ?? h.getOpt(args, '--id') ?? tokens[1];
    if (!serviceId?.trim()) {
      process.stderr.write(
        'Usage: ysk-server network exposure put --service ID --mode private|public|restricted [--allow-from CIDR,…] [--execute]\n',
      );
      return 2;
    }
    const modeRaw = h.getOpt(args, '--mode');
    const mode =
      modeRaw === 'private' || modeRaw === 'public' || modeRaw === 'restricted'
        ? modeRaw
        : undefined;
    const allowFrom = h
      .getOpt(args, '--allow-from')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allowCountries = h
      .getOpt(args, '--allow-countries')
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const sync = !h.hasFlag(args, '--no-sync');
    if (sync) {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to sync UFW/ysk-svc (or use --no-sync to only write desired state).',
      );
      if (blocked !== null) return blocked;
    }
    // ports from --ports "role:port:proto,…"
    const portsRaw = h.getOpt(args, '--ports');
    const ports = portsRaw
      ? portsRaw.split(',').map((part) => {
          const [role, port, proto] = part.split(':').map((s) => s.trim());
          return { role: role || 'main', port: port || '0', proto: proto || 'tcp' };
        })
      : undefined;

    const result = await putServiceExposure({
      host: ctx.host,
      dataDir: ctx.dataDir,
      serviceId: serviceId.trim(),
      mode,
      ports: ports as never,
      allowFrom,
      allowCountries,
      sync,
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  if (action === 'sync') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to apply service exposure sync on the host.',
    );
    if (blocked !== null) return blocked;
    const serviceId =
      h.getOpt(args, '--service') ?? h.getOpt(args, '--id') ?? tokens[1];
    if (!serviceId?.trim()) {
      process.stderr.write(
        'Usage: ysk-server network exposure sync --service ID [--decision keep-private|public|restricted] --execute\n',
      );
      return 2;
    }
    const decisionRaw = h.getOpt(args, '--decision') ?? h.getOpt(args, '--exposure-decision');
    const exposureDecision =
      decisionRaw === 'keep-private' ||
      decisionRaw === 'public' ||
      decisionRaw === 'restricted'
        ? decisionRaw
        : undefined;
    const allowFrom = h
      .getOpt(args, '--allow-from')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const allowCountries = h
      .getOpt(args, '--allow-countries')
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const result = await syncServiceExposure({
      host: ctx.host,
      dataDir: ctx.dataDir,
      serviceId: serviceId.trim(),
      reason: (h.getOpt(args, '--reason') as never) ?? 'manual',
      exposureDecision,
      allowFrom,
      allowCountries,
      requireDecision: h.hasFlag(args, '--require-decision'),
    });
    h.printJson(result);
    return h.exitFromResult(result);
  }

  process.stderr.write(
    'Usage: ysk-server network exposure list|get|put|sync [--service …] [--mode …] [--execute]\n',
  );
  return 2;
}

async function runRealIp(
  ctx: AppContext,
  args: string[],
  tokens: string[],
  h: CliHelpers,
): Promise<number> {
  const action = tokens[0] ?? 'status';

  if (action === 'status' || action === 'get' || action === 'info') {
    const config = loadRealIpConfig(ctx.dataDir);
    h.printJson({
      ok: true,
      config,
      providers: realIpProviderSummary(),
      catalog: listRealIpProviders().map((p) => ({
        id: p.id,
        label: p.label,
        clientIpHeader: p.clientIpHeader,
        hasSources: Boolean(p.cidrSources?.ipv4 || p.cidrSources?.ipv6),
        snapshotCount: p.snapshotIpv4.length + p.snapshotIpv6.length,
      })),
    });
    return 0;
  }

  if (action === 'set' || action === 'patch') {
    const defaultProvider = h.getOpt(args, '--provider') ?? h.getOpt(args, '--default-provider');
    const trustMode = h.getOpt(args, '--trust-mode');
    const enabledProviders = h
      .getOpt(args, '--enabled-providers')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const customCidrs = h
      .getOpt(args, '--custom-cidrs')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const customHeader = h.getOpt(args, '--custom-header');
    const config = patchRealIpConfig(ctx.dataDir, {
      defaultProvider: defaultProvider as never,
      trustMode: trustMode as never,
      enabledProviders: enabledProviders as never,
      customCidrs: customCidrs as never,
      customHeader: customHeader as never,
    });
    // Applying artifacts to host needs execute for real write
    let art: { notes: string[]; written?: unknown } = { notes: [] };
    if (h.wantsHostExecute(args) || h.hasFlag(args, '--apply-artifacts')) {
      const blocked = needExecute(
        h,
        args,
        'Pass --execute to write Real-IP nginx/apache artifacts on the host.',
      );
      if (blocked !== null) {
        h.printJson({ ok: true, config, dryRun: true, notes: ['Config saved; host artifacts not applied'] });
        return 0;
      }
      art = await applyRealIpArtifacts({
        dataDir: ctx.dataDir,
        host: ctx.host,
        enableApacheRemoteIp: h.hasFlag(args, '--apache-remote-ip'),
      });
    }
    h.printJson({
      ok: true,
      config,
      notes: art.notes,
      written: art.written,
    });
    return 0;
  }

  if (action === 'refresh') {
    const blocked = needExecute(
      h,
      args,
      'Pass --execute to refresh CDN CIDR snapshots and re-apply Real-IP artifacts.',
    );
    if (blocked !== null) return blocked;
    const r = await refreshRealIpCidrs({ dataDir: ctx.dataDir, host: ctx.host });
    const art = await applyRealIpArtifacts({ dataDir: ctx.dataDir, host: ctx.host });
    h.printJson({
      ok: r.ok,
      config: r.config,
      updated: r.updated,
      notes: [...r.notes, ...art.notes],
    });
    return r.ok ? 0 : 1;
  }

  process.stderr.write(
    'Usage: ysk-server real-ip status|set|refresh [--provider …] [--execute]\n',
  );
  return 2;
}

/** Top-level `real-ip` entry */
export async function runRealIpCommand(
  ctx: AppContext,
  args: string[],
  json: boolean,
  h: CliHelpers,
): Promise<number> {
  void json;
  const tokens = cliPositionals(args);
  return runRealIp(ctx, args, tokens.slice(1), h);
}
