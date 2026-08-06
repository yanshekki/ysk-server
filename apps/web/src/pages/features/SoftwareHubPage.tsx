/**
 * Software hub — professional multi-tab catalog of all panel software.
 * Runtimes show install / active / newer-upstream; CTA to manage + use in projects.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  FeaturePageLayout,
  LoadingBlock,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { updatesApi } from '../../features/updates';
import { toast } from '../../shared/stores/toast-store';
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
};

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
  const [aptById, setAptById] = useState<Record<string, AptUpgradeRow>>({});
  /** Product-catalog apt upgradable count (from software/upgrades) */
  const [catalogAptUpgradable, setCatalogAptUpgradable] = useState(0);
  /** Full-host inventory upgradable (updates page) */
  const [hostUpgradable, setHostUpgradable] = useState(0);
  const [applyTarget, setApplyTarget] = useState<{
    packageName: string;
    currentVersion: string;
    candidateVersion: string;
  } | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);

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
      const [mx, rt, up, inv] = await Promise.all([
        systemApi.servicesMatrix().catch(() => ({ items: [] as MatrixItem[] })),
        systemApi.runtimes().catch(() => null),
        systemApi.softwareUpgrades().catch(() => ({
          items: [] as AptUpgradeRow[],
          upgradableCount: 0,
        })),
        updatesApi
          .inventory({ upgradable: '1', cached: true })
          .catch(() => null),
      ]);
      setMatrix((mx as { items?: MatrixItem[] }).items ?? []);
      setRuntimeProbe((rt as Record<string, unknown>) ?? null);
      const aptMap: Record<string, AptUpgradeRow> = {};
      for (const row of (up as { items?: AptUpgradeRow[] }).items ?? []) {
        if (row?.id) aptMap[row.id] = row;
      }
      setAptById(aptMap);
      setCatalogAptUpgradable(
        Number((up as { upgradableCount?: number }).upgradableCount ?? 0) || 0,
      );
      const metaUp = Number(inv?.meta?.upgradableCount ?? 0);
      const rowUp = (inv?.inventory ?? []).filter(
        (i) =>
          i.candidateVersion && i.candidateVersion !== i.currentVersion,
      ).length;
      setHostUpgradable(Math.max(metaUp, rowUp) || 0);

      const kinds = SOFTWARE_CARDS.map((c) => c.runtimeKind).filter(
        Boolean,
      ) as RuntimeKindKey[];
      const latestEntries = await Promise.all(
        kinds.map(async (kind) => {
          try {
            const h = await systemApi.runtimeLatest(kind);
            return [kind, h] as const;
          } catch {
            return [kind, {} as LatestHint] as const;
          }
        }),
      );
      const map: Partial<Record<RuntimeKindKey, LatestHint>> = {};
      for (const [k, h] of latestEntries) map[k] = h;
      setLatestByKind(map);
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

  const cardView = useCallback(
    (def: SoftwareCardDef) => {
      const mx = matrixMatch(matrix, def.matrixIds);
      const items = def.runtimeKind ? probeByKind[def.runtimeKind] ?? [] : [];
      const installed = items.filter((i) => i.available);
      const activeItem = installed.find((i) => i.active) ?? installed[0];
      const installedLabels = installed.map((i) => String(i.version ?? '')).filter(Boolean);
      const latest = def.runtimeKind ? latestByKind[def.runtimeKind] : undefined;

      const aptRows = (def.softwareIds ?? [])
        .map((id) => aptById[id])
        .filter((r): r is AptUpgradeRow => Boolean(r));
      const aptUpgradable = aptRows.filter((r) => r.upgradable);
      const primaryApt = aptUpgradable[0] ?? aptRows[0];

      let status: 'ok' | 'warn' | 'danger' | 'neutral' = 'neutral';
      let statusLabel = t('software.status.unknown', { defaultValue: '—' });

      if (def.runtimeKind) {
        if (installed.length) {
          status = 'ok';
          statusLabel = t('software.status.installed', { defaultValue: '已安裝' });
        } else {
          status = 'warn';
          statusLabel = t('software.status.notInstalled', { defaultValue: '未安裝' });
        }
      } else if (mx) {
        if (mx.active === 'active' || mx.active === 'tool') {
          status = 'ok';
          statusLabel = t('software.status.running', { defaultValue: '運行中' });
        } else if (mx.installed === false || mx.active === 'not-found') {
          status = 'danger';
          statusLabel = t('software.status.missing', { defaultValue: '未偵測' });
        } else if (mx.active === 'inactive' || mx.active === 'failed') {
          status = mx.active === 'failed' ? 'danger' : 'warn';
          statusLabel =
            mx.active === 'failed'
              ? t('software.status.failed', { defaultValue: '失敗' })
              : t('software.status.stopped', { defaultValue: '已停止' });
        } else if (mx.installed) {
          status = 'ok';
          statusLabel = t('software.status.installed', { defaultValue: '已安裝' });
        }
      } else if (primaryApt?.installed) {
        status = 'ok';
        statusLabel = t('software.status.installed', { defaultValue: '已安裝' });
      }

      const runtimeUpdate = Boolean(
        latest?.newerThanPanel ||
          (latest?.remoteLatest &&
            installedLabels.length > 0 &&
            !installedLabels.some(
              (v) =>
                latest.remoteLatest === v ||
                String(latest.remoteLatest).startsWith(`${v}.`) ||
                String(v).startsWith(String(latest.remoteLatest)),
            )),
      );

      // Panel supports more pins than installed (go/rust)
      const panelGap =
        def.runtimeKind &&
        installedLabels.length > 0 &&
        (probeByKind[def.runtimeKind]?.length ?? 0) >
          installedLabels.length;

      const aptUpdate = aptUpgradable.length > 0;
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

      return {
        def,
        status,
        statusLabel,
        installedLabels,
        activeVersion: activeItem?.version != null ? String(activeItem.version) : null,
        versionOutput: activeItem?.versionOutput,
        hasUpdate,
        latest,
        mx,
        aptCurrent: primaryApt?.currentVersion,
        aptCandidate: primaryApt?.candidateVersion,
        aptPackage: primaryApt?.packageName,
        aptUpdate,
        hostUpdatesHint,
      };
    },
    [matrix, probeByKind, latestByKind, aptById, hostUpgradable, t],
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

  const confirmApplyPackage = useCallback(async () => {
    if (!applyTarget) return;
    setApplyBusy(true);
    try {
      const r = await updatesApi.applyPackage({
        packageName: applyTarget.packageName,
        currentVersion: applyTarget.currentVersion,
        candidateVersion: applyTarget.candidateVersion,
        confirmHighRisk: true,
      });
      if (r.blocked) {
        toast.error(
          r.blockMessage ||
            t('software.apply.blocked', { defaultValue: '更新被阻擋（需 root+EXECUTE）' }),
        );
      } else if (r.ok && r.applied) {
        toast.ok(
          t('software.apply.ok', {
            pkg: applyTarget.packageName,
            defaultValue: `已套用 ${applyTarget.packageName} 更新`,
          }),
        );
        setApplyTarget(null);
        void refresh();
      } else {
        toast.error(
          (r.notes ?? []).slice(0, 2).join(' · ') ||
            t('software.apply.failed', { defaultValue: '更新未完成' }),
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setApplyBusy(false);
    }
  }, [applyTarget, refresh, t]);

  const visibleCards = useMemo(() => {
    const list = cardsForTab(tab);
    return list.map((c) => cardView(c));
  }, [tab, cardView]);

  const tabItems = SOFTWARE_TABS.map((x) => ({
    id: x.id,
    label: t(x.labelKey, {
      defaultValue:
        x.id === 'overview'
          ? '總覽'
          : x.id === 'runtimes'
            ? '執行環境'
            : x.id === 'databases'
              ? '資料庫'
              : x.id === 'edge'
                ? '域名與邊緣'
                : x.id === 'mail-files'
                  ? '郵件與檔案'
                  : '主機服務',
    }),
    badge: (() => {
      if (x.id === 'overview') return summary.updates > 0 ? summary.updates : undefined;
      const n = allViews.filter((v) => v.def.tab === x.id && v.hasUpdate).length;
      return n > 0 ? n : undefined;
    })(),
  }));

  return (
    <FeaturePageLayout
      title={t('software.title', { defaultValue: '軟件中心' })}
      subtitle={t('software.desc', {
        defaultValue:
          '全部可管理軟件一覽：安裝狀態、服務健康、新版本提示；可進入管理頁或用於專案。',
      })}
      actions={
        <Button variant="secondary" size="sm" loading={loading} onClick={() => void refresh()}>
          {t('common.refresh', { defaultValue: '重新整理' })}
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
                        {t('software.stat.catalog', { defaultValue: '目錄項目' })}
                      </span>
                    </div>
                    <div className="software-hub__stat software-hub__stat--ok">
                      <span className="software-hub__stat-value">
                        {summary.installedRt}/{summary.runtimeTotal}
                      </span>
                      <span className="software-hub__stat-label">
                        {t('software.stat.runtimesInstalled', {
                          defaultValue: '執行環境已裝',
                        })}
                      </span>
                    </div>
                    <div
                      className={`software-hub__stat${summary.updates ? ' software-hub__stat--warn' : ''}`}
                    >
                      <span className="software-hub__stat-value">{summary.updates}</span>
                      <span className="software-hub__stat-label">
                        {t('software.stat.updates', { defaultValue: '有新版本／可擴充' })}
                      </span>
                    </div>
                    <div
                      className={`software-hub__stat${summary.serviceBad ? ' software-hub__stat--warn' : ' software-hub__stat--ok'}`}
                    >
                      <span className="software-hub__stat-value">{summary.serviceBad}</span>
                      <span className="software-hub__stat-label">
                        {t('software.stat.attention', { defaultValue: '需關注' })}
                      </span>
                    </div>
                  </div>

                  {(summary.catalogAptUpgradable > 0 || summary.hostUpgradable > 0) ? (
                    <Card className="u-mb-3">
                      <CardSection
                        title={t('software.aptSummaryTitle', {
                          defaultValue: '系統倉庫可升級',
                        })}
                        description={t('software.aptSummaryDesc', {
                          defaultValue:
                            '目錄軟件與主機套件清單分開統計；實際套用可在更新中心或卡片一鍵確認。',
                        })}
                      >
                        <div className="software-card__actions">
                          <Badge tone="warn">
                            {t('software.aptSummary.catalog', {
                              n: summary.catalogAptUpgradable,
                              defaultValue: `目錄軟件 ${summary.catalogAptUpgradable}`,
                            })}
                          </Badge>
                          <Badge tone={summary.hostUpgradable ? 'warn' : 'neutral'}>
                            {t('software.aptSummary.host', {
                              n: summary.hostUpgradable,
                              defaultValue: `主機套件 ${summary.hostUpgradable}`,
                            })}
                          </Badge>
                          <Link
                            to="/updates"
                            className={buttonClassName({ variant: 'primary', size: 'sm' })}
                          >
                            {t('software.aptSummary.openUpdates', {
                              defaultValue: '開啟更新中心',
                            })}
                          </Link>
                        </div>
                      </CardSection>
                    </Card>
                  ) : null}

                  <Card className="u-mb-3">
                    <CardSection
                      title={t('software.quickTitle', { defaultValue: '快捷' })}
                      description={t('software.quickDesc', {
                        defaultValue: '常用分區與主機服務入口',
                      })}
                    >
                      <div className="software-card__actions">
                        {(
                          [
                            ['runtimes', '執行環境'],
                            ['databases', '資料庫'],
                            ['edge', '域名與邊緣'],
                            ['mail-files', '郵件與檔案'],
                            ['host', '主機服務'],
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
                          defaultValue: '可更新／可安裝版本',
                        })}
                        description={t('software.updatesDesc', {
                          defaultValue:
                            '執行環境：上游／面板新版本；服務：系統倉庫可升級。可一鍵套用套件或前往更新中心。',
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
                                onRequestAptApply={setApplyTarget}
                              />
                            ))}
                        </div>
                      </CardSection>
                    </Card>
                  ) : null}

                  <div className="software-hub__section-head">
                    <h3>{t('software.allSoftware', { defaultValue: '全部軟件' })}</h3>
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
                      onRequestAptApply={setApplyTarget}
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
          defaultValue: '確認套用系統套件更新？',
        })}
        description={
          applyTarget
            ? t('software.apply.confirmBody', {
                pkg: applyTarget.packageName,
                from: applyTarget.currentVersion,
                to: applyTarget.candidateVersion,
                defaultValue: `將升級 ${applyTarget.packageName}：${applyTarget.currentVersion} → ${applyTarget.candidateVersion}。需 root 且已開啟 EXECUTE。`,
              })
            : ''
        }
        confirmLabel={t('software.apply.confirm', { defaultValue: '確認更新' })}
        cancelLabel={t('common.cancel', { defaultValue: '取消' })}
        busy={applyBusy}
        danger
        onConfirm={() => void confirmApplyPackage()}
        onClose={() => {
          if (!applyBusy) setApplyTarget(null);
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
  /** Full-host inventory upgradable count (updates card only) */
  hostUpdatesHint?: number;
};

function SoftwareCard({
  view,
  t,
  onRequestAptApply,
}: {
  view: CardView;
  t: (k: string, o?: Record<string, unknown>) => string;
  onRequestAptApply?: (target: {
    packageName: string;
    currentVersion: string;
    candidateVersion: string;
  }) => void;
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
    hostUpdatesHint,
  } = view;

  const name = t(`nav.${def.navKey}`, { defaultValue: def.navKey });
  // Prefer remote/panel latest for runtime update deep-link; apt → updates center
  const updateTarget = String(
    latest?.remoteLatest || latest?.panelLatest || '',
  ).trim();
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
      aptPackage &&
      aptCurrent &&
      aptCandidate &&
      onRequestAptApply,
  );

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
        defaultValue: `已裝：${installedLabels.join(', ')}`,
      }),
    );
  }
  if (activeVersion) {
    metaParts.push(
      t('software.meta.default', {
        v: activeVersion,
        defaultValue: `預設 ${activeVersion}`,
      }),
    );
  }
  if (versionOutput) metaParts.push(versionOutput);
  if (latest?.remoteLatest && hasUpdate && !aptUpdate) {
    metaParts.push(
      t('software.meta.remote', {
        v: latest.remoteLatest,
        defaultValue: `上游約 ${latest.remoteLatest}`,
      }),
    );
  }
  if (aptCurrent && aptUpdate && aptCandidate) {
    metaParts.push(
      t('software.meta.aptUpgrade', {
        from: aptCurrent,
        to: aptCandidate,
        defaultValue: `系統倉庫 ${aptCurrent} → ${aptCandidate}`,
      }),
    );
  } else if (aptCurrent && !def.runtimeKind) {
    metaParts.push(
      t('software.meta.aptVersion', {
        v: aptCurrent,
        defaultValue: `版本 ${aptCurrent}`,
      }),
    );
  }
  if (hostUpdatesHint != null && hostUpdatesHint > 0) {
    metaParts.push(
      t('software.meta.hostUpgradable', {
        n: hostUpdatesHint,
        defaultValue: `主機約 ${hostUpdatesHint} 個套件可升級`,
      }),
    );
  }
  if (!metaParts.length) {
    metaParts.push(
      t('software.meta.openManage', { defaultValue: '開啟管理頁安裝或設定' }),
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
              {t('software.badge.update', { defaultValue: '有新版本' })}
            </Badge>
          ) : null}
        </div>
      </div>
      <p className="software-card__meta">{metaParts.join(' · ')}</p>
      <div className="software-card__actions">
        {canOneClickApt ? (
          <button
            type="button"
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            title={t('software.action.applyAptTitle', {
              pkg: aptPackage,
              defaultValue: `確認後套用 ${aptPackage} 系統更新`,
            })}
            onClick={() =>
              onRequestAptApply?.({
                packageName: String(aptPackage),
                currentVersion: String(aptCurrent),
                candidateVersion: String(aptCandidate),
              })
            }
          >
            {t('software.action.update', { defaultValue: '更新' })}
          </button>
        ) : updateHref ? (
          <Link
            to={updateHref}
            className={buttonClassName({ variant: 'primary', size: 'sm' })}
            title={
              updateTarget
                ? t('software.action.updateTitle', {
                    v: updateTarget,
                    defaultValue: `前往安裝／切換至 ${updateTarget}`,
                  })
                : aptPackage
                  ? t('software.action.updateAptTitle', {
                      pkg: aptPackage,
                      defaultValue: `前往更新中心處理 ${aptPackage}`,
                    })
                  : undefined
            }
          >
            {t('software.action.update', { defaultValue: '更新' })}
          </Link>
        ) : null}
        <Link
          to={def.to}
          className={buttonClassName({
            variant: updateHref ? 'secondary' : 'primary',
            size: 'sm',
          })}
        >
          {t('software.action.manage', { defaultValue: '管理' })}
        </Link>
        {def.serviceTo ? (
          <Link
            to={def.serviceTo}
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
          >
            {t(`nav.${def.serviceNavKey ?? 'services'}`, {
              defaultValue: '服務',
            })}
          </Link>
        ) : null}
        {projectHref ? (
          <Link
            to={projectHref}
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            title={t('software.action.useInProjectTitle', {
              defaultValue: '到專案頁，可將此 runtime 用於應用',
            })}
          >
            {t('software.action.useInProject', { defaultValue: '用到專案' })}
          </Link>
        ) : null}
      </div>
    </article>
  );
}
