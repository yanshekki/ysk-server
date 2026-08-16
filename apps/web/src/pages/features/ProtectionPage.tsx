/**
 * Defense Center — SOC-simple command UI for DDoS / attack response.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  LoadingBlock,
  MultiCheckSelect,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  SummaryStrip,
  SoftwareVersionBar,
  PageTabs,
  ConfirmDialog,
  PromptDialog,
  ServerListFilters,
  buttonClassName } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { useServerList } from '../../shared/hooks/useServerList';
import {
  classifySelfIp,
  collectHostIps,
  collectLoginIps,
  isProtectedSelfIp,
} from '../../shared/lib/self-ip';
import { formatDateTimeLocale } from '../../shared/lib/format-date';
import { bindAppendUniqueStr, bindBanAndClear, bindBanOne, bindCheck, bindCloseIfIdle, bindDefenseAutoBanTick, bindDefenseGeoApply, bindDefensePost, bindDefensePostOnly, bindDefenseProbe, bindDefenseUnban, bindDefenseWhitelist, bindDefenseWhitelistAction, bindFormSubmit, bindInput, bindListRemove, bindLoadGeo, bindPreset, bindSaveCfZones, bindSaveChecked, bindSaveNumber, bindSaveString, bindSaveTopChecked, bindSelect, bindSelectAllSuspects, bindValueSet, bindVoid } from '../bind-handlers';

import {
  GEO_ASN_PROVIDERS,
  getGeoContinents,
  getGeoCountries,
  getGeoRegions,
  normalizeAsnInput } from '../../features/defense/geo-options';

const TABS = ['command', 'automation', 'bans', 'geo', 'stack', 'intel', 'about'] as const;

type IpAccessPolicy = {
  enabled: boolean;
  mode: 'deny_list' | 'allow_list';
  countries: string[];
  continents: string[];
  regions: string[];
  cities: string[];
  cityPolicyEnabled: boolean;
  asns: string[];
  enforce: { autoBan: boolean; nginx: boolean; ufw: boolean };
  autoUpdate: boolean;
  updatedAt?: string;
};

type GeoipStatus = {
  provider: string;
  dir: string;
  ready: boolean;
  stale: boolean;
  cityReady?: boolean;
  maxGranularity?: string;
  notes: string[];
  attribution: string[];
  policy: IpAccessPolicy;
  sources: Array<{
    filename: string;
    present: boolean;
    mtime?: string;
    bytes?: number;
    license: string;
    updateHint: string;
  }>;
  meta: {
    lastSuccessAt?: string;
    lastAttemptAt?: string;
    lastError?: string;
  } | null;
  scheduler?: {
    intervalMs?: number;
    lastRunAt?: string;
    nextRunAt?: string;
  } | null;
};

type ThreatLevel = 'low' | 'elevated' | 'under_attack' | 'critical';

type StatusLabel = { short: string; tone: 'ok' | 'warn' | 'danger' | 'default'; detail?: string };

type AutoBanPolicy = {
  enabled: boolean;
  mode: 'off' | 'soft' | 'normal' | 'aggressive';
  method: 'fail2ban' | 'ufw' | 'both';
  cooldownMinutes: number;
  maxAutoBansPerHour: number;
  whitelist: string[];
  lastTickAt?: string;
  lastTickNotes?: string[];
  pausedReason?: string;
  autoBansLastHour?: number;
};

type DefenseAutomation = {
  enabled: boolean;
  autoPreset: {
    enabled: boolean;
    escalateToHardenedAt: number;
    escalateToUnderAttackAt: number;
    suggestEmergencyAt: number;
    deescalateEnabled: boolean;
    deescalateToDailyBelow: number;
    holdMinutes: number;
  };
  autoBan: {
    enabled: boolean;
    mode: 'soft' | 'normal' | 'aggressive' | 'custom';
    method: 'fail2ban' | 'ufw' | 'both';
    minScore: number;
    minHits: number;
    min429: number;
    minScan: number;
    cooldownMinutes: number;
    maxAutoBansPerHour: number;
    intervalSeconds: number;
    whitelist: string[];
    syncFail2banIgnoreip?: boolean;
  };
  signalWeights?: {
    networkDown: number;
    highReqRate: number;
    ddosHeuristic: number;
    tcpInuse: number;
    ufwInactive: number;
    f2bBans: number;
  };
  cloudflare?: {
    enabled: boolean;
    zones: string[];
    onAutoEscalate: boolean;
    ufwAllowOnlyCf?: boolean;
    ufwKeepTcpPorts?: number[];
  };
  lastTickAt?: string;
  lastTickNotes?: string[];
  suggestEmergency?: boolean;
};

type SuspectIp = {
  ip: string;
  score: number;
  hits: number;
  reasons: string[];
  sources: string[];
  lastSeen: string;
  alreadyBanned?: boolean;
  whitelisted?: boolean;
};

type DefenseStatus = {
  at: string;
  threatLevel: ThreatLevel;
  score: number;
  signals: Array<{
    id: string;
    label: string;
    value: string | number | boolean;
    points: number;
    detail?: string;
  }>;
  activePreset: string;
  presets: Array<{
    id: string;
    label: string;
    short: string;
    bullets: string[];
    danger?: boolean;
  }>;
  bans: { count: number; items: Array<{ ip: string; source: string; jail?: string; reason?: string }> };
  nginxLimits: { reqRate: string; burst: number; connLimit: number; confPath: string; exists: boolean };
  firewall: { active?: string; installed?: boolean };
  fail2ban: { active?: string; installed?: boolean; jails?: number };
  labels?: {
    firewall: StatusLabel;
    fail2ban: StatusLabel;
    apply: StatusLabel;
    autoBan: StatusLabel;
  };
  autoBan?: AutoBanPolicy;
  protectionMode?: string;
  executeEnabled: boolean;
  isRoot: boolean;
  suggestions: Array<{ id: string; title: string; body: string; action?: string }>;
  notes: string[];
};

const LEVEL_TONES: Record<ThreatLevel, 'ok' | 'warn' | 'danger'> = {
  low: 'ok',
  elevated: 'warn',
  under_attack: 'danger',
  critical: 'danger' };

export function levelMeta(
  t: (key: string, opts?: Record<string, unknown>) => string,
  level: ThreatLevel,
) {
  return {
    label: t(`protection.levels.${level}.label`),
    verb: t(`protection.levels.${level}.verb`),
    tone: LEVEL_TONES[level],
    hint: t(`protection.levels.${level}.hint`) };
}

const PRESET_META_BASE: Record<string, { step: number; accent: string }> = {
  daily: { step: 1, accent: 'calm' },
  hardened: { step: 2, accent: 'firm' },
  under_attack: { step: 3, accent: 'alert' },
  emergency: { step: 4, accent: 'critical' } };

export function presetWhen(t: (key: string) => string, id: string): string {
  const k = `protection.presetsWhen.${id}`;
  const v = t(k);
  return v === k ? id : v;
}

export function summarizeOpsNotes(
  notes: string[] | undefined,
  t: (key: string) => string,
): string[] {
  if (!notes?.length) return [];
  return notes.map((n) => {
    // L3: match backend Chinese / mixed ops notes until error codes exist
    if (/YSK_EXECUTE|未開啟系統|blocked system|無法 ban 到系統/i.test(n)) {
      return t('protection.note.notApplied');
    }
    if (/已寫 Nginx|Wrote .*nginx|00-ysk-defense/i.test(n)) {
      return t('protection.note.nginxWritten');
    }
    if (/jail\.local|fail2ban/i.test(n) && /Wrote|已寫/i.test(n)) {
      return t('protection.note.f2bWritten');
    }
    if (n.length > 120 && n.includes('/')) {
      return n.replace(/\/home\/[^ ]+/g, '…').slice(0, 100);
    }
    return n;
  });
}

export function toneToBadge(t?: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (t === 'ok') return 'ok';
  if (t === 'warn') return 'warn';
  if (t === 'danger') return 'danger';
  if (t === 'info') return 'info';
  return 'neutral';
}

export function relTime(
  iso: string | undefined,
  t: (key: string, o?: Record<string, unknown>) => string,
): string {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return t('protection.rel.justNow');
  if (d < 3600_000) return t('protection.rel.minutesAgo', { n: Math.floor(d / 60_000) });
  if (d < 86400_000) return t('protection.rel.hoursAgo', { n: Math.floor(d / 3600_000) });
  return new Date(iso).toLocaleString();
}

/** Suggested defense preset for the current threat level (never auto-picks emergency). */
export function recommendedPresetForThreat(threat: ThreatLevel): string | null {
  if (threat === 'critical' || threat === 'under_attack') return 'under_attack';
  if (threat === 'elevated') return 'hardened';
  return null;
}

export function presetMeta(
  id: string,
  fallbackStep = 1,
): { step: number; accent: string } {
  return PRESET_META_BASE[id] ?? { step: fallbackStep, accent: 'calm' };
}

/** Clamp auto-ban scan interval to 30–600 seconds. */
export function clampScanIntervalSeconds(v: unknown): number {
  return Math.max(30, Math.min(600, Number(v) || 120));
}

export function isActionableSuspect(s: {
  alreadyBanned?: boolean;
  whitelisted?: boolean;
}): boolean {
  return !s.alreadyBanned && !s.whitelisted;
}

export function filterActionableSuspects<
  T extends { alreadyBanned?: boolean; whitelisted?: boolean },
>(suspects: T[]): T[] {
  return suspects.filter(isActionableSuspect);
}

/** Keys of a selection map that are truthy. */
export function selectedKeys(selected: Record<string, boolean>): string[] {
  return Object.entries(selected)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

/** Status strip tone for active ban count. */
export function banCountTone(count: number): 'warn' | 'neutral' {
  return count > 10 ? 'warn' : 'neutral';
}

/** Suspect score badge tone. */
export function scoreTone(score: number): 'warn' | 'info' | 'ok' {
  if (score >= 40) return 'warn';
  if (score >= 20) return 'info';
  return 'ok';
}

/** Deep-link ban IP query is a plausible IPv4/IPv6 literal. */
export function isValidBanIpQuery(ip: string | null | undefined): boolean {
  return Boolean(ip && /^[\d.a-fA-F:]+$/.test(ip));
}

/** Whether `t` is a known Protection tab id. */
export function isProtectionTab(
  t: string | null | undefined,
): t is (typeof TABS)[number] {
  return Boolean(t && (TABS as readonly string[]).includes(t));
}

/** Split comma / semicolon / whitespace free text. */
export function parseCommaList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Localize raw probe values (true/inactive/installed) for signal cards. */
export function formatSignalValue(
  v: unknown,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (v === true) return t('common.yes');
  if (v === false) return t('common.no');
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  const raw = String(v ?? '').trim();
  if (!raw) return '—';
  const mapped: Record<string, string> = {
    true: t('common.yes'),
    false: t('common.no'),
    yes: t('common.yes'),
    no: t('common.no'),
    active: t('protection.signalActive'),
    inactive: t('protection.signalInactive'),
    installed: t('common.installed'),
    missing: t('common.notInstalled'),
  };
  const lower = raw.toLowerCase();
  if (mapped[lower]) return mapped[lower];
  const jail = raw.match(/^(\d+)\s*jails?$/i);
  if (jail) return t('protection.signalJails', { n: Number(jail[1]) });
  return raw;
}

/** Installed stack badge tone. */
export function installedTone(installed?: boolean): 'ok' | 'warn' {
  return installed ? 'ok' : 'warn';
}

/** Count signals that contribute points. */
export function activeSignalsCount(
  signals: Array<{ points: number }> | null | undefined,
): number {
  return (signals ?? []).filter((s) => s.points > 0).length;
}

/** Emergency preset requires typed EMERGENCY token. */
export function needsEmergencyConfirm(
  id: string,
  danger?: boolean,
  confirmToken?: string,
): boolean {
  return Boolean(danger && id === 'emergency' && confirmToken !== 'EMERGENCY');
}

/** Non-emergency danger presets need a confirm dialog first. */
export function needsPresetConfirm(
  id: string,
  danger?: boolean,
  preview?: boolean,
  confirmToken?: string,
): boolean {
  return Boolean(!preview && danger && id !== 'emergency' && !confirmToken);
}

/** Confirm body token for emergency apply. */
export function confirmTokenForPreset(id: string): string | undefined {
  return id === 'emergency' ? 'EMERGENCY' : undefined;
}

/** Binary on/off display. */
export function onOffLabel(
  on: boolean,
  onLabel: string,
  offLabel: string,
): string {
  return on ? onLabel : offLabel;
}

/** Normalize geo mode from API. */
export function geoModeNormalize(
  mode: string | null | undefined,
): 'deny_list' | 'allow_list' {
  return mode === 'allow_list' ? 'allow_list' : 'deny_list';
}

/** autoUpdate defaults true when unset. */
export function autoUpdateDefault(v: boolean | undefined | null): boolean {
  return v !== false;
}

/** Compact vhost limit label. */
export function vhostLimitLabel(withLimit: number, total: number): string {
  return `${withLimit}/${total}`;
}

/** CSS-ish class key for suspect row state. */
export function suspectRowClass(s: {
  alreadyBanned?: boolean;
  whitelisted?: boolean;
}): 'banned' | 'whitelist' | 'actionable' {
  if (s.alreadyBanned) return 'banned';
  if (s.whitelisted) return 'whitelist';
  return 'actionable';
}

/** Threat score with nullish coalesce. */
export function threatScore(score: number | null | undefined): number {
  return score ?? 0;
}

/** Threat level with low default. */
export function threatLevelOrLow(
  level: ThreatLevel | null | undefined,
): ThreatLevel {
  return level ?? 'low';
}

/** Join CF zone list for textarea. */
export function joinZones(zones: string[] | null | undefined): string {
  return (zones ?? []).join(', ');
}

/** Nginx limits existence tone. */
export function nginxLimitsTone(exists?: boolean): 'ok' | 'warn' {
  return exists ? 'ok' : 'warn';
}

/** Execute path tone (root + executeEnabled). */
export function executePathTone(
  executeEnabled?: boolean,
  isRoot?: boolean,
): 'ok' | 'warn' {
  return executeEnabled && isRoot ? 'ok' : 'warn';
}

/** Toggle membership in a string set (countries, ASNs, …). */
export function toggleInList(prev: string[], item: string): string[] {
  return prev.includes(item) ? prev.filter((x) => x !== item) : [...prev, item];
}

/** Whether recommended preset should show apply CTA. */
export function showRecommendedCta(
  activePreset: string | null | undefined,
  recommended: string | null,
): boolean {
  return Boolean(recommended && activePreset !== recommended);
}

type BanRow = { ip: string; source: string; jail?: string; reason?: string };

export function ProtectionPage() {
  const { t, i18n } = useTranslation();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = usePageTab(TABS, 'command');
  const [status, setStatus] = useState<DefenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [banIp, setBanIp] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banMethod, setBanMethod] = useState<'fail2ban' | 'ufw' | 'both'>('fail2ban');
  const banList = useServerList<BanRow>({
    path: '/api/v1/defense/bans',
    debounceMs: 300,
    enabled: tab === 'bans' || tab === 'command' });
  const [suspects, setSuspects] = useState<SuspectIp[]>([]);
  const [suspectNotes, setSuspectNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [wlInput, setWlInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [showWl, setShowWl] = useState(false);
  const [presetConfirmId, setPresetConfirmId] = useState<string | null>(null);
  const [emergencyPromptOpen, setEmergencyPromptOpen] = useState(false);
  const [showMech, setShowMech] = useState(true);
  const [automation, setAutomation] = useState<DefenseAutomation | null>(null);
  const [mechanisms, setMechanisms] = useState<
    Array<{ step: string; mechanism: string; tunable: string }>
  >([]);
  const [autoBansLastHour, setAutoBansLastHour] = useState(0);
  const [schedNext, setSchedNext] = useState<string | null>(null);
  const [hasCfToken, setHasCfToken] = useState(false);
  const [cfZonesText, setCfZonesText] = useState('');
  const [topIps, setTopIps] = useState<
    Array<{ ip: string; hits: number; s429: number; scan: number; score: number }>
  >([]);
  const [vhostLimits, setVhostLimits] = useState<{
    withLimit: number;
    total: number;
    items: Array<{ name: string; hasDefenseMarker: boolean }>;
  } | null>(null);
  const [stackFw, setStackFw] = useState<{
    activeLabel?: string;
    allowCount?: number;
    denyCount?: number;
    installed?: boolean;
  } | null>(null);
  const [stackF2b, setStackF2b] = useState<{
    activeLabel?: string;
    installed?: boolean;
    jails?: number;
    banned?: number;
  } | null>(null);
  const [timeline, setTimeline] = useState<
    Array<{ at: string; kind: string; title: string; detail?: string }>
  >([]);
  const [geoStatus, setGeoStatus] = useState<GeoipStatus | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [geoCountries, setGeoCountries] = useState<string[]>([]);
  const [geoContinents, setGeoContinents] = useState<string[]>([]);
  const [geoRegions, setGeoRegions] = useState<string[]>([]);
  const [geoCities, setGeoCities] = useState<string[]>([]);
  const [geoCityPolicy, setGeoCityPolicy] = useState(false);
  const [geoCityDraft, setGeoCityDraft] = useState('');
  const [geoAsns, setGeoAsns] = useState<string[]>([]);
  const [geoMode, setGeoMode] = useState<'deny_list' | 'allow_list'>('deny_list');
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoAutoUpdate, setGeoAutoUpdate] = useState(true);
  const [lookupIp, setLookupIp] = useState('');
  const [lookupResult, setLookupResult] = useState<{
    lookup?: Record<string, unknown>;
    access?: { blocked: boolean; reason?: string; matched: string[] };
  } | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const [hostIps, setHostIps] = useState<string[]>([]);
  const [loginIps, setLoginIps] = useState<string[]>([]);
  const [hideZeroScore, setHideZeroScore] = useState(true);

  const loadGeo = useCallback(async () => {
    setGeoLoading(true);
    setGeoErr(null);
    try {
      const s = await api.requestRaw<GeoipStatus>('/api/v1/defense/geoip/status');
      setGeoStatus(s);
      const p = s.policy;
      setGeoEnabled(Boolean(p.enabled));
      setGeoMode(p.mode === 'allow_list' ? 'allow_list' : 'deny_list');
      setGeoAutoUpdate(p.autoUpdate !== false);
      setGeoCountries([...(p.countries ?? [])]);
      setGeoContinents([...(p.continents ?? [])]);
      setGeoRegions([...(p.regions ?? [])]);
      setGeoCities([...(p.cities ?? [])]);
      setGeoCityPolicy(Boolean(p.cityPolicyEnabled));
      setGeoAsns([...(p.asns ?? [])]);
    } catch (e) {
      const m =
        e instanceof Error
          ? e.message === 'Failed to fetch'
            ? t('protection.apiUnreachable')
            : e.message
          : t('protection.geoipLoadFailed');
      setGeoErr(m);
      throw e;
    } finally {
      setGeoLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'geo') return;
    void loadGeo().catch(() => {
      /* geoErr set in loadGeo */
    });
  }, [tab, loadGeo]);

  // Deep link from Log Center: /protection?tab=bans&ip=x.x.x.x
  useEffect(() => {
    const ip = searchParams.get('ip');
    const t = searchParams.get('tab');
    if (isValidBanIpQuery(ip) && ip) {
      setBanIp(ip);
      setShowManual(true);
      setBanReason((r) => r || 'from logs');
    }
    if (isProtectionTab(t)) {
      setTab(t as (typeof TABS)[number]);
    }
  }, [searchParams, setTab]);

  const refresh = useCallback(async () => {
    setLoadErr(null);
    try {
      const s = await api.requestRaw<DefenseStatus>('/api/v1/defense/status');
      setStatus(s);
      try {
        const host = await api.requestRaw<{ network?: { ips?: string[] } }>(
          '/api/v1/system/host',
        );
        setHostIps(collectHostIps(host));
      } catch {
        /* optional */
      }
      try {
        const ses = await api.listSessions();
        setLoginIps(collectLoginIps(ses.items));
      } catch {
        /* optional */
      }
      const t = await api.requestRaw<{ items: typeof timeline }>('/api/v1/defense/timeline?hours=48');
      setTimeline(t.items ?? []);
      const sus = await api.requestRaw<{ items: SuspectIp[]; notes: string[] }>(
        '/api/v1/defense/suspects',
      );
      setSuspects(sus.items ?? []);
      setSuspectNotes(sus.notes ?? []);
      try {
        const a = await api.requestRaw<{
          automation: DefenseAutomation;
          mechanisms: Array<{ step: string; mechanism: string; tunable: string }>;
          autoBansLastHour: number;
          scheduler?: { nextRunAt?: string; intervalMs?: number; lastRunAt?: string } | null;
          hasCfToken?: boolean;
        }>('/api/v1/defense/automation');
        setAutomation(a.automation);
        setMechanisms(a.mechanisms ?? []);
        setAutoBansLastHour(a.autoBansLastHour ?? 0);
        setSchedNext(a.scheduler?.nextRunAt ?? null);
        setHasCfToken(Boolean(a.hasCfToken));
        setCfZonesText(joinZones(a.automation.cloudflare?.zones));
      } catch {
        /* optional */
      }
      try {
        const intel = await api.requestRaw<{
          topIps: Array<{ ip: string; hits: number; s429: number; scan: number; score: number }>;
          vhosts: Array<{ name: string; hasDefenseMarker: boolean }>;
          vhostsWithLimit: number;
          vhostsTotal: number;
        }>('/api/v1/defense/intel');
        setTopIps(intel.topIps ?? []);
        setVhostLimits({
          withLimit: intel.vhostsWithLimit ?? 0,
          total: intel.vhostsTotal ?? 0,
          items: intel.vhosts ?? [] });
      } catch {
        /* optional */
      }
      try {
        const fw = await api.requestRaw<{
          activeLabel: string;
          allowCount: number;
          denyCount: number;
          installed: boolean;
        }>('/api/v1/system/firewall/status');
        setStackFw(fw);
      } catch {
        setStackFw(null);
      }
      try {
        const f2b = await api.requestRaw<{
          activeLabel: string;
          installed: boolean;
          jails: unknown[];
          banned: unknown[];
        }>('/api/v1/system/fail2ban/status');
        setStackF2b({
          activeLabel: f2b.activeLabel,
          installed: f2b.installed,
          jails: f2b.jails?.length,
          banned: f2b.banned?.length });
      } catch {
        setStackF2b(null);
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('protection.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, i18n.language]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(id);
  }, [refresh]);


  const selectedIps = useMemo(() => selectedKeys(selected), [selected]);

  const goCommand = useCallback(() => setTab('command'), [setTab]);
  const goBans = useCallback(() => setTab('bans'), [setTab]);
  const goAutomation = useCallback(() => setTab('automation'), [setTab]);
  const goGeo = useCallback(() => setTab('geo'), [setTab]);
  const goStack = useCallback(() => setTab('stack'), [setTab]);
  const goIntel = useCallback(() => setTab('intel'), [setTab]);
  const clearMsg = useCallback(() => setMsg(null), [setMsg]);
  const clearSelected = useCallback(() => setSelected({}), []);
  const toggleMech = useCallback(() => setShowMech((v) => !v), []);
  const toggleWl = useCallback(() => setShowWl((v) => !v), []);
  const toggleManual = useCallback(() => setShowManual((v) => !v), []);
  const clearPresetConfirm = useCallback(() => setPresetConfirmId(null), []);
  const closeEmergency = useCallback(() => setEmergencyPromptOpen(false), []);

  const selfIpOpts = useMemo(
    () => ({
      hostIps,
      loginIps,
      ignoreIps: suspects.filter((s) => s.whitelisted).map((s) => s.ip),
    }),
    [hostIps, loginIps, suspects],
  );

  const visibleSuspects = useMemo(
    () =>
      hideZeroScore ? suspects.filter((s) => (s.score ?? 0) > 0) : suspects,
    [suspects, hideZeroScore],
  );

  const actionableSuspects = useMemo(
    () =>
      filterActionableSuspects(visibleSuspects).filter(
        (s) => !isProtectedSelfIp(s.ip, selfIpOpts),
      ),
    [visibleSuspects, selfIpOpts],
  );

  async function applyPreset(
    id: string,
    danger?: boolean,
    preview = false,
    confirmToken?: string,
  ) {
    if (!preview && danger && id === 'emergency' && confirmToken !== 'EMERGENCY') {
      setEmergencyPromptOpen(true);
      return;
    }
    if (!preview && danger && id !== 'emergency' && !confirmToken) {
      setPresetConfirmId(id);
      return;
    }
    const confirm = id === 'emergency' ? 'EMERGENCY' : undefined;
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/preset', {
        method: 'POST',
        body: JSON.stringify({
          preset: id,
          apply: !preview,
          confirm }) })) as OpsResultLike;
      if (!preview) await refresh();
      if (r.notes) r.notes = summarizeOpsNotes(r.notes, t);
      return r;
    }, preview ? t('protection.previewDone') : t('protection.presetApplied'));
  }

  async function banOne(ip: string, reason?: string) {
    if (isProtectedSelfIp(ip, selfIpOpts)) {
      setError(t('protection.cannotBanSelf', { ip }));
      return;
    }
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/ban', {
        method: 'POST',
        body: JSON.stringify({
          ip,
          reason: reason || banReason || t('protection.manualBan'),
          method: banMethod }) })) as OpsResultLike;
      if (r.notes) r.notes = summarizeOpsNotes(r.notes, t);
      await refresh();
      return r;
    }, t('protection.banSent', { ip }));
  }

  async function banSelected() {
    if (!selectedIps.length) return;
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/ban-batch', {
        method: 'POST',
        body: JSON.stringify({
          ips: selectedIps,
          reason: banReason || t('protection.quickSelectBan'),
          method: banMethod }) })) as OpsResultLike;
      if (r.notes) r.notes = summarizeOpsNotes(r.notes, t);
      setSelected({});
      await refresh();
      return r;
    }, t('protection.bulkBan', { count: selectedIps.length }));
  }

  async function saveAutoBan(patch: Partial<AutoBanPolicy>) {
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/auto-ban', {
        method: 'PUT',
        body: JSON.stringify(patch) })) as OpsResultLike & AutoBanPolicy;
      await refresh();
      return {
        ok: true,
        notes: [
          t('protection.autoBanStatus', { onOff: r.enabled ? t('protection.on') : t('protection.off'), mode: r.mode, method: r.method }),
        ] };
    }, t('protection.autoBanUpdated'));
  }

  async function saveAutomation(patch: {
    enabled?: boolean;
    autoPreset?: Partial<DefenseAutomation['autoPreset']>;
    autoBan?: Partial<DefenseAutomation['autoBan']>;
    signalWeights?: Partial<NonNullable<DefenseAutomation['signalWeights']>>;
    cloudflare?: Partial<NonNullable<DefenseAutomation['cloudflare']>>;
  }) {
    await run(async () => {
      const r = await api.requestRaw<{ automation: DefenseAutomation }>(
        '/api/v1/defense/automation',
        { method: 'PUT', body: JSON.stringify(patch) },
      );
      setAutomation(r.automation);
      await refresh();
      return {
        ok: true,
        notes: [
          t('protection.automationMaster', { onOff: r.automation.enabled ? t('protection.on') : t('protection.off') }),
          t('protection.autoPresetStatus', { onOff: r.automation.autoPreset.enabled ? t('protection.on') : t('protection.off') }),
          t('protection.autoBanAutomation', { onOff: r.automation.autoBan.enabled ? t('protection.on') : t('protection.off'), mode: r.automation.autoBan.mode }),
        ] };
    }, t('protection.automationSaved'));
  }

  const threat = status?.threatLevel ?? 'low';
  const meta = levelMeta(t, threat);
  const labels = status?.labels;
  const ab = status?.autoBan;
  const activePreset = status?.presets.find((p) => p.id === status.activePreset);
  const score = status?.score ?? 0;

  const recommendedPreset = recommendedPresetForThreat(threat);

  return (
    <FeaturePageLayout
      title={t('nav.protection')}
      status={
        status
          ? {
              pill: {
                label: t('protection.threatPill', { label: meta.label, score }),
                tone: meta.tone },
              items: [
                {
                  label: t('protection.statSuspects'),
                  value: suspects.length,
                  hint: t('protection.scoreBasisHint'),
                  tone: suspects.length > 0 ? 'warn' : 'ok',
                },
                {
                  label: 'fail2ban',
                  value: labels?.fail2ban.short ?? '—',
                  tone: toneToBadge(labels?.fail2ban.tone),
                },
                {
                  label: t('protection.statFirewall'),
                  value: labels?.firewall.short ?? '—',
                  tone: toneToBadge(labels?.firewall.tone),
                },
                {
                  label: t('protection.statActiveBans'),
                  value: banList.meta?.total ?? banList.items.length ?? status.bans?.count ?? 0,
                  tone: banCountTone(
                    banList.meta?.total ?? banList.items.length ?? status.bans?.count ?? 0,
                  ),
                },
                {
                  label: t('protection.statPreset'),
                  value: activePreset?.label ?? '—',
                },
              ] }
          : undefined
      }
      actions={
        <ActionBar size="sm">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={bindDefenseProbe(
              run,
              api.requestRaw,
              setStatus,
              refresh,
              t('protection.reprobed'),
            )}
          >
            {t('common.reprobe')}
          </Button>
          {actionableSuspects.length > 0 ? (
            <Button variant="danger" size="sm" onClick={goBans}>
              {t('protection.suspectIpsCount', { count: actionableSuspects.length })}
            </Button>
          ) : null}
        </ActionBar>
      }
    >
      {loadErr ? <Alert variant="error">{loadErr}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading && !status ? <LoadingBlock label={t('protection.loadingStatus')} /> : null}

      {!status?.executeEnabled && status ? (
        <Alert variant="warn">
          {t('protection.writeOnlyBanner')}
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: 'command',
            label: t('protection.tabs.command'),
            badge: recommendedPreset ? '!' : undefined,
            badgeTitle: recommendedPreset
              ? t('protection.badgeRecommendPreset')
              : undefined,
          },
          {
            id: 'automation',
            label: t('protection.tabs.automation'),
            badge: automation?.enabled ? 'ON' : undefined,
            badgeTitle: automation?.enabled
              ? t('protection.badgeAutomationOn')
              : undefined,
          },
          {
            id: 'bans',
            label: t('protection.tabs.bans'),
            badge: status?.bans.count || undefined,
            badgeTitle: t('protection.badgeBanCount'),
          },
          {
            id: 'geo',
            label: t('protection.tabs.geo'),
            badge: geoStatus?.policy?.enabled
              ? 'ON'
              : geoStatus?.ready
                ? undefined
                : '!',
            badgeTitle: geoStatus?.policy?.enabled
              ? t('protection.badgeGeoOn')
              : geoStatus?.ready
                ? undefined
                : t('protection.badgeGeoNotReady'),
          },
          { id: 'stack', label: t('protection.tabs.stack') },
          {
            id: 'intel',
            label: t('protection.tabs.intel'),
            badge: activeSignalsCount(status?.signals) || undefined,
            badgeTitle: t('protection.badgeIntelSignals'),
          },
          { id: 'about', label: t('protection.tabs.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'command' ? (
          <div className="tab-panel def-panel">
            <div className="def-section-head">
              <h3 className="def-section-head__title">{t('protection.sectionPreset')}</h3>
            </div>

            <div className="def-ramp" role="list">
              {(status?.presets ?? []).map((p, idx) => {
                const active = status?.activePreset === p.id;
                const pm = presetMeta(p.id, idx + 1);
                const whenLabel = presetWhen(t, p.id) || p.short;
                const recommended = recommendedPreset === p.id && !active;
                return (
                  <article
                    key={p.id}
                    role="listitem"
                    className={[
                      'def-ramp__card',
                      `def-ramp__card--${pm.accent}`,
                      active ? 'is-active' : '',
                      recommended ? 'is-recommended' : '',
                      p.danger ? 'is-danger' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <header className="def-ramp__head">
                      <span className="def-ramp__step">{pm.step}</span>
                      <div className="def-ramp__titles">
                        <h4>
                          {p.label}
                          {active ? <Badge tone="ok">{t('protection.active')}</Badge> : null}
                          {recommended ? <Badge tone="warn">{t('protection.recommended')}</Badge> : null}
                          {p.danger && !active ? (
                            <Badge tone="danger">{t('protection.useCarefully')}</Badge>
                          ) : null}
                        </h4>
                        <span className="def-ramp__when">{whenLabel}</span>
                      </div>
                    </header>
                    <footer className="def-ramp__foot">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={bindPreset(applyPreset, p.id, p.danger, true)}
                      >
                        {t('protection.preview')}
                      </Button>
                      <Button
                        variant={p.danger ? 'danger' : active ? 'secondary' : 'primary'}
                        size="sm"
                        loading={busy}
                        onClick={bindPreset(applyPreset, p.id, p.danger, false)}
                      >
                        {active ? t('protection.reapply') : t('common.apply')}
                      </Button>
                    </footer>
                  </article>
                );
              })}
            </div>

            <SummaryStrip
              items={[
                {
                  label: t('protection.nginxLimits'),
                  value: status?.nginxLimits.exists
                    ? `${status.nginxLimits.reqRate ?? '—'}/${status.nginxLimits.burst ?? '—'}/${status.nginxLimits.connLimit ?? '—'}`
                    : t('protection.notWritten'),
                  tone: nginxLimitsTone(status?.nginxLimits.exists) },
                {
                  label: t('protection.mode'),
                  value: status?.protectionMode ?? '—' },
                {
                  label: t('protection.controlPlane'),
                  value: status?.executeEnabled
                    ? status?.isRoot
                      ? t('protection.canApply')
                      : t('protection.needRoot')
                    : t('protection.writeOnly'),
                  tone: executePathTone(status?.executeEnabled, status?.isRoot) },
              ]}
            />
          </div>
        ) : null}

        {tab === 'automation' ? (
          <div className="tab-panel def-panel">
            <section className="def-autoban">
              <div className="def-autoban__left">
                <div className="def-autoban__title">
                  <span className="def-autoban__icon" aria-hidden>
                    ⚙
                  </span>
                  <div>
                    <strong>{t('protection.automationMasterLabel')}</strong>
                    <p>
                      {automation?.enabled
                        ? t('protection.autoRunning', { sec: automation.autoBan.intervalSeconds, n: autoBansLastHour })
                        : t('protection.autoOffManual')}
                      {automation?.lastTickAt
                        ? t('protection.lastTickPrefix', { t: relTime(automation.lastTickAt, t) })
                        : ''}
                      {schedNext && automation?.enabled
                        ? t('protection.nextTickPrefix', { t: relTime(schedNext, t) })
                        : ''}
                    </p>
                  </div>
                </div>
              </div>
              <div className="def-autoban__controls">
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(automation?.enabled)}
                    disabled={busy}
                    onChange={bindSaveTopChecked(saveAutomation, 'enabled')}
                  />
                  <span>{automation?.enabled ? t('protection.open') : t('common.close')}</span>
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={bindDefenseAutoBanTick(
                    run,
                    api.requestRaw,
                    refresh,
                    t('protection.ranAutomationTick'),
                  )}
                >
                  {t('protection.runOneTick')}
                </Button>
              </div>
            </section>

            {automation?.suggestEmergency ? (
              <Alert variant="error">
                {t('protection.suggestEmergencyBanner')}
              </Alert>
            ) : null}

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.sectionAutoPreset')}</h3>
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(automation?.autoPreset.enabled)}
                    disabled={busy || !automation?.enabled}
                    onChange={bindSaveChecked(saveAutomation, 'autoPreset', 'enabled')}
                  />
                  <span>{automation?.autoPreset.enabled ? t('protection.on') : t('protection.off')}</span>
                </label>
              </div>
              <p className="muted u-text-sm">
                {t('protection.autoPresetDesc')}
              </p>
              <FormLayout columns={2}>
                <Field label={t('protection.escalateHardened')} htmlFor="ap-h" flush>
                  <PresetChips
                    options={[
                      { value: '15', label: '15' },
                      { value: '20', label: '20' },
                      { value: '30', label: '30' },
                      { value: '40', label: '40' },
                      { value: '50', label: '50' },
                    ]}
                    value={String(automation?.autoPreset.escalateToHardenedAt ?? 20)}
                    disabled={busy}
                    onChange={bindSaveNumber(
                      saveAutomation,
                      setAutomation,
                      'autoPreset',
                      'escalateToHardenedAt',
                      20,
                    )}
                  />
                </Field>
                <Field label={t('protection.escalateAttack')} htmlFor="ap-u" flush>
                  <PresetChips
                    options={[
                      { value: '35', label: '35' },
                      { value: '45', label: '45' },
                      { value: '55', label: '55' },
                      { value: '65', label: '65' },
                      { value: '80', label: '80' },
                    ]}
                    value={String(automation?.autoPreset.escalateToUnderAttackAt ?? 45)}
                    disabled={busy}
                    onChange={bindSaveNumber(
                      saveAutomation,
                      setAutomation,
                      'autoPreset',
                      'escalateToUnderAttackAt',
                      45,
                    )}
                  />
                </Field>
                <Field label={t('protection.deescalateDaily')} htmlFor="ap-d" flush>
                  <PresetChips
                    options={[
                      { value: '5', label: '5' },
                      { value: '10', label: '10' },
                      { value: '15', label: '15' },
                      { value: '20', label: '20' },
                      { value: '0', label: t('protection.zeroOff') },
                    ]}
                    value={String(automation?.autoPreset.deescalateToDailyBelow ?? 10)}
                    disabled={busy}
                    onChange={bindSaveNumber(
                      saveAutomation,
                      setAutomation,
                      'autoPreset',
                      'deescalateToDailyBelow',
                      0,
                    )}
                  />
                </Field>
                <Field label={t('protection.holdAfterEscalate')} htmlFor="ap-hold" flush>
                  <PresetChips
                    options={[
                      { value: '5', label: t('protection.min5') },
                      { value: '15', label: t('protection.min15') },
                      { value: '30', label: t('protection.min30') },
                      { value: '60', label: t('protection.hour1') },
                      { value: '120', label: t('protection.hour2') },
                    ]}
                    value={String(automation?.autoPreset.holdMinutes ?? 15)}
                    disabled={busy}
                    onChange={bindSaveNumber(
                      saveAutomation,
                      setAutomation,
                      'autoPreset',
                      'holdMinutes',
                      15,
                    )}
                  />
                </Field>
              </FormLayout>
              <label className="def-switch u-mt-2">
                <input
                  type="checkbox"
                  checked={automation?.autoPreset.deescalateEnabled !== false}
                  disabled={busy || !automation?.enabled}
                  onChange={bindSaveChecked(saveAutomation, 'autoPreset', 'deescalateEnabled')}
                />
                <span>{t('protection.allowDeescalate')}</span>
              </label>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.sectionAutoBan')}</h3>
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(automation?.autoBan.enabled)}
                    disabled={busy || !automation?.enabled}
                    onChange={bindSaveChecked(saveAutomation, 'autoBan', 'enabled')}
                  />
                  <span>{automation?.autoBan.enabled ? t('protection.on') : t('protection.off')}</span>
                </label>
              </div>
              <FormLayout columns={2}>
                <Field label={t('protection.presetOrCustom')} htmlFor="ab-mode2" flush>
                  <SegRadio
                    name="ab-mode2"
                    aria-label={t('protection.autoBanMode')}
                    value={(automation?.autoBan.mode ?? 'soft') as string}
                    disabled={busy}
                    onChange={bindSaveString(saveAutomation, 'autoBan', 'mode', { enabled: true })}
                    options={[
                      { value: 'soft', label: t('protection.soft') },
                      { value: 'normal', label: t('protection.normal') },
                      { value: 'aggressive', label: t('protection.aggressive') },
                      { value: 'custom', label: t('protection.custom') },
                    ]}
                  />
                </Field>
                <Field label={t('protection.method')} htmlFor="ab-meth2" flush>
                  <SegRadio
                    name="ab-meth2"
                    aria-label={t('protection.banMethod')}
                    value={(automation?.autoBan.method ?? 'fail2ban') as string}
                    disabled={busy}
                    onChange={bindSaveString(saveAutomation, 'autoBan', 'method')}
                    options={[
                      { value: 'fail2ban', label: 'fail2ban' },
                      { value: 'ufw', label: 'UFW' },
                      { value: 'both', label: t('protection.both') },
                    ]}
                  />
                </Field>
                <Field label={t('protection.scoreGte')} htmlFor="ab-sc" flush>
                  <PresetChips
                    options={[
                      { value: '40', label: '40' },
                      { value: '55', label: '55' },
                      { value: '70', label: '70' },
                      { value: '85', label: '85' },
                    ]}
                    value={String(automation?.autoBan.minScore ?? 55)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={bindSaveNumber(saveAutomation, setAutomation, 'autoBan', 'minScore', 55)}
                  />
                </Field>
                <Field label={t('protection.hitsGte')} htmlFor="ab-hi" flush>
                  <PresetChips
                    options={[
                      { value: '50', label: '50' },
                      { value: '100', label: '100' },
                      { value: '200', label: '200' },
                      { value: '500', label: '500' },
                    ]}
                    value={String(automation?.autoBan.minHits ?? 100)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={bindSaveNumber(saveAutomation, setAutomation, 'autoBan', 'minHits', 100)}
                  />
                </Field>
                <Field label={t('protection.hits429Gte')} htmlFor="ab-429" flush>
                  <PresetChips
                    options={[
                      { value: '20', label: '20' },
                      { value: '50', label: '50' },
                      { value: '100', label: '100' },
                      { value: '200', label: '200' },
                    ]}
                    value={String(automation?.autoBan.min429 ?? 50)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={bindSaveNumber(saveAutomation, setAutomation, 'autoBan', 'min429', 50)}
                  />
                </Field>
                <Field label={t('protection.scanHitsGte')} htmlFor="ab-scan" flush>
                  <PresetChips
                    options={[
                      { value: '10', label: '10' },
                      { value: '20', label: '20' },
                      { value: '40', label: '40' },
                      { value: '80', label: '80' },
                    ]}
                    value={String(automation?.autoBan.minScan ?? 20)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={bindSaveNumber(saveAutomation, setAutomation, 'autoBan', 'minScan', 20)}
                  />
                </Field>
                <Field label={t('protection.cooldown')} htmlFor="ab-cd" flush>
                  <PresetChips
                    options={[
                      { value: '15', label: t('protection.min15') },
                      { value: '30', label: t('protection.min30') },
                      { value: '60', label: t('protection.hour1') },
                      { value: '120', label: t('protection.hour2') },
                      { value: '360', label: t('protection.hour6') },
                    ]}
                    value={String(automation?.autoBan.cooldownMinutes ?? 60)}
                    disabled={busy}
                    onChange={bindSaveNumber(
                      saveAutomation,
                      setAutomation,
                      'autoBan',
                      'cooldownMinutes',
                      60,
                    )}
                  />
                </Field>
                <Field label={t('protection.maxPerHour')} htmlFor="ab-max" flush>
                  <PresetChips
                    options={[
                      { value: '5', label: '5' },
                      { value: '10', label: '10' },
                      { value: '20', label: '20' },
                      { value: '40', label: '40' },
                      { value: '80', label: '80' },
                    ]}
                    value={String(automation?.autoBan.maxAutoBansPerHour ?? 40)}
                    disabled={busy}
                    onChange={bindSaveNumber(
                      saveAutomation,
                      setAutomation,
                      'autoBan',
                      'maxAutoBansPerHour',
                      40,
                    )}
                  />
                </Field>
                <Field label={t('protection.scanInterval')} htmlFor="ab-iv" flush hint={t('protection.schedulerDefault')}>
                  <PresetChips
                    options={[
                      { value: '30', label: '30s' },
                      { value: '60', label: '1m' },
                      { value: '120', label: '2m' },
                      { value: '180', label: '3m' },
                      { value: '300', label: '5m' },
                      { value: '600', label: '10m' },
                    ]}
                    value={String(automation?.autoBan.intervalSeconds ?? 120)}
                    onChange={bindSaveNumber(
                      saveAutomation,
                      setAutomation,
                      'autoBan',
                      'intervalSeconds',
                      120,
                      clampScanIntervalSeconds,
                    )}
                    disabled={busy}
                  />
                </Field>
              </FormLayout>
              <FormHint>
                {t('protection.autoBanThresholdHint')}
              </FormHint>
            </div>

            <div className="def-panel-card def-panel-card--muted">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.sectionMechanism')}</h3>
                <Button variant="ghost" size="sm" onClick={toggleMech}>
                  {showMech ? t('protection.collapse') : t('protection.expand')}
                </Button>
              </div>
              {showMech ? (
                <DataTable
                  columns={[
                    {
                      key: 'step',
                      header: t('protection.step'),
                      nowrap: true,
                      render: (row) => <strong>{row.step}</strong> },
                    {
                      key: 'mechanism',
                      header: t('protection.mechanism'),
                      className: 'u-text-sm',
                      render: (row) => row.mechanism },
                    {
                      key: 'tunable',
                      header: t('protection.youCanTune'),
                      className: 'u-text-sm muted',
                      render: (row) => row.tunable },
                  ]}
                  rows={
                    mechanisms.length
                      ? mechanisms
                      : [
                          {
                            step: t('protection.probe'),
                            mechanism: t('protection.probeSignals'),
                            tunable: t('protection.escalateThreshold') },
                          {
                            step: t('protection.emergency'),
                            mechanism: t('protection.neverAuto'),
                            tunable: t('protection.manualEmergency') },
                        ]
                  }
                  rowKey={(row) => row.step}
                />
              ) : null}
              {automation?.lastTickNotes?.length ? (
                <p className="muted u-text-sm u-mt-3">
                  {t('protection.lastNotes', { notes: automation.lastTickNotes.slice(0, 4).join(' · ') })}
                </p>
              ) : null}
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.sectionWeights')}</h3>
              </div>
              <p className="muted u-text-sm">
                {t('protection.weightsDesc')}
              </p>
              <FormLayout columns={2}>
                {(
                  [
                    ['networkDown', t('protection.signalNetworkDown')],
                    ['highReqRate', t('protection.signalHighReq')],
                    ['ddosHeuristic', t('protection.signalDdos')],
                    ['tcpInuse', t('protection.signalTcp')],
                    ['ufwInactive', t('protection.signalUfwOff')],
                    ['f2bBans', t('protection.signalF2bBans')],
                  ] as const
                ).map(([key, label]) => {
                  const raw = automation?.signalWeights?.[key] ?? 1;
                  const selected = Math.min(
                    3,
                    Math.max(0, Math.round(Number(raw) || 0)),
                  );
                  return (
                    <Field key={key} label={label} htmlFor={`sw-${key}-1`} flush>
                      <div
                        className="def-weight-radios"
                        role="radiogroup"
                        aria-label={t('protection.weightHint', { label })}
                      >
                        {([0, 1, 2, 3] as const).map((n) => {
                          const id = `sw-${key}-${n}`;
                          return (
                            <label
                              key={n}
                              htmlFor={id}
                              className={`def-weight-radios__opt${
                                selected === n
                                  ? ' def-weight-radios__opt--on'
                                  : ''
                              }`}
                            >
                              <input
                                id={id}
                                type="radio"
                                name={`sw-${key}`}
                                value={n}
                                checked={selected === n}
                                disabled={busy}
                                onChange={() => {
                                  setAutomation((a) =>
                                    a
                                      ? {
                                          ...a,
                                          signalWeights: {
                                            networkDown: 1,
                                            highReqRate: 1,
                                            ddosHeuristic: 1,
                                            tcpInuse: 1,
                                            ufwInactive: 1,
                                            f2bBans: 1,
                                            ...a.signalWeights,
                                            [key]: n } }
                                      : a,
                                  );
                                  void saveAutomation({
                                    signalWeights: { [key]: n } });
                                }}
                              />
                              <span>{n}</span>
                            </label>
                          );
                        })}
                      </div>
                    </Field>
                  );
                })}
              </FormLayout>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">⑤ Cloudflare Under Attack</h3>
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(automation?.cloudflare?.enabled)}
                    disabled={busy}
                    onChange={(e) =>
                      void saveAutomation({
                        cloudflare: {
                          enabled: e.target.checked,
                          zones: cfZonesText
                            .split(/[,\s]+/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                          onAutoEscalate: automation?.cloudflare?.onAutoEscalate !== false } })
                    }
                  />
                  <span>{automation?.cloudflare?.enabled ? t('protection.on') : t('protection.off')}</span>
                </label>
              </div>
              <FormHint>
                {t('protection.needCfToken')} <code className="inline">CF_API_TOKEN</code>
                {hasCfToken ? t('protection.detected') : t('protection.notSet')}
                {t('protection.cfOnEscalate')}
              </FormHint>
              <Field label={t('protection.zonesComma')} htmlFor="cf-zones" flush>
                <input
                  id="cf-zones"
                  value={cfZonesText}
                  onChange={bindInput(setCfZonesText)}
                  placeholder="example.com, app.example.com"
                  spellCheck={false}
                />
              </Field>
              <label className="def-switch u-mt-2">
                <input
                  type="checkbox"
                  checked={Boolean(automation?.cloudflare?.ufwAllowOnlyCf)}
                  disabled={busy}
                  onChange={(e) =>
                    void saveAutomation({
                      cloudflare: {
                        enabled: automation?.cloudflare?.enabled ?? true,
                        zones: cfZonesText
                          .split(/[,\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                        onAutoEscalate: automation?.cloudflare?.onAutoEscalate !== false,
                        ufwAllowOnlyCf: e.target.checked,
                        ufwKeepTcpPorts: automation?.cloudflare?.ufwKeepTcpPorts ?? [22] } })
                  }
                />
                <span>{t('protection.ufwOnlyCf')}</span>
              </label>
              <FormHint>
                {t('protection.ufwOnlyCfHint')}
              </FormHint>
              <FormActions>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={bindSaveCfZones(
                    saveAutomation,
                    cfZonesText,
                    automation?.cloudflare?.ufwAllowOnlyCf,
                    automation?.cloudflare?.ufwKeepTcpPorts,
                  )}
                >
                  {t('protection.saveZones')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  disabled={!cfZonesText.trim()}
                  onClick={bindDefensePostOnly(
                    run,
                    api.requestRaw,
                    '/api/v1/defense/cloudflare/under-attack',
                    {
                      enable: true,
                      zones: cfZonesText
                        .split(/[,\s]+/)
                        .map((s) => s.trim())
                        .filter(Boolean) },
                    t('protection.underAttackRequested'),
                  )}
                >
                  {t('protection.uaNow')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  onClick={bindDefensePostOnly(
                    run,
                    api.requestRaw,
                    '/api/v1/defense/cloudflare/under-attack',
                    {
                      enable: false,
                      zones: cfZonesText
                        .split(/[,\s]+/)
                        .map((s) => s.trim())
                        .filter(Boolean) },
                    t('protection.underAttackCleared'),
                  )}
                >
                  {t('protection.uaClear')}
                </Button>
              </FormActions>
            </div>
          </div>
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel def-panel stack">
            <SoftwareVersionBar softwareId="ufw" />
            <SoftwareVersionBar softwareId="fail2ban" />
            <div className="def-split">
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">{t('protection.fwUfwTitle')}</h3>
                  <Badge tone={stackFw?.installed ? 'ok' : 'warn'}>
                    {stackFw?.activeLabel ?? '—'}
                  </Badge>
                </div>
                <p className="def-kpi-body">
                  {t('protection.fwStats', {
                    allow: stackFw?.allowCount ?? '—',
                    deny: stackFw?.denyCount ?? '—' })}
                </p>
                <FormActions>
                  <Link
                    to="/protection/firewall"
                    className={buttonClassName({ variant: 'primary', size: 'sm' })}
                  >
                    {t('protection.fwRulesProfiles')}
                  </Link>
                </FormActions>
              </section>
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">fail2ban</h3>
                  <Badge tone={stackF2b?.installed ? 'ok' : 'warn'}>
                    {stackF2b?.activeLabel ?? '—'}
                  </Badge>
                </div>
                <p className="def-kpi-body">
                  {t('protection.f2bStats', {
                    jails: stackF2b?.jails ?? 0,
                    banned: stackF2b?.banned ?? 0 })}
                </p>
                <FormActions>
                  <Link
                    to="/protection/fail2ban"
                    className={buttonClassName({ variant: 'primary', size: 'sm' })}
                  >
                    {t('protection.jailsWhitelistPolicy')}
                  </Link>
                </FormActions>
              </section>
            </div>
          </div>
        ) : null}

        {tab === 'bans' ? (
          <div className="tab-panel def-panel">
            {/* Auto-ban control strip */}
            <section className="def-autoban">
              <div className="def-autoban__left">
                <div className="def-autoban__title">
                  <span className="def-autoban__icon" aria-hidden>
                    ⚡
                  </span>
                  <div>
                    <strong>{t('protection.autoBanLabel')}</strong>
                    <p>
                      {ab?.enabled
                        ? t('protection.autoBanOpen', { mode: ab.mode, n: ab.autoBansLastHour ?? 0, max: ab.maxAutoBansPerHour })
                        : t('protection.autoBanClosed')}
                      {ab?.pausedReason === 'no_execute'
                        ? t('protection.pausedNoExecute')
                        : ab?.pausedReason === 'circuit_breaker'
                          ? t('protection.circuitOpen')
                          : ''}
                    </p>
                  </div>
                </div>
              </div>
              <div className="def-autoban__controls">
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(ab?.enabled)}
                    disabled={busy}
                    onChange={(e) =>
                      void saveAutoBan({
                        enabled: e.target.checked,
                        mode: e.target.checked ? ab?.mode || 'soft' : 'off' })
                    }
                  />
                  <span>{ab?.enabled ? t('protection.open') : t('common.close')}</span>
                </label>
                <SegRadio
                  name="cmd-ab-mode"
                  aria-label={t('protection.autoBanModeLabel')}
                  size="sm"
                  value={(ab?.mode ?? 'soft') as string}
                  disabled={busy || !ab?.enabled}
                  onChange={(mode) =>
                    void saveAutoBan({
                      mode: mode as AutoBanPolicy['mode'],
                      enabled: mode !== 'off' })
                  }
                  options={[
                    { value: 'soft', label: t('protection.soft') },
                    { value: 'normal', label: t('protection.normal') },
                    { value: 'aggressive', label: t('protection.aggressive') },
                  ]}
                />
                <SegRadio
                  name="cmd-ab-meth"
                  aria-label={t('protection.banMethod')}
                  size="sm"
                  value={(ab?.method ?? banMethod) as string}
                  disabled={busy}
                  onChange={(m) => {
                    const method = m as 'fail2ban' | 'ufw' | 'both';
                    setBanMethod(method);
                    if (ab?.enabled) void saveAutoBan({ method });
                  }}
                  options={[
                    { value: 'fail2ban', label: 'fail2ban' },
                    { value: 'ufw', label: 'UFW' },
                    { value: 'both', label: t('protection.both') },
                  ]}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  onClick={bindDefenseAutoBanTick(
                    run,
                    api.requestRaw,
                    refresh,
                    t('protection.scanned'),
                  )}
                >
                  {t('protection.scanOnce')}
                </Button>
              </div>
            </section>

            {/* Sticky batch bar */}
            {selectedIps.length > 0 ? (
              <div className="def-batch-bar" role="region" aria-label={t('protection.bulkOps')}>
                <span>
                  {t('protection.selectedIps', { count: selectedIps.length })}
                </span>
                <div className="def-batch-bar__actions">
                  <Button variant="ghost" size="sm" onClick={clearSelected}>
                    {t('common.cancel')}
                  </Button>
                  <Button variant="danger" size="sm" loading={busy} onClick={bindVoid(banSelected)}>
                    {t('protection.banSelected')}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="def-section-head">
              <div>
                <h3 className="def-section-head__title">
                  {t('protection.suspectIps')}
                  {actionableSuspects.length ? (
                    <Badge tone="warn">{actionableSuspects.length}</Badge>
                  ) : null}
                </h3>
                <p className="def-section-head__desc">
                  {suspectNotes.join(' · ') || t('protection.fromAccessLog')}
                </p>
              </div>
              <div className="def-section-head__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setHideZeroScore((v) => !v)}
                >
                  {hideZeroScore
                    ? t('protection.showZeroScore')
                    : t('protection.hideZeroScore')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!actionableSuspects.length}
                  onClick={bindSelectAllSuspects(setSelected, actionableSuspects)}
                >
                  {t('protection.selectAll')}
                </Button>
              </div>
            </div>

            {!visibleSuspects.length ? (
              <div className="def-empty-card">
                <EmptyState
                  title={t('protection.noSuspectIps')}
                  description={t('protection.noSuspectDesc')}
                />
              </div>
            ) : (
              <div className="def-suspect-grid">
                {visibleSuspects.map((s) => {
                  const selfKind = classifySelfIp(s.ip, selfIpOpts);
                  const disabled = Boolean(
                    s.alreadyBanned || s.whitelisted || selfKind,
                  );
                  const checked = Boolean(selected[s.ip]);
                  return (
                    <article
                      key={s.ip}
                      className={[
                        'def-suspect',
                        checked ? 'is-selected' : '',
                        disabled ? 'is-disabled' : '',
                        s.score >= 40 ? 'is-hot' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <label className="def-suspect__check">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={checked}
                          onChange={(e) =>
                            setSelected((prev) => ({ ...prev, [s.ip]: e.target.checked }))
                          }
                        />
                        <span className="def-suspect__ip">
                          <code>{s.ip}</code>
                        </span>
                      </label>
                      <div className="def-suspect__badges">
                        <Badge tone={scoreTone(s.score)}>{s.score}</Badge>
                        {s.alreadyBanned ? <Badge tone="ok">{t('protection.alreadyBanned')}</Badge> : null}
                        {s.whitelisted ? <Badge tone="info">{t('protection.whitelist')}</Badge> : null}
                        {selfKind ? (
                          <Badge tone="warn">
                            {selfKind === 'login'
                              ? t('protection.selfLoginIp')
                              : selfKind === 'host'
                                ? t('protection.selfHostIp')
                                : t('protection.selfIp')}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="def-suspect__why">{s.reasons.slice(0, 3).join(' · ') || '—'}</p>
                      <div className="def-suspect__meta">
                        <span>{t('protection.hitsCount', { n: s.hits })}</span>
                        <span>{s.sources.join(', ')}</span>
                        <span>{relTime(s.lastSeen, t)}</span>
                      </div>
                      <div className="def-suspect__actions">
                        {selfKind ? (
                          <span className="muted u-text-sm" title={t('protection.cannotBanSelf', { ip: s.ip })}>
                            {t('protection.cannotBanSelf', { ip: s.ip })}
                          </span>
                        ) : (
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          disabled={disabled}
                          onClick={bindBanOne(banOne, s.ip, s.reasons[0])}
                        >
                          {t('protection.ban')}
                        </Button>
                        )}
                        {!s.whitelisted ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            onClick={() =>
                              void run(async () => {
                                await api.requestRaw('/api/v1/defense/whitelist', {
                                  method: 'POST',
                                  body: JSON.stringify({ ip: s.ip, action: 'add' }) });
                                await refresh();
                                return { ok: true, notes: [t('protection.whitelistPlus', { ip: s.ip })] };
                              }, t('protection.whitelistAdded'))
                            }
                          >
                            {t('protection.whitelist')}
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <FormHint>
              {t('protection.bansWorkflow')}{' '}
              <Link to="/protection/fail2ban">{t('protection.f2bTool')}</Link>
              {t('protection.noSecondJail')}
            </FormHint>

            <DataTable
              title={t('protection.activeBansTitle', {
                count: banList.meta?.total ?? status?.bans.count ?? banList.items.length })}
              description={t('protection.activeBansDesc')}
              toolbar={
                <ActionBar>
                  <Link
                    to="/protection/fail2ban"
                    className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                  >
                    {t('protection.f2bTool')}
                  </Link>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = (await api.requestRaw('/api/v1/defense/stack/apply', {
                          method: 'POST',
                          body: JSON.stringify({ execute: true }) })) as OpsResultLike;
                        if (r.notes) r.notes = summarizeOpsNotes(r.notes, t);
                        await refresh();
                        await banList.refresh();
                        return r;
                      }, t('protection.stackApplyDone', { defaultValue: 'Defense stack apply requested' }))
                    }
                  >
                    {t('protection.stackApply')}
                  </Button>
                </ActionBar>
              }
              filters={
                <ServerListFilters
                  q={banList.q}
                  setQ={banList.setQ}
                  searching={banList.searching}
                  loading={banList.loading}
                  total={banList.meta?.total ?? banList.items.length}
                  shown={banList.items.length}
                  activeFilterCount={banList.activeFilterCount}
                  clear={banList.clear}
                  chipGroups={[
                    {
                      key: 'source',
                      allLabel: t('common.all', { defaultValue: 'All' }),
                      value: banList.filters.source ?? '',
                      onChange: (v) => banList.setFilter('source', v),
                      chips: [
                        { id: 'fail2ban', label: 'fail2ban' },
                        { id: 'panel', label: 'panel' },
                        { id: 'ufw', label: 'ufw' },
                        { id: 'auto', label: 'auto' },
                      ] },
                  ]}
                />
              }
              columns={[
                {
                  key: 'ip',
                  header: 'IP',
                  render: (b) => <code className="inline">{b.ip}</code> },
                {
                  key: 'src',
                  header: t('protection.source'),
                  className: 'muted u-text-sm',
                  render: (b) =>
                    `${b.source}${b.jail ? ` · ${b.jail}` : ''}` },
              ]}
              rows={banList.items.length ? banList.items : status?.bans.items ?? []}
              rowKey={(b) => `${b.source}-${b.jail}-${b.ip}`}
              rowActions={(b) => (
                <ActionBar align="end">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = (await api.requestRaw('/api/v1/defense/unban', {
                          method: 'POST',
                          body: JSON.stringify({
                            ip: b.ip,
                            jail: b.jail,
                            method: 'fail2ban' }) })) as OpsResultLike;
                        if (r.notes) r.notes = summarizeOpsNotes(r.notes, t);
                        await refresh();
                        return r;
                      }, t('protection.unbanned'))
                    }
                  >
                    {t('protection.unban')}
                  </Button>
                </ActionBar>
              )}
              empty={
                <EmptyState title={t('protection.noBans')} description={t('protection.noBansDesc')} />
              }
            />

            <div className="def-panel-card u-mt-4">
              <div className="def-section-head">
                <div>
                  <h3 className="def-section-head__title">
                    {t('protection.autoBanWhitelistTitle')}{' '}
                    <Badge tone="neutral">{ab?.whitelist?.length ?? 0}</Badge>
                  </h3>
                  <p className="def-section-head__desc">
                    {t('protection.autoBanWhitelistDesc')}
                  </p>
                </div>
                <ActionBar>
                  <Link
                    to="/protection/fail2ban?tab=whitelist"
                    className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                  >
                    {t('protection.ignoreipWhitelist')}
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleWl}
                  >
                    {showWl ? t('protection.collapseQuickAdd') : t('protection.quickAddOne')}
                  </Button>
                </ActionBar>
              </div>
              <div className="def-wl">
                {(ab?.whitelist ?? []).slice(0, 12).map((w) => (
                  <span key={w} className="def-wl__chip">
                    <code>{w}</code>
                    <button
                      type="button"
                      className="def-wl__x"
                      disabled={busy}
                      onClick={bindDefenseWhitelistAction(
                        run,
                        api.requestRaw,
                        w,
                        'remove',
                        refresh,
                        t('protection.updated'),
                        undefined,
                        [t('protection.removeItem', { w })],
                      )}
                      aria-label={t('protection.removeItem', { w })}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {!ab?.whitelist?.length ? (
                  <span className="muted u-text-sm">{t('protection.notSetSuggestAdmin')}</span>
                ) : null}
                {(ab?.whitelist?.length ?? 0) > 12 ? (
                  <span className="muted u-text-sm">
                    {t('protection.moreItems', { n: (ab?.whitelist?.length ?? 0) - 12 })}
                  </span>
                ) : null}
              </div>
              {showWl ? (
                <div className="def-wl-add">
                  <input
                    value={wlInput}
                    onChange={bindInput(setWlInput)}
                    placeholder={t('protection.ipOrCidr')}
                    spellCheck={false}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={!wlInput.trim()}
                    onClick={bindDefenseWhitelistAction(
                      run,
                      api.requestRaw,
                      wlInput.trim(),
                      'add',
                      refresh,
                      t('protection.added'),
                      setWlInput,
                      [t('protection.autoBanWhitelistAdded')],
                    )}
                  >
                    {t('protection.add')}
                  </Button>
                </div>
              ) : null}
            </div>

            <section className="def-panel-card def-panel-card--muted">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.manualBanTitle')}</h3>
                <Button variant="ghost" size="sm" onClick={toggleManual}>
                  {showManual ? t('protection.collapse') : t('protection.expand')}
                </Button>
              </div>
              {showManual ? (
                <FormLayout columns={2}>
                  <Field label="IP" htmlFor="def-ip" flush required>
                    <input
                      id="def-ip"
                      value={banIp}
                      onChange={bindInput(setBanIp)}
                      placeholder={t('protection.banIpPlaceholder')}
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={t('protection.reason')} htmlFor="def-reason" flush>
                    <input
                      id="def-reason"
                      value={banReason}
                      onChange={bindInput(setBanReason)}
                      placeholder={t('protection.scanBrute')}
                    />
                  </Field>
                  <div className="def-manual-actions">
                    <Button
                      variant="danger"
                      size="md"
                      loading={busy}
                      disabled={!banIp.trim()}
                      onClick={bindBanAndClear(banOne, banIp, banReason, () => setBanIp(''))}
                    >
                      {t('protection.ban')}
                    </Button>
                    <FormHint>{t('protection.methodFollows')}</FormHint>
                  </div>
                </FormLayout>
              ) : (
                <p className="muted u-text-sm">{t('protection.preferSuspectList')}</p>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'intel' ? (
          <div className="tab-panel def-panel">
            <div className="def-split def-split--intel">
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">{t('protection.threatSignals')}</h3>
                  <span className="muted u-text-sm">{t('protection.scoreSource')}</span>
                </div>
                {!status?.signals.length ? (
                  <EmptyState title={t('protection.noSignals')} description={t('protection.pressReprobe')} />
                ) : (
                  <ul className="def-signal-list">
                    {status.signals.map((s) => (
                      <li key={s.id} className={s.points > 0 ? 'is-hot' : ''}>
                        <div className="def-signal-list__top">
                          <strong>{s.label}</strong>
                          <Badge tone={s.points > 0 ? 'warn' : 'ok'}>
                            {s.points > 0 ? `+${s.points}` : '0'}
                          </Badge>
                        </div>
                        <code className="def-signal-list__val">{formatSignalValue(s.value, t)}</code>
                        {s.detail && !/need to be root/i.test(String(s.detail)) ? (
                          <p className="muted u-text-sm">{s.detail}</p>
                        ) : s.id === 'ufw' && labels?.firewall.detail ? (
                          <p className="muted u-text-sm">{labels.firewall.detail}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">
                    {t('protection.topIpsTitle')}{' '}
                    <Badge tone="neutral">{topIps.length}</Badge>
                  </h3>
                  <span className="muted u-text-sm">{t('protection.accessAuthSample')}</span>
                </div>
                <FormHint>
                  {t('protection.sampleWindowHint')}{' '}
                  {t('protection.fullLogsAt')}{' '}
                  <Link to="/logs?source=file:auth">{t('protection.logCenter')}</Link>
                </FormHint>
                <DataTable
                  columns={[
                    {
                      key: 'ip',
                      header: 'IP',
                      render: (row) => (
                        <code className="inline">{row.ip}</code>
                      ) },
                    {
                      key: 'score',
                      header: t('protection.colScore'),
                      nowrap: true,
                      render: (row) => (
                        <Badge tone={row.score >= 40 ? 'warn' : 'info'}>
                          {row.score}
                        </Badge>
                      ) },
                    {
                      key: 'hits',
                      header: t('protection.colHits'),
                      nowrap: true,
                      render: (row) => row.hits },
                    {
                      key: 's429',
                      header: t('protection.col429'),
                      nowrap: true,
                      render: (row) => row.s429 },
                  ]}
                  rows={topIps.slice(0, 20)}
                  rowKey={(row) => row.ip}
                  rowActions={(row) => {
                    const selfKind = classifySelfIp(row.ip, selfIpOpts);
                    return (
                    <ActionBar align="end">
                      {selfKind ? (
                        <Badge tone="warn">
                          {selfKind === 'login'
                            ? t('protection.selfLoginIp')
                            : selfKind === 'host'
                              ? t('protection.selfHostIp')
                              : t('protection.selfIp')}
                        </Badge>
                      ) : null}
                      {selfKind ? null : (
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={bindBanOne(banOne, row.ip, `top-ip score=${row.score}`)}
                      >
                        {t('protection.ban')}
                      </Button>
                      )}
                    </ActionBar>
                    );
                  }}
                  empty={
                    <EmptyState
                      title={t('protection.noTopIps')}
                      description={t('protection.topIpsAfterLog')}
                    />
                  }
                />
              </section>
            </div>

            <div className="def-split def-split--intel">
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">
                    {t('protection.vhostLimits')}{' '}
                    <Badge tone="ok">
                      {vhostLimits?.withLimit ?? 0}/{vhostLimits?.total ?? 0}
                    </Badge>
                  </h3>
                </div>
                {!vhostLimits?.items.length ? (
                  <EmptyState title={t('protection.noManagedVhost')} description={t('protection.afterPresetMarker')} />
                ) : (
                  <ul className="def-ban-list">
                    {vhostLimits.items.slice(0, 30).map((v) => (
                      <li key={v.name}>
                        <code>{v.name}</code>
                        <span className="muted">
                          {v.hasDefenseMarker ? t('protection.injected') : t('protection.notInjected')}
                        </span>
                        <Badge tone={v.hasDefenseMarker ? 'ok' : 'warn'}>
                          {v.hasDefenseMarker ? 'OK' : '—'}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">{t('protection.eventStream')}</h3>
                  <span className="muted u-text-sm">{t('protection.hours48')}</span>
                </div>
                {!timeline.length ? (
                  <EmptyState title={t('protection.noEvents')} description={t('protection.eventsAfterOps')} />
                ) : (
                  <ol className="def-timeline">
                    {timeline.map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        <span className="def-timeline__time">{relTime(e.at, t)}</span>
                        <div>
                          <Badge tone="info">
                            {t(`protection.eventKind.${e.kind}`, {
                              defaultValue: e.kind.replace(/_/g, ' ') })}
                          </Badge>{' '}
                          <strong>{e.title}</strong>
                          {e.detail ? <p className="muted u-text-sm">{e.detail}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </div>
        ) : null}

        {tab === 'geo' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.geoipDb')}</h3>
                <ActionBar>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={bindLoadGeo(loadGeo, (e) => setError(e.message))}
                  >
                    {t('protection.refreshStatus')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = await api.requestRaw<{
                          ok: boolean;
                          notes: string[];
                          status?: GeoipStatus;
                        }>('/api/v1/defense/geoip/update', {
                          method: 'POST',
                          body: '{}' });
                        await loadGeo();
                        return {
                          ok: r.ok,
                          notes: r.notes ?? [] };
                      }, t('protection.geoipUpdated'))
                    }
                  >
                    {t('protection.updateDbNow')}
                  </Button>
                </ActionBar>
              </div>
              <FormHint>
                {t('protection.geoipSourceHint')}
              </FormHint>
              {geoErr ? (
                <div className="geo-status-box geo-status-box--err">
                  <Alert variant="error">{geoErr}</Alert>
                  <ActionBar className="u-mt-2">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={geoLoading || busy}
                      onClick={bindLoadGeo(loadGeo)}
                    >
                      {t('protection.retry')}
                    </Button>
                  </ActionBar>
                </div>
              ) : null}
              {geoLoading && !geoStatus ? (
                <div className="geo-status-box geo-status-box--loading" role="status">
                  <span className="spinner" aria-hidden />
                  <span className="muted">{t('protection.loadingGeoip')}</span>
                </div>
              ) : null}
              {geoStatus ? (
                <>
                  <SummaryStrip
                    items={[
                      { label: t('protection.provider'), value: geoStatus.provider === 'sapics+dbip' ? 'DB-IP / sapics' : geoStatus.provider },
                      {
                        label: t('protection.dbReady'),
                        value: geoStatus.ready ? t('protection.yes') : t('protection.no'),
                        hint: geoStatus.ready
                          ? t('protection.dbReadyHint')
                          : t('protection.dbNotReadyHint'),
                        tone: geoStatus.ready ? 'ok' : 'warn' },
                      {
                        label: t('protection.stale'),
                        value: !geoStatus.ready
                          ? t('protection.freshnessNa')
                          : geoStatus.stale
                            ? t('protection.older7d')
                            : t('protection.yes'),
                        hint: t('protection.staleHint'),
                        tone: !geoStatus.ready
                          ? 'default'
                          : geoStatus.stale
                            ? 'warn'
                            : 'ok' },
                      {
                        label: t('protection.lastSuccess'),
                        value: geoStatus.meta?.lastSuccessAt
                          ? relTime(geoStatus.meta.lastSuccessAt, t)
                          : '—' },
                    ]}
                  />
                  <ul className="list-plain list-spaced">
                    {(geoStatus.sources ?? []).map((s) => (
                      <li key={s.filename}>
                        <code className="inline">{s.filename}</code>{' '}
                        <Badge tone={s.present ? 'ok' : 'warn'}>
                          {s.present ? t('protection.downloaded') : t('protection.missing')}
                        </Badge>
                        <span className="muted u-text-sm">
                          {' '}
                          · {s.license} · {s.updateHint}
                          {s.bytes != null ? ` · ${Math.round(s.bytes / 1024)} KiB` : ''}
                          {s.mtime ? ` · ${relTime(s.mtime, t)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {geoStatus.notes?.length ? (
                    <ul className="list-plain u-mt-3">
                      {geoStatus.notes.map((n) => (
                        <li key={n} className="muted u-text-sm">
                          {n}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {geoStatus.attribution?.length ? (
                    <FormHint>{geoStatus.attribution.join(' · ')}</FormHint>
                  ) : null}
                  {geoStatus.scheduler?.nextRunAt ? (
                    <FormHint>
                      {t('protection.nextScheduledUpdate', {
                        at: formatDateTimeLocale(
                          geoStatus.scheduler.nextRunAt,
                          i18n.language,
                        ),
                      })}
                    </FormHint>
                  ) : null}
                </>
              ) : null}
              {!geoLoading && !geoStatus && !geoErr ? (
                <div className="geo-status-box">
                  <p className="muted u-mb-2">{t('protection.statusNotLoaded')}</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={bindLoadGeo(loadGeo)}
                  >
                    {t('protection.load')}
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.accessPolicy')}</h3>
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={geoEnabled}
                    onChange={bindCheck(setGeoEnabled)}
                  />
                  {t('protection.enable')}
                </label>
              </div>
              <FormHint>
                {t('protection.freeGranularity')}
              </FormHint>
              {!geoEnabled ? (
                <Alert variant="warn">{t('protection.geoDraftOnly')}</Alert>
              ) : null}
              {geoMode === 'allow_list' ? (
                <Alert variant="error">
                  {t('protection.allowListDanger')}
                </Alert>
              ) : null}
              <FormLayout columns={2}>
                <Field label={t('protection.mode')} htmlFor="geo-mode" flush>
                  <SegRadio
                    name="geo-mode"
                    aria-label={t('protection.geoMode')}
                    value={geoMode}
                    onChange={bindValueSet(setGeoMode as (v: string) => void)}
                    options={[
                      { value: 'deny_list', label: t('protection.denyList') },
                      { value: 'allow_list', label: t('protection.allowListHighRisk') },
                    ]}
                  />
                </Field>
                <Field label={t('protection.autoUpdateDb')} htmlFor="geo-au" flush>
                  <label className="def-switch">
                    <input
                      id="geo-au"
                      type="checkbox"
                      checked={geoAutoUpdate}
                      onChange={bindCheck(setGeoAutoUpdate)}
                    />
                    {t('protection.dailySchedule')}
                  </label>
                </Field>
              </FormLayout>

              <div className="geo-select-grid geo-select-grid--4 u-mt-3">
                <Field
                  label={t('protection.countriesSelected', { n: geoCountries.length })}
                  htmlFor="geo-cc"
                  flush
                  fullWidth
                  hint={t('protection.searchCountry')}
                >
                  <MultiCheckSelect
                    id="geo-cc"
                    options={getGeoCountries(t)}
                    value={geoCountries}
                    onChange={setGeoCountries}
                    searchPlaceholder={t('protection.countryPlaceholder')}
                    disabled={busy}
                    confirmSelectAll={
                      geoMode === 'deny_list'
                        ? t('protection.selectAllCountriesWarn')
                        : undefined
                    }
                  />
                </Field>
                <Field
                  label={t('protection.regionsSelected', { n: geoRegions.length })}
                  htmlFor="geo-reg"
                  flush
                  fullWidth
                  hint={
                    geoCountries.length
                      ? t('protection.regionsHint')
                      : t('protection.pickCountryFirst')
                  }
                >
                  <MultiCheckSelect
                    id="geo-reg"
                    options={getGeoRegions(t, geoCountries)}
                    value={geoRegions}
                    onChange={setGeoRegions}
                    allowCustom
                    customPlaceholder={t('protection.customRegion')}
                    searchPlaceholder={t('protection.regionPlaceholder')}
                    disabled={busy}
                  />
                </Field>
                <Field
                  label={t('protection.continentsSelected', { n: geoContinents.length })}
                  htmlFor="geo-cont"
                  flush
                  fullWidth
                  hint={t('protection.continentsHint')}
                >
                  <MultiCheckSelect
                    id="geo-cont"
                    options={getGeoContinents(t)}
                    value={geoContinents}
                    onChange={setGeoContinents}
                    searchPlaceholder={t('protection.continentPlaceholder')}
                    disabled={busy}
                  />
                </Field>
                <Field
                  label={t('protection.asnsSelected', { n: geoAsns.length })}
                  htmlFor="geo-asn"
                  flush
                  fullWidth
                  hint={t('protection.asnsHint')}
                >
                  <MultiCheckSelect
                    id="geo-asn"
                    options={GEO_ASN_PROVIDERS}
                    value={geoAsns}
                    onChange={(next) =>
                      setGeoAsns(
                        next
                          .map((x) => normalizeAsnInput(x) || x)
                          .filter(Boolean),
                      )
                    }
                    allowCustom
                    customPlaceholder={t('protection.customAsn')}
                    searchPlaceholder={t('protection.asnPlaceholder')}
                    disabled={busy}
                  />
                </Field>
              </div>

              <div className="def-panel-card def-panel-card--muted u-mt-3">
                <div className="def-section-head">
                  <h4 className="def-section-head__title u-text-body">
                    {t('protection.cityPolicy')}
                  </h4>
                  <label className="def-switch">
                    <input
                      type="checkbox"
                      checked={geoCityPolicy}
                      onChange={bindCheck(setGeoCityPolicy)}
                    />
                    {t('protection.useCityAccess')}
                  </label>
                </div>
                <FormHint>
                  {t('protection.cityPolicyHint')}
                </FormHint>
                {geoCityPolicy ? (
                  <>
                    <div className="mcs__chips u-mb-2">
                      {geoCities.length === 0 ? (
                        <span className="muted u-text-sm">{t('protection.noCitiesYet')}</span>
                      ) : (
                        geoCities.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className="mcs__chip"
                            onClick={bindListRemove(setGeoCities, c)}
                          >
                            {c}
                            <span className="mcs__chip-x">×</span>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="mcs__custom">
                      <input
                        value={geoCityDraft}
                        onChange={bindInput(setGeoCityDraft)}
                        placeholder={t('protection.cityExample')}
                        spellCheck={false}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const v = geoCityDraft.trim();
                            if (!v) return;
                            const key = v.includes('|')
                              ? v
                              : geoCountries[0]
                                ? `${geoCountries[0]}|${v}`
                                : v;
                            if (!geoCities.includes(key)) {
                              setGeoCities((prev) => [...prev, key]);
                            }
                            setGeoCityDraft('');
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const v = geoCityDraft.trim();
                          if (!v) return;
                          const key = v.includes('|')
                            ? v
                            : geoCountries[0]
                              ? `${geoCountries[0]}|${v}`
                              : v;
                          if (!geoCities.includes(key)) {
                            setGeoCities((prev) => [...prev, key]);
                          }
                          setGeoCityDraft('');
                        }}
                      >
                        {t('protection.add')}
                      </Button>
                    </div>
                  </>
                ) : null}
              </div>

              <FormActions>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!geoStatus?.ready}
                  title={
                    !geoStatus?.ready
                      ? t('protection.geoNeedDb')
                      : geoEnabled
                        ? t('protection.savePolicy')
                        : t('protection.geoDraftOnly')
                  }
                  onClick={() =>
                    void run(async () => {
                      const r = await api.requestRaw<{
                        policy: IpAccessPolicy;
                        applyNotes?: string[];
                      }>('/api/v1/defense/geoip/policy', {
                        method: 'PUT',
                        body: JSON.stringify({
                          enabled: geoEnabled,
                          mode: geoMode,
                          countries: geoCountries,
                          continents: geoContinents,
                          regions: geoRegions,
                          cities: geoCities,
                          cityPolicyEnabled: geoCityPolicy,
                          asns: geoAsns.map((a) => normalizeAsnInput(a) || a),
                          autoUpdate: geoAutoUpdate,
                          enforce: {
                            autoBan: true,
                            nginx: true,
                            ufw: false } }) });
                      await loadGeo();
                      return {
                        ok: true,
                        notes: [
                          t('protection.policySaved', { c: r.policy.countries.length, r: r.policy.regions?.length ?? 0, a: r.policy.asns.length }),
                          ...(r.applyNotes ?? []),
                        ] };
                    }, t('protection.ipPolicySaved'))
                  }
                >
                  {t('protection.savePolicy')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  disabled={!geoEnabled || !geoStatus?.ready}
                  title={
                    !geoStatus?.ready
                      ? t('protection.geoNeedDb')
                      : geoEnabled
                        ? t('protection.applyNginxSnippet')
                        : t('protection.geoDraftOnly')
                  }
                  onClick={bindDefenseGeoApply(
                    run,
                    api.requestRaw,
                    t('protection.nginxGeoWritten'),
                  )}
                >
                  {t('protection.applyNginxSnippet')}
                </Button>
              </FormActions>
              <FormHint>
                {t('protection.nginxSnippetHint')}
              </FormHint>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('protection.testIp')}</h3>
              </div>
              <FormLayout columns={2}>
                <Field label={t('protection.ipAddress')} htmlFor="geo-lip" flush>
                  <input
                    id="geo-lip"
                    value={lookupIp}
                    onChange={bindInput(setLookupIp)}
                    placeholder={t('protection.lookupPlaceholder')}
                    spellCheck={false}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await api.requestRaw<{
                        lookup: Record<string, unknown>;
                        access: {
                          blocked: boolean;
                          reason?: string;
                          matched: string[];
                        };
                      }>('/api/v1/defense/geoip/lookup', {
                        method: 'POST',
                        body: JSON.stringify({ ip: lookupIp }) });
                      setLookupResult(r);
                      const L = r.lookup ?? {};
                      return {
                        ok: Boolean(L.ok !== false),
                        notes: [
                          `country=${String(L.country ?? '—')} continent=${String(L.continent ?? '—')} asn=${String(L.asn ?? '—')} ${String(L.asName ?? '')}`,
                          r.access?.blocked
                            ? t('protection.wouldBlock', { reason: r.access.reason, matched: r.access.matched?.join(', ') })
                            : t('protection.wouldAllow', { reason: r.access?.reason ?? 'ok' }),
                          ...((L.notes as string[]) ?? []).slice(0, 4),
                        ] };
                    }, t('protection.lookupDone'))
                  }
                >
                  {t('protection.lookup')}
                </Button>
              </FormActions>
              {lookupResult?.lookup ? (
                <>
                  <ActionBar className="u-mt-3 u-mb-2">
                    {lookupResult.lookup.country ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={bindAppendUniqueStr(
                          setGeoCountries,
                          String(lookupResult.lookup!.country),
                        )}
                      >
                        {t('protection.plusCountry', { v: String(lookupResult.lookup.country) })}
                      </Button>
                    ) : null}
                    {lookupResult.lookup.regionKey ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={bindAppendUniqueStr(
                          setGeoRegions,
                          String(lookupResult.lookup!.regionKey),
                        )}
                      >
                        {t('protection.plusRegion', { v: String(lookupResult.lookup.regionKey) })}
                      </Button>
                    ) : null}
                    {lookupResult.lookup.cityKey ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={bindAppendUniqueStr(
                          setGeoCities,
                          String(lookupResult.lookup!.cityKey),
                          setGeoCityPolicy,
                          true,
                        )}
                      >
                        {t('protection.plusCity', { v: String(lookupResult.lookup.city) })}
                      </Button>
                    ) : null}
                    {lookupResult.lookup.asn ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const a = String(lookupResult.lookup!.asn);
                          if (!geoAsns.includes(a)) {
                            setGeoAsns((p) => [...p, a]);
                          }
                        }}
                      >
                        + ASN {String(lookupResult.lookup.asn)}
                      </Button>
                    ) : null}
                  </ActionBar>
                  <DataTable
                    columns={[
                      {
                        key: 'label',
                        header: t('protection.item'),
                        nowrap: true,
                        render: (row) => <strong>{row.label}</strong> },
                      {
                        key: 'value',
                        header: t('protection.value'),
                        render: (row) => row.value },
                    ]}
                    rows={(
                      [
                        ['IP', lookupResult.lookup.ip],
                        [t('protection.country'), lookupResult.lookup.country],
                        [
                          t('protection.region'),
                          lookupResult.lookup.regionKey ||
                            lookupResult.lookup.regionName,
                        ],
                        [t('protection.city'), lookupResult.lookup.city],
                        [t('protection.continent'), lookupResult.lookup.continent],
                        [
                          t('protection.coords'),
                          lookupResult.lookup.latitude != null
                            ? `${lookupResult.lookup.latitude}, ${lookupResult.lookup.longitude}`
                            : '—',
                        ],
                        ['ASN', lookupResult.lookup.asn],
                        [t('protection.provider'), lookupResult.lookup.asName],
                        [t('protection.source'), lookupResult.lookup.source],
                        [
                          t('protection.policy'),
                          lookupResult.access?.blocked ? t('protection.block') : t('protection.allow'),
                        ],
                        [
                          t('protection.matched'),
                          lookupResult.access?.matched?.join(', ') || '—',
                        ],
                      ] as const
                    ).map(([label, v]) => ({
                      label,
                      value: String(v ?? '—') }))}
                    rowKey={(row) => row.label}
                  />
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="protection" /> : null}
      </PageTabs>

      <OpsResultPanel
        title={t('opsResult.title')}
        result={
          result
            ? {
                ...result,
                notes: summarizeOpsNotes(
                  Array.isArray(result.notes) ? result.notes.map(String) : undefined,
                  t,
                ) }
            : result
        }
        message={msg}
        busy={busy}
      />

      <ConfirmDialog
        open={presetConfirmId != null}
        onClose={bindCloseIfIdle(busy, () => setPresetConfirmId(null))}
        title={t('protection.applyStricterTitle')}
        description={t('protection.applyStricterDesc')}
        confirmLabel={t('common.apply')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => {
          const id = presetConfirmId;
          setPresetConfirmId(null);
          if (id) void applyPreset(id, true, false, 'ok');
        }}
      />

      <PromptDialog
        open={emergencyPromptOpen}
        onClose={bindCloseIfIdle(busy, () => setEmergencyPromptOpen(false))}
        title={t('protection.confirmEmergencyTitle')}
        description={t('protection.confirmEmergencyDesc')}
        label={t('protection.confirmString')}
        placeholder="EMERGENCY"
        expectExact="EMERGENCY"
        confirmLabel={t('protection.applyEmergency')}
        danger
        busy={busy}
        onSubmit={() => {
          setEmergencyPromptOpen(false);
          void applyPreset('emergency', true, false, 'EMERGENCY');
          return true;
        }}
      />
    </FeaturePageLayout>
  );
}
