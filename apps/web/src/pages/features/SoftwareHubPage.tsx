/**
 * Software hub — professional multi-tab catalog of all panel software.
 * Runtimes show install / active / newer-upstream; CTA to manage + use in projects.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  FeaturePageLayout,
  InstallStreamPanel,
  LoadingBlock,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import type { InstallStreamLine } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { updatesApi } from '../../features/updates';
import { softwareApi } from '../../features/software/api';
import { toast } from '../../shared/stores/toast-store';
import { humanizeOperatorNote } from '../../shared/lib/operator-messages';
import {
  SOFTWARE_CARDS,
  SOFTWARE_TABS,
  cardsForTab,
  type RuntimeKindKey,
  type SoftwareCardDef,
  type SoftwareTabId,
} from '../../shared/nav/software-catalog';
type MatrixItem = {
  id?: string;
  label?: string;
  unit?: string;
  installed?: boolean;
  active?: string;
  category?: string;
};

type RuntimeProbeItem = {
  version?: string;
  available?: boolean;
  active?: boolean;
  versionOutput?: string;
};

type LatestHint = {
  panelLatest?: string;
  remoteLatest?: string;
  newerThanPanel?: boolean;
};

type AptUpgradeRow = {
  id: string;
  packageName: string;
  installed: boolean;
  currentVersion?: string;
  candidateVersion?: string;
  upgradable: boolean;
  latestVersion?: string;
  source?: string;
};

/** Extract panel pin from host version strings (PATH default). */
function extractHostRuntimePin(kind: RuntimeKindKey, hostReport: string): string | undefined {
  const h = String(hostReport || '').trim();
  if (!h) return undefined;
  if (kind === 'node') {
    return h.replace(/^v/i, '').match(/^(\d+)/)?.[1];
  }
  if (kind === 'go') {
    return h.replace(/^go/i, '').match(/(\d+\.\d+)/)?.[1];
  }
  if (kind === 'java') {
    return h.match(/version "?(\d+)/)?.[1] || h.match(/(\d+)\.\d+\.\d+/)?.[1];
  }
  if (kind === 'kotlin') {
    return h.match(/(\d+\.\d+\.\d+)/)?.[1];
  }
  if (kind === 'bun') {
    return h.match(/(\d+\.\d+[\w.-]*)/)?.[1];
  }
  if (kind === 'rust') {
    return h.match(/(\d+\.\d+\.\d+)/)?.[1] || (/\bstable\b/i.test(h) ? 'stable' : undefined);
  }
  // php / python → X.Y
  return h.match(/(\d+\.\d+)/)?.[1];
}

/** All probe/runtime ids that hub cards may need for version checks */
function allVersionIds(): string[] {
  const ids = new Set<string>();
  for (const c of SOFTWARE_CARDS) {
    if (c.runtimeKind) ids.add(c.runtimeKind);
    for (const sid of c.softwareIds ?? []) ids.add(sid);
  }
  return [...ids];
}

function isTabId(v: string | null): v is SoftwareTabId {
  return (
    v === 'overview' ||
    v === 'runtimes' ||
    v === 'databases' ||
    v === 'edge' ||
    v === 'mail-files' ||
    v === 'host'
  );
}

function matrixMatch(
  items: MatrixItem[],
  ids?: string[],
): MatrixItem | undefined {
  if (!ids?.length) return undefined;
  const lower = ids.map((x) => x.toLowerCase());
  return items.find((m) => {
    const id = String(m.id ?? m.unit ?? '').toLowerCase();
    const label = String(m.label ?? '').toLowerCase();
    return lower.some((k) => id.includes(k) || label.includes(k));
  });
}

export function SoftwareHubPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const [tab, setTab] = useState<SoftwareTabId>(
    isTabId(tabParam) ? tabParam : 'overview',
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matrix, setMatrix] = useState<MatrixItem[]>([]);
  const [runtimeProbe, setRuntimeProbe] = useState<Record<string, unknown> | null>(
    null,
  );
  const [latestByKind, setLatestByKind] = useState<
    Partial<Record<RuntimeKindKey, LatestHint>>
  >({});
  /** Discovery candidates per runtime (for hub in-page version pick + install) */
  const [runtimeCandidates, setRuntimeCandidates] = useState<
    Partial<Record<RuntimeKindKey, Array<{ version: string; label: string }>>>
  >({});
  const [aptById, setAptById] = useState<Record<string, AptUpgradeRow>>({});
  /** Product-catalog apt upgradable count (from software/upgrades) */
  const [catalogAptUpgradable, setCatalogAptUpgradable] = useState(0);
  /** Full-host inventory upgradable (updates page) */
  const [hostUpgradable, setHostUpgradable] = useState(0);
  type AptPkgTarget = {
    packageName: string;
    currentVersion: string;
    candidateVersion: string;
    softwareId?: string;
  };
  const [applyTarget, setApplyTarget] = useState<{
    packages: AptPkgTarget[];
    cardLabel: string;
  } | null>(null);
  const [installTarget, setInstallTarget] = useState<{
    ids: string[];
    cardLabel: string;
  } | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  /** Runtime kind currently installing — do not freeze every Update button */
  const [installingKind, setInstallingKind] = useState<RuntimeKindKey | null>(null);
  /** Apt/software card id busy (multi-package update or install) */
  const [busyCardId, setBusyCardId] = useState<string | null>(null);
  /** Progress / result banner */
  const [installFeedback, setInstallFeedback] = useState<{
    tone: 'ok' | 'error' | 'info';
    title: string;
    detail: string;
  } | null>(null);
  /** Live install log (SSE) while hub runtime install runs */
  const [installLog, setInstallLog] = useState<InstallStreamLine[]>([]);

  // Sync tab ↔ URL
  useEffect(() => {
    if (isTabId(tabParam) && tabParam !== tab) setTab(tabParam);
  }, [tabParam]); // eslint-disable-line react-hooks/exhaustive-deps

  const onTab = useCallback(
    (id: string) => {
      const next = isTabId(id) ? id : 'overview';
      setTab(next);
      setParams(next === 'overview' ? {} : { tab: next }, { replace: true });
    },
    [setParams],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const versionIds = allVersionIds();
      const [mx, rt, inv, batch] = await Promise.all([
        systemApi.servicesMatrix().catch(() => ({ items: [] as MatrixItem[] })),
        systemApi.runtimes().catch(() => null),
        updatesApi
          .inventory({ upgradable: '1', cached: true })
          .catch(() => null),
        // ALL package-backed software + runtimes — not runtimes only
        systemApi
          .softwareVersions({ ids: versionIds })
          .catch(() => ({ items: [] as Array<Record<string, unknown>> })),
      ]);
      setMatrix((mx as { items?: MatrixItem[] }).items ?? []);
      setRuntimeProbe((rt as Record<string, unknown>) ?? null);

      const metaUp = Number(inv?.meta?.upgradableCount ?? 0);
      const rowUp = (inv?.inventory ?? []).filter(
        (i) =>
          i.candidateVersion && i.candidateVersion !== i.currentVersion,
      ).length;
      setHostUpgradable(Math.max(metaUp, rowUp) || 0);

      const map: Partial<Record<RuntimeKindKey, LatestHint>> = {};
      const candMap: Partial<
        Record<RuntimeKindKey, Array<{ version: string; label: string }>>
      > = {};
      const aptMap: Record<string, AptUpgradeRow> = {};
      let aptUpCount = 0;

      for (const row of (batch as { items?: Array<Record<string, unknown>> })
        .items ?? []) {
        const id = String(row.id ?? '');
        if (!id) continue;
        const updateKind = String(row.updateKind ?? '');
        const installed = Boolean(row.installed);
        const upgradable = Boolean(row.upgradable);
        const currentVersion =
          row.currentVersion != null ? String(row.currentVersion) : undefined;
        const latestVersion =
          row.latestVersion != null ? String(row.latestVersion) : undefined;
        const packageName =
          row.packageName != null ? String(row.packageName) : id;
        const candidates = Array.isArray(row.candidates)
          ? (row.candidates as Array<{ version?: string; label?: string }>).map(
              (c) => ({
                version: String(c.version ?? ''),
                label: String(c.label ?? c.version ?? ''),
              }),
            )
          : [];

        if (updateKind === 'runtime' || (SOFTWARE_CARDS.some((c) => c.runtimeKind === id))) {
          const kind = id as RuntimeKindKey;
          map[kind] = {
            panelLatest: currentVersion || '—',
            remoteLatest: latestVersion,
            newerThanPanel: upgradable,
          };
          candMap[kind] = candidates.filter((c) => c.version);
        }

        // Apt / catalog packages (also store runtime ids harmlessly for lookups)
        aptMap[id] = {
          id,
          packageName,
          installed,
          currentVersion,
          candidateVersion: upgradable
            ? latestVersion || candidates[0]?.version
            : latestVersion || currentVersion,
          latestVersion,
          upgradable,
          source: row.source != null ? String(row.source) : undefined,
        };
        if (upgradable && updateKind === 'apt') aptUpCount += 1;
      }

      setCatalogAptUpgradable(aptUpCount);
      setAptById((prev) => ({ ...prev, ...aptMap }));
      setLatestByKind((prev) => ({ ...prev, ...map }));
      setRuntimeCandidates((prev) => ({ ...prev, ...candMap }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const probeByKind = useMemo(() => {
    const probe = (runtimeProbe?.probe ?? runtimeProbe) as
      | Record<string, unknown>
      | undefined;
    const out: Partial<Record<RuntimeKindKey, RuntimeProbeItem[]>> = {};
    for (const kind of [
      'node',
      'php',
      'python',
      'go',
      'rust',
      'java',
      'kotlin',
      'bun',
    ] as RuntimeKindKey[]) {
      const raw = probe?.[kind];
      if (Array.isArray(raw)) out[kind] = raw as RuntimeProbeItem[];
    }
    return out;
  }, [runtimeProbe]);

  /** hostNode / hostPhp / … strings from probe report (PATH default). */
  const hostDefaultByKind = useMemo(() => {
    const probe = (runtimeProbe?.probe ?? runtimeProbe) as
      | Record<string, unknown>
      | undefined;
    if (!probe) return {} as Partial<Record<RuntimeKindKey, string>>;
    const map: Partial<Record<RuntimeKindKey, string>> = {};
    const keys: Array<[RuntimeKindKey, string]> = [
      ['node', 'hostNode'],
      ['php', 'hostPhp'],
      ['python', 'hostPython'],
      ['go', 'hostGo'],
      ['rust', 'hostRust'],
      ['java', 'hostJava'],
      ['kotlin', 'hostKotlin'],
      ['bun', 'hostBun'],
    ];
    for (const [kind, key] of keys) {
      const v = probe[key];
      if (v != null && String(v).trim()) map[kind] = String(v).trim();
    }
    return map;
  }, [runtimeProbe]);

  const cardView = useCallback(
    (def: SoftwareCardDef) => {
      const mx = matrixMatch(matrix, def.matrixIds);
      const items = def.runtimeKind ? probeByKind[def.runtimeKind] ?? [] : [];
      const installed = items.filter((i) => i.available);
      const activeItem = installed.find((i) => i.active) ?? installed[0];
      let installedLabels = installed.map((i) => String(i.version ?? '')).filter(Boolean);
      const latest = def.runtimeKind ? latestByKind[def.runtimeKind] : undefined;
      const candidates = def.runtimeKind
        ? runtimeCandidates[def.runtimeKind] ?? []
        : [];
      // softwareVersions batch also stores runtime rows under the kind id
      const runtimeSv = def.runtimeKind ? aptById[def.runtimeKind] : undefined;
      const hostDefault = def.runtimeKind
        ? hostDefaultByKind[def.runtimeKind]
        : undefined;

      // —— Multi-source "installed" (probe pins alone are often empty / incomplete) ——
      // 1) probe.available  2) softwareVersions.installed+current  3) host* PATH default
      if (!installedLabels.length && runtimeSv?.installed && runtimeSv.currentVersion) {
        installedLabels = [runtimeSv.currentVersion];
      }
      if (!installedLabels.length && hostDefault) {
        const pin = extractHostRuntimePin(def.runtimeKind!, hostDefault);
        installedLabels = [pin || hostDefault.split(/\s+/).slice(0, 3).join(' ')];
      }

      const runtimeInstalled = installedLabels.length > 0;

      const aptRows = (def.softwareIds ?? [])
        .map((id) => aptById[id])
        .filter((r): r is AptUpgradeRow => Boolean(r));
      const aptUpgradable = aptRows.filter((r) => r.upgradable);
      // Prefer an upgradable package; else first installed; else first probed row
      const primaryApt =
        aptUpgradable[0] ??
        aptRows.find((r) => r.installed) ??
        aptRows[0];
      const aptChecked = aptRows.length > 0 || Boolean(def.softwareIds?.length);
      const aptInstalled = aptRows.some((r) => r.installed);
      const aptCurrentLatest =
        primaryApt?.latestVersion ||
        primaryApt?.candidateVersion ||
        primaryApt?.currentVersion;

      let status: 'ok' | 'warn' | 'danger' | 'neutral' = 'neutral';
      let statusLabel = t('software.status.unknown', { defaultValue: '—' });

      if (def.runtimeKind) {
        if (runtimeInstalled) {
          status = 'ok';
          statusLabel = t('software.status.installed', { defaultValue: t('uiInline.s7aa09150') });
        } else {
          status = 'warn';
          statusLabel = t('software.status.notInstalled', { defaultValue: t('uiInline.sbcbdbc49') });
        }
      } else if (mx) {
        if (mx.active === 'active' || mx.active === 'tool') {
          status = 'ok';
          statusLabel = t('software.status.running', { defaultValue: t('uiInline.sae7738d0') });
        } else if (mx.installed === false || mx.active === 'not-found') {
          status = 'danger';
          statusLabel = t('software.status.missing', { defaultValue: t('uiInline.sf3af7c5e') });
        } else if (mx.active === 'inactive' || mx.active === 'failed') {
          status = mx.active === 'failed' ? 'danger' : 'warn';
          statusLabel =
            mx.active === 'failed'
              ? t('software.status.failed', { defaultValue: t('uiInline.sa1d77833') })
              : t('software.status.stopped', { defaultValue: t('uiInline.s75dddf52') });
        } else if (mx.installed) {
          status = 'ok';
          statusLabel = t('software.status.installed', { defaultValue: t('uiInline.s7aa09150') });
        }
      } else if (primaryApt?.installed) {
        status = 'ok';
        statusLabel = t('software.status.installed', { defaultValue: t('uiInline.s7aa09150') });
      } else if (aptChecked && !aptInstalled) {
        status = 'warn';
        statusLabel = t('software.status.notInstalled', { defaultValue: t('uiInline.sbcbdbc49') });
      }

      const runtimeUpdate = Boolean(
        runtimeInstalled &&
          (latest?.newerThanPanel ||
            (latest?.remoteLatest &&
              !installedLabels.some(
                (v) =>
                  latest.remoteLatest === v ||
                  String(latest.remoteLatest).startsWith(`${v}.`) ||
                  String(v).startsWith(String(latest.remoteLatest)),
              ))),
      );

      // Panel supports more pins than installed (go/rust)
      const panelGap =
        def.runtimeKind &&
        installedLabels.length > 0 &&
        (probeByKind[def.runtimeKind]?.length ?? 0) >
          installedLabels.length;

      const aptUpdate = aptUpgradable.length > 0;
      /** Package-backed card that is installed and already at apt candidate */
      const aptUpToDate = Boolean(
        !def.runtimeKind &&
          aptInstalled &&
          !aptUpdate &&
          primaryApt?.currentVersion,
      );
      /** softwareIds not present on host — can one-click install */
      const aptMissingIds = (def.softwareIds ?? []).filter((id) => {
        const row = aptById[id];
        return !row?.installed;
      });
      const canInstallMissing =
        !def.runtimeKind &&
        aptMissingIds.length > 0 &&
        Boolean(def.softwareIds?.length);
      // Host "updates" card: surface full-host inventory count (not a fake package version)
      const hostUpdatesHint =
        def.id === 'updates' && hostUpgradable > 0
          ? hostUpgradable
          : undefined;
      const hasUpdate =
        runtimeUpdate ||
        Boolean(panelGap) ||
        aptUpdate ||
        Boolean(hostUpdatesHint);

      const aptPackagesToUpdate: AptPkgTarget[] = aptUpgradable.map((r) => ({
        packageName: r.packageName || r.id,
        currentVersion: r.currentVersion || '',
        candidateVersion: String(
          r.candidateVersion || r.latestVersion || '',
        ),
        softwareId: r.id,
      }));

      return {
        def,
        status,
        statusLabel,
        installedLabels,
        activeVersion:
          activeItem?.version != null
            ? String(activeItem.version)
            : runtimeInstalled
              ? installedLabels[0] ?? null
              : null,
        versionOutput: activeItem?.versionOutput || hostDefault,
        hasUpdate,
        latest,
        mx,
        aptCurrent: primaryApt?.currentVersion,
        aptCandidate: primaryApt?.candidateVersion || aptCurrentLatest,
        aptPackage: primaryApt?.packageName,
        aptUpdate,
        aptUpToDate,
        aptChecked,
        aptPackagesToUpdate,
        aptMissingIds,
        canInstallMissing,
        hostUpdatesHint,
        candidates,
      };
    },
    [
      matrix,
      probeByKind,
      hostDefaultByKind,
      latestByKind,
      runtimeCandidates,
      aptById,
      hostUpgradable,
      t,
    ],
  );

  const allViews = useMemo(
    () => SOFTWARE_CARDS.map((c) => cardView(c)),
    [cardView],
  );

  const summary = useMemo(() => {
    const runtimeViews = allViews.filter((v) => v.def.runtimeKind);
    const installedRt = runtimeViews.filter((v) => v.installedLabels.length > 0).length;
    const updates = allViews.filter((v) => v.hasUpdate).length;
    const serviceBad = allViews.filter(
      (v) => v.status === 'danger' || v.status === 'warn',
    ).length;
    return {
      total: SOFTWARE_CARDS.length,
      installedRt,
      runtimeTotal: runtimeViews.length,
      updates,
      serviceBad,
      catalogAptUpgradable,
      hostUpgradable,
    };
  }, [allViews, catalogAptUpgradable, hostUpgradable]);

  const confirmApplyPackages = useCallback(async () => {
    if (!applyTarget?.packages.length) return;
    const pkgs = applyTarget.packages;
    const label = applyTarget.cardLabel;
    setApplyBusy(true);
    const okList: string[] = [];
    const failList: string[] = [];
    try {
      for (let i = 0; i < pkgs.length; i++) {
        const p = pkgs[i]!;
        setInstallFeedback({
          tone: 'info',
          title: t('software.apply.progress', {
            n: i + 1,
            total: pkgs.length,
            pkg: p.packageName,
            defaultValue: t('uiInline.s4e7f6152', { v0: i + 1, v1: pkgs.length, v2: p.packageName }),
          }),
          detail: t('software.apply.progressDetail', {
            from: p.currentVersion || '—',
            to: p.candidateVersion,
            defaultValue: `${p.currentVersion || '—'} → ${p.candidateVersion}`,
          }),
        });
        try {
          const r = await updatesApi.applyPackage({
            packageName: p.packageName,
            currentVersion: p.currentVersion,
            candidateVersion: p.candidateVersion,
            confirmHighRisk: true,
          });
          if (r.blocked) {
            failList.push(
              `${p.packageName}: ${r.blockMessage || t('software.apply.blockedShort')}`,
            );
          } else if (r.ok && r.applied) {
            okList.push(p.packageName);
          } else {
            failList.push(
              `${p.packageName}: ${(r.notes ?? []).slice(0, 1).join(' ') || t('software.apply.failedShort')}`,
            );
          }
        } catch (e) {
          failList.push(
            `${p.packageName}: ${e instanceof Error ? e.message : t('common.loadFailed')}`,
          );
        }
      }
      if (okList.length && !failList.length) {
        toast.ok(
          t('software.apply.okMulti', {
            list: okList.join(', '),
            defaultValue: t('uiInline.s7a90f74c', { v0: okList.join(', ') }),
          }),
        );
        setInstallFeedback({
          tone: 'ok',
          title: t('software.apply.okMultiTitle', {
            label,
            defaultValue: t('uiInline.s0aa24093', { v0: label }),
          }),
          detail: okList.join(', '),
        });
        setApplyTarget(null);
        void refresh();
      } else if (okList.length && failList.length) {
        toast.error(
          t('software.apply.partial', {
            defaultValue: t('uiInline.s5d92ffc3', { v0: okList.join(', '), v1: failList.join(' · ') }),
          }),
        );
        setInstallFeedback({
          tone: 'error',
          title: t('software.apply.partialTitle', {
            defaultValue: t('uiInline.sa15a291f'),
          }),
          detail: `OK: ${okList.join(', ')} · FAIL: ${failList.join(' · ')}`,
        });
        setApplyTarget(null);
        void refresh();
      } else {
        toast.error(failList.join(' · ') || t('software.apply.failed', { defaultValue: t('uiInline.sbb823c06') }));
        setInstallFeedback({
          tone: 'error',
          title: t('software.apply.failedTitle', {
            label,
            defaultValue: t('uiInline.s68db1348', { v0: label }),
          }),
          detail: failList.join(' · '),
        });
      }
    } finally {
      setApplyBusy(false);
      setBusyCardId(null);
    }
  }, [applyTarget, refresh, t]);

  const confirmInstallMissing = useCallback(async () => {
    if (!installTarget?.ids.length) return;
    const ids = installTarget.ids;
    const label = installTarget.cardLabel;
    setApplyBusy(true);
    setInstallFeedback({
      tone: 'info',
      title: t('software.install.progress', {
        list: ids.join(', '),
        defaultValue: t('uiInline.s84a4e7c6', { v0: ids.join(', ') }),
      }),
      detail: t('software.install.progressHint', {
        defaultValue: t('uiInline.s2ca8a4f5'),
      }),
    });
    try {
      const r = (await softwareApi.installMany(ids)) as {
        ok?: boolean;
        blocked?: boolean;
        blockMessage?: string;
        notes?: string[];
        applied?: boolean;
      };
      const notes = (r.notes ?? [])
        .map((n) => humanizeOperatorNote(String(n)))
        .filter((n): n is string => Boolean(n));
      if (r.blocked) {
        const msg =
          r.blockMessage ||
          t('software.apply.blocked', {
            defaultValue: t('uiInline.sd9419dc9'),
          });
        toast.error(msg);
        setInstallFeedback({
          tone: 'error',
          title: t('software.install.blockedTitle', {
            label,
            defaultValue: t('uiInline.s3ec3d449', { v0: label }),
          }),
          detail: [msg, ...notes].filter(Boolean).join(' · '),
        });
      } else if (r.ok !== false) {
        toast.ok(
          t('software.install.ok', {
            list: ids.join(', '),
            defaultValue: t('uiInline.sbb8dfdeb', { v0: ids.join(', ') }),
          }),
        );
        setInstallFeedback({
          tone: 'ok',
          title: t('software.install.okTitle', {
            label,
            defaultValue: t('uiInline.s18bb4b62', { v0: label }),
          }),
          detail: notes.slice(0, 4).join(' · ') || ids.join(', '),
        });
        setInstallTarget(null);
        void refresh();
      } else {
        const msg =
          notes.slice(0, 2).join(' · ') ||
          t('software.apply.failed', { defaultValue: t('uiInline.se9a47def') });
        toast.error(msg);
        setInstallFeedback({
          tone: 'error',
          title: t('software.install.failedTitle', {
            label,
            defaultValue: t('uiInline.sdc0528a2', { v0: label }),
          }),
          detail: msg,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.loadFailed');
      toast.error(msg);
      setInstallFeedback({
        tone: 'error',
        title: t('software.install.failedTitle', {
          label,
          defaultValue: t('uiInline.sdc0528a2', { v0: label }),
        }),
        detail: msg,
      });
    } finally {
      setApplyBusy(false);
      setBusyCardId(null);
    }
  }, [installTarget, refresh, t]);

  const installRuntimeVersion = useCallback(
    async (kind: RuntimeKindKey, version: string) => {
      const ver = String(version || '').trim();
      if (!ver) {
        toast.error(
          t('software.version.noTarget', { defaultValue: t('uiInline.s69e60fb5') }),
        );
        return;
      }
      setInstallingKind(kind);
      setInstallLog([]);
      setInstallFeedback({
        tone: 'info',
        title: t('software.runtime.installing', {
          kind,
          v: ver,
          defaultValue: t('uiInline.s3f50fa6e', { v0: kind, v1: ver }),
        }),
        detail: t('software.runtime.installingHint', {
          defaultValue: t('uiInline.s1f5eef17'),
        }),
      });
      try {
        const r = await systemApi.runtimeInstallStream(
          {
            kind,
            version: ver,
            install: true,
          },
          {
            onLog: (line) => setInstallLog((prev) => [...prev.slice(-1999), line]),
          },
        );
        const notes = (r.notes ?? [])
          .map((n) => humanizeOperatorNote(String(n)))
          .filter((n): n is string => Boolean(n));
        const detail =
          notes.slice(0, 4).join(' · ') ||
          r.blockMessage ||
          '';

        if (r.blocked || r.requiresExecute || r.requiresRoot) {
          const msg =
            r.blockMessage ||
            t('software.apply.blocked', {
              defaultValue: t('uiInline.s2bf6b642'),
            });
          toast.error(msg);
          setInstallFeedback({
            tone: 'error',
            title: t('software.runtime.blockedTitle', {
              kind,
              v: ver,
              defaultValue: t('uiInline.s9b4a58e8', { v0: kind, v1: ver }),
            }),
            detail: [msg, detail].filter(Boolean).join(' · '),
          });
          return;
        }

        // Strict success only — never treat "plan only" / missing ok as success
        if (r.ok === true) {
          toast.ok(
            t('software.runtime.installed', {
              kind,
              v: ver,
              defaultValue: t('uiInline.s6dc82720', { v0: kind, v1: ver }),
            }),
          );
          setInstallFeedback({
            tone: 'ok',
            title: t('software.runtime.installed', {
              kind,
              v: ver,
              defaultValue: t('uiInline.s6dc82720', { v0: kind, v1: ver }),
            }),
            detail:
              detail ||
              t('software.runtime.installedDetail', {
                defaultValue: t('uiInline.s94a1f025'),
              }),
          });
          // Soft refresh — discovery failure must not wipe cards
          void refresh();
          return;
        }

        const failMsg =
          detail ||
          t('software.apply.failed', { defaultValue: t('uiInline.sbb823c06') });
        toast.error(failMsg);
        setInstallFeedback({
          tone: 'error',
          title: t('software.runtime.failedTitle', {
            kind,
            v: ver,
            defaultValue: t('uiInline.s73cae5a0', { v0: kind, v1: ver }),
          }),
          detail: failMsg,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : t('common.loadFailed');
        toast.error(msg);
        setInstallFeedback({
          tone: 'error',
          title: t('software.runtime.failedTitle', {
            kind,
            v: ver,
            defaultValue: t('uiInline.s73cae5a0', { v0: kind, v1: ver }),
          }),
          detail: msg,
        });
      } finally {
        setInstallingKind(null);
      }
    },
    [refresh, t],
  );

  const visibleCards = useMemo(() => {
    const list = cardsForTab(tab);
    return list.map((c) => cardView(c));
  }, [tab, cardView]);

  const tabItems = SOFTWARE_TABS.map((x) => ({
    id: x.id,
    label: t(x.labelKey, {
      defaultValue:
        x.id === 'overview'
          ? t('uiInline.se1050a28')
          : x.id === 'runtimes'
            ? t('uiInline.s8c29cb38')
            : x.id === 'databases'
              ? t('uiInline.s583f0654')
              : x.id === 'edge'
                ? t('uiInline.s4344c486')
                : x.id === 'mail-files'
                  ? t('uiInline.sed2550e1')
                  : t('uiInline.scb435db5'),
    }),
    badge: (() => {
      if (x.id === 'overview') return summary.updates > 0 ? summary.updates : undefined;
      const n = allViews.filter((v) => v.def.tab === x.id && v.hasUpdate).length;
      return n > 0 ? n : undefined;
    })(),
  }));

  return (
    <FeaturePageLayout
      title={t('software.title', { defaultValue: t('uiInline.s97bbc1b7') })}
      subtitle={t('software.desc', {
        defaultValue:
          t('uiInline.s60a23151'),
      })}
      actions={
        <Button variant="secondary" size="sm" loading={loading} onClick={() => void refresh()}>
          {t('common.refresh', { defaultValue: t('uiInline.s5387b55b') })}
        </Button>
      }
    >
      <PageTabs tabs={tabItems} active={tab} onChange={onTab} variant="scroll">
        <div className="tab-panel">
          {error ? (
            <p className="muted u-mb-3" role="alert">
              {error}
            </p>
          ) : null}

          {installFeedback ? (
            <Alert
              variant={
                installFeedback.tone === 'ok'
                  ? 'ok'
                  : installFeedback.tone === 'error'
                    ? 'error'
                    : 'info'
              }
              className="u-mb-3"
            >
              <strong>{installFeedback.title}</strong>
              {installFeedback.detail ? (
                <p className="u-mt-1 u-mb-0">{installFeedback.detail}</p>
              ) : null}
              {(installLog.length > 0 || installingKind) ? (
                <InstallStreamPanel
                  lines={installLog}
                  busy={Boolean(installingKind)}
                />
              ) : null}
              <div className="u-mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setInstallFeedback(null);
                    if (!installingKind) setInstallLog([]);
                  }}
                >
                  {t('common.dismiss', { defaultValue: t('uiInline.sddc05404') })}
                </Button>
              </div>
            </Alert>
          ) : null}

          {loading && !runtimeProbe && matrix.length === 0 ? (
            <LoadingBlock />
          ) : (
            <>
              {tab === 'overview' ? (
                <>
                  <div className="software-hub__summary">
                    <div className="software-hub__stat">
                      <span className="software-hub__stat-value">{summary.total}</span>
                      <span className="software-hub__stat-label">
                        {t('software.stat.catalog', { defaultValue: t('uiInline.s0b582c70') })}
                      </span>
                    </div>
                    <div className="software-hub__stat software-hub__stat--ok">
                      <span className="software-hub__stat-value">
                        {summary.installedRt}/{summary.runtimeTotal}
                      </span>
                      <span className="software-hub__stat-label">
                        {t('software.stat.runtimesInstalled', {
                          defaultValue: t('uiInline.s4be2a3a4'),
                        })}
                      </span>
                    </div>
                    <div
                      className={`software-hub__stat${summary.updates ? ' software-hub__stat--warn' : ''}`}
                    >
                      <span className="software-hub__stat-value">{summary.updates}</span>
                      <span className="software-hub__stat-label">
                        {t('software.stat.updates', { defaultValue: t('uiInline.s259e6f0e') })}
                      </span>
                    </div>
                    <div
                      className={`software-hub__stat${summary.serviceBad ? ' software-hub__stat--warn' : ' software-hub__stat--ok'}`}
                    >
                      <span className="software-hub__stat-value">{summary.serviceBad}</span>
                      <span className="software-hub__stat-label">
                        {t('software.stat.attention', { defaultValue: t('uiInline.s13b3f970') })}
                      </span>
                    </div>
                  </div>

                  {(summary.catalogAptUpgradable > 0 || summary.hostUpgradable > 0) ? (
                    <Card className="u-mb-3">
                      <CardSection
                        title={t('software.aptSummaryTitle', {
                          defaultValue: t('uiInline.sdd33adf9'),
                        })}
                        description={t('software.aptSummaryDesc', {
                          defaultValue:
                            t('uiInline.sdfaaf946'),
                        })}
                      >
                        <div className="software-card__actions">
                          <Badge tone="warn">
                            {t('software.aptSummary.catalog', {
                              n: summary.catalogAptUpgradable,
                              defaultValue: t('uiInline.s78f03e20', { v0: summary.catalogAptUpgradable }),
                            })}
                          </Badge>
                          <Badge tone={summary.hostUpgradable ? 'warn' : 'neutral'}>
                            {t('software.aptSummary.host', {
                              n: summary.hostUpgradable,
                              defaultValue: t('uiInline.sbf368054', { v0: summary.hostUpgradable }),
                            })}
                          </Badge>
                          <Link
                            to="/updates"
                            className={buttonClassName({ variant: 'primary', size: 'sm' })}
                          >
                            {t('software.aptSummary.openUpdates', {
                              defaultValue: t('uiInline.s235a7426'),
                            })}
                          </Link>
                        </div>
                      </CardSection>
                    </Card>
                  ) : null}

                  <Card className="u-mb-3">
                    <CardSection
                      title={t('software.quickTitle', { defaultValue: t('uiInline.s14249f75') })}
                      description={t('software.quickDesc', {
                        defaultValue: t('uiInline.saff76d0a'),
                      })}
                    >
                      <div className="software-card__actions">
                        {(
                          [
                            ['runtimes', t('uiInline.s8c29cb38')],
                            ['databases', t('uiInline.s583f0654')],
                            ['edge', t('uiInline.s4344c486')],
                            ['mail-files', t('uiInline.sed2550e1')],
                            ['host', t('uiInline.scb435db5')],
                          ] as const
                        ).map(([id, label]) => (
                          <Button
                            key={id}
                            variant="secondary"
                            size="sm"
                            onClick={() => onTab(id)}
                          >
                            {t(`software.tabs.${id === 'mail-files' ? 'mailFiles' : id}`, {
                              defaultValue: label,
                            })}
                          </Button>
                        ))}
                        <Link
                          to="/services"
                          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        >
                          {t('nav.services')}
                        </Link>
                        <Link
                          to="/projects"
                          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        >
                          {t('nav.projects')}
                        </Link>
                        <Link
                          to="/updates"
                          className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        >
                          {t('nav.updates')}
                        </Link>
                      </div>
                    </CardSection>
                  </Card>

                  {summary.updates > 0 ? (
                    <Card className="u-mb-3">
                      <CardSection
                        title={t('software.updatesTitle', {
                          defaultValue: t('uiInline.s24f12f4f'),
                        })}
                        description={t('software.updatesDesc', {
                          defaultValue:
                            t('uiInline.s43a9fd7a'),
                        })}
                      >
                        <div className="software-hub__grid">
                          {allViews
                            .filter((v) => v.hasUpdate)
                            .map((v) => (
                              <SoftwareCard
                                key={v.def.id}
                                view={v}
                                t={t}
                                onRequestAptApply={(pkgs, cardLabel) => {
                                  setBusyCardId(v.def.id);
                                  setApplyTarget({ packages: pkgs, cardLabel });
                                }}
                                onRequestInstall={(ids, cardLabel) => {
                                  setBusyCardId(v.def.id);
                                  setInstallTarget({ ids, cardLabel });
                                }}
                                onInstallRuntime={installRuntimeVersion}
                                installBusy={
                                  (Boolean(v.def.runtimeKind) &&
                                    installingKind === v.def.runtimeKind) ||
                                  busyCardId === v.def.id
                                }
                              />
                            ))}
                        </div>
                      </CardSection>
                    </Card>
                  ) : null}

                  <div className="software-hub__section-head">
                    <h3>{t('software.allSoftware', { defaultValue: t('uiInline.sc45743bd') })}</h3>
                  </div>
                </>
              ) : null}

              {visibleCards.length === 0 ? (
                <div className="software-hub__empty">{t('common.noneSelectedShort')}</div>
              ) : (
                <div className="software-hub__grid">
                  {visibleCards.map((v) => (
                    <SoftwareCard
                      key={v.def.id}
                      view={v}
                      t={t}
                      onRequestAptApply={(pkgs, cardLabel) => {
                        setBusyCardId(v.def.id);
                        setApplyTarget({ packages: pkgs, cardLabel });
                      }}
                      onRequestInstall={(ids, cardLabel) => {
                        setBusyCardId(v.def.id);
                        setInstallTarget({ ids, cardLabel });
                      }}
                      onInstallRuntime={installRuntimeVersion}
                      installBusy={
                        (Boolean(v.def.runtimeKind) &&
                          installingKind === v.def.runtimeKind) ||
                        busyCardId === v.def.id
                      }
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </PageTabs>

      <ConfirmDialog
        open={Boolean(applyTarget)}
        title={t('software.apply.confirmTitle', {
          defaultValue: t('uiInline.s00338fde'),
        })}
        description={
          applyTarget
            ? t('software.apply.confirmBodyMulti', {
                label: applyTarget.cardLabel,
                list: applyTarget.packages
                  .map(
                    (p) =>
                      `${p.packageName} (${p.currentVersion || '—'} → ${p.candidateVersion})`,
                  )
                  .join('；'),
                defaultValue: `將升級 ${applyTarget.cardLabel} 共 ${applyTarget.packages.length} 個套件：${applyTarget.packages
                  .map(
                    (p) =>
                      `${p.packageName} (${p.currentVersion || '—'} → ${p.candidateVersion})`,
                  )
                  .join('；')}。需 root 且 YSK_EXECUTE=1。`,
              })
            : ''
        }
        confirmLabel={t('software.apply.confirm', { defaultValue: t('uiInline.s0e05f4b7') })}
        cancelLabel={t('common.cancel', { defaultValue: t('uiInline.s4d0b4688') })}
        busy={applyBusy}
        danger
        onConfirm={() => void confirmApplyPackages()}
        onClose={() => {
          if (!applyBusy) {
            setApplyTarget(null);
            setBusyCardId(null);
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(installTarget)}
        title={t('software.install.confirmTitle', {
          defaultValue: t('uiInline.s92b8bf67'),
        })}
        description={
          installTarget
            ? t('software.install.confirmBody', {
                label: installTarget.cardLabel,
                list: installTarget.ids.join(', '),
                defaultValue: t('uiInline.s9af27043', { v0: installTarget.cardLabel, v1: installTarget.ids.join(', ') }),
              })
            : ''
        }
        confirmLabel={t('software.install.confirm', { defaultValue: t('uiInline.s28263d85') })}
        cancelLabel={t('common.cancel', { defaultValue: t('uiInline.s4d0b4688') })}
        busy={applyBusy}
        onConfirm={() => void confirmInstallMissing()}
        onClose={() => {
          if (!applyBusy) {
            setInstallTarget(null);
            setBusyCardId(null);
          }
        }}
      />
    </FeaturePageLayout>
  );
}

type CardView = {
  def: SoftwareCardDef;
  status: 'ok' | 'warn' | 'danger' | 'neutral';
  statusLabel: string;
  installedLabels: string[];
  activeVersion: string | null;
  versionOutput?: string;
  hasUpdate: boolean;
  latest?: LatestHint;
  aptCurrent?: string;
  aptCandidate?: string;
  aptPackage?: string;
  aptUpdate?: boolean;
  /** Installed package-backed software already at apt candidate */
  aptUpToDate?: boolean;
  /** Card has softwareIds and we ran version discovery */
  aptChecked?: boolean;
  /** All upgradable apt packages on this card (email/protection multi) */
  aptPackagesToUpdate?: Array<{
    packageName: string;
    currentVersion: string;
    candidateVersion: string;
    softwareId?: string;
  }>;
  aptMissingIds?: string[];
  canInstallMissing?: boolean;
  /** Full-host inventory upgradable count (updates card only) */
  hostUpdatesHint?: number;
  /** Discovery candidates for in-page version pick */
  candidates?: Array<{ version: string; label: string }>;
};

function SoftwareCard({
  view,
  t,
  onRequestAptApply,
  onRequestInstall,
  onInstallRuntime,
  installBusy,
}: {
  view: CardView;
  t: (k: string, o?: Record<string, unknown>) => string;
  onRequestAptApply?: (
    packages: Array<{
      packageName: string;
      currentVersion: string;
      candidateVersion: string;
      softwareId?: string;
    }>,
    cardLabel: string,
  ) => void;
  onRequestInstall?: (ids: string[], cardLabel: string) => void;
  onInstallRuntime?: (kind: RuntimeKindKey, version: string) => void | Promise<void>;
  installBusy?: boolean;
}) {
  const {
    def,
    status,
    statusLabel,
    installedLabels,
    activeVersion,
    versionOutput,
    hasUpdate,
    latest,
    aptCurrent,
    aptCandidate,
    aptPackage,
    aptUpdate,
    aptUpToDate,
    aptChecked,
    aptPackagesToUpdate = [],
    aptMissingIds = [],
    canInstallMissing,
    hostUpdatesHint,
    candidates = [],
  } = view;

  const name = t(`nav.${def.navKey}`, { defaultValue: def.navKey });
  // Prefer remote/panel latest for runtime update deep-link; apt → updates center
  const updateTarget = String(
    latest?.remoteLatest || latest?.panelLatest || '',
  ).trim();
  const [picked, setPicked] = useState(
    () => updateTarget || candidates[0]?.version || '',
  );
  useEffect(() => {
    setPicked(updateTarget || candidates[0]?.version || '');
  }, [updateTarget, candidates]);

  const updateHref = hasUpdate
    ? def.runtimeKind && updateTarget
      ? `${def.to}?version=${encodeURIComponent(updateTarget)}`
      : def.id === 'updates'
        ? '/updates'
        : aptUpdate && aptPackage
          ? `/updates?q=${encodeURIComponent(aptPackage)}`
          : def.runtimeKind
            ? def.to
            : aptPackage
              ? `/updates?q=${encodeURIComponent(aptPackage)}`
              : def.to
    : null;

  const canOneClickApt = Boolean(
    aptUpdate &&
      aptPackagesToUpdate.length > 0 &&
      onRequestAptApply,
  );

  const canInstallRuntime = Boolean(
    def.runtimeKind &&
      onInstallRuntime &&
      (picked || updateTarget || candidates[0]?.version),
  );

  /** Package-backed: offer update when warehouse has newer candidate(s) */
  const showAptUpdate = canOneClickApt;
  const showAptInstall = Boolean(
    canInstallMissing && aptMissingIds.length > 0 && onRequestInstall,
  );
  const cardLabel = t(`nav.${def.navKey}`, { defaultValue: def.navKey });

  const projectHref =
    def.projectRuntime && def.runtimeKind
      ? `/projects?hintRuntime=${encodeURIComponent(def.runtimeKind)}${
          updateTarget || activeVersion
            ? `&version=${encodeURIComponent(updateTarget || activeVersion || '')}`
            : ''
        }`
      : null;

  const metaParts: string[] = [];
  if (installedLabels.length) {
    metaParts.push(
      t('software.meta.installed', {
        list: installedLabels.join(', '),
        defaultValue: t('uiInline.s2e37cbfa', { v0: installedLabels.join(', ') }),
      }),
    );
  }
  if (activeVersion) {
    metaParts.push(
      t('software.meta.default', {
        v: activeVersion,
        defaultValue: t('uiInline.s7d52bb0c', { v0: activeVersion }),
      }),
    );
  }
  if (versionOutput) metaParts.push(versionOutput);
  if (latest?.remoteLatest && hasUpdate && !aptUpdate) {
    metaParts.push(
      t('software.meta.remote', {
        v: latest.remoteLatest,
        defaultValue: t('uiInline.s9f898b85', { v0: latest.remoteLatest }),
      }),
    );
  }
  if (aptPackagesToUpdate.length > 1) {
    metaParts.push(
      t('software.meta.aptUpgradeMulti', {
        n: aptPackagesToUpdate.length,
        list: aptPackagesToUpdate
          .map((p) => `${p.packageName}→${p.candidateVersion}`)
          .join(', '),
        defaultValue: `${aptPackagesToUpdate.length} 個套件可升級：${aptPackagesToUpdate
          .map((p) => `${p.packageName}→${p.candidateVersion}`)
          .join(', ')}`,
      }),
    );
  } else if (aptCurrent && aptUpdate && aptCandidate) {
    metaParts.push(
      t('software.meta.aptUpgrade', {
        from: aptCurrent,
        to: aptCandidate,
        defaultValue: t('uiInline.s93dde991', { v0: aptCurrent, v1: aptCandidate }),
      }),
    );
  } else if (aptCurrent && aptUpToDate) {
    metaParts.push(
      t('software.meta.aptCurrentLatest', {
        v: aptCurrent,
        defaultValue: t('uiInline.s9071dcb7', { v0: aptCurrent }),
      }),
    );
  } else if (aptCurrent && !def.runtimeKind) {
    metaParts.push(
      t('software.meta.aptVersion', {
        v: aptCurrent,
        defaultValue: t('uiInline.s0b09f444', { v0: aptCurrent }),
      }),
    );
  } else if (aptChecked && !aptCurrent && !def.runtimeKind) {
    metaParts.push(
      t('software.meta.aptNotInstalled', {
        defaultValue: t('uiInline.sf6cc774f'),
      }),
    );
  }
  if (hostUpdatesHint != null && hostUpdatesHint > 0) {
    metaParts.push(
      t('software.meta.hostUpgradable', {
        n: hostUpdatesHint,
        defaultValue: t('uiInline.s42f9c88b', { v0: hostUpdatesHint }),
      }),
    );
  }
  if (!metaParts.length) {
    metaParts.push(
      def.softwareIds?.length || def.runtimeKind
        ? t('software.meta.checking', {
            defaultValue: t('uiInline.sb72e8ebc'),
          })
        : t('software.meta.openManage', {
            defaultValue: t('uiInline.sabac942e'),
          }),
    );
  }

  return (
    <article className="software-card">
      <div className="software-card__head">
        <div className="software-card__title-row">
          <span className="software-card__icon" aria-hidden>
            {def.icon}
          </span>
          <span className="software-card__name">{name}</span>
        </div>
        <div className="software-card__badges">
          <Badge tone={status}>{statusLabel}</Badge>
          {hasUpdate ? (
            <Badge tone="warn">
              {t('software.badge.update', { defaultValue: t('uiInline.sbd26894e') })}
            </Badge>
          ) : aptUpToDate ? (
            <Badge tone="ok">
              {t('software.badge.upToDate', { defaultValue: t('uiInline.s5985ee9a') })}
            </Badge>
          ) : null}
        </div>
      </div>
      <p className="software-card__meta">{metaParts.join(' · ')}</p>
      {canInstallRuntime && candidates.length > 0 ? (
        <div className="software-card__actions u-mb-1">
          <select
            className="input input--sm"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            aria-label={t('software.version.pick', { defaultValue: t('uiInline.s090e6a43') })}
          >
            {candidates.map((c) => (
              <option key={c.version} value={c.version}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="software-card__actions">
        {canInstallRuntime ? (
          <button
            type="button"
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            disabled={installBusy || !String(picked || updateTarget || candidates[0]?.version || '').trim()}
            title={t('software.action.installVersion', {
              v: picked || updateTarget,
              defaultValue: t('uiInline.s8253535d', { v0: picked || updateTarget }),
            })}
            onClick={() => {
              if (!def.runtimeKind) return;
              const target = String(
                picked || updateTarget || candidates[0]?.version || '',
              ).trim();
              if (!target) {
                return;
              }
              void onInstallRuntime?.(def.runtimeKind, target);
            }}
          >
            {installBusy
              ? t('software.runtime.installingShort', { defaultValue: t('uiInline.s1723f1d7') })
              : t('software.action.update', { defaultValue: t('uiInline.sd9db02d0') })}
          </button>
        ) : showAptUpdate ? (
          <button
            type="button"
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            disabled={installBusy}
            title={t('software.action.applyAptTitle', {
              pkg: aptPackagesToUpdate.map((p) => p.packageName).join(', '),
              defaultValue: t('uiInline.sba60558e', { v0: aptPackagesToUpdate.map((p) => p.packageName).join(', ') }),
            })}
            onClick={() => onRequestAptApply?.(aptPackagesToUpdate, cardLabel)}
          >
            {installBusy
              ? t('software.runtime.installingShort', { defaultValue: t('uiInline.s1723f1d7') })
              : aptPackagesToUpdate.length > 1
                ? t('software.action.updateN', {
                    n: aptPackagesToUpdate.length,
                    defaultValue: t('uiInline.s706de938', { v0: aptPackagesToUpdate.length }),
                  })
                : t('software.action.update', { defaultValue: t('uiInline.sd9db02d0') })}
          </button>
        ) : showAptInstall ? (
          <button
            type="button"
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            disabled={installBusy}
            title={t('software.action.installTitle', {
              list: aptMissingIds.join(', '),
              defaultValue: t('uiInline.s0f9ddc70', { v0: aptMissingIds.join(', ') }),
            })}
            onClick={() => onRequestInstall?.(aptMissingIds, cardLabel)}
          >
            {installBusy
              ? t('software.runtime.installingShort', { defaultValue: t('uiInline.s1723f1d7') })
              : t('software.action.install', { defaultValue: t('uiInline.sef864639') })}
          </button>
        ) : updateHref ? (
          <Link
            to={updateHref}
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            title={
              updateTarget
                ? t('software.action.updateTitle', {
                    v: updateTarget,
                    defaultValue: t('uiInline.s59f613d5', { v0: updateTarget }),
                  })
                : aptPackage
                  ? t('software.action.updateAptTitle', {
                      pkg: aptPackage,
                      defaultValue: t('uiInline.s78b1688f', { v0: aptPackage }),
                    })
                  : undefined
            }
          >
            {t('software.action.update', { defaultValue: t('uiInline.sd9db02d0') })}
          </Link>
        ) : null}
        <Link
          to={def.to}
          className={buttonClassName({
            variant: updateHref ? 'secondary' : 'primary',
            size: 'sm',
          })}
        >
          {t('software.action.manage', { defaultValue: t('uiInline.s4989b5cf') })}
        </Link>
        {def.serviceTo ? (
          <Link
            to={def.serviceTo}
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          >
            {t(`nav.${def.serviceNavKey ?? 'services'}`, {
              defaultValue: t('uiInline.s72203f17'),
            })}
          </Link>
        ) : null}
        {projectHref ? (
          <Link
            to={projectHref}
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            title={t('software.action.useInProjectTitle', {
              defaultValue: t('uiInline.s75817a35'),
            })}
          >
            {t('software.action.useInProject', { defaultValue: t('uiInline.s6d449473') })}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
