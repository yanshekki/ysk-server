/**
 * Smart updates — tabbed: packages · panel self · schedule · policy.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUpdates } from '../features/updates';
import type { AdviceRow } from '../features/updates';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  InfoCard,
  InfoCardGrid,
  LoadingBlock,
  PageTabs,
} from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';
import { useCapabilities } from '../shared/hooks/useCapabilities';
import { humanizeOperatorNote } from '../shared/lib/operator-messages';

const UPD_TABS = ['packages', 'panel', 'schedule', 'policy', 'about'] as const;
type RiskFilter = 'all' | 'upgradable' | 'high' | 'medium' | 'low' | 'approval';

function riskTone(risk?: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
  if (risk === 'critical' || risk === 'high') return 'danger';
  if (risk === 'medium') return 'warn';
  if (risk === 'low') return 'ok';
  return 'neutral';
}

function riskLabel(risk: string | undefined, tr: (k: string) => string): string {
  if (risk === 'critical') return tr('updates.risk.critical');
  if (risk === 'high') return tr('updates.risk.high');
  if (risk === 'medium') return tr('updates.risk.medium');
  if (risk === 'low') return tr('updates.risk.low');
  return risk ?? '—';
}

function isHighRisk(row: AdviceRow): boolean {
  return (
    row.risk === 'high' ||
    row.risk === 'critical' ||
    Boolean(row.requiresApproval)
  );
}

function relTime(iso: string | null, tr: (k: string, o?: Record<string, unknown>) => string): string {
  if (!iso) return '—';
  try {
    const ms = new Date(iso).getTime();
    const sec = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (sec < 15) return tr('updates.justNow');
    if (sec < 60) return tr('updates.secAgo', { n: sec });
    if (sec < 3600) return tr('updates.minAgo', { n: Math.floor(sec / 60) });
    if (sec < 86400) return tr('updates.hourAgo', { n: Math.floor(sec / 3600) });
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function UpdatesPage() {
  const { t } = useTranslation();
  const { can } = useCapabilities();
  const canApply = can('updates.apply');
  const {
    inventory,
    selfUpdate,
    lastAt,
    jobs,
    error,
    busy,
    msg,
    setMsg,
    load,
    applySelf,
    applyPackage,
  } = useUpdates();

  const [tab, setTab] = usePageTab(UPD_TABS, 'packages');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [q, setQ] = useState('');
  const [highRiskApply, setHighRiskApply] = useState<AdviceRow | null>(null);

  const highRisk = inventory.filter(
    (i) => i.risk === 'critical' || i.risk === 'high',
  ).length;
  const needApproval = inventory.filter((i) => i.requiresApproval).length;
  const withCve = inventory.filter((i) => (i.cves?.length ?? 0) > 0).length;

  const selfAvailable = Boolean(selfUpdate?.updateAvailable);
  const selfVersion = String(selfUpdate?.currentVersion ?? '—');
  const selfLatest = String(selfUpdate?.latestVersion ?? '—');
  const selfChannel = String(selfUpdate?.channel ?? '—');
  const selfChecked = selfUpdate?.checked !== false;
  const selfOk = selfUpdate?.ok !== false && selfChecked;

  const heroTone = highRisk > 0 ? 'danger' : selfAvailable ? 'warn' : 'ok';

  const upgradableCount = inventory.filter(
    (i) => i.candidateVersion && i.candidateVersion !== i.currentVersion,
  ).length;

  const filtered = useMemo(() => {
    let list = inventory;
    if (riskFilter === 'upgradable') {
      list = list.filter(
        (i) => i.candidateVersion && i.candidateVersion !== i.currentVersion,
      );
    } else if (riskFilter === 'high') {
      list = list.filter((i) => i.risk === 'high' || i.risk === 'critical');
    } else if (riskFilter === 'medium') {
      list = list.filter((i) => i.risk === 'medium');
    } else if (riskFilter === 'low') {
      list = list.filter((i) => i.risk === 'low' || !i.risk);
    } else if (riskFilter === 'approval') {
      list = list.filter((i) => i.requiresApproval);
    }
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (i) =>
          i.packageName.toLowerCase().includes(needle) ||
          (i.summary ?? '').toLowerCase().includes(needle) ||
          (i.advice ?? '').toLowerCase().includes(needle) ||
          (i.cves ?? []).some((c) => c.toLowerCase().includes(needle)),
      );
    }
    return list;
  }, [inventory, riskFilter, q]);

  return (
    <FeaturePageLayout
      title={t('nav.updates')}
      showCapability={false}
      status={{
        pill: {
          label:
            highRisk > 0
              ? t('updates.highRiskN', { count: highRisk })
              : selfAvailable
                ? t('updates.panelUpdate')
                : inventory.length
                  ? t('updates.riskOk')
                  : t('updates.pendingScan'),
          tone: heroTone,
        },
        items: [
          { label: t('updates.packages'), value: inventory.length },
          {
            label: t('updates.highRisk'),
            value: highRisk,
            tone: highRisk > 0 ? 'danger' : 'ok',
          },
          {
            label: t('updates.needApproval'),
            value: needApproval,
            tone: needApproval > 0 ? 'warn' : 'neutral',
          },
          {
            label: t('updates.hasCve'),
            value: withCve,
            tone: withCve > 0 ? 'warn' : 'neutral',
          },
          {
            label: t('updates.panel'),
            value: selfAvailable ? `${selfVersion}→${selfLatest}` : selfVersion,
            tone: selfAvailable ? 'warn' : 'ok',
          },
          {
            label: t('updates.schedule'),
            value: jobs.length,
          },
        ],
      }}
      actions={
        <ActionBar align="end">
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void load(false)}
          >
            {t('updates.reload')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => void load(true, true)}
            title={t('updates.osvTitle')}
          >
            {t('updates.scanOsv')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() => void load(true, false)}
          >
            {t('updates.scanPkgs')}
          </Button>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: 'packages',
            label: t('updates.tabInventory'),
            badge: inventory.length || undefined,
          },
          {
            id: 'panel',
            label: t('updates.tabSelf'),
            badge: selfAvailable ? t('updates.badgeUpdate') : undefined,
          },
          {
            id: 'schedule',
            label: t('updates.schedule'),
            badge: jobs.length || undefined,
          },
          { id: 'policy', label: t('updates.tabPolicy') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'packages' ? (
          <div className="tab-panel stack">
            {busy && inventory.length === 0 ? (
              <LoadingBlock label={t('updates.scanning')} />
            ) : (
              <DataTable
                title={t('updates.inventoryTitle')}
                description={t('updates.inventoryDesc', { shown: filtered.length, total: inventory.length, when: relTime(lastAt, t) })}
                filters={
                  <div className="upd-toolbar">
                    <div className="upd-chips" role="tablist" aria-label={t('updates.riskFilterAria')}>
                      {(
                        [
                          ['all', t('updates.all'), inventory.length],
                          ['upgradable', t('updates.upgradable'), upgradableCount],
                          ['high', t('updates.highRisk'), highRisk],
                          [
                            'medium',
                            t('updates.mediumFilter'),
                            inventory.filter((i) => i.risk === 'medium').length,
                          ],
                          [
                            'low',
                            t('updates.lowUnmarked'),
                            inventory.filter((i) => !i.risk || i.risk === 'low')
                              .length,
                          ],
                          ['approval', t('updates.needApproval'), needApproval],
                        ] as const
                      ).map(([id, label, n]) => (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={riskFilter === id}
                          className={`upd-chip${riskFilter === id ? ' upd-chip--active' : ''}${
                            id === 'high'
                              ? ' upd-chip--danger'
                              : id === 'approval' || id === 'medium'
                                ? ' upd-chip--warn'
                                : id === 'low'
                                  ? ' upd-chip--ok'
                                  : ''
                          }`}
                          onClick={() => setRiskFilter(id)}
                        >
                          {label}
                          <span className="upd-chip__n">{n}</span>
                        </button>
                      ))}
                    </div>
                    <label className="upd-field">
                      <span className="upd-field__lab">{t('common.search')}</span>
                      <input
                        id="upd-q"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={t('updates.searchPh')}
                        autoComplete="off"
                        aria-label={t('updates.searchAria')}
                      />
                    </label>
                  </div>
                }
                columns={[
                  {
                    key: 'pkg',
                    header: t('updates.colPackage'),
                    render: (i) => (
                      <div className="upd-pkg-cell">
                        <div className="upd-pkg-cell__title">
                          <strong className="upd-pkg-cell__name">
                            {i.packageName}
                          </strong>
                          <Badge tone={riskTone(i.risk)}>
                            {riskLabel(i.risk, t)}
                          </Badge>
                          {i.requiresApproval ? (
                            <Badge tone="warn">{t('updates.needApproval')}</Badge>
                          ) : null}
                        </div>
                        {i.cves?.length ? (
                          <div className="upd-pkg-cell__cves">
                            {i.cves.slice(0, 4).map((c) => (
                              <code key={c} className="upd-pkg__cve">
                                {c}
                              </code>
                            ))}
                            {i.cves.length > 4 ? (
                              <span className="muted u-text-sm">
                                +{i.cves.length - 4}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: 'ver',
                    header: t('updates.colVersion'),
                    render: (i) => {
                      const cur = i.currentVersion ?? '—';
                      const cand = i.candidateVersion ?? cur;
                      const hasUpgrade = Boolean(cand && cand !== cur);
                      return (
                        <div className="upd-pkg-cell__ver">
                          <code title={t('updates.installedTitle')}>{cur}</code>
                          {hasUpgrade ? (
                            <>
                              <span className="upd-pkg__arrow">→</span>
                              <code className="upd-pkg__cand" title="apt Candidate">
                                {cand}
                              </code>
                            </>
                          ) : (
                            <span className="muted u-text-sm">{t('updates.noUpgrade')}</span>
                          )}
                        </div>
                      );
                    },
                  },
                  {
                    key: 'advice',
                    header: t('updates.colAdvice'),
                    render: (i) => {
                      const advice =
                        humanizeOperatorNote(i.advice ?? i.summary ?? '') ??
                        i.advice ??
                        i.summary ??
                        null;
                      return advice ? (
                        <span className="upd-pkg-cell__advice">{advice}</span>
                      ) : (
                        <span className="muted">—</span>
                      );
                    },
                  },
                ]}
                rows={filtered}
                rowKey={(i) => `${i.packageName}-${i.currentVersion}`}
                rowActions={(i) => {
                  const hasUpgrade =
                    Boolean(i.candidateVersion) &&
                    i.candidateVersion !== i.currentVersion;
                  return (
                    <ActionBar align="end">
                      <Button
                        variant={
                          !hasUpgrade
                            ? 'ghost'
                            : isHighRisk(i)
                              ? 'danger'
                              : 'primary'
                        }
                        size="sm"
                        loading={busy}
                        disabled={!hasUpgrade || !canApply}
                        title={
                          !canApply
                            ? t('rbac.cap.updatesApply')
                            : hasUpgrade
                              ? t('updates.upgradeTo', { v: i.candidateVersion })
                              : t('updates.sameVersion')
                        }
                        onClick={() => {
                          if (!hasUpgrade || !canApply) return;
                          const high = isHighRisk(i);
                          if (high) {
                            setHighRiskApply(i);
                            return;
                          }
                          void applyPackage(i, false);
                        }}
                      >
                        {hasUpgrade ? t('common.apply') : t('updates.noNeedUpgrade')}
                      </Button>
                    </ActionBar>
                  );
                }}
                empty={
                  inventory.length === 0 ? (
                    <EmptyState
                      title={t('updates.emptyInventory')}
                      description={t('updates.emptyInventoryDesc')}
                    />
                  ) : (
                    <EmptyState
                      title={t('updates.emptyFilter')}
                      description={t('updates.emptyFilterDesc')}
                    />
                  )
                }
              />
            )}
          </div>
        ) : null}

        {tab === 'panel' ? (
          <div className="tab-panel">
            {!selfUpdate ? (
              <LoadingBlock label={t('updates.selfLoading')} />
            ) : (
              <InfoCardGrid cols={2}>
                <InfoCard
                  title={t('updates.selfTitle')}
                  badge={{
                    label: !selfOk
                      ? t('updates.selfCheckFailed')
                      : selfAvailable
                        ? t('updates.selfUpdatable')
                        : t('updates.selfUpToDate'),
                    tone: !selfOk ? 'danger' : selfAvailable ? 'warn' : 'ok',
                  }}
                  facts={[
                    { label: t('updates.selfCurrentShort'), value: selfVersion, mono: true },
                    { label: t('updates.selfLatestShort'), value: selfLatest, mono: true },
                    { label: t('updates.selfChannel'), value: selfChannel },
                    ...(selfUpdate.packageName != null
                      ? [
                          {
                            label: t('updates.packages'),
                            value: String(selfUpdate.packageName),
                            mono: true as const,
                          },
                        ]
                      : []),
                    ...(Array.isArray(selfUpdate.notes) &&
                    (selfUpdate.notes as string[]).length
                      ? [
                          {
                            label: t('common.about'),
                            value: humanizeOperatorNote(
                              String((selfUpdate.notes as string[])[0]),
                            ),
                          },
                        ]
                      : []),
                    {
                      label: t('common.status'),
                      value: !selfOk
                        ? t('updates.remoteUnknown')
                        : selfAvailable
                          ? t('updates.hasUpdate')
                          : t('updates.selfUpToDate'),
                    },
                  ]}
                  actions={
                    <ActionBar>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        disabled={!selfAvailable || !canApply}
                        title={!canApply ? t('rbac.cap.updatesApply') : undefined}
                        onClick={() => void applySelf()}
                      >
                        {t('updates.applyPanelUpdate')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => void load(false)}
                      >
                        {t('updates.recheck')}
                      </Button>
                    </ActionBar>
                  }
                />
                <InfoCard
                  title={t('common.about')}
                  facts={[
                    {
                      label: t('updates.aboutScope'),
                      value: t('updates.aboutScopeV'),
                    },
                    {
                      label: t('updates.aboutChannel'),
                      value:
                        t('updates.aboutChannelV'),
                    },
                    {
                      label: t('updates.aboutFail'),
                      value: t('updates.aboutFailV'),
                    },
                  ]}
                />
              </InfoCardGrid>
            )}
          </div>
        ) : null}

        {tab === 'schedule' ? (
          <div className="tab-panel">
            <section className="data-table">
              <header className="data-table__head">
                <div className="data-table__head-text">
                  <h3 className="data-table__title">{t('updates.jobsTitle')}</h3>
                  <p className="data-table__desc">
                    {t('updates.jobsSub', { count: jobs.length })}
                  </p>
                </div>
              </header>
              {jobs.length === 0 ? (
                <div className="data-table__empty">
                  <EmptyState
                    title={t('updates.noJobs')}
                    description={t('updates.noJobsDesc')}
                  />
                </div>
              ) : (
                <ul className="upd-job-list">
                  {jobs.map((j) => (
                    <li key={String(j.id)}>
                      <span className="upd-job__id">{String(j.id)}</span>
                      <span className="upd-job__meta">
                        {j.intervalMs != null
                          ? `${j.intervalMs}ms`
                          : j.interval
                            ? String(j.interval)
                            : '—'}
                        {j.lastRunAt
                          ? t('updates.lastRun', {
                              when: relTime(String(j.lastRunAt), t),
                            })
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'policy' ? (
          <div className="tab-panel stack">
            <InfoCard
              title={t('updates.policyTitle')}
              facts={[
                {
                  label: t('updates.scanPolicy'),
                  value: t('updates.scanPolicyV'),
                },
                {
                  label: t('updates.highRisk'),
                  value: t('updates.highRiskPolicyV'),
                },
                {
                  label: t('updates.permPolicy'),
                  value: t('updates.permPolicyV'),
                },
                {
                  label: 'OSV',
                  value: t('updates.osvPolicyV'),
                },
              ]}
            />
            <nav className="upd-shortcuts" aria-label={t('updates.relatedAria')}>
              <Link to="/system" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scHost')}</span>
                <span className="upd-shortcut__d">EXECUTE / root</span>
              </Link>
              <Link to="/system/readiness" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scReadiness')}</span>
                <span className="upd-shortcut__d">{t('updates.scReadinessD')}</span>
              </Link>
              <Link to="/system/unit" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scSystemd')}</span>
                <span className="upd-shortcut__d">{t('updates.scSystemdD')}</span>
              </Link>
              <Link to="/security" className="upd-shortcut">
                <span className="upd-shortcut__t">{t('updates.scSecurity')}</span>
                <span className="upd-shortcut__d">{t('updates.scSecurityD')}</span>
              </Link>
            </nav>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="updates" /> : null}
      </PageTabs>

      <ConfirmDialog
        open={highRiskApply != null}
        onClose={() => setHighRiskApply(null)}
        title={
          highRiskApply
            ? t('updates.applyHighRisk', { name: highRiskApply.packageName })
            : t('updates.highRiskUpdate')
        }
        description={
          highRiskApply
            ? `${highRiskApply.currentVersion} → ${highRiskApply.candidateVersion}. ${highRiskApply.summary ?? highRiskApply.advice ?? ''}`
            : ''
        }
        confirmLabel={t('common.apply')}
        cancelLabel={t('common.cancel')}
        danger
        onConfirm={() => {
          const row = highRiskApply;
          setHighRiskApply(null);
          if (row) void applyPackage(row, true);
        }}
      />
    </FeaturePageLayout>
  );
}
