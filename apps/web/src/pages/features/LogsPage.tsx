/**
 * System Log Center — SOC-style professional UX.
 * Explore (sources + viewer) · Ops (vacuum/disk) · Settings
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  LogViewer,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  Tabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';

/** Public tabs — old journal/files/projects deep-links map into explore */
const TABS = ['explore', 'ops', 'settings'] as const;
const LEGACY_TAB_MAP: Record<string, (typeof TABS)[number]> = {
  overview: 'explore',
  journal: 'explore',
  files: 'explore',
  projects: 'explore',
  maintain: 'ops',
  settings: 'settings',
};

type LogSettings = {
  maxLines: number;
  maxBytes: number;
  followIntervalSec: number;
  vacuumDefaultDays: number;
  maskSecrets: boolean;
  disabledSources: string[];
  customAllowPaths: string[];
  bookmarks: LogBookmark[];
  autoVacuumEnabled: boolean;
  autoVacuumTime: string;
  journalWarnMb: number;
};

type LogBookmark = {
  id: string;
  name: string;
  source: string;
  since?: string;
  priority?: string;
  grep?: string;
  lines?: number;
  createdAt: string;
};

type Overview = {
  at: string;
  journalDisk?: string;
  journalDiskMb?: number;
  varLogHint?: string;
  varLogMb?: number;
  logrotate?: { installed: boolean; statusText?: string; notes: string[] };
  quickUnits: Array<{ unit: string; label: string }>;
  sourceCount: { total: number; available: number };
  recentErrors?: number;
  notes: string[];
  executeEnabled: boolean;
  isRoot: boolean;
  settings?: LogSettings;
  projectLogs?: { projectCount: number; fileCount: number; withFiles: number };
};

type ProjectLogIndex = {
  projectId: string;
  name: string;
  domain?: string;
  runtime?: string;
  status?: string;
  linuxUser?: string;
  homeDir?: string;
  files: Array<{
    name: string;
    bytes: number;
    mtime?: string;
    kind?: string;
    previewable?: boolean;
  }>;
  related?: Array<{
    id: string;
    kind: string;
    label: string;
    source: string;
    available: boolean;
    meta?: string;
  }>;
  fileCount?: number;
};

type Source = {
  id: string;
  kind: string;
  label: string;
  description?: string;
  unit?: string;
  group: string;
  available: boolean;
  resolvedPath?: string;
  bytes?: number;
  mtime?: string;
  notes?: string[];
};

type QueryResult = {
  ok: boolean;
  source: string;
  lines: string[];
  lineCount: number;
  truncated: boolean;
  notes: string[];
  blocked?: boolean;
  requiresRoot?: boolean;
};

type RailItem = {
  id: string;
  source: string;
  label: string;
  meta?: string;
  group: string;
  kind: 'journal' | 'file' | 'project';
  available: boolean;
  projectId?: string;
};

function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function groupLabel(g: string): string {
  if (g.startsWith('proj:')) return g.slice('proj:'.length);
  const map: Record<string, string> = {
    system: '系統檔',
    web: 'Web',
    mail: '郵件',
    security: '安全',
    app: '應用',
    other: '其他',
    journal: 'Journal 服務',
  };
  return map[g] || g;
}

export function LogsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = usePageTab(TABS, 'explore');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [units, setUnits] = useState<Array<{ unit: string; active?: string }>>([]);
  const [projects, setProjects] = useState<ProjectLogIndex[]>([]);
  const [settings, setSettings] = useState<LogSettings | null>(null);
  const [projectsOnly, setProjectsOnly] = useState(false);
  const [collapsedProjects, setCollapsedProjects] = useState<Record<string, boolean>>({});

  const [activeSource, setActiveSource] = useState(
    () =>
      (searchParams.get('source')
        ? searchParams.get('source')!
        : searchParams.get('unit')
          ? `journal:${searchParams.get('unit')}`
          : 'journal:nginx.service'),
  );
  const [since, setSince] = useState('1h');
  const [priority, setPriority] = useState('');
  const [grep, setGrep] = useState('');
  const [lines, setLines] = useState(300);
  const [follow, setFollow] = useState(false);
  const [useSse, setUseSse] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [text, setText] = useState('');
  const [lineCount, setLineCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [queryNotes, setQueryNotes] = useState<string[]>([]);
  const [queryOk, setQueryOk] = useState<boolean | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [railFilter, setRailFilter] = useState('');
  const [vacuumDays, setVacuumDays] = useState('14d');
  const [customPathInput, setCustomPathInput] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<Partial<LogSettings>>({});
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const followSec = settings?.followIntervalSec ?? 3;
  const journalWarn = settings?.journalWarnMb ?? 1024;
  const journalHigh =
    overview?.journalDiskMb != null && overview.journalDiskMb >= journalWarn;

  const refreshMeta = useCallback(async () => {
    setLoadErr(null);
    setMetaLoading(true);
    try {
      const [ov, src, un, pr, st] = await Promise.all([
        api.requestRaw<Overview>('/api/v1/logs/overview'),
        api.requestRaw<{ items: Source[] }>('/api/v1/logs/sources'),
        api.requestRaw<{ items: Array<{ unit: string; active?: string }> }>(
          '/api/v1/logs/journal/units',
        ),
        api.requestRaw<{ items: ProjectLogIndex[] }>('/api/v1/logs/projects'),
        api.requestRaw<LogSettings>('/api/v1/logs/settings'),
      ]);
      setOverview(ov);
      setSources(src.items ?? []);
      setUnits(un.items ?? []);
      setProjects(pr.items ?? []);
      setSettings(st);
      setSettingsDraft(st);
      if (st.vacuumDefaultDays) setVacuumDays(`${st.vacuumDefaultDays}d`);
      if (st.maxLines && !searchParams.get('lines')) setLines(st.maxLines);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : '載入失敗');
    } finally {
      setMetaLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void refreshMeta();
  }, [refreshMeta]);

  // deep links
  useEffect(() => {
    const u = searchParams.get('unit');
    const s = searchParams.get('source');
    const t = searchParams.get('tab');
    const projectId = searchParams.get('project');
    if (t) {
      const mapped = LEGACY_TAB_MAP[t] ?? ((TABS as readonly string[]).includes(t) ? t : null);
      if (mapped) setTab(mapped as (typeof TABS)[number]);
      if (t === 'projects') setProjectsOnly(true);
    }
    if (u) setActiveSource(`journal:${u}`);
    else if (s) setActiveSource(s);
    if (projectId) {
      setProjectsOnly(true);
      setCollapsedProjects((c) => ({ ...c, [projectId]: false }));
    }
    if (searchParams.get('projectsOnly') === '1') setProjectsOnly(true);
  }, [searchParams, setTab]);

  // When ?project= and index loaded, pick first available source for that project
  useEffect(() => {
    const projectId = searchParams.get('project');
    if (!projectId || !projects.length) return;
    if (searchParams.get('source') || searchParams.get('unit')) return;
    const p = projects.find((x) => x.projectId === projectId);
    if (!p) return;
    const firstFile = p.files.find((f) => f.previewable !== false);
    if (firstFile) {
      setActiveSource(`project:${p.projectId}:${firstFile.name}`);
      return;
    }
    const rel = p.related?.find((r) => r.available);
    if (rel) setActiveSource(rel.source);
  }, [projects, searchParams]);

  const railItems = useMemo((): RailItem[] => {
    const items: RailItem[] = [];

    const journalSeen = new Set<string>();
    for (const s of sources.filter((x) => x.kind === 'journal')) {
      const unitName = s.unit || `${s.label}.service`;
      const src = `journal:${unitName}`;
      journalSeen.add(unitName);
      items.push({
        id: s.id,
        source: src,
        label: s.label,
        meta: unitName,
        group: 'journal',
        kind: 'journal',
        available: true,
      });
    }
    for (const q of overview?.quickUnits ?? []) {
      if (journalSeen.has(q.unit)) continue;
      journalSeen.add(q.unit);
      items.push({
        id: `quick:${q.unit}`,
        source: `journal:${q.unit}`,
        label: q.label,
        meta: q.unit,
        group: 'journal',
        kind: 'journal',
        available: true,
      });
    }
    for (const u of units.slice(0, 80)) {
      if (journalSeen.has(u.unit)) continue;
      // hide per-project units from global journal list (they appear under project)
      if (u.unit.startsWith('ysk-project-')) continue;
      journalSeen.add(u.unit);
      items.push({
        id: `unit:${u.unit}`,
        source: `journal:${u.unit}`,
        label: u.unit.replace(/\.service$/, ''),
        meta: u.active ? u.active : undefined,
        group: 'journal',
        kind: 'journal',
        available: true,
      });
    }

    for (const s of sources.filter((x) => x.kind === 'file')) {
      // managed nginx files that belong to a project linux user → shown under project group
      const managedUser = s.id.startsWith('file:managed:')
        ? s.id.replace('file:managed:', '').replace(/\.(access|error)\.log$/, '')
        : null;
      const owner = managedUser
        ? projects.find((p) => p.linuxUser === managedUser)
        : undefined;
      if (owner) {
        items.push({
          id: s.id,
          source: s.id,
          label: s.label,
          meta: s.available ? formatBytes(s.bytes) : '不可用',
          group: `proj:${owner.name}`,
          kind: 'project',
          available: s.available,
          projectId: owner.projectId,
        });
        continue;
      }
      items.push({
        id: s.id,
        source: s.id,
        label: s.label,
        meta: s.available ? formatBytes(s.bytes) : '不可用',
        group: s.group || 'other',
        kind: 'file',
        available: s.available,
      });
    }

    // Every project: related + files under its own group
    for (const p of projects) {
      const g = `proj:${p.name}`;
      for (const r of p.related ?? []) {
        // available managed nginx already listed via file:managed catalog
        if (r.kind === 'managed-nginx' && r.available) continue;
        items.push({
          id: r.id,
          source: r.source,
          label: r.label,
          meta: r.meta,
          group: g,
          kind: r.kind === 'journal' ? 'journal' : 'project',
          available: r.available,
          projectId: p.projectId,
        });
      }
      for (const f of p.files) {
        const previewable = f.previewable !== false;
        items.push({
          id: `proj:${p.projectId}:${f.name}`,
          source: `project:${p.projectId}:${f.name}`,
          label: f.name,
          meta: `${formatBytes(f.bytes)}${previewable ? '' : ' · 壓縮'}`,
          group: g,
          kind: 'project',
          available: previewable,
          projectId: p.projectId,
        });
      }
      if (!(p.related?.length) && !p.files.length) {
        items.push({
          id: `proj-empty:${p.projectId}`,
          source: `project:${p.projectId}`,
          label: '（尚未有 log 檔）',
          meta: p.linuxUser ? `user ${p.linuxUser}` : '部署後會出現',
          group: g,
          kind: 'project',
          available: true,
          projectId: p.projectId,
        });
      }
    }
    return items;
  }, [sources, units, projects, overview?.quickUnits]);

  const railFiltered = useMemo(() => {
    const focusProject = searchParams.get('project');
    let list = railItems;
    if (focusProject) {
      list = list.filter((i) => i.projectId === focusProject);
    } else if (projectsOnly) {
      list = list.filter((i) => Boolean(i.projectId) || i.group.startsWith('proj:'));
    }
    const q = railFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.source.toLowerCase().includes(q) ||
        i.group.toLowerCase().includes(q) ||
        (i.meta && i.meta.toLowerCase().includes(q)),
    );
  }, [railItems, railFilter, projectsOnly, searchParams]);

  const railGroups = useMemo(() => {
    const order = ['journal', 'security', 'web', 'mail', 'system', 'other', 'app'];
    const map = new Map<string, RailItem[]>();
    for (const i of railFiltered) {
      const g = i.group;
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(i);
    }
    const systemGroups = order
      .filter((g) => map.has(g))
      .map((g) => ({ group: g, items: map.get(g)!, isProject: false }));
    const projectGroups = [...map.keys()]
      .filter((g) => g.startsWith('proj:'))
      .sort((a, b) => a.localeCompare(b))
      .map((g) => ({ group: g, items: map.get(g)!, isProject: true }));
    const other = [...map.keys()]
      .filter((g) => !order.includes(g) && !g.startsWith('proj:'))
      .map((g) => ({ group: g, items: map.get(g)!, isProject: false }));
    return [...systemGroups, ...other, ...projectGroups];
  }, [railFiltered]);

  const activeMeta = useMemo(
    () => railItems.find((i) => i.source === activeSource),
    [railItems, activeSource],
  );

  const isJournal = activeSource.startsWith('journal:');
  const bookmarks = settings?.bookmarks ?? [];

  async function runQuery(source?: string) {
    const src = source ?? activeSource;
    const srcIsJournal = src.startsWith('journal:');
    await run(async () => {
      const q = new URLSearchParams();
      q.set('source', src);
      q.set('lines', String(lines));
      if (since && srcIsJournal) q.set('since', since);
      if (priority && srcIsJournal) q.set('priority', priority);
      if (grep.trim()) q.set('grep', grep.trim());
      const r = await api.requestRaw<QueryResult>(`/api/v1/logs/query?${q}`);
      setText((r.lines ?? []).join('\n'));
      setLineCount(r.lineCount ?? r.lines?.length ?? 0);
      setTruncated(Boolean(r.truncated));
      setQueryNotes(r.notes ?? []);
      setQueryOk(r.ok);
      setActiveSource(src);
      setSearchParams(
        (prev) => {
          const n = new URLSearchParams(prev);
          n.set('tab', 'explore');
          if (src.startsWith('journal:')) {
            n.set('unit', src.slice('journal:'.length));
            n.delete('source');
          } else {
            n.set('source', src);
            n.delete('unit');
          }
          return n;
        },
        { replace: true },
      );
      return {
        ok: r.ok,
        notes: r.notes,
        blocked: r.blocked,
      } as OpsResultLike;
    }, '已載入日誌');
  }

  function selectSource(src: string) {
    setActiveSource(src);
    setFollow(false);
    void runQuery(src);
  }

  function applyBookmark(b: LogBookmark) {
    if (b.since) setSince(b.since);
    if (b.priority != null) setPriority(b.priority);
    if (b.grep != null) setGrep(b.grep);
    if (b.lines) setLines(b.lines);
    setTab('explore');
    setActiveSource(b.source);
    void runQuery(b.source);
  }

  // Follow
  useEffect(() => {
    if (!follow || tab !== 'explore') return;
    const src = activeSource;
    if (!src) return;

    if (useSse) {
      const token = authStore.getToken();
      const q = new URLSearchParams({
        source: src,
        lines: String(lines),
        interval: String(followSec),
      });
      if (since) q.set('since', since);
      if (priority) q.set('priority', priority);
      if (grep.trim()) q.set('grep', grep.trim());
      const ac = new AbortController();
      void (async () => {
        try {
          const headers: Record<string, string> = { Accept: 'text/event-stream' };
          if (token) headers.Authorization = `Bearer ${token}`;
          const res = await fetch(`/api/v1/logs/stream?${q}`, {
            headers,
            signal: ac.signal,
            credentials: 'include',
          });
          if (!res.ok || !res.body) {
            setError('SSE 串流失敗，改用輪詢');
            setUseSse(false);
            return;
          }
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          while (!ac.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const parts = buf.split('\n\n');
            buf = parts.pop() || '';
            for (const block of parts) {
              const linesB = block.split('\n');
              let event = 'message';
              let data = '';
              for (const ln of linesB) {
                if (ln.startsWith('event:')) event = ln.slice(6).trim();
                if (ln.startsWith('data:')) data += ln.slice(5).trim();
              }
              if (event === 'log' && data) {
                try {
                  const payload = JSON.parse(data) as QueryResult;
                  setText((payload.lines ?? []).join('\n'));
                  setLineCount(payload.lineCount ?? payload.lines?.length ?? 0);
                  setQueryNotes(payload.notes ?? []);
                  setQueryOk(payload.ok);
                } catch {
                  /* */
                }
              }
            }
          }
        } catch (e) {
          if (!ac.signal.aborted) {
            setError(e instanceof Error ? e.message : 'SSE 中斷');
            setUseSse(false);
          }
        }
      })();
      return () => ac.abort();
    }

    const id = window.setInterval(() => {
      void (async () => {
        try {
          const q = new URLSearchParams({
            source: src,
            lines: String(lines),
            since,
          });
          if (priority) q.set('priority', priority);
          if (grep.trim()) q.set('grep', grep.trim());
          const r = await api.requestRaw<QueryResult>(`/api/v1/logs/query?${q}`);
          setText((r.lines ?? []).join('\n'));
          setLineCount(r.lineCount ?? r.lines?.length ?? 0);
        } catch {
          /* */
        }
      })();
    }, followSec * 1000);
    return () => window.clearInterval(id);
  }, [
    follow,
    useSse,
    tab,
    activeSource,
    lines,
    since,
    priority,
    grep,
    followSec,
    setError,
  ]);

  async function saveSettings() {
    await run(async () => {
      const r = await api.requestRaw<LogSettings>('/api/v1/logs/settings', {
        method: 'PUT',
        body: JSON.stringify({
          maxLines: Number(settingsDraft.maxLines) || 500,
          maxBytes: Number(settingsDraft.maxBytes) || 2 * 1024 * 1024,
          followIntervalSec: Number(settingsDraft.followIntervalSec) || 3,
          vacuumDefaultDays: Number(settingsDraft.vacuumDefaultDays) || 14,
          maskSecrets: settingsDraft.maskSecrets !== false,
          autoVacuumEnabled: Boolean(settingsDraft.autoVacuumEnabled),
          autoVacuumTime: settingsDraft.autoVacuumTime || '03:00',
          journalWarnMb: Number(settingsDraft.journalWarnMb) || 1024,
          customAllowPaths: settingsDraft.customAllowPaths ?? [],
          disabledSources: settingsDraft.disabledSources ?? [],
        }),
      });
      setSettings(r);
      setSettingsDraft(r);
      await refreshMeta();
      return { ok: true, notes: ['設定已儲存'] } as OpsResultLike;
    }, '設定已儲存');
  }

  async function exportServer(format: 'text' | 'jsonl') {
    await run(async () => {
      const r = await api.requestRaw<{
        ok: boolean;
        id?: string;
        notes?: string[];
        format?: string;
      }>('/api/v1/logs/export', {
        method: 'POST',
        body: JSON.stringify({
          source: activeSource,
          lines,
          since: isJournal ? since : undefined,
          priority: isJournal && priority ? priority : undefined,
          grep: grep.trim() || undefined,
          format,
        }),
      });
      if (r.ok && r.id) {
        await api.downloadAuthenticated(
          `/api/v1/logs/export/${r.id}`,
          `ysk-logs-${r.id}.${format === 'jsonl' ? 'jsonl' : 'log'}`,
        );
      }
      return { ok: r.ok, notes: r.notes } as OpsResultLike;
    }, format === 'jsonl' ? '已匯出 JSONL' : '已匯出');
  }

  async function saveBookmark() {
    const defaultName =
      activeMeta?.label || activeSource.replace(/^(journal:|file:|project:)/, '');
    const name = window.prompt('書籤名稱', defaultName) || defaultName;
    await run(async () => {
      await api.requestRaw('/api/v1/logs/bookmarks', {
        method: 'POST',
        body: JSON.stringify({
          name,
          source: activeSource,
          since: isJournal ? since : undefined,
          priority: priority || undefined,
          grep: grep.trim() || undefined,
          lines,
        }),
      });
      await refreshMeta();
      return { ok: true, notes: ['已存書籤'] } as OpsResultLike;
    }, '已存書籤');
  }

  const quickChips = [
    { label: 'nginx', source: 'journal:nginx.service' },
    { label: 'ssh', source: 'journal:ssh.service' },
    { label: 'fail2ban', source: 'journal:fail2ban.service' },
    { label: 'auth.log', source: 'file:auth' },
    { label: 'nginx error', source: 'file:nginx-error' },
  ];

  return (
    <FeaturePageLayout
      title={t('nav.logs', { defaultValue: '日誌中心' })}
      showCapability={false}
      actions={
        <div className="lc-head-actions">
          <Button
            variant="secondary"
            size="md"
            loading={metaLoading || busy}
            onClick={() => void refreshMeta()}
          >
            重新整理
          </Button>
          <Link to="/services" className="btn btn--ghost btn--md">
            服務狀態
          </Link>
          <Link to="/metrics" className="btn btn--ghost btn--md">
            主機指標
          </Link>
          <Link to="/system" className="btn btn--ghost btn--md">
            主機設定
          </Link>
          <Link to="/protection" className="btn btn--ghost btn--md">
            防護中心
          </Link>
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

      {/* Hero — aligned with System ops console density */}
      <section
        className={`lc-hero${journalHigh || (overview?.recentErrors ?? 0) > 20 ? ' lc-hero--warn' : ''}`}
        aria-label="日誌健康總覽"
      >
        <div className="lc-hero__layout">
          <div className="lc-hero__main">
            <div className="lc-hero__eyebrow">System Log Center</div>
            <h2 className="lc-hero__title">
              <span
                className={`ops-hero__pill ops-hero__pill--${
                  overview?.isRoot && overview?.executeEnabled
                    ? 'ok'
                    : journalHigh
                      ? 'warn'
                      : 'warn'
                }`}
              >
                {overview
                  ? overview.isRoot && overview.executeEnabled
                    ? '完整權限'
                    : !overview.isRoot
                      ? '非 root'
                      : '無 EXECUTE'
                  : '載入中'}
              </span>
              主機日誌觀測
              {journalHigh ? <Badge tone="warn">Journal 偏高</Badge> : null}
            </h2>
            <p className="lc-hero__hint">
              點來源即可查詢 · 行內公網 IP 可跳轉 ban · allowlist 安全 ·{' '}
              <strong>唔會</strong>開放任意路徑讀取。written vacuum ≠ 磁碟已回收需 EXECUTE。
            </p>
            <div className="lc-hero__meta">
              <span>
                來源{' '}
                <strong>
                  {overview?.sourceCount?.available ?? '—'}/
                  {overview?.sourceCount?.total ?? '—'}
                </strong>
              </span>
              <span className="ops-hero__dot" />
              <span>
                近 1h err <strong>{overview?.recentErrors ?? '—'}</strong>
              </span>
              <span className="ops-hero__dot" />
              <span>
                採樣{' '}
                <strong>
                  {overview?.at
                    ? new Date(overview.at).toLocaleString('zh-TW')
                    : '—'}
                </strong>
              </span>
            </div>
          </div>
          <div className="ops-hero__stats lc-hero__stats">
            <div className="ops-stat">
              <span className="ops-stat__lab">Journal</span>
              <span className="ops-stat__val">
                {overview?.journalDiskMb != null ? `${overview.journalDiskMb}` : '—'}
                <span className="lc-kpi-unit"> MB</span>
              </span>
            </div>
            <div className="ops-stat">
              <span className="ops-stat__lab">/var/log</span>
              <span className="ops-stat__val ops-stat__val--sm">
                {overview?.varLogMb != null ? `≈${overview.varLogMb}MB` : '—'}
              </span>
            </div>
            <div className="ops-stat">
              <span className="ops-stat__lab">錯誤</span>
              <span className="ops-stat__val">
                <Badge
                  tone={(overview?.recentErrors ?? 0) > 20 ? 'warn' : 'ok'}
                >
                  {overview?.recentErrors ?? '—'}
                </Badge>
              </span>
            </div>
            <div className="ops-stat">
              <span className="ops-stat__lab">專案 log</span>
              <span className="ops-stat__val">
                {overview?.projectLogs?.fileCount ??
                  projects.reduce((n, p) => n + (p.files?.length ?? 0), 0)}
              </span>
            </div>
          </div>
        </div>
        <ul className="ops-rail lc-hero__rail">
          <li>
            <span className="ops-rail__k">EXECUTE</span>
            <Badge tone={overview?.executeEnabled ? 'ok' : 'warn'}>
              {overview?.executeEnabled ? '開' : '關'}
            </Badge>
          </li>
          <li>
            <span className="ops-rail__k">Root</span>
            <Badge tone={overview?.isRoot ? 'ok' : 'warn'}>
              {overview?.isRoot ? '是' : '否'}
            </Badge>
          </li>
          <li>
            <span className="ops-rail__k">logrotate</span>
            <Badge
              tone={overview?.logrotate?.installed ? 'ok' : 'neutral'}
            >
              {overview?.logrotate?.installed ? '有' : '—'}
            </Badge>
          </li>
        </ul>
      </section>

      {/* Quick + bookmarks */}
      <div className="lc-strip">
        <div className="lc-strip__row">
          <span className="lc-strip__label">快捷</span>
          {quickChips.map((c) => (
            <button
              key={c.source}
              type="button"
              className={`lc-chip ${activeSource === c.source ? 'lc-chip--active' : ''}`}
              onClick={() => selectSource(c.source)}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            className={`lc-chip ${projectsOnly ? 'lc-chip--active' : ''}`}
            onClick={() => {
              setProjectsOnly((v) => !v);
              setTab('explore');
            }}
          >
            只顯示專案
          </button>
          {projects.slice(0, 6).map((p) => (
            <button
              key={p.projectId}
              type="button"
              className="lc-chip lc-chip--bookmark"
              onClick={() => {
                setProjectsOnly(true);
                setTab('explore');
                setCollapsedProjects((c) => ({ ...c, [p.projectId]: false }));
                const f = p.files.find((x) => x.previewable !== false);
                if (f) selectSource(`project:${p.projectId}:${f.name}`);
                else if (p.related?.[0]) selectSource(p.related[0].source);
                else selectSource(`project:${p.projectId}`);
              }}
              title={`${p.files?.length ?? 0} 檔`}
            >
              {p.name}
            </button>
          ))}
        </div>
        {bookmarks.length > 0 ? (
          <div className="lc-strip__row">
            <span className="lc-strip__label">書籤</span>
            {bookmarks.map((b) => (
              <button
                key={b.id}
                type="button"
                className="lc-chip lc-chip--bookmark"
                onClick={() => applyBookmark(b)}
                title={b.source}
              >
                ★ {b.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Tabs
        tabs={[
          { id: 'explore', label: '探索' },
          { id: 'ops', label: '維護' },
          { id: 'settings', label: '設定' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'explore' ? (
          <div className="tab-panel lc-explore">
            <div className="lc-workspace">
              {/* Source rail */}
              <aside className="lc-rail" aria-label="日誌來源">
                <div className="lc-rail__head">
                  <strong>來源</strong>
                  <span className="muted u-text-sm">{railFiltered.length}</span>
                </div>
                <input
                  className="lc-rail__search"
                  type="search"
                  placeholder="篩選 unit / 檔案…"
                  value={railFilter}
                  onChange={(e) => setRailFilter(e.target.value)}
                  aria-label="篩選來源"
                />
                <div className="lc-rail__body">
                  {railGroups.length === 0 ? (
                    <p className="muted u-text-sm lc-rail__empty">
                      {projectsOnly ? '未發現專案 log — 部署專案後會出現' : '無匹配來源'}
                    </p>
                  ) : (
                    railGroups.map(({ group, items, isProject }) => {
                      const pid = items.find((i) => i.projectId)?.projectId;
                      const collapsed =
                        Boolean(isProject && pid && collapsedProjects[pid] === true);
                      return (
                        <div key={group} className="lc-rail__group">
                          <button
                            type="button"
                            className="lc-rail__group-title lc-rail__group-title--btn"
                            onClick={() => {
                              if (!pid) return;
                              setCollapsedProjects((c) => ({
                                ...c,
                                [pid]: !collapsed,
                              }));
                            }}
                          >
                            <span>
                              {isProject ? '專案 · ' : ''}
                              {groupLabel(group)}
                            </span>
                            <span className="lc-rail__group-count">
                              {items.length}
                              {isProject && pid
                                ? collapsed
                                  ? ' ▸'
                                  : ' ▾'
                                : ''}
                            </span>
                          </button>
                          {collapsed ? null : (
                            <ul className="lc-rail__list">
                              {items.map((item) => (
                                <li key={item.id}>
                                  <button
                                    type="button"
                                    className={[
                                      'lc-rail__item',
                                      activeSource === item.source
                                        ? 'lc-rail__item--active'
                                        : '',
                                      !item.available ? 'lc-rail__item--off' : '',
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                    disabled={!item.available && item.kind === 'file'}
                                    onClick={() => selectSource(item.source)}
                                  >
                                    <span className="lc-rail__item-label">{item.label}</span>
                                    {item.meta ? (
                                      <span className="lc-rail__item-meta">{item.meta}</span>
                                    ) : null}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </aside>

              {/* Viewer pane */}
              <div className="lc-main">
                <div className="lc-toolbar">
                  <div className="lc-toolbar__source">
                    <span className="lc-toolbar__kind">
                      {activeSource.startsWith('journal:')
                        ? 'JOURNAL'
                        : activeSource.startsWith('project:')
                          ? 'PROJECT'
                          : 'FILE'}
                    </span>
                    <code className="lc-toolbar__id">{activeSource}</code>
                  </div>
                  <div className="lc-toolbar__filters">
                    {isJournal ? (
                      <>
                        <label className="lc-field">
                          <span>時間</span>
                          <SegRadio
                            name="lc-since"
                            aria-label="時間範圍"
                            size="sm"
                            value={since || 'all'}
                            onChange={(v) => setSince(v === 'all' ? '' : v)}
                            options={[
                              { value: '15m', label: '15m' },
                              { value: '1h', label: '1h' },
                              { value: '6h', label: '6h' },
                              { value: '24h', label: '24h' },
                              { value: '7d', label: '7d' },
                              { value: 'all', label: '不限' },
                            ]}
                          />
                        </label>
                        <label className="lc-field">
                          <span>優先級</span>
                          <SegRadio
                            name="lc-prio"
                            aria-label="優先級"
                            size="sm"
                            value={priority || 'all'}
                            onChange={(v) => setPriority(v === 'all' ? '' : v)}
                            options={[
                              { value: 'all', label: '全部' },
                              { value: 'err', label: 'err+' },
                              { value: 'warning', label: 'warn+' },
                              { value: 'info', label: 'info+' },
                            ]}
                          />
                        </label>
                      </>
                    ) : null}
                    <label className="lc-field lc-field--grow">
                      <span>篩選</span>
                      <input
                        value={grep}
                        onChange={(e) => setGrep(e.target.value)}
                        placeholder="關鍵字 / IP…"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runQuery();
                        }}
                      />
                    </label>
                    <label className="lc-field">
                      <span>行數</span>
                      <PresetChips
                        options={[
                          { value: '100', label: '100' },
                          { value: '300', label: '300' },
                          { value: '500', label: '500' },
                          { value: '1000', label: '1000' },
                          { value: '2000', label: '2000' },
                        ]}
                        value={String(lines)}
                        onChange={(v) =>
                          setLines(Math.max(50, Math.min(5000, Number(v) || 300)))
                        }
                        allowCustom
                        customPlaceholder="自訂"
                      />
                    </label>
                  </div>
                  <div className="lc-toolbar__actions">
                    <Button
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={() => void runQuery()}
                    >
                      查詢
                    </Button>
                    <label className={`lc-toggle ${follow ? 'lc-toggle--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={follow}
                        onChange={(e) => setFollow(e.target.checked)}
                      />
                      <span>跟隨 {followSec}s</span>
                    </label>
                    <label className={`lc-toggle ${useSse ? 'lc-toggle--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={useSse}
                        disabled={!follow}
                        onChange={(e) => setUseSse(e.target.checked)}
                      />
                      <span>SSE</span>
                    </label>
                    <label className={`lc-toggle ${wrap ? 'lc-toggle--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={wrap}
                        onChange={(e) => setWrap(e.target.checked)}
                      />
                      <span>換行</span>
                    </label>
                    <div className="lc-toolbar__more">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!text}
                        onClick={() => void exportServer('text')}
                      >
                        匯出
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!text}
                        onClick={() => void exportServer('jsonl')}
                      >
                        JSONL
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!text}
                        onClick={() => {
                          void navigator.clipboard?.writeText(text);
                          setMsg('已複製');
                        }}
                      >
                        複製
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void saveBookmark()}
                      >
                        書籤
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="lc-status">
                  <span>
                    {queryOk == null ? (
                      <Badge tone="neutral">待命</Badge>
                    ) : queryOk ? (
                      <Badge tone="ok">OK</Badge>
                    ) : (
                      <Badge tone="warn">部分／失敗</Badge>
                    )}
                  </span>
                  <span className="muted u-text-sm">
                    {lineCount} 行
                    {truncated ? ' · 已截斷' : ''}
                    {follow ? ` · 跟隨中${useSse ? ' (SSE)' : ''}` : ''}
                  </span>
                  <span className="lc-status__notes muted u-text-sm">
                    {queryNotes.slice(0, 3).join(' · ')}
                  </span>
                  <Link
                    to="/protection?tab=bans"
                    className="lc-status__link u-text-sm"
                  >
                    IP → 封禁
                  </Link>
                </div>

                <div className={`lc-viewer-shell ${wrap ? '' : 'lc-viewer-shell--nowrap'}`}>
                  <LogViewer
                    text={text}
                    emptyLabel={
                      metaLoading
                        ? '載入來源中…'
                        : '選左側來源，或按快捷 · 再「查詢」'
                    }
                    maxHeight="min(62vh, 640px)"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'ops' ? (
          <div className="tab-panel lc-ops">
            <div className="lc-ops-grid">
              <div className="lc-card">
                <div className="lc-card__head">
                  <h3>Journal vacuum</h3>
                  <Badge tone={overview?.executeEnabled && overview?.isRoot ? 'ok' : 'warn'}>
                    {overview?.executeEnabled && overview?.isRoot ? '可執行' : '需 root+EXECUTE'}
                  </Badge>
                </div>
                <p className="muted u-text-sm">
                  釋放 journal 磁碟。目前：{overview?.journalDisk ?? '—'}
                  {overview?.journalDiskMb != null
                    ? ` (≈${overview.journalDiskMb} MB)`
                    : ''}
                </p>
                <FormLayout columns={2}>
                  <Field label="保留時間" htmlFor="vac-t" flush hint="例 7d · 14d">
                    <input
                      id="vac-t"
                      value={vacuumDays}
                      onChange={(e) => setVacuumDays(e.target.value)}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="danger"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      if (!window.confirm(`確定 journalctl --vacuum-time=${vacuumDays}？`))
                        return;
                      void run(async () => {
                        const r = (await api.requestRaw('/api/v1/logs/journal/vacuum', {
                          method: 'POST',
                          body: JSON.stringify({ mode: 'time', value: vacuumDays }),
                        })) as OpsResultLike;
                        await refreshMeta();
                        return r;
                      }, '已請求 vacuum');
                    }}
                  >
                    Vacuum 時間
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      if (!window.confirm('確定 vacuum-size=500M？')) return;
                      void run(async () => {
                        const r = (await api.requestRaw('/api/v1/logs/journal/vacuum', {
                          method: 'POST',
                          body: JSON.stringify({ mode: 'size', value: '500M' }),
                        })) as OpsResultLike;
                        await refreshMeta();
                        return r;
                      }, '已請求 vacuum size');
                    }}
                  >
                    Vacuum 500M
                  </Button>
                </FormActions>
                <FormHint>
                  無 EXECUTE 會 blocked。建議保留 ≥7 日。
                </FormHint>
              </div>

              <div className="lc-card">
                <div className="lc-card__head">
                  <h3>logrotate</h3>
                  <Badge tone={overview?.logrotate?.installed ? 'ok' : 'warn'}>
                    {overview?.logrotate?.installed ? '已安裝' : '未安裝'}
                  </Badge>
                </div>
                {overview?.logrotate?.statusText ? (
                  <pre className="lc-pre">{overview.logrotate.statusText}</pre>
                ) : (
                  <p className="muted u-text-sm">無 status 檔或不可讀</p>
                )}
              </div>

              <div className="lc-card lc-card--muted">
                <div className="lc-card__head">
                  <h3>分工</h3>
                </div>
                <ul className="lc-bullets">
                  <li>
                    <strong>日誌中心</strong> = 觀測 journal／檔案／專案
                  </li>
                  <li>
                    <strong>防護中心</strong> = 攻擊應變、自動 ban（點 IP）
                  </li>
                  <li>
                    <strong>專案 → 日誌</strong> = 單站快捷 + 深鏈
                  </li>
                </ul>
                <FormActions>
                  <Link to="/protection" className="btn btn--secondary btn--sm">
                    開啟防護中心
                  </Link>
                  <Link to="/services" className="btn btn--ghost btn--sm">
                    服務矩陣
                  </Link>
                </FormActions>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="tab-panel lc-settings">
            <div className="lc-ops-grid">
              <div className="lc-card">
                <div className="lc-card__head">
                  <h3>查詢與跟隨</h3>
                </div>
                <FormLayout columns={2}>
                  <Field label="預設行數" htmlFor="set-lines" flush>
                    <PresetChips
                      options={[
                        { value: '200', label: '200' },
                        { value: '500', label: '500' },
                        { value: '1000', label: '1000' },
                        { value: '2000', label: '2000' },
                      ]}
                      value={String(settingsDraft.maxLines ?? 500)}
                      onChange={(v) =>
                        setSettingsDraft((d) => ({
                          ...d,
                          maxLines: Number(v) || 500,
                        }))
                      }
                    />
                  </Field>
                  <Field label="跟隨間隔" htmlFor="set-follow" flush>
                    <PresetChips
                      options={[
                        { value: '1', label: '1s' },
                        { value: '2', label: '2s' },
                        { value: '3', label: '3s' },
                        { value: '5', label: '5s' },
                        { value: '10', label: '10s' },
                      ]}
                      value={String(settingsDraft.followIntervalSec ?? 3)}
                      onChange={(v) =>
                        setSettingsDraft((d) => ({
                          ...d,
                          followIntervalSec: Number(v) || 3,
                        }))
                      }
                    />
                  </Field>
                  <Field label="最大字節" htmlFor="set-bytes" flush>
                    <PresetChips
                      options={[
                        { value: '524288', label: '512 KiB' },
                        { value: '1048576', label: '1 MiB' },
                        { value: '2097152', label: '2 MiB' },
                        { value: '5242880', label: '5 MiB' },
                      ]}
                      value={String(settingsDraft.maxBytes ?? 2097152)}
                      onChange={(v) =>
                        setSettingsDraft((d) => ({
                          ...d,
                          maxBytes: Number(v) || 2097152,
                        }))
                      }
                    />
                  </Field>
                  <Field label="遮罩 secret" htmlFor="set-mask" flush>
                    <label className="lc-toggle">
                      <input
                        id="set-mask"
                        type="checkbox"
                        checked={settingsDraft.maskSecrets !== false}
                        onChange={(e) =>
                          setSettingsDraft((d) => ({ ...d, maskSecrets: e.target.checked }))
                        }
                      />
                      <span>password / token → ***</span>
                    </label>
                  </Field>
                </FormLayout>
              </div>

              <div className="lc-card">
                <div className="lc-card__head">
                  <h3>保留與告警</h3>
                </div>
                <FormLayout columns={2}>
                  <Field label="預設 vacuum 天數" htmlFor="set-vac-d" flush>
                    <PresetChips
                      options={[
                        { value: '7', label: '7 日' },
                        { value: '14', label: '14 日' },
                        { value: '30', label: '30 日' },
                        { value: '90', label: '90 日' },
                      ]}
                      value={String(settingsDraft.vacuumDefaultDays ?? 14)}
                      onChange={(v) =>
                        setSettingsDraft((d) => ({
                          ...d,
                          vacuumDefaultDays: Number(v) || 14,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Journal 告警" htmlFor="set-warn" flush>
                    <PresetChips
                      options={[
                        { value: '512', label: '512 MB' },
                        { value: '1024', label: '1 GB' },
                        { value: '2048', label: '2 GB' },
                        { value: '4096', label: '4 GB' },
                      ]}
                      value={String(settingsDraft.journalWarnMb ?? 1024)}
                      onChange={(v) =>
                        setSettingsDraft((d) => ({
                          ...d,
                          journalWarnMb: Number(v) || 1024,
                        }))
                      }
                    />
                  </Field>
                  <Field label="自動 vacuum" htmlFor="set-auto-v" flush>
                    <label className="lc-toggle">
                      <input
                        id="set-auto-v"
                        type="checkbox"
                        checked={Boolean(settingsDraft.autoVacuumEnabled)}
                        onChange={(e) =>
                          setSettingsDraft((d) => ({
                            ...d,
                            autoVacuumEnabled: e.target.checked,
                          }))
                        }
                      />
                      <span>每日（需 root + EXECUTE）</span>
                    </label>
                  </Field>
                  <Field label="時間" htmlFor="set-auto-t" flush>
                    <PresetChips
                      options={[
                        { value: '01:00', label: '01:00' },
                        { value: '03:00', label: '03:00' },
                        { value: '04:30', label: '04:30' },
                        { value: '05:00', label: '05:00' },
                      ]}
                      value={String(settingsDraft.autoVacuumTime ?? '03:00')}
                      onChange={(v) =>
                        setSettingsDraft((d) => ({ ...d, autoVacuumTime: v }))
                      }
                      allowCustom
                      customPlaceholder="HH:MM"
                    />
                  </Field>
                </FormLayout>
              </div>

              <div className="lc-card">
                <div className="lc-card__head">
                  <h3>自訂 allow 路徑</h3>
                </div>
                <p className="muted u-text-sm">僅 /var/log 或 /run/log。拒絕 .ssh、金鑰、/etc。</p>
                <FormLayout columns={1}>
                  <Field label="新增路徑" htmlFor="set-custom" flush>
                    <input
                      id="set-custom"
                      value={customPathInput}
                      onChange={(e) => setCustomPathInput(e.target.value)}
                      placeholder="/var/log/nginx/custom.log"
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const p = customPathInput.trim();
                      if (!p) return;
                      setSettingsDraft((d) => ({
                        ...d,
                        customAllowPaths: [...(d.customAllowPaths ?? []), p].slice(0, 40),
                      }));
                      setCustomPathInput('');
                    }}
                  >
                    加入
                  </Button>
                </FormActions>
                <ul className="lc-path-list">
                  {(settingsDraft.customAllowPaths ?? []).map((p) => (
                    <li key={p}>
                      <code>{p}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSettingsDraft((d) => ({
                            ...d,
                            customAllowPaths: (d.customAllowPaths ?? []).filter((x) => x !== p),
                          }))
                        }
                      >
                        移除
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="lc-card">
                <div className="lc-card__head">
                  <h3>書籤</h3>
                </div>
                {!bookmarks.length ? (
                  <EmptyState
                    title="尚未有書籤"
                    description="在探索頁查詢後按「書籤」儲存常用過濾"
                  />
                ) : (
                  <ul className="lc-path-list">
                    {bookmarks.map((b) => (
                      <li key={b.id}>
                        <span>
                          <strong>{b.name}</strong>{' '}
                          <code className="muted">{b.source}</code>
                        </span>
                        <span className="lc-path-list__acts">
                          <Button variant="ghost" size="sm" onClick={() => applyBookmark(b)}>
                            開啟
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              void run(async () => {
                                await api.requestRaw(`/api/v1/logs/bookmarks/${b.id}`, {
                                  method: 'DELETE',
                                });
                                await refreshMeta();
                                return { ok: true, notes: ['已刪'] } as OpsResultLike;
                              }, '已刪書籤');
                            }}
                          >
                            刪
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <FormActions>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() => void saveSettings()}
              >
                儲存設定
              </Button>
            </FormActions>
            <FormHint>設定寫入面板 DB；自動 vacuum 由排程每 15 分鐘檢查時間窗。</FormHint>
          </div>
        ) : null}
      </Tabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
