/**
 * System Log Center — SOC-style professional UX.
 * Explore (sources + viewer) · Ops (vacuum/disk) · Settings
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PageGuide,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  FeaturePageLayout,
  Field,
  LogViewer,
  OpsResultPanel,
  PresetChips,
  PromptDialog,
  SegRadio,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { api } from '../../shared/services/api';
import { authStore } from '../../shared/stores/auth-store';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  bindSet,
  bindInput,
  bindCheck,
  bindVoid,
  bindCall1,
  bindAllOrValue,
  bindCloseIfIdle,
  bindChipNumber,
  bindDraftNumber,
  bindDraftCheck,
  bindToggleAndTab,
  bindCopyMsg,
  bindDraftString,
} from '../bind-handlers';

/** Public tabs — old journal/files/projects deep-links map into explore */
const TABS = ['explore', 'ops', 'settings', 'about'] as const;
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

export function formatBytes(n?: number): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function groupLabel(g: string): string {
  if (g.startsWith('proj:')) return g.slice('proj:'.length);
  const map: Record<string, string> = {
    system: i18n.t('logs.catSystem'),
    web: 'Web',
    mail: i18n.t('common.mail'),
    security: i18n.t('nav.sections.security'),
    app: i18n.t('logs.catApp'),
    other: i18n.t('logs.catOther'),
    journal: i18n.t('logs.journalService'),
  };
  return map[g] || g;
}

export function isJournalSource(src: string): boolean {
  return src.startsWith('journal:');
}

export function resolveLogTab(
  tab: string | null | undefined,
): (typeof TABS)[number] | null {
  if (!tab) return null;
  return (
    LEGACY_TAB_MAP[tab] ??
    ((TABS as readonly string[]).includes(tab)
      ? (tab as (typeof TABS)[number])
      : null)
  );
}

export function initialSourceFromParams(
  get: (key: string) => string | null,
): string {
  const source = get('source');
  if (source) return source;
  const unit = get('unit');
  if (unit) return `journal:${unit}`;
  return 'journal:nginx.service';
}

export function filterRailItems(
  list: RailItem[],
  opts: {
    focusProject?: string | null;
    projectsOnly?: boolean;
    q?: string;
  },
): RailItem[] {
  let out = list;
  if (opts.focusProject) {
    out = out.filter((i) => i.projectId === opts.focusProject);
  } else if (opts.projectsOnly) {
    out = out.filter(
      (i) => Boolean(i.projectId) || i.group.startsWith('proj:'),
    );
  }
  const q = (opts.q ?? '').trim().toLowerCase();
  if (!q) return out;
  return out.filter(
    (i) =>
      i.label.toLowerCase().includes(q) ||
      i.source.toLowerCase().includes(q) ||
      i.group.toLowerCase().includes(q) ||
      (i.meta && i.meta.toLowerCase().includes(q)),
  );
}

export function groupRailItems(
  railFiltered: RailItem[],
): Array<{ group: string; items: RailItem[]; isProject: boolean }> {
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

  const [activeSource, setActiveSource] = useState(() =>
    initialSourceFromParams((k) => searchParams.get(k)),
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
  const [vacuumConfirm, setVacuumConfirm] = useState<null | 'time' | 'size'>(null);
  const [bookmarkPromptOpen, setBookmarkPromptOpen] = useState(false);
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
      // Soft-fail per endpoint so one 500/timeout does not blank the whole Log center
      const settled = await Promise.allSettled([
        api.requestRaw<Overview>('/api/v1/logs/overview'),
        api.requestRaw<{ items: Source[] }>('/api/v1/logs/sources'),
        api.requestRaw<{ items: Array<{ unit: string; active?: string }> }>(
          '/api/v1/logs/journal/units',
        ),
        api.requestRaw<{ items: ProjectLogIndex[] }>('/api/v1/logs/projects'),
        api.requestRaw<LogSettings>('/api/v1/logs/settings'),
      ]);
      const [ov, src, un, pr, st] = settled;
      const fails: string[] = [];
      if (ov.status === 'fulfilled') setOverview(ov.value);
      else fails.push(ov.reason instanceof Error ? ov.reason.message : 'overview');
      if (src.status === 'fulfilled') setSources(src.value.items ?? []);
      else fails.push(src.reason instanceof Error ? src.reason.message : 'sources');
      if (un.status === 'fulfilled') setUnits(un.value.items ?? []);
      else fails.push(un.reason instanceof Error ? un.reason.message : 'units');
      if (pr.status === 'fulfilled') setProjects(pr.value.items ?? []);
      else fails.push(pr.reason instanceof Error ? pr.reason.message : 'projects');
      if (st.status === 'fulfilled') {
        setSettings(st.value);
        setSettingsDraft(st.value);
        if (st.value.vacuumDefaultDays) setVacuumDays(`${st.value.vacuumDefaultDays}d`);
        if (st.value.maxLines && !searchParams.get('lines')) setLines(st.value.maxLines);
      } else {
        fails.push(st.reason instanceof Error ? st.reason.message : 'settings');
      }
      // Only surface error if every critical call failed
      if (fails.length === settled.length) {
        setLoadErr(fails[0] ?? t('common.loadFailed'));
      } else if (fails.length) {
        setLoadErr(null); // partial OK — page still usable
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setMetaLoading(false);
    }
  }, [searchParams, t]);

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
      const mapped = resolveLogTab(t);
      if (mapped) setTab(mapped);
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
      if ((u.unit ?? '').startsWith('ysk-project-')) continue;
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
          meta: s.available ? formatBytes(s.bytes) : t('network.unavailable'),
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
        meta: s.available ? formatBytes(s.bytes) : t('network.unavailable'),
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
          meta: `${formatBytes(f.bytes)}${previewable ? '' : t('logs.compressed')}`,
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
          label: t('logs.noLogFileYet'),
          meta: p.linuxUser ? `user ${p.linuxUser}` : t('logs.afterDeploy'),
          group: g,
          kind: 'project',
          available: true,
          projectId: p.projectId,
        });
      }
    }
    return items;
  }, [sources, units, projects, overview?.quickUnits]);

  const railFiltered = useMemo(
    () =>
      filterRailItems(railItems, {
        focusProject: searchParams.get('project'),
        projectsOnly,
        q: railFilter,
      }),
    [railItems, railFilter, projectsOnly, searchParams],
  );

  const railGroups = useMemo(
    () => groupRailItems(railFiltered),
    [railFiltered],
  );

  const activeMeta = useMemo(
    () => railItems.find((i) => i.source === activeSource),
    [railItems, activeSource],
  );

  const isJournal = isJournalSource(activeSource);
  const bookmarks = settings?.bookmarks ?? [];

  async function runQuery(source?: string) {
    const src = source ?? activeSource;
    const srcIsJournal = isJournalSource(src);
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
          if (isJournalSource(src)) {
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
    }, t('logs.logsLoaded'));
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
            setError(t('logs.sseFailed'));
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
            setError(e instanceof Error ? e.message : t('logs.sseInterrupted'));
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
      return { ok: true, notes: [t('logs.settingsSaved')] } as OpsResultLike;
    }, t('logs.settingsSaved'));
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
    }, format === 'jsonl' ? t('logs.exportedJsonl') : t('logs.exported'));
  }

  async function saveBookmark(name: string) {
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
      return { ok: true, notes: [t('logs.bookmarkSaved')] } as OpsResultLike;
    }, t('logs.bookmarkSaved'));
  }

  const quickChips = [
    { label: t('logs.srcNginx'), source: 'journal:nginx.service' },
    { label: t('logs.srcSsh'), source: 'journal:ssh.service' },
    { label: t('logs.srcFail2ban'), source: 'journal:fail2ban.service' },
    { label: t('logs.srcAuthLog'), source: 'file:auth' },
    { label: t('logs.srcNginxError'), source: 'file:nginx-error' },
    { label: t('logs.srcLetsEncrypt'), source: 'file:letsencrypt' },
  ];

  return (
    <FeaturePageLayout
      title={t('nav.logs', { defaultValue: t('system.scLogs') })}
      showCapability={false}
      status={{
        pill: {
          label: overview
            ? overview.isRoot && overview.executeEnabled
              ? t('logs.fullAccess')
              : !overview.isRoot
                ? t('logs.nonRoot')
                : t('logs.noExecute')
            : t('runtime.loading'),
          tone:
            overview?.isRoot && overview?.executeEnabled
              ? 'ok'
              : journalHigh || (overview?.recentErrors ?? 0) > 20
                ? 'warn'
                : 'warn',
        },
        items: [
          {
            label: t('logs.groupJournal'),
            value:
              overview?.journalDiskMb != null
                ? `${overview.journalDiskMb} MB`
                : '—',
            tone: journalHigh ? 'warn' : undefined,
          },
          {
            label: t('logs.groupVarLog'),
            value:
              overview?.varLogMb != null ? `≈${overview.varLogMb}MB` : '—',
          },
          {
            label: t('projects.healthDetail.error'),
            value: overview?.recentErrors ?? '—',
            tone: (overview?.recentErrors ?? 0) > 20 ? 'warn' : 'ok',
          },
          {
            label: t('logs.projectLog'),
            value:
              overview?.projectLogs?.fileCount ??
              projects.reduce((n, p) => n + (p.files?.length ?? 0), 0),
          },
          {
            label: t('system.executeLabel'),
            value: overview?.executeEnabled ? t('common.on') : t('common.off'),
            tone: overview?.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: t('system.rootLabel'),
            value: overview?.isRoot ? t('common.yes') : t('common.no'),
            tone: overview?.isRoot ? 'ok' : 'warn',
          },
        ],
      }}
      actions={<div className="lc-head-actions">
          <Button
            variant="secondary"
            size="sm"
            loading={metaLoading || busy}
            onClick={bindVoid(refreshMeta)}
          >
            {t('common.refresh')}
          </Button>
          <Link to="/services" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('nav.services')}
          </Link>
          <Link to="/metrics" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('system.scMetrics')}
          </Link>
          <Link to="/system" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('updates.scHost')}
          </Link>
          <Link to="/protection" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('readiness.scProtection')}
          </Link>
        </div>
      }
    >
      {loadErr ? <Alert variant="error">{loadErr}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {/* Quick + bookmarks */}
      <div className="lc-strip">
        <div className="lc-strip__row">
          <span className="lc-strip__label">{t('logs.shortcuts')}</span>
          {quickChips.map((c) => (
            <button
              key={c.source}
              type="button"
              className={`lc-chip ${activeSource === c.source ? 'lc-chip--active' : ''}`}
              onClick={bindCall1(selectSource, c.source)}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            className={`lc-chip ${projectsOnly ? 'lc-chip--active' : ''}`}
            onClick={bindToggleAndTab(setProjectsOnly, setTab, 'explore')}
          >
            {t('logs.projectsOnly')}
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
              title={t('logs.filesTitle', { n: p.files?.length ?? 0 })}
            >
              {p.name}
            </button>
          ))}
        </div>
        {bookmarks.length > 0 ? (
          <div className="lc-strip__row">
            <span className="lc-strip__label">{t('logs.bookmark')}</span>
            {bookmarks.map((b) => (
              <button
                key={b.id}
                type="button"
                className="lc-chip lc-chip--bookmark"
                onClick={bindCall1(applyBookmark, b)}
                title={b.source}
              >
                ★ {b.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <PageTabs
        tabs={[
          { id: 'explore', label: t('logs.tabExplore') },
          { id: 'ops', label: t('logs.tabMaint') },
          { id: 'settings', label: t('logs.tabSettings') },
        
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'explore' ? (
          <div className="tab-panel lc-explore">
            <div className="lc-workspace">
              {/* Source rail */}
              <aside className="lc-rail" aria-label={t('logs.sources')}>
                <div className="lc-rail__head">
                  <strong>{t('system.source')}</strong>
                  <span className="muted u-text-sm">{railFiltered.length}</span>
                </div>
                <input
                  id="logs-source-search"
                  name="logs-source-search"
                  className="lc-rail__search"
                  type="search"
                  placeholder={t('logs.filterPlaceholder')}
                  value={railFilter}
                  onChange={bindInput(setRailFilter)}
                  aria-label={t('logs.filterSources')}
                  autoComplete="off"
                />
                <div className="lc-rail__body">
                  {railGroups.length === 0 ? (
                    <p className="muted u-text-sm lc-rail__empty">
                      {projectsOnly ? t('logs.noProjectLogs') : t('logs.noMatchSources')}
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
                              {isProject ? t('logs.projectPrefix') : ''}
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
                                    onClick={bindCall1(selectSource, item.source)}
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
                          <span>{t('common.time')}</span>
                          <SegRadio
                            name="lc-since"
                            aria-label={t('logs.timeRange')}
                            size="sm"
                            value={since || 'all'}
                            onChange={bindAllOrValue(setSince)}
                            options={[
                              { value: '15m', label: '15m' },
                              { value: '1h', label: '1h' },
                              { value: '6h', label: '6h' },
                              { value: '24h', label: '24h' },
                              { value: '7d', label: '7d' },
                              { value: 'all', label: t('publicFiles.unlimited') },
                            ]}
                          />
                        </label>
                        <label className="lc-field">
                          <span>{t('logs.priority')}</span>
                          <SegRadio
                            name="lc-prio"
                            aria-label={t('logs.priority')}
                            size="sm"
                            value={priority || 'all'}
                            onChange={bindAllOrValue(setPriority)}
                            options={[
                              { value: 'all', label: t('updates.all') },
                              { value: 'err', label: t('logs.prioErr') },
                              { value: 'warning', label: t('logs.prioWarn') },
                              { value: 'info', label: t('logs.prioInfo') },
                            ]}
                          />
                        </label>
                      </>
                    ) : null}
                    <label className="lc-field lc-field--grow">
                      <span>{t('logs.filter')}</span>
                      <input
                        value={grep}
                        onChange={bindInput(setGrep)}
                        placeholder={t('logs.keywordIp')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void runQuery();
                        }}
                      />
                    </label>
                    <label className="lc-field">
                      <span>{t('metrics.rows')}</span>
                      <PresetChips
                        options={[
                          { value: '100', label: '100' },
                          { value: '300', label: '300' },
                          { value: '500', label: '500' },
                          { value: '1000', label: '1000' },
                          { value: '2000', label: '2000' },
                        ]}
                        value={String(lines)}
                        onChange={bindChipNumber(setLines, 300, 50, 5000)}
                        allowCustom
                        customPlaceholder={t('common.custom')}
                      />
                    </label>
                  </div>
                  <div className="lc-toolbar__actions">
                    <Button
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={bindVoid(runQuery)}
                    >
                      {t('protection.lookup')}
                    </Button>
                    <label className={`lc-toggle ${follow ? 'lc-toggle--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={follow}
                        onChange={bindCheck(setFollow)}
                      />
                      <span>{t('logs.followSec', { sec: followSec })}</span>
                    </label>
                    <label className={`lc-toggle ${useSse ? 'lc-toggle--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={useSse}
                        disabled={!follow}
                        onChange={bindCheck(setUseSse)}
                      />
                      <span>{t('logs.sseLabel')}</span>
                    </label>
                    <label className={`lc-toggle ${wrap ? 'lc-toggle--on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={wrap}
                        onChange={bindCheck(setWrap)}
                      />
                      <span>{t('logs.wrap')}</span>
                    </label>
                    <div className="lc-toolbar__more">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!text}
                        onClick={bindCall1(exportServer, 'text')}
                      >
                        {t('security.export')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!text}
                        onClick={bindCall1(exportServer, 'jsonl')}
                      >
                        JSONL
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!text}
                        onClick={bindCopyMsg(text, setMsg, t('logs.copied'))}
                      >
                        {t('common.copy')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={bindSet(setBookmarkPromptOpen, true)}
                      >
                        {t('logs.bookmarksLabel')}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="lc-status">
                  <span>
                    {queryOk == null ? (
                      <Badge tone="neutral">{t('logs.standby')}</Badge>
                    ) : queryOk ? (
                      <Badge tone="ok">OK</Badge>
                    ) : (
                      <Badge tone="warn">{t('logs.partialFail')}</Badge>
                    )}
                  </span>
                  <span className="muted u-text-sm">
                    {t('logs.lines', { n: lineCount })}
                    {truncated ? t('logs.truncated') : ''}
                    {follow ? t('logs.followingSseDyn', { sse: useSse ? ' (SSE)' : '' }) : ''}
                  </span>
                  <span className="lc-status__notes muted u-text-sm">
                    {queryNotes.slice(0, 3).join(' · ')}
                  </span>
                  <Link
                    to="/protection?tab=bans"
                    className="lc-status__link u-text-sm"
                  >
                    {t('logs.ipBan')}
                  </Link>
                </div>

                <div className={`lc-viewer-shell ${wrap ? '' : 'lc-viewer-shell--nowrap'}`}>
                  <LogViewer
                    text={text}
                    emptyLabel={
                      metaLoading
                        ? t('logs.loadingSources')
                        : t('logs.pickSource')
                    }
                    maxHeight="min(58vh, 620px)"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'ops' ? (
          <div className="tab-panel lc-ops">
            <div className="lc-section-stats" aria-label={t('logs.maintOverview')}>
              <div className="lc-stat">
                <span className="lc-stat__lab">Journal</span>
                <span className="lc-stat__val">
                  {overview?.journalDiskMb != null
                    ? `${overview.journalDiskMb} MB`
                    : overview?.journalDisk ?? '—'}
                </span>
              </div>
              <div className="lc-stat">
                <span className="lc-stat__lab">{t('updates.permPolicy')}</span>
                <span className="lc-stat__val">
                  {overview?.executeEnabled && overview?.isRoot ? t('logs.executable') : t('logs.restricted')}
                </span>
              </div>
            </div>

            <div className="lc-ops-grid lc-ops-grid--maint">
              <article className="lc-card lc-card--accent">
                <div className="lc-card__head">
                  <div className="lc-card__titles">
                    <h3>{t('logs.journalVacuumTitle')}</h3>
                    <p className="lc-card__desc">
                      {t('logs.vacuumNote')}
                    </p>
                  </div>
                  <Badge
                    tone={
                      overview?.executeEnabled && overview?.isRoot ? 'ok' : 'warn'
                    }
                  >
                    {overview?.executeEnabled && overview?.isRoot
                      ? t('logs.executable')
                      : t('logs.needRootExecute')}
                  </Badge>
                </div>
                <div className="lc-card__body">
                  <Field label={t('logs.retention')} htmlFor="vac-t" flush hint={t('logs.retentionHint')}>
                    <input
                      id="vac-t"
                      value={vacuumDays}
                      onChange={bindInput(setVacuumDays)}
                      placeholder="14d"
                    />
                  </Field>
                  <div className="lc-card__actions">
                    <Button
                      variant="danger"
                      size="md"
                      loading={busy}
                      onClick={bindSet(setVacuumConfirm, 'time')}
                    >
                      {t('logs.vacuumTime')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      loading={busy}
                      onClick={bindSet(setVacuumConfirm, 'size')}
                    >
                      Vacuum 500M
                    </Button>
                  </div>
                  <p className="lc-card__hint">{t('logs.vacuumHint')}</p>
                </div>
              </article>

              <article className="lc-card">
                <div className="lc-card__head">
                  <div className="lc-card__titles">
                    <h3>logrotate</h3>
                    <p className="lc-card__desc">{t('logs.logrotateStatus')}</p>
                  </div>
                  <Badge tone={overview?.logrotate?.installed ? 'ok' : 'warn'}>
                    {overview?.logrotate?.installed ? t('common.installed') : t('common.notInstalled')}
                  </Badge>
                </div>
                <div className="lc-card__body">
                  {overview?.logrotate?.statusText ? (
                    <pre className="lc-pre">{overview.logrotate.statusText}</pre>
                  ) : (
                    <div className="lc-empty-inline">
                      {t('logs.logrotateMissing')}
                    </div>
                  )}
                </div>
              </article>

              <article className="lc-card lc-card--links">
                <div className="lc-card__head">
                  <div className="lc-card__titles">
                    <h3>{t('logs.relatedOps')}</h3>
                    <p className="lc-card__desc">{t('logs.relatedOpsDesc')}</p>
                  </div>
                </div>
                <div className="lc-card__body">
                  <ul className="lc-bullets">
                    <li>
                      <strong>{t('system.scLogs')}</strong> — {t('logs.scLogsLine')}
                    </li>
                    <li>
                      <strong>{t('readiness.scProtection')}</strong> — {t('logs.scProtLine')}
                    </li>
                    <li>
                      <strong>{t('logs.projectLogsLink')}</strong>{t('logs.projectLogsDesc')}
                    </li>
                  </ul>
                  <div className="lc-card__actions">
                    <Link to="/protection" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                      {t('readiness.scProtection')}
                    </Link>
                    <Link to="/services" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
                      {t('system.scServices')}
                    </Link>
                    <Link to="/system" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
                      {t('updates.scHost')}
                    </Link>
                  </div>
                </div>
              </article>
            </div>
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="tab-panel lc-settings">
            <div className="lc-settings-grid">
              <article className="lc-card">
                <div className="lc-card__head">
                  <div className="lc-card__titles">
                    <h3>{t('logs.queryFollow')}</h3>
                    <p className="lc-card__desc">{t('logs.queryFollowDesc')}</p>
                  </div>
                </div>
                <div className="lc-card__body lc-card__body--fields">
                  <Field label={t('logs.defaultLines')} htmlFor="set-lines" flush>
                    <PresetChips
                      options={[
                        { value: '200', label: '200' },
                        { value: '500', label: '500' },
                        { value: '1000', label: '1000' },
                        { value: '2000', label: '2000' },
                      ]}
                      value={String(settingsDraft.maxLines ?? 500)}
                      onChange={bindDraftNumber(setSettingsDraft, 'maxLines', 500)}
                    />
                  </Field>
                  <Field label={t('logs.followInterval')} htmlFor="set-follow" flush>
                    <PresetChips
                      options={[
                        { value: '1', label: '1s' },
                        { value: '2', label: '2s' },
                        { value: '3', label: '3s' },
                        { value: '5', label: '5s' },
                        { value: '10', label: '10s' },
                      ]}
                      value={String(settingsDraft.followIntervalSec ?? 3)}
                      onChange={bindDraftNumber(setSettingsDraft, 'followIntervalSec', 3)}
                    />
                  </Field>
                  <Field label={t('logs.maxBytes')} htmlFor="set-bytes" flush>
                    <PresetChips
                      options={[
                        { value: '524288', label: '512 KiB' },
                        { value: '1048576', label: '1 MiB' },
                        { value: '2097152', label: '2 MiB' },
                        { value: '5242880', label: '5 MiB' },
                      ]}
                      value={String(settingsDraft.maxBytes ?? 2097152)}
                      onChange={bindDraftNumber(setSettingsDraft, 'maxBytes', 2097152)}
                    />
                  </Field>
                  <Field label={t('logs.maskSecrets')} htmlFor="set-mask" flush>
                    <label className="lc-toggle lc-toggle--block">
                      <input
                        id="set-mask"
                        type="checkbox"
                        checked={settingsDraft.maskSecrets !== false}
                        onChange={bindDraftCheck(setSettingsDraft, 'maskSecrets')}
                      />
                      <span>password / token → ***</span>
                    </label>
                  </Field>
                </div>
              </article>

              <article className="lc-card">
                <div className="lc-card__head">
                  <div className="lc-card__titles">
                    <h3>{t('logs.retentionAlerts')}</h3>
                    <p className="lc-card__desc">
                      {t('logs.retentionAlertsDesc')}
                    </p>
                  </div>
                </div>
                <div className="lc-card__body lc-card__body--fields">
                  <Field label={t('logs.defaultVacuumDays')} htmlFor="set-vac-d" flush>
                    <PresetChips
                      options={[
                        { value: '7', label: t('runtime.d7') },
                        { value: '14', label: t('logs.d14') },
                        { value: '30', label: t('logs.d30') },
                        { value: '90', label: t('logs.d90') },
                      ]}
                      value={String(settingsDraft.vacuumDefaultDays ?? 14)}
                      onChange={bindDraftNumber(setSettingsDraft, 'vacuumDefaultDays', 14)}
                    />
                  </Field>
                  <Field label={t('logs.journalAlerts')} htmlFor="set-warn" flush>
                    <PresetChips
                      options={[
                        { value: '512', label: '512 MB' },
                        { value: '1024', label: '1 GB' },
                        { value: '2048', label: '2 GB' },
                        { value: '4096', label: '4 GB' },
                      ]}
                      value={String(settingsDraft.journalWarnMb ?? 1024)}
                      onChange={bindDraftNumber(setSettingsDraft, 'journalWarnMb', 1024)}
                    />
                  </Field>
                  <Field label={t('logs.autoVacuum')} htmlFor="set-auto-v" flush>
                    <label className="lc-toggle lc-toggle--block">
                      <input
                        id="set-auto-v"
                        type="checkbox"
                        checked={Boolean(settingsDraft.autoVacuumEnabled)}
                        onChange={bindDraftCheck(setSettingsDraft, 'autoVacuumEnabled')}
                      />
                      <span>{t('logs.dailyNeedRoot')}</span>
                    </label>
                  </Field>
                  <Field label={t('common.time')} htmlFor="set-auto-t" flush>
                    <PresetChips
                      options={[
                        { value: '01:00', label: '01:00' },
                        { value: '03:00', label: '03:00' },
                        { value: '04:30', label: '04:30' },
                        { value: '05:00', label: '05:00' },
                      ]}
                      value={String(settingsDraft.autoVacuumTime ?? '03:00')}
                      onChange={bindDraftString(setSettingsDraft, 'autoVacuumTime')}
                      allowCustom
                      customPlaceholder="HH:MM"
                    />
                  </Field>
                </div>
              </article>

              <article className="lc-card">
                <div className="lc-card__head">
                  <div className="lc-card__titles">
                    <h3>{t('logs.customAllow')}</h3>
                    <p className="lc-card__desc">
                      {t('logs.customAllowDesc')}
                    </p>
                  </div>
                  <Badge tone="neutral">
                    {t('logs.pathsCount', { n: (settingsDraft.customAllowPaths ?? []).length })}
                  </Badge>
                </div>
                <div className="lc-card__body">
                  <div className="lc-inline-add">
                    <input
                      id="set-custom"
                      value={customPathInput}
                      onChange={bindInput(setCustomPathInput)}
                      placeholder="/var/log/nginx/custom.log"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const p = customPathInput.trim();
                          if (!p) return;
                          setSettingsDraft((d) => ({
                            ...d,
                            customAllowPaths: [
                              ...(d.customAllowPaths ?? []),
                              p,
                            ].slice(0, 40),
                          }));
                          setCustomPathInput('');
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const p = customPathInput.trim();
                        if (!p) return;
                        setSettingsDraft((d) => ({
                          ...d,
                          customAllowPaths: [
                            ...(d.customAllowPaths ?? []),
                            p,
                          ].slice(0, 40),
                        }));
                        setCustomPathInput('');
                      }}
                    >
                      {t('protection.add')}
                    </Button>
                  </div>
                  {(settingsDraft.customAllowPaths ?? []).length === 0 ? (
                    <div className="lc-empty-inline">{t('logs.noCustomPaths')}</div>
                  ) : (
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
                                customAllowPaths: (d.customAllowPaths ?? []).filter(
                                  (x) => x !== p,
                                ),
                              }))
                            }
                          >
                            {t('security.ssh.remove')}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>

              <article className="lc-card lc-card--span">
                <div className="lc-card__head">
                  <div className="lc-card__titles">
                    <h3>{t('logs.bookmark')}</h3>
                    <p className="lc-card__desc">
                      {t('logs.bookmarksDesc')}
                    </p>
                  </div>
                  <Badge tone="neutral">{bookmarks.length}</Badge>
                </div>
                <div className="lc-card__body">
                  {!bookmarks.length ? (
                    <div className="lc-empty-inline">
                      {t('logs.noBookmarks')}
                    </div>
                  ) : (
                    <ul className="lc-path-list lc-path-list--bookmarks">
                      {bookmarks.map((b) => (
                        <li key={b.id}>
                          <span className="lc-bookmark-meta">
                            <strong>{b.name}</strong>
                            <code className="muted">{b.source}</code>
                          </span>
                          <span className="lc-path-list__acts">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={bindCall1(applyBookmark, b)}
                            >
                              {t('common.open')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                void run(async () => {
                                  await api.requestRaw(
                                    `/api/v1/logs/bookmarks/${b.id}`,
                                    { method: 'DELETE' },
                                  );
                                  await refreshMeta();
                                  return {
                                    ok: true,
                                    notes: [t('logs.deleted')],
                                  } as OpsResultLike;
                                }, t('logs.bookmarkDeleted'));
                              }}
                            >
                              {t('network.deleteShort')}
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </article>
            </div>

            <footer className="lc-settings-bar">
              <p className="lc-settings-bar__hint">
                {t('logs.settingsWriteNote')}
              </p>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={bindVoid(saveSettings)}
              >
                {t('logs.saveSettings')}
              </Button>
            </footer>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="logs" /> : null}
      </PageTabs>

      <OpsResultPanel title={t('systemd.opsResult')} result={result} message={msg} busy={busy} />

      <PromptDialog
        open={bookmarkPromptOpen}
        onClose={bindSet(setBookmarkPromptOpen, false)}
        title={t('logs.saveBookmark')}
        description={t('logs.bookmarkNamePrompt')}
        label={t('common.name')}
        defaultValue={
          activeMeta?.label ||
          activeSource.replace(/^(journal:|file:|project:)/, '')
        }
        confirmLabel={t('common.save')}
        onSubmit={(name) => {
          setBookmarkPromptOpen(false);
          void saveBookmark(name);
          return true;
        }}
      />

      <ConfirmDialog
        open={vacuumConfirm != null}
        onClose={bindCloseIfIdle(busy, bindSet(setVacuumConfirm, null))}
        title={
          vacuumConfirm === 'time'
            ? `{t('logs.vacuumTime')} ${vacuumDays}？`
            : t('logs.vacuumSizeQ')
        }
        description={t('logs.vacuumDesc')}
        confirmLabel={t('migrate.tabRun')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
        onConfirm={() => {
          const mode = vacuumConfirm;
          setVacuumConfirm(null);
          if (mode === 'time') {
            void run(async () => {
              const r = (await api.requestRaw('/api/v1/logs/journal/vacuum', {
                method: 'POST',
                body: JSON.stringify({ mode: 'time', value: vacuumDays }),
              })) as OpsResultLike;
              await refreshMeta();
              return r;
            }, t('logs.vacuumRequested'));
          } else if (mode === 'size') {
            void run(async () => {
              const r = (await api.requestRaw('/api/v1/logs/journal/vacuum', {
                method: 'POST',
                body: JSON.stringify({ mode: 'size', value: '500M' }),
              })) as OpsResultLike;
              await refreshMeta();
              return r;
            }, t('logs.vacuumSizeRequested'));
          }
        }}
      />
    </FeaturePageLayout>
  );
}
