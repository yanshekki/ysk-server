import { tl } from '@yanshekki/shared';
/**
 * Defense automation — auto preset escalate/de-escalate + auto-ban (user-tunable).
 * Emergency preset is NEVER applied automatically.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import type { AutoBanMode, AutoBanPolicy, BanMethod, DefensePresetId } from './types.js';
import {
  loadAutoBanPolicy,
  modeThresholds,
  runAutoBanTick,
  saveAutoBanPolicy,
  updateAutoBanPolicy } from './auto-ban.js';
import { applyDefensePreset } from './defense-service.js';
import { getDefensePreset } from './presets.js';
import {
  collectDefenseSignals,
  DEFAULT_SIGNAL_WEIGHTS,
  threatThresholdsFromAutoPreset,
  type SignalWeights } from './signals.js';
import { enableCloudflareUnderAttack } from './cloudflare-ua.js';
import { writeAndMaybeApplyCfOnlyUfw } from './cf-ufw.js';

const AUTO_KEY = 'defense_automation';
const TIMELINE_KEY = 'defense_timeline';
const PRESET_KEY = 'defense_active_preset';
const HOLD_KEY = 'defense_auto_preset_hold';

export type DefenseAutomation = {
  /** Master switch */
  enabled: boolean;
  autoPreset: {
    enabled: boolean;
    /** Also drives display threatLevel elevatedAt */
    escalateToHardenedAt: number;
    /** Also drives display underAttackAt */
    escalateToUnderAttackAt: number;
    /** Score at which we only *suggest* emergency — never auto-apply */
    suggestEmergencyAt: number;
    /** Display critical band (default derived near 70) */
    criticalAt: number;
    deescalateEnabled: boolean;
    deescalateToDailyBelow: number;
    holdMinutes: number;
  };
  autoBan: {
    enabled: boolean;
    mode: AutoBanMode | 'custom';
    method: BanMethod;
    minScore: number;
    minHits: number;
    min429: number;
    minScan: number;
    cooldownMinutes: number;
    maxAutoBansPerHour: number;
    /** Scheduler interval 30–600s */
    intervalSeconds: number;
    whitelist: string[];
    /** also write fail2ban ignoreip when whitelist changes */
    syncFail2banIgnoreip: boolean;
  };
  /** Signal point multipliers (0–3) */
  signalWeights: SignalWeights;
  /** Cloudflare zones for Under Attack when escalating to under_attack */
  cloudflare: {
    enabled: boolean;
    zones: string[];
    /** also call CF when auto-preset escalates */
    onAutoEscalate: boolean;
    /**
     * When applying under_attack: write UFW rules that only allow CF IP ranges
     * (+ SSH/optional admin). Requires EXECUTE+root to apply.
     */
    ufwAllowOnlyCf: boolean;
    /** Always keep these TCP ports open even in CF-only mode (default 22) */
    ufwKeepTcpPorts: number[];
  };
  lastTickAt?: string;
  lastTickNotes?: string[];
  lastPresetChangeAt?: string;
  lastPresetId?: DefensePresetId;
  suggestEmergency?: boolean;
};

export const DEFAULT_AUTOMATION: DefenseAutomation = {
  enabled: false,
  autoPreset: {
    enabled: false,
    escalateToHardenedAt: 20,
    escalateToUnderAttackAt: 45,
    suggestEmergencyAt: 85,
    criticalAt: 70,
    deescalateEnabled: true,
    deescalateToDailyBelow: 10,
    holdMinutes: 15 },
  autoBan: {
    enabled: false,
    mode: 'soft',
    method: 'fail2ban',
    minScore: 55,
    minHits: 100,
    min429: 50,
    minScan: 20,
    cooldownMinutes: 60,
    maxAutoBansPerHour: 40,
    intervalSeconds: 120,
    whitelist: ['127.0.0.1', '::1'],
    syncFail2banIgnoreip: true },
  signalWeights: { ...DEFAULT_SIGNAL_WEIGHTS },
  cloudflare: {
    enabled: false,
    zones: [],
    onAutoEscalate: true,
    ufwAllowOnlyCf: false,
    ufwKeepTcpPorts: [22] } };

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function loadDefenseAutomation(db: JsonStore): DefenseAutomation {
  // Migrate / merge from legacy auto-ban policy
  const legacy = loadAutoBanPolicy(db);
  try {
    const raw = db.snapshot.settings?.[AUTO_KEY];
    if (!raw) {
      return {
        ...DEFAULT_AUTOMATION,
        enabled: legacy.enabled,
        autoBan: {
          ...DEFAULT_AUTOMATION.autoBan,
          enabled: legacy.enabled,
          mode: legacy.mode === 'off' ? 'soft' : legacy.mode,
          method: legacy.method,
          cooldownMinutes: legacy.cooldownMinutes,
          maxAutoBansPerHour: legacy.maxAutoBansPerHour,
          whitelist: [...legacy.whitelist],
          ...thresholdsFromMode(legacy.mode === 'off' ? 'soft' : legacy.mode) },
        lastTickAt: legacy.lastTickAt,
        lastTickNotes: legacy.lastTickNotes };
    }
    const p = JSON.parse(raw) as Partial<DefenseAutomation>;
    const ab: Partial<DefenseAutomation['autoBan']> = p.autoBan ?? {};
    const ap: Partial<DefenseAutomation['autoPreset']> = p.autoPreset ?? {};
    const mode = (ab.mode as AutoBanMode | 'custom') || 'soft';
    const th =
      mode === 'custom'
        ? {
            minScore: Number(ab.minScore) || 40,
            minHits: Number(ab.minHits) || 60,
            min429: Number(ab.min429) || 30,
            minScan: Number(ab.minScan) || 12 }
        : thresholdsFromMode(mode === 'off' ? 'soft' : mode);
    return {
      enabled: Boolean(p.enabled),
      autoPreset: {
        enabled: Boolean(ap.enabled),
        escalateToHardenedAt: clamp(Number(ap.escalateToHardenedAt) || 20, 1, 99),
        escalateToUnderAttackAt: clamp(Number(ap.escalateToUnderAttackAt) || 45, 1, 99),
        suggestEmergencyAt: clamp(Number(ap.suggestEmergencyAt) || 85, 50, 100),
        criticalAt: clamp(Number(ap.criticalAt) || 70, 30, 100),
        deescalateEnabled: ap.deescalateEnabled !== false,
        deescalateToDailyBelow: clamp(Number(ap.deescalateToDailyBelow) || 10, 0, 50),
        holdMinutes: clamp(Number(ap.holdMinutes) || 15, 1, 240) },
      autoBan: {
        enabled: Boolean(ab.enabled ?? legacy.enabled),
        mode: mode === 'off' ? 'soft' : mode,
        method: ab.method === 'ufw' || ab.method === 'both' ? ab.method : 'fail2ban',
        minScore: clamp(Number(ab.minScore) || th.minScore, 1, 100),
        minHits: clamp(Number(ab.minHits) || th.minHits, 1, 10_000),
        min429: clamp(Number(ab.min429) || th.min429, 1, 10_000),
        minScan: clamp(Number(ab.minScan) || th.minScan, 1, 10_000),
        cooldownMinutes: clamp(Number(ab.cooldownMinutes) || legacy.cooldownMinutes || 60, 5, 24 * 60),
        maxAutoBansPerHour: clamp(
          Number(ab.maxAutoBansPerHour) || legacy.maxAutoBansPerHour || 40,
          1,
          500,
        ),
        intervalSeconds: clamp(Number(ab.intervalSeconds) || 120, 30, 600),
        whitelist: Array.isArray(ab.whitelist)
          ? ab.whitelist.map(String).filter(Boolean).slice(0, 200)
          : [...legacy.whitelist],
        syncFail2banIgnoreip: ab.syncFail2banIgnoreip !== false },
      signalWeights: {
        ...DEFAULT_SIGNAL_WEIGHTS,
        ...(p.signalWeights ?? {}) },
      cloudflare: {
        enabled: Boolean(p.cloudflare?.enabled),
        zones: Array.isArray(p.cloudflare?.zones)
          ? p.cloudflare!.zones.map(String).filter(Boolean).slice(0, 20)
          : [],
        onAutoEscalate: p.cloudflare?.onAutoEscalate !== false,
        ufwAllowOnlyCf: Boolean(p.cloudflare?.ufwAllowOnlyCf),
        ufwKeepTcpPorts: Array.isArray(p.cloudflare?.ufwKeepTcpPorts)
          ? p.cloudflare!.ufwKeepTcpPorts
              .map(Number)
              .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
              .slice(0, 20)
          : [22] },
      lastTickAt: p.lastTickAt,
      lastTickNotes: p.lastTickNotes,
      lastPresetChangeAt: p.lastPresetChangeAt,
      lastPresetId: p.lastPresetId as DefensePresetId | undefined,
      suggestEmergency: p.suggestEmergency };
  } catch {
    return {
      ...DEFAULT_AUTOMATION,
      autoBan: { ...DEFAULT_AUTOMATION.autoBan },
      signalWeights: { ...DEFAULT_SIGNAL_WEIGHTS },
      cloudflare: { ...DEFAULT_AUTOMATION.cloudflare } };
  }
}

function thresholdsFromMode(mode: AutoBanMode): {
  minScore: number;
  minHits: number;
  min429: number;
  minScan: number;
} {
  return modeThresholds(mode);
}

export function saveDefenseAutomation(
  db: JsonStore,
  policy: DefenseAutomation,
): DefenseAutomation {
  const next: DefenseAutomation = {
    ...policy,
    autoBan: {
      ...policy.autoBan,
      whitelist: (policy.autoBan.whitelist ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 200),
      intervalSeconds: clamp(policy.autoBan.intervalSeconds, 30, 600),
      syncFail2banIgnoreip: policy.autoBan.syncFail2banIgnoreip !== false },
    signalWeights: { ...DEFAULT_SIGNAL_WEIGHTS, ...policy.signalWeights },
    cloudflare: {
      enabled: Boolean(policy.cloudflare?.enabled),
      zones: (policy.cloudflare?.zones ?? []).map(String).filter(Boolean).slice(0, 20),
      onAutoEscalate: policy.cloudflare?.onAutoEscalate !== false,
      ufwAllowOnlyCf: Boolean(policy.cloudflare?.ufwAllowOnlyCf),
      ufwKeepTcpPorts: (policy.cloudflare?.ufwKeepTcpPorts ?? [22])
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0 && n < 65536)
        .slice(0, 20) } };
  // When mode is preset, sync numeric thresholds for UI clarity
  if (next.autoBan.mode !== 'custom') {
    const th = thresholdsFromMode(next.autoBan.mode === 'off' ? 'soft' : next.autoBan.mode);
    next.autoBan = { ...next.autoBan, ...th };
  }
  db.snapshot.settings[AUTO_KEY] = JSON.stringify(next);
  // Keep legacy auto-ban key in sync for old readers
  updateAutoBanPolicy(db, {
    enabled: next.enabled && next.autoBan.enabled,
    mode: next.autoBan.mode === 'custom' ? 'normal' : next.autoBan.mode,
    method: next.autoBan.method,
    cooldownMinutes: next.autoBan.cooldownMinutes,
    maxAutoBansPerHour: next.autoBan.maxAutoBansPerHour,
    whitelist: next.autoBan.whitelist });
  db.persist();
  return next;
}

/** Write defense whitelist into fail2ban ignoreip.txt under dataDir. */
export function syncWhitelistToFail2banIgnore(dataDir: string, whitelist: string[]): string {
  const dir = join(dataDir, 'fail2ban');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'ignoreip.txt');
  const list = [
    ...new Set(['127.0.0.1', '::1', ...whitelist.map((s) => s.trim()).filter(Boolean)]),
  ];
  writeFileSync(path, list.join('\n') + (list.length ? '\n' : ''), 'utf8');
  return path;
}

export function updateDefenseAutomation(
  db: JsonStore,
  patch: Partial<DefenseAutomation> & {
    autoPreset?: Partial<DefenseAutomation['autoPreset']>;
    autoBan?: Partial<DefenseAutomation['autoBan']>;
    signalWeights?: Partial<SignalWeights>;
    cloudflare?: Partial<DefenseAutomation['cloudflare']>;
  },
): DefenseAutomation {
  const cur = loadDefenseAutomation(db);
  return saveDefenseAutomation(db, {
    ...cur,
    ...patch,
    autoPreset: { ...cur.autoPreset, ...patch.autoPreset },
    autoBan: { ...cur.autoBan, ...patch.autoBan },
    signalWeights: { ...cur.signalWeights, ...patch.signalWeights },
    cloudflare: { ...cur.cloudflare, ...patch.cloudflare } });
}

function loadPresetId(db: JsonStore): DefensePresetId {
  const v = db.snapshot.settings?.[PRESET_KEY];
  if (v === 'hardened' || v === 'under_attack' || v === 'emergency' || v === 'daily') return v;
  return 'daily';
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

function holdActive(db: JsonStore, holdMinutes: number): boolean {
  try {
    const raw = db.snapshot.settings?.[HOLD_KEY];
    if (!raw) return false;
    const h = JSON.parse(raw) as { at: string; preset: string };
    return Date.now() - new Date(h.at).getTime() < holdMinutes * 60_000;
  } catch {
    return false;
  }
}

function setHold(db: JsonStore, preset: DefensePresetId): void {
  db.snapshot.settings[HOLD_KEY] = JSON.stringify({
    at: new Date().toISOString(),
    preset });
  db.persist();
}

/**
 * Desired preset from score (never returns emergency).
 */
export function desiredPresetFromScore(
  score: number,
  ap: DefenseAutomation['autoPreset'],
): DefensePresetId {
  if (score >= ap.escalateToUnderAttackAt) return 'under_attack';
  if (score >= ap.escalateToHardenedAt) return 'hardened';
  if (ap.deescalateEnabled && score < ap.deescalateToDailyBelow) return 'daily';
  return 'daily';
}

/**
 * Full automation tick: signals → optional preset change → auto-ban.
 */
export async function runDefenseAutomationTick(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  requestCountLastMinute?: number;
}): Promise<{
  ok: boolean;
  notes: string[];
  score: number;
  threatLevel: string;
  preset?: DefensePresetId;
  presetChanged?: boolean;
  banned: string[];
  suggestEmergency?: boolean;
  automation: DefenseAutomation;
}> {
  const notes: string[] = [];
  let automation = loadDefenseAutomation(input.db);
  const threatThresholds = threatThresholdsFromAutoPreset(automation.autoPreset);
  const sig = await collectDefenseSignals({
    host: input.host,
    requestCountLastMinute: input.requestCountLastMinute,
    weights: automation.signalWeights,
    threatThresholds });
  notes.push(tl('notes.auto.t0530', { v0: (sig.score), v1: (sig.threatLevel) }));

  let presetChanged = false;
  let preset = loadPresetId(input.db);
  let suggestEmergency = false;

  if (automation.enabled && automation.autoPreset.enabled) {
    if (sig.score >= automation.autoPreset.suggestEmergencyAt) {
      suggestEmergency = true;
      notes.push(tl('notes.auto.n0596'));
      pushTimeline(input.db, {
        at: new Date().toISOString(),
        kind: 'auto_suggest',
        title: tl('notes.auto.n0824'),
        detail: `score=${sig.score}` });
    }

    const desired = desiredPresetFromScore(sig.score, automation.autoPreset);
    const current = loadPresetId(input.db);
    const rank: Record<DefensePresetId, number> = {
      daily: 0,
      hardened: 1,
      under_attack: 2,
      emergency: 3 };

    // Escalate always if higher; de-escalate only if enabled and not in hold
    const wantUp = rank[desired] > rank[current] && current !== 'emergency';
    const wantDown =
      automation.autoPreset.deescalateEnabled &&
      rank[desired] < rank[current] &&
      current !== 'emergency' &&
      !holdActive(input.db, automation.autoPreset.holdMinutes);

    if (wantUp || wantDown) {
      // Never auto emergency
      const target = desired === 'emergency' ? 'under_attack' : desired;
      if (target !== current) {
        const r = await applyDefensePreset({
          host: input.host,
          db: input.db,
          dataDir: input.dataDir,
          preset: target,
          apply: true,
          enableAutoBan: false, // don't clobber automation policy
        });
        presetChanged = true;
        preset = target;
        setHold(input.db, target);
        const appliedTag = r.applied
          ? tl('notes.auto.appliedTag')
          : r.blocked
            ? tl('notes.auto.writtenTag')
            : '';
        notes.push(tl('notes.auto.t0531', { v0: getDefensePreset(target).label, v1: appliedTag }));
        pushTimeline(input.db, {
          at: new Date().toISOString(),
          kind: 'auto_preset',
          title: tl('notes.auto.t0532', { v0: getDefensePreset(target).label }),
          detail: tl('notes.auto.tScoreFrom', {
            score: sig.score,
            from: getDefensePreset(current).label,
          }),
        });
        // Cloudflare Under Attack + optional CF-only UFW on escalate
        if (target === 'under_attack' && wantUp && automation.cloudflare.enabled) {
          if (automation.cloudflare.onAutoEscalate && automation.cloudflare.zones.length) {
            const cf = await enableCloudflareUnderAttack({
              zones: automation.cloudflare.zones,
              dryRun: !input.host.executeEnabled() });
            notes.push(...cf.notes.slice(0, 4));
            pushTimeline(input.db, {
              at: new Date().toISOString(),
              kind: 'cloudflare_ua',
              title: cf.ok ? tl('notes.auto.n0089') : tl('notes.auto.n0088'),
              detail: cf.notes.slice(0, 2).join('; ') });
          }
          if (automation.cloudflare.ufwAllowOnlyCf) {
            const u = await writeAndMaybeApplyCfOnlyUfw({
              dataDir: input.dataDir,
              host: input.host,
              keepTcpPorts: automation.cloudflare.ufwKeepTcpPorts,
              apply: Boolean(input.host.executeEnabled() && input.host.isRoot()) });
            notes.push(...u.notes.slice(0, 4));
          }
        }
      }
    } else if (holdActive(input.db, automation.autoPreset.holdMinutes) && wantDown === false) {
      notes.push(tl('notes.auto.n1526'));
    }
  } else if (!automation.enabled) {
    notes.push(tl('notes.auto.n1333'));
  }

  let banned: string[] = [];
  if (automation.enabled && automation.autoBan.enabled) {
    // Apply custom thresholds into modeThresholds path via temporary policy
    const legacy: AutoBanPolicy = {
      enabled: true,
      mode:
        automation.autoBan.mode === 'custom'
          ? 'normal'
          : automation.autoBan.mode === 'off'
            ? 'soft'
            : automation.autoBan.mode,
      method: automation.autoBan.method,
      cooldownMinutes: automation.autoBan.cooldownMinutes,
      maxAutoBansPerHour: automation.autoBan.maxAutoBansPerHour,
      whitelist: automation.autoBan.whitelist };
    saveAutoBanPolicy(input.db, {
      ...loadAutoBanPolicy(input.db),
      ...legacy,
      enabled: true });

    // Monkey-patch: run tick with custom thresholds by temporarily overriding
    // We inject custom thresholds via settings flag for runAutoBanTick
    input.db.snapshot.settings.defense_auto_ban_custom_th = JSON.stringify({
      minScore: automation.autoBan.minScore,
      minHits: automation.autoBan.minHits,
      min429: automation.autoBan.min429,
      minScan: automation.autoBan.minScan });
    input.db.persist();

    const banR = await runAutoBanTick({
      host: input.host,
      db: input.db,
      dataDir: input.dataDir });
    banned = banR.banned;
    notes.push(...banR.notes.slice(0, 6));
  }

  automation = saveDefenseAutomation(input.db, {
    ...loadDefenseAutomation(input.db),
    lastTickAt: new Date().toISOString(),
    lastTickNotes: notes.slice(0, 16),
    lastPresetChangeAt: presetChanged ? new Date().toISOString() : automation.lastPresetChangeAt,
    lastPresetId: preset,
    suggestEmergency });

  return {
    ok: true,
    notes,
    score: sig.score,
    threatLevel: sig.threatLevel,
    preset,
    presetChanged,
    banned,
    suggestEmergency,
    automation };
}

/**
 * Mechanism table for UI — resolved at request time (never module-load tl freeze).
 */
export function getAutomationMechanismRows(): Array<{
  step: string;
  mechanism: string;
  tunable: string;
}> {
  return [
    {
      step: tl('notes.probe'),
      mechanism: tl('notes.tpl.probeMech'),
      tunable: tl('notes.tpl.probeTunable'),
    },
    {
      step: tl('notes.auto.n1375'),
      mechanism: tl('notes.auto.n1354'),
      tunable: tl('notes.auto.n1519'),
    },
    {
      step: tl('notes.auto.n1531'),
      mechanism: tl('notes.auto.n1525'),
      tunable: tl('notes.auto.n1332'),
    },
    {
      step: tl('notes.auto.n1325'),
      mechanism: 'fail2ban banip',
      tunable: tl('notes.auto.n0906'),
    },
    {
      step: tl('notes.auto.n1046'),
      mechanism: 'UFW deny from',
      tunable: 'method=ufw/both',
    },
    {
      step: tl('notes.auto.n1202'),
      mechanism: tl('notes.auto.n1044'),
      tunable: 'maxAutoBansPerHour',
    },
    {
      step: tl('notes.auto.n0030'),
      mechanism: tl('notes.tpl.autoNever'),
      tunable: tl('notes.tpl.autoManualEmergency'),
    },
  ];
}

/** @deprecated alias — prefer getAutomationMechanismRows() at request time */
export const AUTOMATION_MECHANISM_ROWS = getAutomationMechanismRows;
