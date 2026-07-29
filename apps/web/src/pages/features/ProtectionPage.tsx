/**
 * Defense Center — SOC-simple command UI for DDoS / attack response.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  KpiCard,
  KpiGrid,
  LoadingBlock,
  MultiCheckSelect,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  Tabs,
  buttonClassName,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  GEO_ASN_PROVIDERS,
  GEO_CONTINENTS,
  GEO_COUNTRIES,
  normalizeAsnInput,
  regionsForCountries,
} from '../../features/defense/geo-options';

const TABS = ['command', 'automation', 'bans', 'geo', 'stack', 'intel'] as const;

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

const LEVEL_META: Record<
  ThreatLevel,
  { label: string; verb: string; tone: 'ok' | 'warn' | 'danger'; hint: string }
> = {
  low: {
    label: '正常',
    verb: '系統平穩',
    tone: 'ok',
    hint: '維持日常防護即可',
  },
  elevated: {
    label: '偏高',
    verb: '有異常跡象',
    tone: 'warn',
    hint: '建議切到「加固」並留意可疑 IP',
  },
  under_attack: {
    label: '受攻擊',
    verb: '疑似正在受攻擊',
    tone: 'danger',
    hint: '立即套用「受攻擊」檔 + 批量封禁',
  },
  critical: {
    label: '危急',
    verb: '威脅嚴重',
    tone: 'danger',
    hint: '考慮緊急檔；確認白名單有你',
  },
};

const PRESET_META: Record<
  string,
  { step: number; accent: string; when: string }
> = {
  daily: { step: 1, accent: 'calm', when: '日常營運' },
  hardened: { step: 2, accent: 'firm', when: '掃描／暴力' },
  under_attack: { step: 3, accent: 'alert', when: 'L7 爆量' },
  emergency: { step: 4, accent: 'critical', when: '最後手段' },
};

function summarizeOpsNotes(notes: string[] | undefined): string[] {
  if (!notes?.length) return [];
  return notes.map((n) => {
    if (/YSK_EXECUTE|未開啟系統|blocked system|無法 ban 到系統/i.test(n)) {
      return '未套用到系統（需 root + YSK_EXECUTE=1）— 已記到管理設定';
    }
    if (/已寫 Nginx|Wrote .*nginx|00-ysk-defense/i.test(n)) {
      return '已寫入 Nginx 限速管理檔';
    }
    if (/jail\.local|fail2ban/i.test(n) && /Wrote|已寫/i.test(n)) {
      return '已寫入 fail2ban 管理設定';
    }
    if (n.length > 120 && n.includes('/')) {
      return n.replace(/\/home\/[^ ]+/g, '…').slice(0, 100);
    }
    return n;
  });
}

function toneToBadge(t?: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (t === 'ok') return 'ok';
  if (t === 'warn') return 'warn';
  if (t === 'danger') return 'danger';
  if (t === 'info') return 'info';
  return 'neutral';
}

function relTime(iso?: string): string {
  if (!iso) return '—';
  const d = Date.now() - new Date(iso).getTime();
  if (d < 60_000) return '剛剛';
  if (d < 3600_000) return `${Math.floor(d / 60_000)} 分鐘前`;
  if (d < 86400_000) return `${Math.floor(d / 3600_000)} 小時前`;
  return new Date(iso).toLocaleString();
}

export function ProtectionPage() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = usePageTab(TABS, 'command');
  const [status, setStatus] = useState<DefenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [banIp, setBanIp] = useState('');
  const [banReason, setBanReason] = useState('');
  const [banMethod, setBanMethod] = useState<'fail2ban' | 'ufw' | 'both'>('fail2ban');
  const [suspects, setSuspects] = useState<SuspectIp[]>([]);
  const [suspectNotes, setSuspectNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [wlInput, setWlInput] = useState('');
  const [showManual, setShowManual] = useState(false);
  const [showWl, setShowWl] = useState(false);
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
            ? '無法連線 API（Web proxy／後端可能未啟動）'
            : e.message
          : '載入 GeoIP 失敗';
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
    if (ip && /^[\d.a-fA-F:]+$/.test(ip)) {
      setBanIp(ip);
      setShowManual(true);
      setBanReason((r) => r || 'from logs');
    }
    if (t && (TABS as readonly string[]).includes(t)) {
      setTab(t as (typeof TABS)[number]);
    }
  }, [searchParams, setTab]);

  const refresh = useCallback(async () => {
    setLoadErr(null);
    try {
      const s = await api.requestRaw<DefenseStatus>('/api/v1/defense/status');
      setStatus(s);
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
        setCfZonesText((a.automation.cloudflare?.zones ?? []).join(', '));
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
          items: intel.vhosts ?? [],
        });
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
          banned: f2b.banned?.length,
        });
      } catch {
        setStackF2b(null);
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 45_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const selectedIps = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected],
  );

  const actionableSuspects = useMemo(
    () => suspects.filter((s) => !s.alreadyBanned && !s.whitelisted),
    [suspects],
  );

  async function applyPreset(id: string, danger?: boolean, preview = false) {
    if (!preview && danger) {
      const ok = window.confirm(
        id === 'emergency'
          ? '緊急檔會極度限速。請確認白名單有你嘅 IP。繼續？'
          : '將套用較嚴防護檔（可能開啟自動 ban）。繼續？',
      );
      if (!ok) return;
    }
    let confirm: string | undefined;
    if (!preview && id === 'emergency') {
      const c = window.prompt('請輸入 EMERGENCY 以確認', '');
      if (c !== 'EMERGENCY') {
        setError('已取消：未輸入 EMERGENCY');
        return;
      }
      confirm = 'EMERGENCY';
    }
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/preset', {
        method: 'POST',
        body: JSON.stringify({ preset: id, apply: !preview, confirm }),
      })) as OpsResultLike;
      if (!preview) await refresh();
      if (r.notes) r.notes = summarizeOpsNotes(r.notes);
      return r;
    }, preview ? '預覽完成（未寫入）' : '已套用防護檔');
  }

  async function banOne(ip: string, reason?: string) {
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/ban', {
        method: 'POST',
        body: JSON.stringify({
          ip,
          reason: reason || banReason || '手動封禁',
          method: banMethod,
        }),
      })) as OpsResultLike;
      if (r.notes) r.notes = summarizeOpsNotes(r.notes);
      await refresh();
      return r;
    }, `已送出封禁 ${ip}`);
  }

  async function banSelected() {
    if (!selectedIps.length) return;
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/ban-batch', {
        method: 'POST',
        body: JSON.stringify({
          ips: selectedIps,
          reason: banReason || '快速選取封禁',
          method: banMethod,
        }),
      })) as OpsResultLike;
      if (r.notes) r.notes = summarizeOpsNotes(r.notes);
      setSelected({});
      await refresh();
      return r;
    }, `批量封禁 ${selectedIps.length} 個`);
  }

  async function saveAutoBan(patch: Partial<AutoBanPolicy>) {
    await run(async () => {
      const r = (await api.requestRaw('/api/v1/defense/auto-ban', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })) as OpsResultLike & AutoBanPolicy;
      await refresh();
      return {
        ok: true,
        notes: [
          `自動 ban：${r.enabled ? '開' : '關'} · ${r.mode} · ${r.method}`,
        ],
      };
    }, '已更新自動 ban');
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
          `自動化主開關：${r.automation.enabled ? '開' : '關'}`,
          `自動防護檔：${r.automation.autoPreset.enabled ? '開' : '關'}`,
          `自動 ban：${r.automation.autoBan.enabled ? '開' : '關'}（${r.automation.autoBan.mode}）`,
        ],
      };
    }, '已儲存自動化設定');
  }

  const threat = status?.threatLevel ?? 'low';
  const meta = LEVEL_META[threat];
  const labels = status?.labels;
  const ab = status?.autoBan;
  const activePreset = status?.presets.find((p) => p.id === status.activePreset);
  const score = status?.score ?? 0;

  const recommendedPreset =
    threat === 'critical' || threat === 'under_attack'
      ? 'under_attack'
      : threat === 'elevated'
        ? 'hardened'
        : null;

  return (
    <FeaturePageLayout
      title="防護中心"
      subtitle="威脅一目了然 · 一鍵應變 · 快速封禁"
      actions={
        <div className="def-head-actions">
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() =>
              void run(async () => {
                const s = await api.requestRaw<DefenseStatus>('/api/v1/defense/probe', {
                  method: 'POST',
                  body: '{}',
                });
                setStatus(s);
                await refresh();
                return {
                  ok: true,
                  notes: [`威脅 ${LEVEL_META[s.threatLevel].label} · ${s.score} 分`],
                };
              }, '已重新探測')
            }
          >
            重新探測
          </Button>
          {actionableSuspects.length > 0 ? (
            <Button variant="danger" size="md" onClick={() => setTab('bans')}>
              可疑 IP {actionableSuspects.length}
            </Button>
          ) : null}
        </div>
      }
    >
      {loadErr ? <Alert variant="error">{loadErr}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      {loading && !status ? <LoadingBlock label="載入防護狀態…" /> : null}

      {status ? (
        <section className={`def-hero def-hero--${threat}`} aria-label="威脅總覽">
          <div className="def-hero__main">
            <div className="def-hero__gauge" aria-hidden>
              <div
                className="def-hero__ring"
                style={
                  {
                    ['--def-score' as string]: String(Math.min(100, score)),
                  } as CSSProperties
                }
              >
                <div className="def-hero__ring-inner">
                  <span className="def-hero__score">{score}</span>
                  <span className="def-hero__score-unit">/100</span>
                </div>
              </div>
            </div>
            <div className="def-hero__copy">
              <div className="def-hero__eyebrow">即時威脅</div>
              <h2 className="def-hero__title">
                <span className={`def-hero__pill def-hero__pill--${meta.tone}`}>{meta.label}</span>
                {meta.verb}
              </h2>
              <p className="def-hero__hint">{meta.hint}</p>
              <div className="def-hero__meta">
                <span>防護檔 · <strong>{activePreset?.label ?? '—'}</strong></span>
                <span className="def-hero__dot" />
                <span>更新 {relTime(status.at)}</span>
                {!status.executeEnabled ? (
                  <>
                    <span className="def-hero__dot" />
                    <Link to="/system/readiness" className="def-hero__link">
                      系統套用未開
                    </Link>
                  </>
                ) : null}
              </div>
              <div className="def-hero__cta">
                {recommendedPreset && status.activePreset !== recommendedPreset ? (
                  <Button
                    variant="danger"
                    size="md"
                    loading={busy}
                    onClick={() => void applyPreset(recommendedPreset, true)}
                  >
                    一鍵套用建議檔
                  </Button>
                ) : (
                  <Button variant="primary" size="md" onClick={() => setTab('command')}>
                    檢視防護檔
                  </Button>
                )}
                <Button variant="secondary" size="md" onClick={() => setTab('bans')}>
                  去封禁
                </Button>
              </div>
            </div>
          </div>
          <ul className="def-status-rail" aria-label="元件狀態">
            <li>
              <span className="def-status-rail__k">fail2ban</span>
              <Badge tone={toneToBadge(labels?.fail2ban.tone)}>
                {labels?.fail2ban.short ?? '—'}
              </Badge>
            </li>
            <li>
              <span className="def-status-rail__k">防火牆</span>
              <Badge tone={toneToBadge(labels?.firewall.tone)}>
                {labels?.firewall.short ?? '—'}
              </Badge>
            </li>
            <li>
              <span className="def-status-rail__k">自動 ban</span>
              <Badge tone={toneToBadge(labels?.autoBan.tone)}>
                {labels?.autoBan.short ?? '關閉'}
              </Badge>
            </li>
            <li>
              <span className="def-status-rail__k">系統套用</span>
              <Badge tone={toneToBadge(labels?.apply.tone)}>
                {labels?.apply.short ?? '—'}
              </Badge>
            </li>
            <li>
              <span className="def-status-rail__k">活躍封禁</span>
              <Badge tone={(status.bans.count ?? 0) > 10 ? 'warn' : 'neutral'}>
                {status.bans.count}
              </Badge>
            </li>
          </ul>
        </section>
      ) : null}

      <Alert variant="info">
        <strong>單一入口：</strong> 側欄只留本頁擋攻擊。UFW／fail2ban 喺「底層」分頁。
        自動化＝探測→評分→可升檔／ban；<strong>緊急檔永不自動</strong>。
      </Alert>

      {!status?.executeEnabled && status ? (
        <Alert variant="info">
          而家只會<strong>寫管理設定</strong>，唔會改系統防火牆。生產環境用 root +{' '}
          <code className="inline">YSK_EXECUTE=1</code>。{' '}
          <Link to="/system/readiness">就緒探測</Link>
        </Alert>
      ) : null}

      <Tabs
        tabs={[
          { id: 'command', label: '應變', badge: recommendedPreset ? '!' : undefined },
          {
            id: 'automation',
            label: '自動化',
            badge: automation?.enabled ? 'ON' : undefined,
          },
          {
            id: 'bans',
            label: '封禁',
            badge: actionableSuspects.length || status?.bans.count || undefined,
          },
          {
            id: 'geo',
            label: 'IP 准入',
            badge: geoStatus?.policy.enabled
              ? 'ON'
              : geoStatus?.ready
                ? undefined
                : '!',
          },
          { id: 'stack', label: '底層' },
          {
            id: 'intel',
            label: '情報',
            badge: status?.signals.filter((s) => s.points > 0).length || undefined,
          },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'command' ? (
          <div className="tab-panel def-panel">
            {status?.suggestions?.length ? (
              <div className="def-suggest">
                {status.suggestions.slice(0, 3).map((s) => (
                  <div key={s.id} className="def-suggest__item">
                    <div>
                      <strong>{s.title}</strong>
                      <p>{s.body}</p>
                    </div>
                    {s.action?.startsWith('preset:') ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => void applyPreset(s.action!.replace('preset:', ''), true)}
                      >
                        套用
                      </Button>
                    ) : s.action === 'tab:bans' ? (
                      <Button variant="secondary" size="sm" onClick={() => setTab('bans')}>
                        前往
                      </Button>
                    ) : s.action?.startsWith('href:') ? (
                      <Link
                        to={s.action.slice(5)}
                        className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                      >
                        前往
                      </Link>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="def-section-head">
              <div>
                <h3 className="def-section-head__title">防護檔</h3>
                <p className="def-section-head__desc">
                  由左到右逐步收緊 · 套用會寫 Nginx 限速 + fail2ban（加固以上開自動 ban）
                </p>
              </div>
            </div>

            <div className="def-ramp" role="list">
              {(status?.presets ?? []).map((p, idx) => {
                const active = status?.activePreset === p.id;
                const pm = PRESET_META[p.id] ?? { step: idx + 1, accent: 'calm', when: p.short };
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
                          {active ? <Badge tone="ok">作用中</Badge> : null}
                          {recommended ? <Badge tone="warn">建議</Badge> : null}
                          {p.danger && !active ? <Badge tone="danger">慎用</Badge> : null}
                        </h4>
                        <span className="def-ramp__when">{pm.when}</span>
                      </div>
                    </header>
                    <p className="def-ramp__short">{p.short}</p>
                    <ul className="def-ramp__bullets">
                      {p.bullets.slice(0, 3).map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                    <footer className="def-ramp__foot">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => void applyPreset(p.id, p.danger, true)}
                      >
                        預覽
                      </Button>
                      <Button
                        variant={p.danger ? 'danger' : active ? 'secondary' : 'primary'}
                        size="sm"
                        loading={busy}
                        onClick={() => void applyPreset(p.id, p.danger, false)}
                      >
                        {active ? '重新套用' : '套用'}
                      </Button>
                    </footer>
                  </article>
                );
              })}
            </div>

            <KpiGrid cols={3} className="def-kpi">
              <KpiCard
                label="Nginx 限速"
                badge={{
                  label: status?.nginxLimits.exists ? '已寫入' : '未寫',
                  tone: status?.nginxLimits.exists ? 'ok' : 'warn',
                }}
              >
                <div className="def-kpi-nums">
                  <div>
                    <span className="def-kpi-nums__v">{status?.nginxLimits.reqRate ?? '—'}</span>
                    <span className="def-kpi-nums__l">req rate</span>
                  </div>
                  <div>
                    <span className="def-kpi-nums__v">{status?.nginxLimits.burst ?? '—'}</span>
                    <span className="def-kpi-nums__l">burst</span>
                  </div>
                  <div>
                    <span className="def-kpi-nums__v">{status?.nginxLimits.connLimit ?? '—'}</span>
                    <span className="def-kpi-nums__l">conn/IP</span>
                  </div>
                </div>
              </KpiCard>
              <KpiCard label="控制面" hint={status?.protectionMode ?? '—'}>
                <p className="def-kpi-body">
                  {status?.executeEnabled
                    ? status.isRoot
                      ? '可以套用到系統（EXECUTE + root）'
                      : '有 EXECUTE，但仍需 root 先完整套用'
                    : '只寫管理檔 · written ≠ applied'}
                </p>
              </KpiCard>
              <KpiCard
                label="快捷連結"
                footer={
                  <div className="def-links">
                    <Link to="/fail2ban">fail2ban</Link>
                    <Link to="/firewall">防火牆</Link>
                    <Link to="/system/readiness">就緒</Link>
                  </div>
                }
              >
                <p className="def-kpi-body muted">底層工具分開管理；本頁係應變總控。</p>
              </KpiCard>
            </KpiGrid>
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
                    <strong>自動化主開關</strong>
                    <p>
                      {automation?.enabled
                        ? `運作中 · 間隔 ${automation.autoBan.intervalSeconds}s · 本小時 ban ${autoBansLastHour}`
                        : '關閉 — 只人手操作'}
                      {automation?.lastTickAt
                        ? ` · 上次 ${relTime(automation.lastTickAt)}`
                        : ''}
                      {schedNext && automation?.enabled
                        ? ` · 下輪 ${relTime(schedNext)}`
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
                    onChange={(e) => void saveAutomation({ enabled: e.target.checked })}
                  />
                  <span>{automation?.enabled ? '開啟' : '關閉'}</span>
                </label>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = (await api.requestRaw('/api/v1/defense/auto-ban/tick', {
                        method: 'POST',
                        body: '{}',
                      })) as OpsResultLike;
                      if (r.notes) r.notes = summarizeOpsNotes(r.notes);
                      await refresh();
                      return r;
                    }, '已跑一輪自動化')
                  }
                >
                  立即執行一輪
                </Button>
              </div>
            </section>

            {automation?.suggestEmergency ? (
              <Alert variant="error">
                分數極高 — 系統<strong>建議</strong>緊急檔，但<strong>唔會自動套用</strong>。請到應變人手確認。
              </Alert>
            ) : null}

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">① 自動防護檔</h3>
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(automation?.autoPreset.enabled)}
                    disabled={busy || !automation?.enabled}
                    onChange={(e) =>
                      void saveAutomation({
                        autoPreset: { enabled: e.target.checked },
                      })
                    }
                  />
                  <span>{automation?.autoPreset.enabled ? '開' : '關'}</span>
                </label>
              </div>
              <p className="muted u-text-sm">
                依威脅分自動切 日常／加固／受攻擊。緊急檔<strong>永不自動</strong>。
              </p>
              <FormLayout columns={2}>
                <Field label="加固 ≥ 分數" htmlFor="ap-h" flush>
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
                    onChange={(v) => {
                      const n = Number(v) || 20;
                      setAutomation((a) =>
                        a
                          ? {
                              ...a,
                              autoPreset: { ...a.autoPreset, escalateToHardenedAt: n },
                            }
                          : a,
                      );
                      void saveAutomation({ autoPreset: { escalateToHardenedAt: n } });
                    }}
                  />
                </Field>
                <Field label="受攻擊 ≥ 分數" htmlFor="ap-u" flush>
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
                    onChange={(v) => {
                      const n = Number(v) || 45;
                      setAutomation((a) =>
                        a
                          ? {
                              ...a,
                              autoPreset: {
                                ...a.autoPreset,
                                escalateToUnderAttackAt: n,
                              },
                            }
                          : a,
                      );
                      void saveAutomation({
                        autoPreset: { escalateToUnderAttackAt: n },
                      });
                    }}
                  />
                </Field>
                <Field label="回落日常 &lt; 分數" htmlFor="ap-d" flush>
                  <PresetChips
                    options={[
                      { value: '5', label: '5' },
                      { value: '10', label: '10' },
                      { value: '15', label: '15' },
                      { value: '20', label: '20' },
                      { value: '0', label: '0 關' },
                    ]}
                    value={String(automation?.autoPreset.deescalateToDailyBelow ?? 10)}
                    disabled={busy}
                    onChange={(v) => {
                      const n = Number(v) || 0;
                      setAutomation((a) =>
                        a
                          ? {
                              ...a,
                              autoPreset: {
                                ...a.autoPreset,
                                deescalateToDailyBelow: n,
                              },
                            }
                          : a,
                      );
                      void saveAutomation({
                        autoPreset: { deescalateToDailyBelow: n },
                      });
                    }}
                  />
                </Field>
                <Field label="升檔後最少維持" htmlFor="ap-hold" flush>
                  <PresetChips
                    options={[
                      { value: '5', label: '5 分' },
                      { value: '15', label: '15 分' },
                      { value: '30', label: '30 分' },
                      { value: '60', label: '1 時' },
                      { value: '120', label: '2 時' },
                    ]}
                    value={String(automation?.autoPreset.holdMinutes ?? 15)}
                    disabled={busy}
                    onChange={(v) => {
                      const n = Number(v) || 15;
                      setAutomation((a) =>
                        a
                          ? {
                              ...a,
                              autoPreset: { ...a.autoPreset, holdMinutes: n },
                            }
                          : a,
                      );
                      void saveAutomation({ autoPreset: { holdMinutes: n } });
                    }}
                  />
                </Field>
              </FormLayout>
              <label className="def-switch u-mt-2">
                <input
                  type="checkbox"
                  checked={automation?.autoPreset.deescalateEnabled !== false}
                  disabled={busy || !automation?.enabled}
                  onChange={(e) =>
                    void saveAutomation({
                      autoPreset: { deescalateEnabled: e.target.checked },
                    })
                  }
                />
                <span>允許自動回落（降檔）</span>
              </label>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">② 自動封禁</h3>
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(automation?.autoBan.enabled)}
                    disabled={busy || !automation?.enabled}
                    onChange={(e) =>
                      void saveAutomation({
                        autoBan: { enabled: e.target.checked },
                      })
                    }
                  />
                  <span>{automation?.autoBan.enabled ? '開' : '關'}</span>
                </label>
              </div>
              <FormLayout columns={2}>
                <Field label="預設檔 / 自訂" htmlFor="ab-mode2" flush>
                  <SegRadio
                    name="ab-mode2"
                    aria-label="自動封禁模式"
                    value={(automation?.autoBan.mode ?? 'soft') as string}
                    disabled={busy}
                    onChange={(mode) => {
                      void saveAutomation({
                        autoBan: {
                          mode: mode as DefenseAutomation['autoBan']['mode'],
                          enabled: true,
                        },
                      });
                    }}
                    options={[
                      { value: 'soft', label: '寬鬆' },
                      { value: 'normal', label: '標準' },
                      { value: 'aggressive', label: '積極' },
                      { value: 'custom', label: '自訂' },
                    ]}
                  />
                </Field>
                <Field label="方式" htmlFor="ab-meth2" flush>
                  <SegRadio
                    name="ab-meth2"
                    aria-label="封禁方式"
                    value={(automation?.autoBan.method ?? 'fail2ban') as string}
                    disabled={busy}
                    onChange={(method) => {
                      void saveAutomation({
                        autoBan: {
                          method: method as 'fail2ban' | 'ufw' | 'both',
                        },
                      });
                    }}
                    options={[
                      { value: 'fail2ban', label: 'fail2ban' },
                      { value: 'ufw', label: 'UFW' },
                      { value: 'both', label: '兩者' },
                    ]}
                  />
                </Field>
                <Field label="分數 ≥" htmlFor="ab-sc" flush>
                  <PresetChips
                    options={[
                      { value: '40', label: '40' },
                      { value: '55', label: '55' },
                      { value: '70', label: '70' },
                      { value: '85', label: '85' },
                    ]}
                    value={String(automation?.autoBan.minScore ?? 55)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={(v) => {
                      const n = Number(v) || 55;
                      setAutomation((a) =>
                        a ? { ...a, autoBan: { ...a.autoBan, minScore: n } } : a,
                      );
                      void saveAutomation({ autoBan: { minScore: n } });
                    }}
                  />
                </Field>
                <Field label="請求 hits ≥" htmlFor="ab-hi" flush>
                  <PresetChips
                    options={[
                      { value: '50', label: '50' },
                      { value: '100', label: '100' },
                      { value: '200', label: '200' },
                      { value: '500', label: '500' },
                    ]}
                    value={String(automation?.autoBan.minHits ?? 100)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={(v) => {
                      const n = Number(v) || 100;
                      setAutomation((a) =>
                        a ? { ...a, autoBan: { ...a.autoBan, minHits: n } } : a,
                      );
                      void saveAutomation({ autoBan: { minHits: n } });
                    }}
                  />
                </Field>
                <Field label="429 相關 hits ≥" htmlFor="ab-429" flush>
                  <PresetChips
                    options={[
                      { value: '20', label: '20' },
                      { value: '50', label: '50' },
                      { value: '100', label: '100' },
                      { value: '200', label: '200' },
                    ]}
                    value={String(automation?.autoBan.min429 ?? 50)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={(v) => {
                      const n = Number(v) || 50;
                      setAutomation((a) =>
                        a ? { ...a, autoBan: { ...a.autoBan, min429: n } } : a,
                      );
                      void saveAutomation({ autoBan: { min429: n } });
                    }}
                  />
                </Field>
                <Field label="掃描路徑 hits ≥" htmlFor="ab-scan" flush>
                  <PresetChips
                    options={[
                      { value: '10', label: '10' },
                      { value: '20', label: '20' },
                      { value: '40', label: '40' },
                      { value: '80', label: '80' },
                    ]}
                    value={String(automation?.autoBan.minScan ?? 20)}
                    disabled={busy || automation?.autoBan.mode !== 'custom'}
                    onChange={(v) => {
                      const n = Number(v) || 20;
                      setAutomation((a) =>
                        a ? { ...a, autoBan: { ...a.autoBan, minScan: n } } : a,
                      );
                      void saveAutomation({ autoBan: { minScan: n } });
                    }}
                  />
                </Field>
                <Field label="冷卻" htmlFor="ab-cd" flush>
                  <PresetChips
                    options={[
                      { value: '15', label: '15 分' },
                      { value: '30', label: '30 分' },
                      { value: '60', label: '1 時' },
                      { value: '120', label: '2 時' },
                      { value: '360', label: '6 時' },
                    ]}
                    value={String(automation?.autoBan.cooldownMinutes ?? 60)}
                    disabled={busy}
                    onChange={(v) => {
                      const n = Number(v) || 60;
                      setAutomation((a) =>
                        a
                          ? { ...a, autoBan: { ...a.autoBan, cooldownMinutes: n } }
                          : a,
                      );
                      void saveAutomation({ autoBan: { cooldownMinutes: n } });
                    }}
                  />
                </Field>
                <Field label="每小時上限" htmlFor="ab-max" flush>
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
                    onChange={(v) => {
                      const n = Number(v) || 40;
                      setAutomation((a) =>
                        a
                          ? {
                              ...a,
                              autoBan: { ...a.autoBan, maxAutoBansPerHour: n },
                            }
                          : a,
                      );
                      void saveAutomation({ autoBan: { maxAutoBansPerHour: n } });
                    }}
                  />
                </Field>
                <Field label="掃描間隔" htmlFor="ab-iv" flush hint="scheduler 預設 120s">
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
                    onChange={(v) => {
                      const n = Math.max(30, Math.min(600, Number(v) || 120));
                      setAutomation((a) =>
                        a
                          ? {
                              ...a,
                              autoBan: { ...a.autoBan, intervalSeconds: n },
                            }
                          : a,
                      );
                      void saveAutomation({ autoBan: { intervalSeconds: n } });
                    }}
                    disabled={busy}
                  />
                </Field>
              </FormLayout>
              <FormHint>
                選 soft/normal/aggressive 會自動填閾值；選「自訂」先可改分數／hits。
                無 YSK_EXECUTE 時只會記錄，唔會真 ban。
              </FormHint>
            </div>

            <div className="def-panel-card def-panel-card--muted">
              <div className="def-section-head">
                <h3 className="def-section-head__title">③ 機制說明</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowMech((v) => !v)}>
                  {showMech ? '收起' : '展開'}
                </Button>
              </div>
              {showMech ? (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>步驟</th>
                        <th>機制</th>
                        <th>你可調</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(mechanisms.length
                        ? mechanisms
                        : [
                            {
                              step: '探測',
                              mechanism: '外網／請求率／TCP／f2b／UFW',
                              tunable: '升檔門檻',
                            },
                            {
                              step: '緊急',
                              mechanism: '永不自動',
                              tunable: '人手 EMERGENCY',
                            },
                          ]
                      ).map((row) => (
                        <tr key={row.step}>
                          <td>
                            <strong>{row.step}</strong>
                          </td>
                          <td className="u-text-sm">{row.mechanism}</td>
                          <td className="u-text-sm muted">{row.tunable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {automation?.lastTickNotes?.length ? (
                <p className="muted u-text-sm u-mt-3">
                  上次：{automation.lastTickNotes.slice(0, 4).join(' · ')}
                </p>
              ) : null}
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">④ 訊號權重（0–3）</h3>
              </div>
              <p className="muted u-text-sm">
                預設 1；加大會令該類訊號更容易推高威脅分。細範圍用單選，唔使手填數字。
              </p>
              <FormLayout columns={2}>
                {(
                  [
                    ['networkDown', '外網斷'],
                    ['highReqRate', '高請求率'],
                    ['ddosHeuristic', 'DDoS 啟發式'],
                    ['tcpInuse', 'TCP 連線'],
                    ['ufwInactive', 'UFW 關閉'],
                    ['f2bBans', 'fail2ban 封禁數'],
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
                        aria-label={`${label} 權重 0–3`}
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
                                            [key]: n,
                                          },
                                        }
                                      : a,
                                  );
                                  void saveAutomation({
                                    signalWeights: { [key]: n },
                                  });
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
                          onAutoEscalate: automation?.cloudflare?.onAutoEscalate !== false,
                        },
                      })
                    }
                  />
                  <span>{automation?.cloudflare?.enabled ? '開' : '關'}</span>
                </label>
              </div>
              <FormHint>
                需環境變數 <code className="inline">CF_API_TOKEN</code>
                {hasCfToken ? '（已偵測）' : '（未設定）'}。升至「受攻擊」或人手套用該檔時可打 API。
              </FormHint>
              <Field label="Zones（逗號分隔）" htmlFor="cf-zones" flush>
                <input
                  id="cf-zones"
                  value={cfZonesText}
                  onChange={(e) => setCfZonesText(e.target.value)}
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
                        ufwKeepTcpPorts: automation?.cloudflare?.ufwKeepTcpPorts ?? [22],
                      },
                    })
                  }
                />
                <span>受攻擊時 UFW 只放 CF 網段（+SSH）</span>
              </label>
              <FormHint>
                慎用：會 reset UFW 再寫入 CF IPv4 段 + 保留埠。需 root + YSK_EXECUTE 先 applied。
              </FormHint>
              <FormActions>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void saveAutomation({
                      cloudflare: {
                        enabled: true,
                        zones: cfZonesText
                          .split(/[,\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                        onAutoEscalate: true,
                        ufwAllowOnlyCf: automation?.cloudflare?.ufwAllowOnlyCf,
                        ufwKeepTcpPorts: automation?.cloudflare?.ufwKeepTcpPorts ?? [22],
                      },
                    })
                  }
                >
                  儲存 zones
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={busy}
                  disabled={!cfZonesText.trim()}
                  onClick={() =>
                    void run(async () => {
                      const r = (await api.requestRaw('/api/v1/defense/cloudflare/under-attack', {
                        method: 'POST',
                        body: JSON.stringify({
                          enable: true,
                          zones: cfZonesText
                            .split(/[,\s]+/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }),
                      })) as OpsResultLike;
                      return r;
                    }, '已請求 Under Attack')
                  }
                >
                  立即 Under Attack
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = (await api.requestRaw('/api/v1/defense/cloudflare/under-attack', {
                        method: 'POST',
                        body: JSON.stringify({
                          enable: false,
                          zones: cfZonesText
                            .split(/[,\s]+/)
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }),
                      })) as OpsResultLike;
                      return r;
                    }, '已請求解除 UA')
                  }
                >
                  解除（→ high）
                </Button>
              </FormActions>
            </div>
          </div>
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel def-panel">
            <p className="muted u-text-sm">
              底層工具唔再佔側欄一級，避免同防護中心重覆。完整設定仍可直達。
            </p>
            <div className="def-split">
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">防火牆 UFW</h3>
                  <Badge tone={stackFw?.installed ? 'ok' : 'warn'}>
                    {stackFw?.activeLabel ?? '—'}
                  </Badge>
                </div>
                <p className="def-kpi-body">
                  埠策略 · 永久 DENY · 允許 {stackFw?.allowCount ?? '—'} · 拒絕{' '}
                  {stackFw?.denyCount ?? '—'}
                </p>
                <FormActions>
                  <Link
                    to="/firewall"
                    className={buttonClassName({ variant: 'primary', size: 'sm' })}
                  >
                    開啟完整防火牆
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
                  日誌臨時 ban · {stackF2b?.jails ?? 0} jails · 封鎖中{' '}
                  {stackF2b?.banned ?? 0}
                </p>
                <FormActions>
                  <Link
                    to="/fail2ban"
                    className={buttonClassName({ variant: 'primary', size: 'sm' })}
                  >
                    開啟完整 fail2ban
                  </Link>
                </FormActions>
              </section>
            </div>
            <div className="def-panel-card def-panel-card--muted">
              <strong>分工一覽</strong>
              <ul className="def-ramp__bullets">
                <li>UFW = 開邊個埠、永久拒邊個 IP</li>
                <li>fail2ban = 睇 log 之後臨時 ban</li>
                <li>防護中心 = 攻擊時總控（限速檔 + 自動化 + 可疑列表）</li>
              </ul>
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
                    <strong>自動 ban</strong>
                    <p>
                      {ab?.enabled
                        ? `已開 · ${ab.mode} · 本小時 ${ab.autoBansLastHour ?? 0}/${ab.maxAutoBansPerHour}`
                        : '關閉 — 只靠手動／列表'}
                      {ab?.pausedReason === 'no_execute'
                        ? ' · 暫停（無 EXECUTE）'
                        : ab?.pausedReason === 'circuit_breaker'
                          ? ' · 已熔斷'
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
                        mode: e.target.checked ? ab?.mode || 'soft' : 'off',
                      })
                    }
                  />
                  <span>{ab?.enabled ? '開啟' : '關閉'}</span>
                </label>
                <SegRadio
                  name="cmd-ab-mode"
                  aria-label="自動 ban 模式"
                  size="sm"
                  value={(ab?.mode ?? 'soft') as string}
                  disabled={busy || !ab?.enabled}
                  onChange={(mode) =>
                    void saveAutoBan({
                      mode: mode as AutoBanPolicy['mode'],
                      enabled: mode !== 'off',
                    })
                  }
                  options={[
                    { value: 'soft', label: '寬鬆' },
                    { value: 'normal', label: '標準' },
                    { value: 'aggressive', label: '積極' },
                  ]}
                />
                <SegRadio
                  name="cmd-ab-meth"
                  aria-label="封禁方式"
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
                    { value: 'both', label: '兩者' },
                  ]}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = (await api.requestRaw('/api/v1/defense/auto-ban/tick', {
                        method: 'POST',
                        body: '{}',
                      })) as OpsResultLike;
                      if (r.notes) r.notes = summarizeOpsNotes(r.notes);
                      await refresh();
                      return r;
                    }, '已掃描')
                  }
                >
                  掃一次
                </Button>
              </div>
            </section>

            {/* Sticky batch bar */}
            {selectedIps.length > 0 ? (
              <div className="def-batch-bar" role="region" aria-label="批量操作">
                <span>
                  已選 <strong>{selectedIps.length}</strong> 個 IP
                </span>
                <div className="def-batch-bar__actions">
                  <Button variant="ghost" size="sm" onClick={() => setSelected({})}>
                    取消
                  </Button>
                  <Button variant="danger" size="sm" loading={busy} onClick={() => void banSelected()}>
                    封禁已選
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="def-section-head">
              <div>
                <h3 className="def-section-head__title">
                  可疑 IP
                  {actionableSuspects.length ? (
                    <Badge tone="warn">{actionableSuspects.length}</Badge>
                  ) : null}
                </h3>
                <p className="def-section-head__desc">
                  {suspectNotes.join(' · ') || '來自 access log · 一鍵或批量封禁'}
                </p>
              </div>
              <div className="def-section-head__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!actionableSuspects.length}
                  onClick={() => {
                    const next: Record<string, boolean> = {};
                    for (const s of actionableSuspects) next[s.ip] = true;
                    setSelected(next);
                  }}
                >
                  全選
                </Button>
              </div>
            </div>

            {!suspects.length ? (
              <div className="def-empty-card">
                <EmptyState
                  title="暫時無可疑 IP"
                  description="有掃描／429 流量時會自動出現。亦可展開手動封禁。"
                />
              </div>
            ) : (
              <div className="def-suspect-grid">
                {suspects.map((s) => {
                  const disabled = Boolean(s.alreadyBanned || s.whitelisted);
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
                        <Badge tone={s.score >= 40 ? 'warn' : 'info'}>{s.score}</Badge>
                        {s.alreadyBanned ? <Badge tone="ok">已封</Badge> : null}
                        {s.whitelisted ? <Badge tone="info">白名單</Badge> : null}
                      </div>
                      <p className="def-suspect__why">{s.reasons.slice(0, 3).join(' · ') || '—'}</p>
                      <div className="def-suspect__meta">
                        <span>{s.hits} hits</span>
                        <span>{s.sources.join(', ')}</span>
                        <span>{relTime(s.lastSeen)}</span>
                      </div>
                      <div className="def-suspect__actions">
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          disabled={disabled}
                          onClick={() => void banOne(s.ip, s.reasons[0])}
                        >
                          封禁
                        </Button>
                        {!s.whitelisted ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            onClick={() =>
                              void run(async () => {
                                await api.requestRaw('/api/v1/defense/whitelist', {
                                  method: 'POST',
                                  body: JSON.stringify({ ip: s.ip, action: 'add' }),
                                });
                                await refresh();
                                return { ok: true, notes: [`白名單 + ${s.ip}`] };
                              }, '已加入白名單')
                            }
                          >
                            白名單
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="def-split">
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">
                    活躍封禁 <Badge tone="neutral">{status?.bans.count ?? 0}</Badge>
                  </h3>
                </div>
                {!status?.bans.items.length ? (
                  <EmptyState title="未有封禁" description="封禁後顯示於此" />
                ) : (
                  <ul className="def-ban-list">
                    {status.bans.items.map((b) => (
                      <li key={`${b.source}-${b.jail}-${b.ip}`}>
                        <code>{b.ip}</code>
                        <span className="muted">
                          {b.source}
                          {b.jail ? ` · ${b.jail}` : ''}
                        </span>
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
                                  method: 'fail2ban',
                                }),
                              })) as OpsResultLike;
                              if (r.notes) r.notes = summarizeOpsNotes(r.notes);
                              await refresh();
                              return r;
                            }, '已解封')
                          }
                        >
                          解封
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">白名單</h3>
                  <Button variant="ghost" size="sm" onClick={() => setShowWl((v) => !v)}>
                    {showWl ? '收起' : '管理'}
                  </Button>
                </div>
                <div className="def-wl">
                  {(ab?.whitelist ?? []).map((w) => (
                    <span key={w} className="def-wl__chip">
                      <code>{w}</code>
                      <button
                        type="button"
                        className="def-wl__x"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api.requestRaw('/api/v1/defense/whitelist', {
                              method: 'POST',
                              body: JSON.stringify({ ip: w, action: 'remove' }),
                            });
                            await refresh();
                            return { ok: true, notes: [`移除 ${w}`] };
                          }, '已更新')
                        }
                        aria-label={`移除 ${w}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {!ab?.whitelist?.length ? (
                    <span className="muted u-text-sm">未設定（建議加入你嘅 IP）</span>
                  ) : null}
                </div>
                {showWl ? (
                  <div className="def-wl-add">
                    <input
                      value={wlInput}
                      onChange={(e) => setWlInput(e.target.value)}
                      placeholder="IP 或 CIDR"
                      spellCheck={false}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      disabled={!wlInput.trim()}
                      onClick={() =>
                        void run(async () => {
                          await api.requestRaw('/api/v1/defense/whitelist', {
                            method: 'POST',
                            body: JSON.stringify({ ip: wlInput.trim(), action: 'add' }),
                          });
                          setWlInput('');
                          await refresh();
                          return { ok: true, notes: ['已加入白名單'] };
                        }, '已加入')
                      }
                    >
                      加入
                    </Button>
                  </div>
                ) : null}
              </section>
            </div>

            <section className="def-panel-card def-panel-card--muted">
              <div className="def-section-head">
                <h3 className="def-section-head__title">手動封禁</h3>
                <Button variant="ghost" size="sm" onClick={() => setShowManual((v) => !v)}>
                  {showManual ? '收起' : '展開'}
                </Button>
              </div>
              {showManual ? (
                <FormLayout columns={2}>
                  <Field label="IP" htmlFor="def-ip" flush required>
                    <input
                      id="def-ip"
                      value={banIp}
                      onChange={(e) => setBanIp(e.target.value)}
                      placeholder="203.0.113.10"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label="原因" htmlFor="def-reason" flush>
                    <input
                      id="def-reason"
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                      placeholder="掃描 / 暴力"
                    />
                  </Field>
                  <div className="def-manual-actions">
                    <Button
                      variant="danger"
                      size="md"
                      loading={busy}
                      disabled={!banIp.trim()}
                      onClick={() => {
                        void banOne(banIp.trim(), banReason);
                        setBanIp('');
                      }}
                    >
                      封禁
                    </Button>
                    <FormHint>方式沿用上方選擇（fail2ban / UFW）</FormHint>
                  </div>
                </FormLayout>
              ) : (
                <p className="muted u-text-sm">多數情況用可疑列表即可。</p>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'intel' ? (
          <div className="tab-panel def-panel">
            <div className="def-split def-split--intel">
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">威脅訊號</h3>
                  <span className="muted u-text-sm">分數來源 · 權重可調</span>
                </div>
                {!status?.signals.length ? (
                  <EmptyState title="尚無訊號" description="按重新探測" />
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
                        <code className="def-signal-list__val">{String(s.value)}</code>
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
                    Top IP{' '}
                    <Badge tone="neutral">{topIps.length}</Badge>
                  </h3>
                  <span className="muted u-text-sm">access + auth 樣本</span>
                </div>
                <FormHint>
                  完整 nginx／auth log 請到{' '}
                  <Link to="/logs?source=file:auth">日誌中心</Link>
                </FormHint>
                {!topIps.length ? (
                  <EmptyState title="暫無 Top IP" description="有 log 後會顯示" />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>IP</th>
                          <th>分</th>
                          <th>hits</th>
                          <th>429</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {topIps.slice(0, 20).map((row) => (
                          <tr key={row.ip}>
                            <td>
                              <code className="inline">{row.ip}</code>
                            </td>
                            <td>
                              <Badge tone={row.score >= 40 ? 'warn' : 'info'}>{row.score}</Badge>
                            </td>
                            <td>{row.hits}</td>
                            <td>{row.s429}</td>
                            <td>
                              <Button
                                variant="danger"
                                size="sm"
                                loading={busy}
                                onClick={() => void banOne(row.ip, `top-ip score=${row.score}`)}
                              >
                                封
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <div className="def-split def-split--intel">
              <section className="def-panel-card">
                <div className="def-section-head">
                  <h3 className="def-section-head__title">
                    Vhost 限速{' '}
                    <Badge tone="ok">
                      {vhostLimits?.withLimit ?? 0}/{vhostLimits?.total ?? 0}
                    </Badge>
                  </h3>
                </div>
                {!vhostLimits?.items.length ? (
                  <EmptyState title="無 managed vhost" description="套用防護檔後會注入 marker" />
                ) : (
                  <ul className="def-ban-list">
                    {vhostLimits.items.slice(0, 30).map((v) => (
                      <li key={v.name}>
                        <code>{v.name}</code>
                        <span className="muted">
                          {v.hasDefenseMarker ? '已注入 YSK_DEFENSE' : '未注入'}
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
                  <h3 className="def-section-head__title">事件流</h3>
                  <span className="muted u-text-sm">48 小時</span>
                </div>
                {!timeline.length ? (
                  <EmptyState title="暫無事件" description="套用／封禁後出現" />
                ) : (
                  <ol className="def-timeline">
                    {timeline.map((e, i) => (
                      <li key={`${e.at}-${i}`}>
                        <span className="def-timeline__time">{relTime(e.at)}</span>
                        <div>
                          <Badge tone="info">{e.kind}</Badge>{' '}
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
                <h3 className="def-section-head__title">GeoIP 資料庫</h3>
                <div className="btn-row">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => void loadGeo().catch((e: Error) => setError(e.message))}
                  >
                    重新整理狀態
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
                          body: '{}',
                        });
                        await loadGeo();
                        return {
                          ok: r.ok,
                          notes: r.notes ?? [],
                        };
                      }, 'GeoIP 庫已更新')
                    }
                  >
                    立即更新庫
                  </Button>
                </div>
              </div>
              <FormHint>
                預設來源 sapics（國家 + ASN，每日、PDDL 免 key）。設定{' '}
                <code className="inline">IPINFO_TOKEN</code> 可改用 IPinfo Lite（國家 + 大陸 +
                ASN 一檔）。查詢只讀本地 MMDB，唔打線上 API 做攔截。
              </FormHint>
              {geoErr ? (
                <div className="geo-status-box geo-status-box--err">
                  <Alert variant="error">{geoErr}</Alert>
                  <div className="btn-row u-mt-2">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={geoLoading || busy}
                      onClick={() =>
                        void loadGeo().catch(() => {
                          /* geoErr set */
                        })
                      }
                    >
                      重試
                    </Button>
                  </div>
                </div>
              ) : null}
              {geoLoading && !geoStatus ? (
                <div className="geo-status-box geo-status-box--loading" role="status">
                  <span className="spinner" aria-hidden />
                  <span className="muted">載入 GeoIP 狀態…</span>
                </div>
              ) : null}
              {geoStatus ? (
                <>
                  <div className="kpi-grid kpi-grid--4 u-mb-3">
                    <div className="ops-stat">
                      <span className="ops-stat__lab">Provider</span>
                      <span className="ops-stat__val">{geoStatus.provider}</span>
                    </div>
                    <div className="ops-stat">
                      <span className="ops-stat__lab">庫就緒</span>
                      <span className="ops-stat__val">
                        <Badge tone={geoStatus.ready ? 'ok' : 'warn'}>
                          {geoStatus.ready ? '是' : '否'}
                        </Badge>
                      </span>
                    </div>
                    <div className="ops-stat">
                      <span className="ops-stat__lab">過舊</span>
                      <span className="ops-stat__val">
                        <Badge tone={geoStatus.stale ? 'warn' : 'ok'}>
                          {geoStatus.stale ? '>7 日' : 'OK'}
                        </Badge>
                      </span>
                    </div>
                    <div className="ops-stat">
                      <span className="ops-stat__lab">上次成功</span>
                      <span className="ops-stat__val u-text-sm">
                        {geoStatus.meta?.lastSuccessAt
                          ? relTime(geoStatus.meta.lastSuccessAt)
                          : '—'}
                      </span>
                    </div>
                  </div>
                  <ul className="list-plain list-spaced">
                    {geoStatus.sources.map((s) => (
                      <li key={s.filename}>
                        <code className="inline">{s.filename}</code>{' '}
                        <Badge tone={s.present ? 'ok' : 'warn'}>
                          {s.present ? '已下載' : '缺失'}
                        </Badge>
                        <span className="muted u-text-sm">
                          {' '}
                          · {s.license} · {s.updateHint}
                          {s.bytes != null ? ` · ${Math.round(s.bytes / 1024)} KiB` : ''}
                          {s.mtime ? ` · ${relTime(s.mtime)}` : ''}
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
                      排程下次更新：{new Date(geoStatus.scheduler.nextRunAt).toLocaleString()}
                    </FormHint>
                  ) : null}
                </>
              ) : null}
              {!geoLoading && !geoStatus && !geoErr ? (
                <div className="geo-status-box">
                  <p className="muted u-mb-2">尚未載入狀態</p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void loadGeo().catch(() => {
                        /* geoErr */
                      })
                    }
                  >
                    載入
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">准入政策</h3>
                <label className="def-switch">
                  <input
                    type="checkbox"
                    checked={geoEnabled}
                    onChange={(e) => setGeoEnabled(e.target.checked)}
                  />
                  啟用
                </label>
              </div>
              <FormHint>
                免費最高細分：<strong>國家 + 省／州 + ASN</strong>；城市可選政策（預設關，準確率較低）。
                供應商 = ASN。Whitelist 永遠豁免。點 chip 移除。
              </FormHint>
              {geoMode === 'allow_list' ? (
                <Alert variant="error">
                  允許名單模式高危：唔喺名單嘅公網 IP（含未知 geo）會被擋。請確認管理端 IP 已加入
                  封禁頁 whitelist。
                </Alert>
              ) : null}
              <FormLayout columns={2}>
                <Field label="模式" htmlFor="geo-mode" flush>
                  <SegRadio
                    name="geo-mode"
                    aria-label="Geo 准入模式"
                    value={geoMode}
                    onChange={(v) => setGeoMode(v as 'deny_list' | 'allow_list')}
                    options={[
                      { value: 'deny_list', label: '封鎖名單' },
                      { value: 'allow_list', label: '允許名單 · 高危' },
                    ]}
                  />
                </Field>
                <Field label="自動更新庫" htmlFor="geo-au" flush>
                  <label className="def-switch">
                    <input
                      id="geo-au"
                      type="checkbox"
                      checked={geoAutoUpdate}
                      onChange={(e) => setGeoAutoUpdate(e.target.checked)}
                    />
                    每日排程
                  </label>
                </Field>
              </FormLayout>

              <div className="geo-select-grid geo-select-grid--4 u-mt-3">
                <Field
                  label={`國家（已選 ${geoCountries.length}）`}
                  htmlFor="geo-cc"
                  flush
                  fullWidth
                  hint="搜尋中文名或 ISO"
                >
                  <MultiCheckSelect
                    id="geo-cc"
                    options={GEO_COUNTRIES}
                    value={geoCountries}
                    onChange={setGeoCountries}
                    searchPlaceholder="中國 / CN"
                    disabled={busy}
                  />
                </Field>
                <Field
                  label={`省／州（已選 ${geoRegions.length}）`}
                  htmlFor="geo-reg"
                  flush
                  fullWidth
                  hint={
                    geoCountries.length
                      ? '依已選國家顯示；可自訂 CN-GD'
                      : '建議先選國家以收窄列表'
                  }
                >
                  <MultiCheckSelect
                    id="geo-reg"
                    options={regionsForCountries(geoCountries)}
                    value={geoRegions}
                    onChange={setGeoRegions}
                    allowCustom
                    customPlaceholder="自訂，例 CN-GD"
                    searchPlaceholder="廣東 / CA / 東京"
                    disabled={busy}
                  />
                </Field>
                <Field
                  label={`大陸（已選 ${geoContinents.length}）`}
                  htmlFor="geo-cont"
                  flush
                  fullWidth
                  hint="洲際（可選）"
                >
                  <MultiCheckSelect
                    id="geo-cont"
                    options={GEO_CONTINENTS}
                    value={geoContinents}
                    onChange={setGeoContinents}
                    searchPlaceholder="亞洲 / EU"
                    disabled={busy}
                  />
                </Field>
                <Field
                  label={`供應商 ASN（已選 ${geoAsns.length}）`}
                  htmlFor="geo-asn"
                  flush
                  fullWidth
                  hint="雲／ISP；可自訂 ASN"
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
                    customPlaceholder="自訂 ASN，例 13335"
                    searchPlaceholder="Cloudflare / 電信"
                    disabled={busy}
                  />
                </Field>
              </div>

              <div className="def-panel-card def-panel-card--muted u-mt-3">
                <div className="def-section-head">
                  <h4 className="def-section-head__title" style={{ fontSize: '0.95rem' }}>
                    城市政策（低置信 · 可選）
                  </h4>
                  <label className="def-switch">
                    <input
                      type="checkbox"
                      checked={geoCityPolicy}
                      onChange={(e) => setGeoCityPolicy(e.target.checked)}
                    />
                    用城市做准入
                  </label>
                </div>
                <FormHint>
                  免費庫城市準確率有限。格式 <code className="inline">CN|Guangzhou</code>
                  ；未勾選時城市只作查詢展示。
                </FormHint>
                {geoCityPolicy ? (
                  <>
                    <div className="mcs__chips u-mb-2">
                      {geoCities.length === 0 ? (
                        <span className="muted u-text-sm">尚未加入城市</span>
                      ) : (
                        geoCities.map((c) => (
                          <button
                            key={c}
                            type="button"
                            className="mcs__chip"
                            onClick={() =>
                              setGeoCities((prev) => prev.filter((x) => x !== c))
                            }
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
                        onChange={(e) => setGeoCityDraft(e.target.value)}
                        placeholder="例：CN|Shenzhen 或 US|Ashburn"
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
                        加入
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
                            ufw: false,
                          },
                        }),
                      });
                      await loadGeo();
                      return {
                        ok: true,
                        notes: [
                          `政策已儲存 · 國 ${r.policy.countries.length} · 省 ${r.policy.regions?.length ?? 0} · ASN ${r.policy.asns.length}`,
                          ...(r.applyNotes ?? []),
                        ],
                      };
                    }, 'IP 准入政策已儲存')
                  }
                >
                  儲存政策
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await api.requestRaw<{
                        ok: boolean;
                        notes: string[];
                        path?: string;
                      }>('/api/v1/defense/geoip/apply', {
                        method: 'POST',
                        body: '{}',
                      });
                      return { ok: r.ok, notes: r.notes ?? [] };
                    }, '已寫入 nginx geo 片段')
                  }
                >
                  套用 Nginx 片段
                </Button>
              </FormActions>
              <FormHint>
                Nginx 片段需 geoip2 模組先會喺 HTTP 層攔截；否則政策主要用 lookup／後續 auto-ban
                enrich。UFW 唔會 bulk 灌整國 CIDR。
              </FormHint>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">測試 IP</h3>
              </div>
              <FormLayout columns={2}>
                <Field label="IP 位址" htmlFor="geo-lip" flush>
                  <input
                    id="geo-lip"
                    value={lookupIp}
                    onChange={(e) => setLookupIp(e.target.value)}
                    placeholder="1.1.1.1"
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
                        body: JSON.stringify({ ip: lookupIp }),
                      });
                      setLookupResult(r);
                      const L = r.lookup ?? {};
                      return {
                        ok: Boolean(L.ok !== false),
                        notes: [
                          `country=${String(L.country ?? '—')} continent=${String(L.continent ?? '—')} asn=${String(L.asn ?? '—')} ${String(L.asName ?? '')}`,
                          r.access?.blocked
                            ? `會攔截 · ${r.access.reason} · ${r.access.matched?.join(', ')}`
                            : `放行 · ${r.access?.reason ?? 'ok'}`,
                          ...((L.notes as string[]) ?? []).slice(0, 4),
                        ],
                      };
                    }, 'Lookup 完成')
                  }
                >
                  查詢
                </Button>
              </FormActions>
              {lookupResult?.lookup ? (
                <>
                  <div className="btn-row u-mt-3 u-mb-2">
                    {lookupResult.lookup.country ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const cc = String(lookupResult.lookup!.country);
                          if (!geoCountries.includes(cc)) {
                            setGeoCountries((p) => [...p, cc]);
                          }
                        }}
                      >
                        + 國家 {String(lookupResult.lookup.country)}
                      </Button>
                    ) : null}
                    {lookupResult.lookup.regionKey ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const rk = String(lookupResult.lookup!.regionKey);
                          if (!geoRegions.includes(rk)) {
                            setGeoRegions((p) => [...p, rk]);
                          }
                        }}
                      >
                        + 省 {String(lookupResult.lookup.regionKey)}
                      </Button>
                    ) : null}
                    {lookupResult.lookup.cityKey ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          const ck = String(lookupResult.lookup!.cityKey);
                          setGeoCityPolicy(true);
                          if (!geoCities.includes(ck)) {
                            setGeoCities((p) => [...p, ck]);
                          }
                        }}
                      >
                        + 城市 {String(lookupResult.lookup.city)}
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
                  </div>
                  <div className="table-wrap">
                    <table className="data">
                      <tbody>
                        {(
                          [
                            ['IP', lookupResult.lookup.ip],
                            ['國家', lookupResult.lookup.country],
                            [
                              '省／州',
                              lookupResult.lookup.regionKey ||
                                lookupResult.lookup.regionName,
                            ],
                            ['城市', lookupResult.lookup.city],
                            ['大陸', lookupResult.lookup.continent],
                            [
                              '座標',
                              lookupResult.lookup.latitude != null
                                ? `${lookupResult.lookup.latitude}, ${lookupResult.lookup.longitude}`
                                : '—',
                            ],
                            ['ASN', lookupResult.lookup.asn],
                            ['供應商', lookupResult.lookup.asName],
                            ['來源', lookupResult.lookup.source],
                            [
                              '政策',
                              lookupResult.access?.blocked ? '攔截' : '放行',
                            ],
                            [
                              '命中',
                              lookupResult.access?.matched?.join(', ') || '—',
                            ],
                          ] as const
                        ).map(([k, v]) => (
                          <tr key={k}>
                            <th>{k}</th>
                            <td>{String(v ?? '—')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </Tabs>

      <OpsResultPanel
        title="操作結果"
        result={
          result
            ? {
                ...result,
                notes: summarizeOpsNotes(
                  Array.isArray(result.notes) ? result.notes.map(String) : undefined,
                ),
              }
            : result
        }
        message={msg}
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
