/**
 * Smart updates — tabbed: packages · panel self · schedule · policy.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUpdates } from '../features/updates';
import type { AdviceRow } from '../features/updates';
import {
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
import { humanizeOperatorNote } from '../shared/lib/operator-messages';

const UPD_TABS = ['packages', 'panel', 'schedule', 'policy'] as const;
type RiskFilter = 'all' | 'upgradable' | 'high' | 'medium' | 'low' | 'approval';

function riskTone(risk?: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
  if (risk === 'critical' || risk === 'high') return 'danger';
  if (risk === 'medium') return 'warn';
  if (risk === 'low') return 'ok';
  return 'neutral';
}

function riskLabel(risk?: string): string {
  if (risk === 'critical') return '嚴重';
  if (risk === 'high') return '高';
  if (risk === 'medium') return '中';
  if (risk === 'low') return '低';
  return risk ?? '—';
}

function isHighRisk(row: AdviceRow): boolean {
  return (
    row.risk === 'high' ||
    row.risk === 'critical' ||
    Boolean(row.requiresApproval)
  );
}

function relTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const t = new Date(iso).getTime();
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 15) return '剛剛';
    if (sec < 60) return `${sec} 秒前`;
    if (sec < 3600) return `${Math.floor(sec / 60)} 分鐘前`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 小時前`;
    return new Date(iso).toLocaleString('zh-TW');
  } catch {
    return iso;
  }
}

export function UpdatesPage() {
  const { t } = useTranslation();
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
      title={t('nav.updates', { defaultValue: '更新' })}
      showCapability={false}
      status={{
        pill: {
          label:
            highRisk > 0
              ? `${highRisk} 項高風險`
              : selfAvailable
                ? '面板有更新'
                : inventory.length
                  ? '風險可控'
                  : '待掃描',
          tone: heroTone,
        },
        items: [
          { label: '套件', value: inventory.length },
          {
            label: '高風險',
            value: highRisk,
            tone: highRisk > 0 ? 'danger' : 'ok',
          },
          {
            label: '需審批',
            value: needApproval,
            tone: needApproval > 0 ? 'warn' : 'neutral',
          },
          {
            label: '有 CVE',
            value: withCve,
            tone: withCve > 0 ? 'warn' : 'neutral',
          },
          {
            label: '面板',
            value: selfAvailable ? `${selfVersion}→${selfLatest}` : selfVersion,
            tone: selfAvailable ? 'warn' : 'ok',
          },
          {
            label: '排程',
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
            重新載入
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => void load(true, true)}
            title="對前 12 個建議套件查 OSV（需外網）"
          >
            掃描 + OSV
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            onClick={() => void load(true, false)}
          >
            掃描套件
          </Button>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: 'packages',
            label: '套件清點',
            badge: inventory.length || undefined,
          },
          {
            id: 'panel',
            label: '面板自身',
            badge: selfAvailable ? '更新' : undefined,
          },
          {
            id: 'schedule',
            label: '排程',
            badge: jobs.length || undefined,
          },
          { id: 'policy', label: '政策' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'packages' ? (
          <div className="tab-panel stack">
            {busy && inventory.length === 0 ? (
              <LoadingBlock label="掃描中…" />
            ) : (
              <DataTable
                title="套件清點"
                description={`顯示 ${filtered.length} / ${inventory.length} · 清點 ${relTime(lastAt)}`}
                filters={
                  <div className="upd-toolbar">
                    <div className="upd-chips" role="tablist" aria-label="風險篩選">
                      {(
                        [
                          ['all', '全部', inventory.length],
                          ['upgradable', '可升級', upgradableCount],
                          ['high', '高風險', highRisk],
                          [
                            'medium',
                            '中',
                            inventory.filter((i) => i.risk === 'medium').length,
                          ],
                          [
                            'low',
                            '低／未標',
                            inventory.filter((i) => !i.risk || i.risk === 'low')
                              .length,
                          ],
                          ['approval', '需審批', needApproval],
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
                      <span className="upd-field__lab">搜尋</span>
                      <input
                        id="upd-q"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="套件名 / 建議 / CVE…"
                        autoComplete="off"
                        aria-label="搜尋套件"
                      />
                    </label>
                  </div>
                }
                columns={[
                  {
                    key: 'pkg',
                    header: '套件',
                    render: (i) => (
                      <div className="upd-pkg-cell">
                        <div className="upd-pkg-cell__title">
                          <strong className="upd-pkg-cell__name">
                            {i.packageName}
                          </strong>
                          <Badge tone={riskTone(i.risk)}>
                            {riskLabel(i.risk)}
                          </Badge>
                          {i.requiresApproval ? (
                            <Badge tone="warn">需審批</Badge>
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
                    header: '版本（已裝 → apt Candidate）',
                    render: (i) => {
                      const cur = i.currentVersion ?? '—';
                      const cand = i.candidateVersion ?? cur;
                      const hasUpgrade = Boolean(cand && cand !== cur);
                      return (
                        <div className="upd-pkg-cell__ver">
                          <code title="已安裝">{cur}</code>
                          {hasUpgrade ? (
                            <>
                              <span className="upd-pkg__arrow">→</span>
                              <code className="upd-pkg__cand" title="apt Candidate">
                                {cand}
                              </code>
                            </>
                          ) : (
                            <span className="muted u-text-sm">（無可用升級）</span>
                          )}
                        </div>
                      );
                    },
                  },
                  {
                    key: 'advice',
                    header: '建議',
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
                        disabled={!hasUpgrade}
                        title={
                          hasUpgrade
                            ? `升級至 ${i.candidateVersion}`
                            : 'apt Candidate 與已裝版本相同'
                        }
                        onClick={() => {
                          if (!hasUpgrade) return;
                          const high = isHighRisk(i);
                          if (high) {
                            setHighRiskApply(i);
                            return;
                          }
                          void applyPackage(i, false);
                        }}
                      >
                        {hasUpgrade ? '套用' : '無需升級'}
                      </Button>
                    </ActionBar>
                  );
                }}
                empty={
                  inventory.length === 0 ? (
                    <EmptyState
                      title="尚無套件資料"
                      description="按頁面右上「掃描套件」由管理面板掃描主機"
                    />
                  ) : (
                    <EmptyState
                      title="沒有符合篩選的套件"
                      description="試下改風險篩選或清搜尋"
                      action={
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setRiskFilter('all');
                            setQ('');
                          }}
                        >
                          重設篩選
                        </Button>
                      }
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
              <LoadingBlock label="載入自身更新狀態…" />
            ) : (
              <InfoCardGrid cols={2}>
                <InfoCard
                  title="面板自身更新"
                  badge={{
                    label: !selfOk
                      ? '檢查失敗'
                      : selfAvailable
                        ? '可更新'
                        : '已是最新',
                    tone: !selfOk ? 'danger' : selfAvailable ? 'warn' : 'ok',
                  }}
                  facts={[
                    { label: '目前', value: selfVersion, mono: true },
                    { label: '最新', value: selfLatest, mono: true },
                    { label: '通道', value: selfChannel },
                    ...(selfUpdate.packageName != null
                      ? [
                          {
                            label: '套件',
                            value: String(selfUpdate.packageName),
                            mono: true as const,
                          },
                        ]
                      : []),
                    ...(Array.isArray(selfUpdate.notes) &&
                    (selfUpdate.notes as string[]).length
                      ? [
                          {
                            label: '說明',
                            value: humanizeOperatorNote(
                              String((selfUpdate.notes as string[])[0]),
                            ),
                          },
                        ]
                      : []),
                    {
                      label: '狀態',
                      value: !selfOk
                        ? '未確認遠端'
                        : selfAvailable
                          ? '有更新'
                          : '已是最新',
                    },
                  ]}
                  actions={
                    <ActionBar>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        disabled={!selfAvailable}
                        onClick={() => void applySelf()}
                      >
                        套用面板更新
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => void load(false)}
                      >
                        重新檢查
                      </Button>
                    </ActionBar>
                  }
                />
                <InfoCard
                  title="說明"
                  facts={[
                    {
                      label: '範圍',
                      value: 'ysk-server 控制面版本 · 非系統 apt 全量升級',
                    },
                    {
                      label: '頻道',
                      value:
                        'npm → GitHub release → package.json；套用：npm install -g 或 git（YSK_SOURCE_ROOT）',
                    },
                    {
                      label: '失敗',
                      value: '頻道不可用唔會假裝已是最新；套用需 EXECUTE；git 後需重啟服務',
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
                  <h3 className="data-table__title">排程任務</h3>
                  <p className="data-table__desc">
                    控制面 scheduler（唯讀）· {jobs.length} 項
                  </p>
                </div>
              </header>
              {jobs.length === 0 ? (
                <div className="data-table__empty">
                  <EmptyState
                    title="尚無可見排程"
                    description="未啟用或目前無 scheduler 任務"
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
                          ? ` · 上次 ${relTime(String(j.lastRunAt))}`
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
              title="更新政策"
              facts={[
                {
                  label: '掃描',
                  value: '掃描 ≠ 已升級；套用才會改系統',
                },
                {
                  label: '高風險',
                  value: '需審批：二次確認後才送出',
                },
                {
                  label: '權限',
                  value: '無 EXECUTE／root → blocked，唔假成功',
                },
                {
                  label: 'OSV',
                  value: '需外網，只補強前 12 項建議',
                },
              ]}
            />
            <nav className="upd-shortcuts" aria-label="相關">
              <Link to="/system" className="upd-shortcut">
                <span className="upd-shortcut__t">主機設定</span>
                <span className="upd-shortcut__d">EXECUTE / root</span>
              </Link>
              <Link to="/system/readiness" className="upd-shortcut">
                <span className="upd-shortcut__t">就緒探測</span>
                <span className="upd-shortcut__d">生產閘門</span>
              </Link>
              <Link to="/system/unit" className="upd-shortcut">
                <span className="upd-shortcut__t">systemd 單元</span>
                <span className="upd-shortcut__d">控制面服務</span>
              </Link>
              <Link to="/security" className="upd-shortcut">
                <span className="upd-shortcut__t">安全中心</span>
                <span className="upd-shortcut__d">審批 / 工具</span>
              </Link>
            </nav>
          </div>
        ) : null}
      </PageTabs>

      <ConfirmDialog
        open={highRiskApply != null}
        onClose={() => setHighRiskApply(null)}
        title={
          highRiskApply
            ? `套用高風險更新 ${highRiskApply.packageName}？`
            : '高風險更新'
        }
        description={
          highRiskApply
            ? `${highRiskApply.currentVersion} → ${highRiskApply.candidateVersion}. ${highRiskApply.summary ?? highRiskApply.advice ?? ''}`
            : ''
        }
        confirmLabel="套用"
        cancelLabel="取消"
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
