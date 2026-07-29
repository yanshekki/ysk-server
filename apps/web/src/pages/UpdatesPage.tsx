/**
 * Smart updates — inventory + self-update (professional ops console).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useUpdates } from '../features/updates';
import type { AdviceRow } from '../features/updates';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  LoadingBlock,
} from '../shared/components/ui';
import { humanizeOperatorNote } from '../shared/lib/operator-messages';

type RiskFilter = 'all' | 'high' | 'medium' | 'low' | 'approval';

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

  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [q, setQ] = useState('');

  const highRisk = inventory.filter(
    (i) => i.risk === 'critical' || i.risk === 'high',
  ).length;
  const needApproval = inventory.filter((i) => i.requiresApproval).length;
  const withCve = inventory.filter((i) => (i.cves?.length ?? 0) > 0).length;

  const selfAvailable = Boolean(selfUpdate?.updateAvailable);
  const selfVersion = String(selfUpdate?.currentVersion ?? '—');
  const selfLatest = String(selfUpdate?.latestVersion ?? '—');
  const selfChannel = String(selfUpdate?.channel ?? '—');
  const selfOk = selfUpdate?.ok !== false;

  const heroTone = highRisk > 0 ? 'danger' : selfAvailable ? 'warn' : 'ok';

  const filtered = useMemo(() => {
    let list = inventory;
    if (riskFilter === 'high') {
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
      actions={
        <>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void load(false)}
          >
            重新載入
          </Button>
          <Button
            variant="primary"
            size="md"
            loading={busy}
            onClick={() => void load(true, false)}
          >
            掃描套件
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void load(true, true)}
            title="對前 12 個建議套件查 OSV（需外網）"
          >
            掃描 + OSV
          </Button>
        </>
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

      <div className="upd">
        {/* Hero */}
        <section className={`upd-hero upd-hero--${heroTone}`} aria-label="更新總覽">
          <div className="upd-hero__main">
            <div className="upd-hero__copy">
              <div className="upd-hero__eyebrow">Smart updates</div>
              <h2 className="upd-hero__title">
                <span className={`upd-hero__pill upd-hero__pill--${heroTone}`}>
                  {highRisk > 0
                    ? `${highRisk} 項高風險`
                    : selfAvailable
                      ? '面板有更新'
                      : inventory.length
                        ? '風險可控'
                        : '待掃描'}
                </span>
                {inventory.length
                  ? `清點 ${inventory.length} 套件`
                  : '尚未有套件清點'}
              </h2>
              <p className="upd-hero__hint">
                由管理面板掃描主機套件、標風險／CVE、審批後套用。高風險需確認；無
                EXECUTE／root 會 blocked。OSV 需外網、只查前 12 項。
              </p>
              <div className="upd-hero__meta">
                <span>
                  清點 <strong>{relTime(lastAt)}</strong>
                </span>
                <span className="upd-hero__dot" />
                <span>
                  面板 <strong>{selfVersion}</strong>
                  {selfAvailable ? ` → ${selfLatest}` : ''}
                </span>
                <span className="upd-hero__dot" />
                <span>
                  排程 <strong>{jobs.length}</strong>
                </span>
              </div>
              <div className="upd-hero__cta">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => void load(true, false)}
                >
                  掃描套件
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() => void load(true, true)}
                >
                  掃描 + OSV
                </Button>
                {selfAvailable ? (
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() => void applySelf()}
                  >
                    套用面板更新
                  </Button>
                ) : null}
                <Link to="/system/readiness" className="btn btn--ghost btn--md">
                  就緒探測
                </Link>
              </div>
            </div>

            <div className="upd-hero__stats" aria-label="指標">
              <div className="upd-stat">
                <span className="upd-stat__lab">套件</span>
                <span className="upd-stat__val">{inventory.length}</span>
              </div>
              <div className="upd-stat">
                <span className="upd-stat__lab">高風險</span>
                <span className="upd-stat__val">
                  <Badge tone={highRisk > 0 ? 'danger' : 'ok'}>{highRisk}</Badge>
                </span>
              </div>
              <div className="upd-stat">
                <span className="upd-stat__lab">需審批</span>
                <span className="upd-stat__val">
                  <Badge tone={needApproval > 0 ? 'warn' : 'neutral'}>
                    {needApproval}
                  </Badge>
                </span>
              </div>
              <div className="upd-stat">
                <span className="upd-stat__lab">有 CVE</span>
                <span className="upd-stat__val">
                  <Badge tone={withCve > 0 ? 'warn' : 'neutral'}>{withCve}</Badge>
                </span>
              </div>
            </div>
          </div>

          <ul className="upd-rail" aria-label="能力摘要">
            <li>
              <span className="upd-rail__k">面板版本</span>
              <code className="upd-rail__code">{selfVersion}</code>
            </li>
            <li>
              <span className="upd-rail__k">通道</span>
              <span className="upd-rail__text">{selfChannel}</span>
            </li>
            <li>
              <span className="upd-rail__k">面板更新</span>
              <Badge tone={selfAvailable ? 'warn' : 'ok'}>
                {selfAvailable ? '有' : '最新'}
              </Badge>
            </li>
            <li>
              <span className="upd-rail__k">自身檢查</span>
              <Badge tone={selfOk ? 'ok' : 'warn'}>{selfOk ? 'ok' : '異常'}</Badge>
            </li>
          </ul>
        </section>

        <div className="upd-grid">
          {/* Self update */}
          <section className="upd-panel upd-panel--self">
            <header className="upd-panel__head">
              <div>
                <h3 className="upd-panel__title">面板自身更新</h3>
                <p className="upd-panel__sub">
                  ysk-server 控制面版本 · 非系統 apt 全量升級
                </p>
              </div>
              <Badge tone={selfAvailable ? 'warn' : 'ok'}>
                {selfAvailable ? '可更新' : '已是最新'}
              </Badge>
            </header>

            {!selfUpdate ? (
              <LoadingBlock label="載入自身更新狀態…" />
            ) : (
              <>
                <dl className="upd-dl">
                  <div>
                    <dt>目前</dt>
                    <dd>
                      <code>{selfVersion}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>最新</dt>
                    <dd>
                      <code>{selfLatest}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>通道</dt>
                    <dd>{selfChannel}</dd>
                  </div>
                  {selfUpdate.packageName != null ? (
                    <div>
                      <dt>套件</dt>
                      <dd>
                        <code>{String(selfUpdate.packageName)}</code>
                      </dd>
                    </div>
                  ) : null}
                  {selfUpdate.applied != null ? (
                    <div>
                      <dt>上次套用</dt>
                      <dd>{String(selfUpdate.applied)}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="upd-panel__actions">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => void applySelf()}
                  >
                    套用面板更新
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    loading={busy}
                    onClick={() => void load(false)}
                  >
                    重新檢查
                  </Button>
                </div>
                <p className="upd-footnote">
                  控制面 self-update；失敗見 notes。
                </p>
              </>
            )}
          </section>

          {/* Scheduler + policy */}
          <aside className="upd-side">
            <section className="upd-panel">
              <header className="upd-panel__head">
                <div>
                  <h3 className="upd-panel__title">排程</h3>
                  <p className="upd-panel__sub">
                    控制面 scheduler 任務（唯讀）
                  </p>
                </div>
                <Badge tone="neutral">{jobs.length}</Badge>
              </header>
              {jobs.length === 0 ? (
                <p className="upd-muted">尚無可見排程（或未啟用）</p>
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

            <section className="upd-panel">
              <header className="upd-panel__head">
                <h3 className="upd-panel__title">政策</h3>
              </header>
              <ul className="upd-bullets">
                <li>掃描 ≠ 已升級；套用才會改系統</li>
                <li>高風險／需審批：二次確認後才送出</li>
                <li>無 EXECUTE／root → blocked，唔假成功</li>
                <li>OSV 需外網，只補強前 12 項建議</li>
              </ul>
            </section>

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
          </aside>
        </div>

        {/* Inventory */}
        <section className="upd-panel upd-panel--inventory">
          <header className="upd-panel__head upd-panel__head--stack">
            <div className="upd-panel__head-row">
              <div>
                <h3 className="upd-panel__title">套件清點</h3>
                <p className="upd-panel__sub">
                  顯示 {filtered.length} / {inventory.length} · 清點{' '}
                  {relTime(lastAt)}
                </p>
              </div>
            </div>

            <div className="upd-toolbar">
              <div className="upd-chips" role="tablist" aria-label="風險篩選">
                {(
                  [
                    ['all', '全部', inventory.length],
                    ['high', '高風險', highRisk],
                    [
                      'medium',
                      '中',
                      inventory.filter((i) => i.risk === 'medium').length,
                    ],
                    [
                      'low',
                      '低／未標',
                      inventory.filter((i) => !i.risk || i.risk === 'low').length,
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
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="套件名 / 建議 / CVE…"
                  autoComplete="off"
                />
              </label>
            </div>
          </header>

          {busy && inventory.length === 0 ? (
            <LoadingBlock label="掃描中…" />
          ) : inventory.length === 0 ? (
            <EmptyState
              title="尚無套件資料"
              description="按「掃描套件」由管理面板掃描主機"
              action={
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => void load(true)}
                >
                  掃描套件
                </Button>
              }
            />
          ) : filtered.length === 0 ? (
            <div className="upd-empty">
              <strong>沒有符合篩選的套件</strong>
              <p>試下改風險篩選或清搜尋。</p>
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
            </div>
          ) : (
            <div className="upd-pkg-list">
              {filtered.map((i) => {
                const advice =
                  humanizeOperatorNote(i.advice ?? i.summary ?? '') ??
                  i.advice ??
                  i.summary ??
                  null;
                return (
                  <article
                    key={`${i.packageName}-${i.currentVersion}`}
                    className={`upd-pkg${isHighRisk(i) ? ' upd-pkg--risk' : ''}`}
                  >
                    <div
                      className={`upd-pkg__risk upd-pkg__risk--${riskTone(i.risk)}`}
                      aria-hidden
                    />
                    <div className="upd-pkg__body">
                      <div className="upd-pkg__head">
                        <h4 className="upd-pkg__name">{i.packageName}</h4>
                        <Badge tone={riskTone(i.risk)}>{riskLabel(i.risk)}</Badge>
                        {i.requiresApproval ? (
                          <Badge tone="warn">需審批</Badge>
                        ) : null}
                      </div>
                      <div className="upd-pkg__ver">
                        <code>{i.currentVersion}</code>
                        {i.candidateVersion ? (
                          <>
                            <span className="upd-pkg__arrow">→</span>
                            <code className="upd-pkg__cand">{i.candidateVersion}</code>
                          </>
                        ) : null}
                      </div>
                      {advice ? <p className="upd-pkg__advice">{advice}</p> : null}
                      {i.cves?.length ? (
                        <div className="upd-pkg__cves">
                          {i.cves.slice(0, 5).map((c) => (
                            <code key={c} className="upd-pkg__cve">
                              {c}
                            </code>
                          ))}
                          {i.cves.length > 5 ? (
                            <span className="upd-muted">+{i.cves.length - 5}</span>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="upd-pkg__action">
                      <Button
                        variant={isHighRisk(i) ? 'danger' : 'primary'}
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          const high = isHighRisk(i);
                          if (
                            high &&
                            !confirm(
                              `確認套用高風險更新 ${i.packageName}？\n${i.summary ?? i.advice ?? ''}`,
                            )
                          ) {
                            return;
                          }
                          void applyPackage(i, high);
                        }}
                      >
                        套用
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </FeaturePageLayout>
  );
}
