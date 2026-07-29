/**
 * Dashboard — health strip + feature tiles with capability badges.
 */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../shared/hooks/useAuth';
import { useDashboard } from '../features/dashboard';
import { softwareApi, type SoftwareStatus } from '../features/software';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  EmptyState,
  FeatureIconGrid,
  Field,
  FormLayout,
  LoadingBlock,
  PageHeader,
  OpsHero,
  Tabs,
  type FeatureTileBadge,
  FormActions,
  FormHint,
  CheckboxField,
  SegRadio,
} from '../shared/components/ui';
import { allFeatureTiles } from '../shared/nav/features';
import { api } from '../shared/services/api';
import { usePageTab } from '../shared/hooks/usePageTab';

const DASH_TABS = ['overview', 'wizard', 'notifications', 'features'] as const;

/** Map nav key → software feature id (for install probe) */
const KEY_TO_FEATURE: Record<string, string> = {
  nginx: 'nginx',
  ssl: 'ssl',
  dns: 'dns',
  ftp: 'ftp',
  ftpService: 'ftp',
  mysql: 'mysql',
  mysqlService: 'mysql',
  mariadb: 'mariadb',
  mariadbService: 'mariadb',
  postgres: 'postgres',
  postgresService: 'postgres',
  redis: 'redis',
  redisService: 'redis',
  node: 'node',
  php: 'php',
  python: 'python',
  go: 'go',
  rust: 'rust',
  firewall: 'firewall',
  fail2ban: 'fail2ban',
  email: 'email',
};

function badgeForKey(
  key: string,
  software: SoftwareStatus[],
  opts: { executeEnabled?: boolean; productionReady?: boolean },
): FeatureTileBadge | undefined {
  const feat = KEY_TO_FEATURE[key];
  if (feat) {
    const related = software.filter((s) => s.features?.includes(feat) || s.id === feat);
    if (related.length === 0) {
      // unknown software entry — neutral control-plane
      return { label: '面板', tone: 'info' };
    }
    const allInstalled = related.every((s) => s.installed);
    const anyActive = related.some((s) => s.active === 'active');
    if (!allInstalled) return { label: '未安裝', tone: 'warn' };
    if (anyActive || allInstalled) return { label: '就緒', tone: 'ok' };
    return { label: '已裝', tone: 'info' };
  }

  // Control-plane features
  if (key === 'readiness') {
    return opts.productionReady
      ? { label: '可生產', tone: 'ok' }
      : { label: '檢查', tone: 'warn' };
  }
  if (['security', 'ai', 'agents', 'updates', 'metrics', 'services', 'cron', 'backups', 'projects', 'files', 'publicFiles', 'systemd'].includes(key)) {
    if (opts.executeEnabled === false) return { label: '需權限', tone: 'warn' };
    return { label: '就緒', tone: 'ok' };
  }
  return { label: '面板', tone: 'neutral' };
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    health,
    audit,
    metrics,
    projects,
    backups,
    expiringCerts,
    summary,
    readiness,
    notifications,
    notifCounts,
    applyAudit,
    error,
    loading,
  } = useDashboard();

  const [software, setSoftware] = useState<SoftwareStatus[]>([]);
  const [svcMatrix, setSvcMatrix] = useState<
    Array<{ id: string; label: string; active: string; activeLabel: string; href?: string }>
  >([]);
  const [wizName, setWizName] = useState('');
  const [wizDomain, setWizDomain] = useState('');
  const [wizRuntime, setWizRuntime] = useState<
    'node' | 'php' | 'static' | 'python' | 'go' | 'rust'
  >('node');
  const [wizDns, setWizDns] = useState(true);
  const [wizMail, setWizMail] = useState(true);
  const [wizDb, setWizDb] = useState(false);
  const [wizBusy, setWizBusy] = useState(false);
  const [wizMsg, setWizMsg] = useState<string | null>(null);
  const [wizErr, setWizErr] = useState<string | null>(null);

  useEffect(() => {
    void softwareApi
      .list()
      .then((r) => setSoftware(r.items ?? []))
      .catch(() => setSoftware([]));
    void api
      .requestRaw<{
        items: Array<{
          id: string;
          label: string;
          active: string;
          activeLabel: string;
          href?: string;
        }>;
      }>('/api/v1/system/services/matrix')
      .then((r) => setSvcMatrix(r.items ?? []))
      .catch(() => setSvcMatrix([]));
  }, []);

  async function onWizard(e: FormEvent) {
    e.preventDefault();
    setWizBusy(true);
    setWizErr(null);
    setWizMsg(null);
    try {
      const r = await api.requestRaw<{
        ok: boolean;
        projectId?: string;
        notes?: string[];
        steps?: Array<{ step: string; ok: boolean; notes?: string[] }>;
      }>('/api/v1/wizard/create', {
        method: 'POST',
        body: JSON.stringify({
          projectName: wizName,
          domain: wizDomain || undefined,
          runtime: wizRuntime,
          createDns: wizDns && Boolean(wizDomain),
          createMail: wizMail && Boolean(wizDomain),
          createDb: wizDb,
        }),
      });
      setWizMsg(
        (r.notes ?? []).join('；') ||
          (r.ok ? '建立完成' : '部分失敗'),
      );
      if (r.projectId) {
        setTimeout(() => navigate(`/projects/${r.projectId}`), 800);
      }
    } catch (err) {
      setWizErr(err instanceof Error ? err.message : '建立失敗');
    } finally {
      setWizBusy(false);
    }
  }

  const running = projects.filter((p) => p.processStatus === 'running').length;
  const executeEnabled = health?.executeEnabled;

  const [tab, setTab] = usePageTab(DASH_TABS, 'overview');

  const tiles = useMemo(() => {
    return allFeatureTiles()
      .filter((i) => !['systemIndex'].includes(i.key))
      .slice(0, 16)
      .map((i) => ({
        ...i,
        title: t(`nav.${i.key}`, { defaultValue: i.key }),
        description: t(`features.desc.${i.key}`, { defaultValue: '' }),
        badge: badgeForKey(i.key, software, {
          executeEnabled,
          productionReady: readiness?.productionReady,
        }),
      }));
  }, [t, software, executeEnabled, readiness?.productionReady]);

  const notifBadge =
    notifications.length +
    (applyAudit && (applyAudit.summary.bad > 0 || applyAudit.summary.warn > 0)
      ? applyAudit.findings.length
      : 0);

  return (
    <div className="stack stack--lg">
      <PageHeader
        title={t('dashboard.title')}
        subtitle={`${t('dashboard.welcome')}${user ? ` — ${user.username}` : ''}`}
      />

      {error ? <Alert variant="error">{error}</Alert> : null}
      {wizErr ? <Alert variant="error">{wizErr}</Alert> : null}
      {wizMsg ? <Alert variant="ok">{wizMsg}</Alert> : null}
      {loading ? <LoadingBlock /> : null}

      <OpsHero
        eyebrow="Dashboard"
        title={t('dashboard.title')}
        pill={
          health?.status === 'ok'
            ? '健康'
            : readiness?.productionReady
              ? '可生產'
              : '需檢查'
        }
        pillTone={
          health?.status === 'ok'
            ? 'ok'
            : notifCounts.critical > 0
              ? 'danger'
              : 'warn'
        }
        tone={
          notifCounts.critical > 0
            ? 'danger'
            : executeEnabled === false
              ? 'warn'
              : 'ok'
        }
        hint={`${t('dashboard.welcome')}${user ? ` — ${user.username}` : ''}`}
        cta={
          <>
            <Link to="/system/readiness" className="btn btn--primary btn--md">
              就緒探測
            </Link>
            <Link to="/projects" className="btn btn--secondary btn--md">
              專案
            </Link>
            <Link to="/services" className="btn btn--ghost btn--md">
              服務
            </Link>
          </>
        }
        stats={[
          { label: t('nav.projects'), value: projects.length },
          {
            label: t('projects.statRunning'),
            value: (
              <Badge tone={running > 0 ? 'ok' : 'neutral'}>{running}</Badge>
            ),
          },
          { label: '備份', value: backups },
          {
            label: '通知',
            value: (
              <Badge
                tone={
                  notifCounts.critical > 0
                    ? 'danger'
                    : notifCounts.warn > 0
                      ? 'warn'
                      : 'ok'
                }
              >
                {notifications.length}
              </Badge>
            ),
          },
        ]}
        rail={
          <>
            <li>
              <span className="ops-rail__k">Health</span>
              <Badge tone={health?.status === 'ok' ? 'ok' : 'warn'}>
                {health?.status ?? '—'}
              </Badge>
            </li>
            <li>
              <span className="ops-rail__k">EXECUTE</span>
              <Badge tone={executeEnabled === true ? 'ok' : 'warn'}>
                {executeEnabled === true ? '開' : executeEnabled === false ? '關' : '—'}
              </Badge>
            </li>
            <li>
              <span className="ops-rail__k">憑證到期</span>
              <Badge tone={(expiringCerts?.length ?? 0) > 0 ? 'warn' : 'ok'}>
                {expiringCerts?.length ?? 0}
              </Badge>
            </li>
          </>
        }
      />

      <Tabs
        tabs={[
          { id: 'overview', label: '概覽' },
          { id: 'wizard', label: '一鍵建立' },
          {
            id: 'notifications',
            label: '通知',
            badge: notifBadge || undefined,
          },
          { id: 'features', label: '功能入口' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
            {svcMatrix.length > 0 ? (
              <Card>
                <CardSection title="服務健康" description="systemctl 實時探測">
                  <div className="chip-row">
                    {svcMatrix.slice(0, 12).map((s) => (
                      <Link
                        key={s.id}
                        to={s.href || '/services'}
                        className="badge-link"
                        title={s.active}
                      >
                        <Badge
                          tone={
                            s.active === 'active'
                              ? 'ok'
                              : s.active === 'failed'
                                ? 'danger'
                                : 'warn'
                          }
                        >
                          {s.label}: {s.activeLabel}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                  <p className="muted u-text-sm u-mt-4">
                    <Link to="/services">完整服務矩陣</Link>
                  </p>
                </CardSection>
              </Card>
            ) : null}

            {readiness ? (
              <Alert variant={readiness.productionReady ? 'ok' : 'info'}>
                <strong>就緒檢查：</strong>
                {readiness.productionReady ? '可作生產' : '尚未完全就緒'} · 模式 {readiness.mode} ·
                分數 {readiness.score.ready}/{readiness.score.total}
                {readiness.summary[1] ? ` — ${readiness.summary[1]}` : ''}
                {' · '}
                <Link to="/system/readiness">詳情</Link>
              </Alert>
            ) : null}

            {expiringCerts && expiringCerts.length > 0 ? (
              <Alert variant={expiringCerts.some((c) => c.days <= 7) ? 'error' : 'info'}>
                <strong>憑證到期：</strong>
                {expiringCerts
                  .slice(0, 4)
                  .map((c) => `${c.domain}（${c.days < 0 ? '已過期' : `${c.days} 日`}）`)
                  .join(' · ')}
                {' · '}
                <Link to="/ssl">SSL</Link>
              </Alert>
            ) : null}

            {(() => {
              const memPct =
                metrics?.memory && typeof metrics.memory === 'object'
                  ? Math.round(
                      ((metrics.memory as { usedRatio: number }).usedRatio || 0) * 100,
                    )
                  : null;
              const loadStr = Array.isArray(metrics?.loadavg)
                ? (metrics!.loadavg as number[])
                    .map((n) => (typeof n === 'number' ? n.toFixed(2) : String(n)))
                    .join(' · ')
                : String(metrics?.loadavg ?? '—');
              const healthOk = health?.status === 'ok';

              return (
                <div className="dash-kpi-grid" role="list">
                  {/* Health */}
                  <article className="dash-kpi" role="listitem">
                    <header className="dash-kpi__head">
                      <span className="dash-kpi__label">{t('dashboard.health')}</span>
                      <Badge tone={healthOk ? 'ok' : health ? 'warn' : 'neutral'}>
                        {health?.status ?? '—'}
                      </Badge>
                    </header>
                    <div className="dash-kpi__body">
                      <p className="dash-kpi__value">
                        {healthOk ? '正常' : health ? String(health.status) : '—'}
                      </p>
                      <p className="dash-kpi__meta">
                        {health
                          ? `${health.product} · v${health.version}`
                          : '尚未取得健康狀態'}
                      </p>
                      <dl className="dash-kpi__facts">
                        <div>
                          <dt>{t('dashboard.protection')}</dt>
                          <dd>{health?.protectionMode ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>系統變更</dt>
                          <dd>
                            {executeEnabled === true
                              ? '已開'
                              : executeEnabled === false
                                ? '未開'
                                : '—'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <footer className="dash-kpi__foot">
                      <Link to="/system/readiness" className="dash-kpi__link">
                        就緒檢查 →
                      </Link>
                    </footer>
                  </article>

                  {/* Host metrics */}
                  <article className="dash-kpi" role="listitem">
                    <header className="dash-kpi__head">
                      <span className="dash-kpi__label">主機指標</span>
                      <span className="dash-kpi__hint">
                        {metrics?.cpuCount != null ? `${String(metrics.cpuCount)} CPU` : '—'}
                      </span>
                    </header>
                    <div className="dash-kpi__body">
                      <p className="dash-kpi__value dash-kpi__value--sm">{loadStr}</p>
                      <p className="dash-kpi__meta">Load average（1 · 5 · 15 分）</p>
                      {memPct != null ? (
                        <div className="dash-kpi__meter">
                          <div className="dash-kpi__meter-row">
                            <span>記憶體</span>
                            <strong>{memPct}%</strong>
                          </div>
                          <div
                            className="dash-kpi__meter-track"
                            role="progressbar"
                            aria-valuenow={memPct}
                            aria-valuemin={0}
                            aria-valuemax={100}
                          >
                            <div
                              className={`dash-kpi__meter-fill${
                                memPct >= 90
                                  ? ' is-danger'
                                  : memPct >= 75
                                    ? ' is-warn'
                                    : ''
                              }`}
                              style={{ width: `${Math.min(100, memPct)}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="dash-kpi__meta">記憶體 —</p>
                      )}
                    </div>
                    <footer className="dash-kpi__foot">
                      <Link to="/metrics" className="dash-kpi__link">
                        詳細指標 →
                      </Link>
                    </footer>
                  </article>

                  {/* Projects */}
                  <article className="dash-kpi" role="listitem">
                    <header className="dash-kpi__head">
                      <span className="dash-kpi__label">{t('nav.projects')}</span>
                      <span className="dash-kpi__hint">
                        運行 {running}/{projects.length}
                      </span>
                    </header>
                    <div className="dash-kpi__body">
                      {projects.length === 0 ? (
                        <div className="dash-kpi__empty">
                          <p className="dash-kpi__value dash-kpi__value--sm">0</p>
                          <p className="dash-kpi__meta">尚未有專案</p>
                        </div>
                      ) : (
                        <ul className="dash-kpi__list">
                          {projects.slice(0, 4).map((p) => (
                            <li key={p.id}>
                              <Link to={`/projects/${p.id}`} className="dash-kpi__list-name">
                                {p.name}
                              </Link>
                              <Badge
                                tone={p.processStatus === 'running' ? 'ok' : 'neutral'}
                              >
                                {p.processStatus ?? p.status ?? '—'}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <footer className="dash-kpi__foot">
                      {projects.length === 0 ? (
                        <button
                          type="button"
                          className="dash-kpi__link btn--link"
                          onClick={() => setTab('wizard')}
                        >
                          一鍵建立 →
                        </button>
                      ) : (
                        <Link to="/projects" className="dash-kpi__link">
                          全部專案 →
                        </Link>
                      )}
                    </footer>
                  </article>

                  {/* Audit */}
                  <article className="dash-kpi" role="listitem">
                    <header className="dash-kpi__head">
                      <span className="dash-kpi__label">{t('dashboard.audit')}</span>
                      <span className="dash-kpi__hint">
                        {audit.length > 0 ? `最近 ${Math.min(5, audit.length)}` : '—'}
                      </span>
                    </header>
                    <div className="dash-kpi__body">
                      {audit.length === 0 ? (
                        <div className="dash-kpi__empty">
                          <p className="dash-kpi__meta">
                            {t('dashboard.needLogin', { defaultValue: '尚無審計紀錄' })}
                          </p>
                        </div>
                      ) : (
                        <ul className="dash-kpi__audit">
                          {audit.slice(0, 5).map((a) => (
                            <li key={String(a.id)}>
                              <code className="inline">{String(a.action)}</code>
                              <time className="dash-kpi__time">
                                {String(a.created_at).replace('T', ' ').slice(5, 19)}
                              </time>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <footer className="dash-kpi__foot">
                      <span className="dash-kpi__hint">
                        運行中{' '}
                        {String((summary?.projects as { running?: number })?.running ?? running)}
                      </span>
                      <Link to="/security" className="dash-kpi__link">
                        安全 →
                      </Link>
                    </footer>
                  </article>
                </div>
              );
            })()}
          </div>
        ) : null}

        {tab === 'wizard' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="一鍵建立"
                description="建立專案，並可選一併登記 DNS／郵件／資料庫草稿（各項需再到對應頁套用）"
              >
                <form onSubmit={(e) => void onWizard(e)}>
                  <FormLayout columns={2}>
                    <Field
                      label="專案名稱"
                      htmlFor="wiz-name"
                      flush
                      required
                      hint="控制台顯示名稱；會產生對應目錄"
                    >
                      <input
                        id="wiz-name"
                        value={wizName}
                        onChange={(e) => setWizName(e.target.value)}
                        required
                        placeholder="my-app"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label="域名（可留空）"
                      htmlFor="wiz-dom"
                      flush
                      hint="填寫後才可勾選 DNS 與郵件"
                    >
                      <input
                        id="wiz-dom"
                        value={wizDomain}
                        onChange={(e) => setWizDomain(e.target.value)}
                        placeholder="app.example.com"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label="執行環境"
                      htmlFor="wiz-rt"
                      flush
                      required
                      hint="決定預設 runtime 版本與部署方式"
                    >
                      <SegRadio
                        name="wiz-rt"
                        aria-label="執行環境"
                        value={wizRuntime}
                        onChange={(v) => setWizRuntime(v as typeof wizRuntime)}
                        options={[
                          { value: 'node', label: 'Node' },
                          { value: 'php', label: 'PHP' },
                          { value: 'python', label: 'Python' },
                          { value: 'go', label: 'Go' },
                          { value: 'rust', label: 'Rust' },
                          { value: 'static', label: '靜態' },
                        ]}
                      />
                    </Field>
                  </FormLayout>
                  <div className="form-check-row u-mt-4">
                    <CheckboxField
                      id="wiz-dns"
                      label="一併建立 DNS 區域"
                      description="需填寫域名；僅登記，需到 DNS 頁寫入區域檔"
                      checked={wizDns}
                      onChange={setWizDns}
                      disabled={!wizDomain}
                    />
                    <CheckboxField
                      id="wiz-mail"
                      label="一併登記郵件域名"
                      description="需填寫域名；軟件安裝與 DNS 在郵件詳情頁完成"
                      checked={wizMail}
                      onChange={setWizMail}
                      disabled={!wizDomain}
                    />
                    <CheckboxField
                      id="wiz-db"
                      label="一併建立 MySQL 資料庫草稿"
                      description="控制面登記；需到 SQL 引擎頁套用到系統"
                      checked={wizDb}
                      onChange={setWizDb}
                    />
                  </div>
                  <FormHint>
                    一鍵建立不會自動對外上線。DNS、郵件、資料庫與 SSL 請到各功能頁確認並套用。
                  </FormHint>
                  <FormActions>
                    <Button type="submit" variant="primary" size="md" loading={wizBusy}>
                      一鍵建立
                    </Button>
                  </FormActions>
                </form>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'notifications' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={`通知中心（${notifications.length}）`}
                description={`嚴重 ${notifCounts.critical} · 警告 ${notifCounts.warn} · 資訊 ${notifCounts.info}`}
              >
                {notifications.length === 0 ? (
                  <EmptyState title="暫無通知" description="系統告警與待辦會顯示於此" />
                ) : (
                  <ul className="list-plain list-spaced">
                    {notifications.slice(0, 20).map((n) => (
                      <li key={n.id}>
                        <Badge
                          tone={
                            n.level === 'critical'
                              ? 'danger'
                              : n.level === 'warn'
                                ? 'warn'
                                : 'info'
                          }
                        >
                          {n.level}
                        </Badge>{' '}
                        <strong>{n.title}</strong>
                        <span className="muted u-text-sm"> — {n.body}</span>
                        {n.href ? (
                          <>
                            {' '}
                            <Link to={n.href}>前往</Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardSection>
            </Card>
            {applyAudit && (applyAudit.summary.bad > 0 || applyAudit.summary.warn > 0) ? (
              <Card>
                <CardSection
                  title="套用狀態審計"
                  description={`ok ${applyAudit.summary.ok} · warn ${applyAudit.summary.warn} · bad ${applyAudit.summary.bad}`}
                >
                  <ul className="list-plain list-spaced">
                    {applyAudit.findings.map((f, i) => (
                      <li key={`${f.kind}-${f.name}-${i}`}>
                        <Badge tone={f.severity === 'bad' ? 'danger' : 'warn'}>{f.severity}</Badge>{' '}
                        <span className="muted u-text-sm">{f.kind}</span> <strong>{f.name}</strong>
                        {f.issue ? <span className="muted"> — {f.issue}</span> : null}
                        {f.href ? (
                          <>
                            {' '}
                            <Link to={f.href}>開啟</Link>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </CardSection>
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === 'features' ? (
          <div className="tab-panel">
            <div>
              <h2 className="section-title">
                {t('dashboard.features', { defaultValue: '功能選單' })}
              </h2>
              <p className="muted meta-block--tight">
                {t('dashboard.featuresHint', {
                  defaultValue:
                    '角標：就緒＝軟件已裝；未安裝＝需一鍵安裝；需權限＝未開系統變更。',
                })}
              </p>
            </div>
            <FeatureIconGrid items={tiles} />
          </div>
        ) : null}
      </Tabs>
    </div>
  );
}
