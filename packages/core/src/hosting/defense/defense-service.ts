import { tl } from 'ysk-server-shared';
/**
 * Defense Center service — status, presets, ban/unban.
 */

import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { isValidIp, normalizeIp } from '../../net/ip.js';
import { applyFail2ban, fail2banBannedIps, fail2banUnban } from '../system-apply.js';
import { syncNginxConfigs } from '../nginx-sync.js';
import { buildPresetActions, getDefensePreset, listDefensePresets } from './presets.js';
import { writeDefenseNginxLimits, readActiveNginxLimitNotes } from './nginx-limits.js';
import { collectDefenseSignals } from './signals.js';
import {
  countAutoBansLastHour,
  humanizeFail2ban,
  humanizeFirewall,
  ipMatchesWhitelist,
  loadAutoBanPolicy,
  suggestedAutoBanForPreset,
  updateAutoBanPolicy } from './auto-ban.js';
import type {
  DefenseApplyResult,
  DefensePresetId,
  DefenseStatus,
  BanEntry } from './types.js';

const SETTINGS_KEY = 'defense_active_preset';
const TIMELINE_KEY = 'defense_timeline';

function loadPresetId(db: JsonStore): DefensePresetId {
  const v = db.snapshot.settings?.[SETTINGS_KEY];
  if (v === 'hardened' || v === 'under_attack' || v === 'emergency' || v === 'daily') return v;
  return 'daily';
}

function savePresetId(db: JsonStore, id: DefensePresetId): void {
  db.snapshot.settings[SETTINGS_KEY] = id;
  db.persist();
}

function pushTimeline(
  db: JsonStore,
  entry: { at: string; kind: string; title: string; detail?: string },
): void {
  let list: Array<Record<string, unknown>> = [];
  try {
    const raw = db.snapshot.settings?.[TIMELINE_KEY];
    if (raw) list = JSON.parse(raw) as Array<Record<string, unknown>>;
  } catch {
    list = [];
  }
  list.unshift(entry);
  db.snapshot.settings[TIMELINE_KEY] = JSON.stringify(list.slice(0, 200));
  db.persist();
}

export function listDefenseTimeline(
  db: JsonStore,
  hours = 24,
): Array<{ at: string; kind: string; title: string; detail?: string }> {
  let list: Array<{ at: string; kind: string; title: string; detail?: string }> = [];
  try {
    const raw = db.snapshot.settings?.[TIMELINE_KEY];
    if (raw) list = JSON.parse(raw);
  } catch {
    list = [];
  }
  const cut = Date.now() - hours * 3600_000;
  return list.filter((e) => new Date(e.at).getTime() >= cut).slice(0, 100);
}

export async function getDefenseStatus(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  requestCountLastMinute?: number;
}): Promise<DefenseStatus> {
  let weights: import('./signals.js').SignalWeights | undefined;
  let threatThresholds: import('./signals.js').ThreatLevelThresholds | undefined;
  try {
    const { loadDefenseAutomation } = await import('./automation.js');
    const { threatThresholdsFromAutoPreset } = await import('./signals.js');
    const auto = loadDefenseAutomation(input.db);
    weights = auto.signalWeights;
    threatThresholds = threatThresholdsFromAutoPreset(auto.autoPreset);
  } catch {
    /* */
  }
  const sig = await collectDefenseSignals({
    host: input.host,
    requestCountLastMinute: input.requestCountLastMinute,
    weights,
    threatThresholds });
  const activePreset = loadPresetId(input.db);
  const preset = getDefensePreset(activePreset);
  const ngx = readActiveNginxLimitNotes(input.dataDir);

  const suggestions: DefenseStatus['suggestions'] = [];
  if (sig.threatLevel === 'under_attack' || sig.threatLevel === 'critical') {
    suggestions.push({
      id: 'switch-ua',
      title: tl('notes.auto.n0822'),
      body: tl('notes.auto.n0899'),
      action: 'preset:under_attack' });
  }
  if (sig.fail2ban.active !== 'active' && sig.fail2ban.installed) {
    suggestions.push({
      id: 'start-f2b',
      title: tl('notes.auto.n0285'),
      body: tl('notes.auto.n0604'),
      action: 'href:/fail2ban' });
  }
  if (!input.host.executeEnabled()) {
    suggestions.push({
      id: 'exec',
      title: tl('notes.auto.n0025'),
      body: tl('notes.auto.n0645'),
      action: 'href:/system/readiness' });
  }
  if (sig.threatLevel === 'low' && activePreset === 'under_attack') {
    suggestions.push({
      id: 'relax',
      title: tl('notes.auto.n0646'),
      body: tl('notes.auto.n0614'),
      action: 'preset:daily' });
  }

  const autoBan = loadAutoBanPolicy(input.db);
  const autoBansLastHour = countAutoBansLastHour(autoBan);
  if (autoBan.enabled && autoBan.pausedReason === 'circuit_breaker') {
    suggestions.push({
      id: 'auto-ban-cb',
      title: tl('notes.auto.n0026'),
      body: tl('notes.auto.t0545', { v0: (autoBan.maxAutoBansPerHour) }) });
  } else if (!autoBan.enabled && (sig.threatLevel === 'under_attack' || sig.threatLevel === 'critical')) {
    suggestions.push({
      id: 'enable-auto-ban',
      title: tl('notes.auto.n0828'),
      body: tl('notes.auto.n0605'),
      action: 'tab:bans' });
  }

  // Persist last threat for dashboard notifications
  try {
    input.db.snapshot.settings.defense_last_threat = sig.threatLevel;
    input.db.persist();
  } catch {
    /* ignore */
  }

  const exec = input.host.executeEnabled();
  const root = input.host.isRoot();
  const fwLabel = humanizeFirewall(sig.firewall.active, sig.firewall.installed, root);
  const f2bLabel = humanizeFail2ban(sig.fail2ban.active, sig.fail2ban.installed);
  const applyLabel = exec
    ? root
      ? { short: tl('notes.auto.n0611'), tone: 'ok' as const }
      : { short: tl('ops.blocked.needRoot'), tone: 'warn' as const, detail: tl('notes.tpl.hasExecuteNotRoot') }
    : {
        short: tl('notes.auto.n0610'),
        tone: 'warn' as const,
        detail: tl('notes.auto.n0213') };
  const autoLabel = !autoBan.enabled
    ? { short: tl('notes.auto.n1522'), tone: 'default' as const }
    : autoBan.pausedReason
      ? { short: tl('notes.auto.n0785'), tone: 'warn' as const, detail: autoBan.pausedReason }
      : { short: autoBan.mode, tone: 'ok' as const, detail: tl('notes.auto.t0546', { v0: (autoBansLastHour) }) };

  return {
    at: new Date().toISOString(),
    threatLevel: sig.threatLevel,
    score: sig.score,
    signals: sig.signals,
    activePreset,
    presets: listDefensePresets().map((p) => ({
      id: p.id,
      label: p.label,
      short: p.short,
      bullets: p.bullets,
      danger: p.danger })),
    bans: { count: sig.bans.length, items: sig.bans.slice(0, 50) },
    nginxLimits: {
      ...preset.nginx,
      confPath: ngx.confPath,
      exists: ngx.exists },
    firewall: sig.firewall,
    fail2ban: sig.fail2ban,
    labels: {
      firewall: fwLabel,
      fail2ban: f2bLabel,
      apply: applyLabel,
      autoBan: autoLabel },
    autoBan: { ...autoBan, autoBansLastHour },
    protectionMode: sig.protectionMode,
    executeEnabled: exec,
    isRoot: root,
    suggestions,
    notes: sig.notes };
}

export async function applyDefensePreset(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  preset: DefensePresetId;
  /** false = preview only (still writes nothing if false) */
  apply: boolean;
  confirm?: string;
  systemNginx?: boolean;
  /** When true (default for hardened+), align auto-ban with preset suggestion */
  enableAutoBan?: boolean;
}): Promise<DefenseApplyResult> {
  const preset = getDefensePreset(input.preset);
  const actions = buildPresetActions(preset);
  const notes: string[] = [];
  const written: string[] = [];

  if (preset.requireConfirm && input.apply) {
    if (input.confirm !== preset.requireConfirm) {
      return {
        ok: false,
        blocked: true,
        applied: false,
        written: [],
        actions,
        notes: [
          tl('notes.auto.t0547', { v0: (preset.requireConfirm) }),
          tl('notes.auto.n1596'),
        ],
        preset: preset.id };
    }
  }

  if (!input.apply) {
    return {
      ok: true,
      applied: false,
      written: [],
      actions,
      notes: [tl('notes.auto.n1597'), ...actions.map((a) => `• ${a.title}: ${a.detail}`)],
      preset: preset.id };
  }

  // Write nginx zones + inject limit_req into managed vhosts
  const ngx = writeDefenseNginxLimits(input.dataDir, preset.nginx);
  written.push(...ngx.written);
  notes.push(tl('notes.auto.t0548', { v0: (ngx.confPath) }));
  if (ngx.vhostsUpdated?.length) {
    notes.push(tl('notes.auto.t0549', { v0: (ngx.vhostsUpdated.length) }));
  }

  // Write fail2ban jail preference + apply management file
  const f2b = await applyFail2ban({
    dataDir: input.dataDir,
    host: input.host,
    jails: preset.fail2banJails,
    apply: Boolean(input.host.executeEnabled() && input.host.isRoot()) });
  if (Array.isArray(f2b.written)) written.push(...f2b.written);
  notes.push(...(f2b.notes ?? []).slice(0, 6));

  savePresetId(input.db, preset.id);
  notes.push(tl('notes.auto.t0550', { v0: (preset.label) }));

  // Align auto-ban with preset when requested or for non-daily danger presets
  const wantAuto =
    input.enableAutoBan === true ||
    (input.enableAutoBan !== false &&
      (preset.id === 'hardened' || preset.id === 'under_attack' || preset.id === 'emergency'));
  if (wantAuto && preset.id !== 'daily') {
    const sug = suggestedAutoBanForPreset(preset.id);
    updateAutoBanPolicy(input.db, sug);
    notes.push(
      tl('notes.auto.t0551', { v0: (sug.enabled ? tl('notes.tpl.on') : tl('notes.tpl.off')), v1: (sug.mode ?? 'soft'), v2: (sug.method ?? 'fail2ban') }),
    );
  } else if (preset.id === 'daily' && input.enableAutoBan === false) {
    updateAutoBanPolicy(input.db, { enabled: false, mode: 'soft' });
    notes.push(tl('notes.auto.n1329'));
  }

  // Cloudflare Under Attack + optional CF-only UFW when human applies under_attack / emergency
  if (input.apply && (preset.id === 'under_attack' || preset.id === 'emergency')) {
    try {
      const { loadDefenseAutomation } = await import('./automation.js');
      const { enableCloudflareUnderAttack } = await import('./cloudflare-ua.js');
      const { writeAndMaybeApplyCfOnlyUfw } = await import('./cf-ufw.js');
      const auto = loadDefenseAutomation(input.db);
      if (auto.cloudflare.enabled && auto.cloudflare.zones.length) {
        const cf = await enableCloudflareUnderAttack({
          zones: auto.cloudflare.zones,
          dryRun: !(input.host.executeEnabled() && input.host.isRoot()) });
        notes.push(...cf.notes.slice(0, 4));
        for (const row of cf.results ?? []) {
          if (row.errors?.length) notes.push(...row.errors.slice(0, 1));
        }
      } else if (auto.cloudflare.enabled) {
        notes.push(tl('notes.auto.n0897'));
      }
      if (auto.cloudflare.ufwAllowOnlyCf) {
        const u = await writeAndMaybeApplyCfOnlyUfw({
          dataDir: input.dataDir,
          host: input.host,
          keepTcpPorts: auto.cloudflare.ufwKeepTcpPorts,
          apply: Boolean(input.host.executeEnabled() && input.host.isRoot()) });
        notes.push(...u.notes.slice(0, 5));
      }
    } catch {
      /* optional */
    }
  }

  let applied = false;
  const canSys = input.host.executeEnabled() && input.host.isRoot();
  if (canSys && input.systemNginx !== false) {
    const sync = await syncNginxConfigs({
      dataDir: input.dataDir,
      systemConfDir: '/etc/nginx/conf.d',
      host: input.host,
      dryRun: false });
    written.push(...sync.copied);
    notes.push(...sync.notes.slice(0, 4));
    if (sync.tested) {
      const rel = await input.host.runCommand(['systemctl', 'reload', 'nginx'], {
        timeoutMs: 15_000 });
      applied = rel.exitCode === 0;
      notes.push(applied ? tl('notes.auto.n0726') : tl('notes.tpl.nginxReloadFailed', { detail: rel.stderr || rel.stdout }));
    }
  } else {
    notes.push(tl('notes.auto.n0953'));
  }

  pushTimeline(input.db, {
    at: new Date().toISOString(),
    kind: 'preset',
    title: tl('notes.auto.t0552', { v0: (preset.label) }),
    detail: notes.slice(0, 3).join('；') });

  const blocked = !canSys;
  return {
    ok: !blocked || written.length > 0,
    blocked,
    applied,
    written,
    actions,
    notes: [
      ...notes,
      blocked
        ? tl('notes.auto.n1226')
        : applied
          ? tl('notes.auto.n0001')
          : tl('notes.auto.n0007'),
    ],
    preset: preset.id,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot() };
}

export async function defenseBanIp(input: {
  host: HostExecutor;
  db: JsonStore;
  ip: string;
  reason?: string;
  method?: 'fail2ban' | 'ufw' | 'both';
  jail?: string;
  /**
   * When false: dry-run plan only (CLI default).
   * When true/undefined: attempt host ban (panel default = true path via omit or true).
   * CLI should pass execute: true only with --execute.
   */
  execute?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  dryRun?: boolean;
  plan?: string[];
}> {
  const ip = normalizeIp(input.ip.trim()) ?? '';
  if (!ip || !isValidIp(ip)) return { ok: false, notes: [tl('notes.invalidIp46')] };
  const policy = loadAutoBanPolicy(input.db);
  if (ipMatchesWhitelist(ip, policy.whitelist)) {
    return { ok: false, notes: [tl('notes.auto.n1263')] };
  }
  // Also respect automation whitelist
  try {
    const { loadDefenseAutomation } = await import('./automation.js');
    const auto = loadDefenseAutomation(input.db);
    if (ipMatchesWhitelist(ip, auto.autoBan.whitelist)) {
      return { ok: false, notes: [tl('notes.auto.n1334')] };
    }
  } catch {
    /* */
  }
  const method = input.method ?? 'fail2ban';
  const jail = input.jail || 'sshd';
  const plan: string[] = [];
  if (method === 'fail2ban' || method === 'both') {
    plan.push(`fail2ban-client set ${jail} banip ${ip}`);
  }
  if (method === 'ufw' || method === 'both') {
    plan.push(`ufw deny from ${ip}`);
  }
  // CLI dry-run: execute === false only (panel omits flag → still ban)
  if (input.execute === false) {
    return {
      ok: true,
      dryRun: true,
      plan,
      notes: [
        tl('notes.auto.n0273'),
        ...plan,
      ] };
  }
  const notes: string[] = [];
  if (!input.host.executeEnabled()) {
    // still record panel ban intent
    recordPanelBan(input.db, ip, input.reason);
    return {
      ok: false,
      blocked: true,
      plan,
      notes: [tl('notes.auto.n1123')] };
  }
  let ok = true;
  if (method === 'fail2ban' || method === 'both') {
    const r = await input.host.runCommand(
      ['fail2ban-client', 'set', jail, 'banip', ip],
      { timeoutMs: 10_000 },
    );
    const banOk = r.exitCode === 0;
    ok = ok && banOk;
    notes.push(banOk ? `fail2ban ban ${ip} @ ${jail}` : tl('notes.auto.t0553', { v0: (r.stderr || r.stdout) }));
  }
  if (method === 'ufw' || method === 'both') {
    const r = await input.host.runCommand(
      ['ufw', 'deny', 'from', ip],
      { timeoutMs: 10_000 },
    );
    const uOk = r.exitCode === 0;
    ok = ok && uOk;
    notes.push(uOk ? `ufw deny from ${ip}` : tl('notes.auto.t0554', { v0: (r.stderr || r.stdout) }));
  }
  recordPanelBan(input.db, ip, input.reason);
  pushTimeline(input.db, {
    at: new Date().toISOString(),
    kind: 'ban',
    title: tl('notes.auto.t0555', { v0: (ip) }),
    detail: input.reason });
  return { ok, notes, plan };
}

export async function defenseUnbanIp(input: {
  host: HostExecutor;
  db: JsonStore;
  ip: string;
  method?: 'fail2ban' | 'ufw' | 'both';
  jail?: string;
  /** false = dry-run (CLI default); omit/true = apply (panel) */
  execute?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  blocked?: boolean;
  dryRun?: boolean;
  plan?: string[];
}> {
  const ip = normalizeIp(input.ip.trim()) ?? '';
  if (!ip || !isValidIp(ip)) return { ok: false, notes: [tl('notes.invalidIp46')] };
  const method = input.method ?? 'fail2ban';
  const jail = input.jail || 'sshd';
  const plan: string[] = [];
  if (method === 'fail2ban' || method === 'both') {
    plan.push(`fail2ban-client set ${jail} unbanip ${ip}`);
  }
  if (method === 'ufw' || method === 'both') {
    plan.push(`ufw delete deny from ${ip}`);
  }
  if (input.execute === false) {
    return {
      ok: true,
      dryRun: true,
      plan,
      notes: [
        tl('notes.auto.n0274'),
        ...plan,
      ] };
  }
  if (!input.host.executeEnabled()) {
    return { ok: false, blocked: true, plan, notes: [tl('notes.auto.n1140')] };
  }
  const notes: string[] = [];
  let ok = true;
  if (method === 'fail2ban' || method === 'both') {
    const r = await fail2banUnban(input.host, jail, ip);
    ok = ok && r.ok;
    notes.push(...(r.notes ?? []));
  }
  if (method === 'ufw' || method === 'both') {
    const r = await input.host.runCommand(['ufw', 'delete', 'deny', 'from', ip], {
      timeoutMs: 10_000 });
    ok = ok && r.exitCode === 0;
    notes.push(
      r.exitCode === 0 ? `ufw delete deny ${ip}` : tl('notes.auto.t0556', { v0: (r.stderr || r.stdout) }),
    );
  }
  // Drop panel ban intent so list stays honest
  try {
    const key = 'defense_panel_bans';
    const raw = input.db.snapshot.settings?.[key];
    if (raw) {
      const list = (JSON.parse(raw) as BanEntry[]).filter((b) => b.ip !== ip);
      input.db.snapshot.settings[key] = JSON.stringify(list.slice(0, 500));
      input.db.persist();
    }
  } catch {
    /* ignore */
  }
  pushTimeline(input.db, {
    at: new Date().toISOString(),
    kind: 'unban',
    title: tl('notes.auto.t0557', { v0: (ip) }) });
  return { ok, notes };
}

function recordPanelBan(db: JsonStore, ip: string, reason?: string): void {
  const key = 'defense_panel_bans';
  let list: BanEntry[] = [];
  try {
    const raw = db.snapshot.settings?.[key];
    if (raw) list = JSON.parse(raw) as BanEntry[];
  } catch {
    list = [];
  }
  list = list.filter((b) => b.ip !== ip);
  list.unshift({
    ip,
    source: 'panel',
    reason,
    at: new Date().toISOString() });
  db.snapshot.settings[key] = JSON.stringify(list.slice(0, 500));
  db.persist();
}

export async function listDefenseBans(input: {
  host: HostExecutor;
  db: JsonStore;
}): Promise<{ items: BanEntry[]; notes: string[] }> {
  const notes: string[] = [];
  let items: BanEntry[] = [];
  try {
    const f = await fail2banBannedIps(input.host);
    items.push(
      ...(f.items ?? []).map((b) => ({
        ip: b.ip,
        source: 'fail2ban' as const,
        jail: b.jail })),
    );
  } catch {
    notes.push(tl('notes.auto.n1439'));
  }
  try {
    const raw = input.db.snapshot.settings?.defense_panel_bans;
    if (raw) {
      const panel = JSON.parse(raw) as BanEntry[];
      for (const b of panel) {
        if (!items.some((x) => x.ip === b.ip && x.source === 'panel')) items.push(b);
      }
    }
  } catch {
    /* ignore */
  }
  return { items: items.slice(0, 100), notes };
}

/**
 * One-shot stack apply: UFW plan + fail2ban jails for current defense preset.
 * Honest: each step may block without YSK_EXECUTE/root; aggregate ok only if all executed ok.
 */
export async function applyDefenseStack(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  execute?: boolean;
  actor?: string;
}): Promise<{
  ok: boolean;
  executed: boolean;
  blocked?: boolean;
  notes: string[];
  steps: Array<{ id: string; ok: boolean; notes: string[] }>;
  requiresExecute: boolean;
  requiresRoot: boolean;
}> {
  const execute = Boolean(input.execute);
  const notes: string[] = [];
  const steps: Array<{ id: string; ok: boolean; notes: string[] }> = [];
  const requiresExecute = !input.host.executeEnabled();
  const requiresRoot = !input.host.isRoot();

  const status = await getDefenseStatus({
    host: input.host,
    db: input.db,
    dataDir: input.dataDir,
  });
  const presetId = status.activePreset ?? 'daily';
  const preset = getDefensePreset(presetId);

  const { applyFirewall, applyFail2ban } = await import('../system-apply.js');
  const fw = await applyFirewall({
    host: input.host,
    dataDir: input.dataDir,
    apply: execute,
  });
  steps.push({
    id: 'firewall',
    ok: Boolean(fw.ok),
    notes: fw.notes ?? [],
  });
  notes.push(...(fw.notes ?? []).map((n) => `[firewall] ${n}`));

  const f2b = await applyFail2ban({
    dataDir: input.dataDir,
    host: input.host,
    apply: execute,
    jails: preset.fail2banJails,
  });
  steps.push({
    id: 'fail2ban',
    ok: Boolean(f2b.ok),
    notes: f2b.notes ?? [],
  });
  notes.push(...(f2b.notes ?? []).map((n) => `[fail2ban] ${n}`));

  // Re-assert nginx limits for current preset (written; apply needs EXECUTE)
  try {
    const r = await applyDefensePreset({
      host: input.host,
      db: input.db,
      dataDir: input.dataDir,
      preset: presetId as import('./types.js').DefensePresetId,
      apply: execute,
    });
    steps.push({
      id: 'preset',
      ok: Boolean(r.ok),
      notes: r.notes ?? [],
    });
    notes.push(...(r.notes ?? []).map((n) => `[preset:${presetId}] ${n}`));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    steps.push({ id: 'preset', ok: false, notes: [msg] });
    notes.push(`[preset] ${msg}`);
  }

  const anyBlocked = Boolean(fw.blocked || f2b.blocked);
  const allOk = steps.every((s) => s.ok);
  const executed = Boolean(
    execute && input.host.executeEnabled() && input.host.isRoot() && (fw.executed || f2b.executed),
  );

  try {
    pushTimeline(input.db, {
      at: new Date().toISOString(),
      kind: 'stack_apply',
      title: `Defense stack apply (${presetId})`,
      detail: steps.map((s) => `${s.id}:${s.ok ? 'ok' : 'fail'}`).join(' · '),
    });
  } catch {
    /* timeline optional */
  }

  return {
    ok: allOk && !anyBlocked,
    executed,
    blocked: anyBlocked || undefined,
    notes,
    steps,
    requiresExecute,
    requiresRoot,
  };
}
