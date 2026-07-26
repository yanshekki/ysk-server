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
  FeatureIconGrid,
  Field,
  FormGrid,
  LoadingBlock,
  PageHeader,
  SummaryStrip,
  type FeatureTileBadge,
} from '../shared/components/ui';
import { allFeatureTiles } from '../shared/nav/features';
import { api } from '../shared/services/api';

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
  const [wizRuntime, setWizRuntime] = useState<'node' | 'php' | 'static'>('node');
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

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        subtitle={`${t('dashboard.welcome')}${user ? ` — ${user.username}` : ''}`}
      />

      {error ? <Alert variant="error">{error}</Alert> : null}
      {wizErr ? <Alert variant="error">{wizErr}</Alert> : null}
      {wizMsg ? <Alert variant="ok">{wizMsg}</Alert> : null}
      {loading ? <LoadingBlock /> : null}

      <Card>
        <CardSection
          title="一鍵建立"
          description="專案 + 可選 DNS / 郵件 / DB（draft 需各頁套用）"
        >
          <form onSubmit={(e) => void onWizard(e)}>
            <FormGrid>
              <Field label="專案名稱" htmlFor="wiz-name" flush>
                <input
                  id="wiz-name"
                  value={wizName}
                  onChange={(e) => setWizName(e.target.value)}
                  required
                />
              </Field>
              <Field label="域名（可空）" htmlFor="wiz-dom" flush>
                <input
                  id="wiz-dom"
                  value={wizDomain}
                  onChange={(e) => setWizDomain(e.target.value)}
                  placeholder="app.example.com"
                />
              </Field>
              <Field label="Runtime" htmlFor="wiz-rt" flush>
                <select
                  id="wiz-rt"
                  value={wizRuntime}
                  onChange={(e) => setWizRuntime(e.target.value as typeof wizRuntime)}
                >
                  <option value="node">node</option>
                  <option value="php">php</option>
                  <option value="static">static</option>
                </select>
              </Field>
            </FormGrid>
            <div className="btn-row u-mt-3">
              <label className="field field--check">
                <input
                  type="checkbox"
                  checked={wizDns}
                  onChange={(e) => setWizDns(e.target.checked)}
                  disabled={!wizDomain}
                />
                <span>DNS zone</span>
              </label>
              <label className="field field--check">
                <input
                  type="checkbox"
                  checked={wizMail}
                  onChange={(e) => setWizMail(e.target.checked)}
                  disabled={!wizDomain}
                />
                <span>郵件域名</span>
              </label>
              <label className="field field--check">
                <input
                  type="checkbox"
                  checked={wizDb}
                  onChange={(e) => setWizDb(e.target.checked)}
                />
                <span>MySQL DB draft</span>
              </label>
              <Button type="submit" variant="primary" size="md" loading={wizBusy}>
                建立
              </Button>
            </div>
          </form>
        </CardSection>
      </Card>

      {svcMatrix.length > 0 ? (
        <Card>
          <CardSection title="服務健康" description="systemctl 實時探測">
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              {svcMatrix.slice(0, 12).map((s) => (
                <Link
                  key={s.id}
                  to={s.href || '/services'}
                  className="badge"
                  style={{ textDecoration: 'none' }}
                  title={s.active}
                >
                  <Badge
                    tone={
                      s.active === 'active' ? 'ok' : s.active === 'failed' ? 'danger' : 'warn'
                    }
                  >
                    {s.label}: {s.activeLabel}
                  </Badge>
                </Link>
              ))}
            </div>
            <p className="muted u-text-sm u-mt-2">
              <Link to="/services">完整服務矩陣</Link>
            </p>
          </CardSection>
        </Card>
      ) : null}

      {readiness ? (
        <Alert variant={readiness.productionReady ? 'ok' : 'info'}>
          <strong>就緒檢查：</strong>
          {readiness.productionReady ? '可作生產' : '尚未完全就緒'} · 模式 {readiness.mode} · 分數{' '}
          {readiness.score.ready}/{readiness.score.total}
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

      <SummaryStrip
        items={[
          { label: t('nav.projects'), value: projects.length },
          { label: t('projects.statRunning'), value: running, tone: running > 0 ? 'ok' : 'default' },
          { label: '備份', value: backups },
          {
            label: '憑證到期',
            value: expiringCerts?.length ?? 0,
            tone: (expiringCerts?.length ?? 0) > 0 ? 'warn' : 'ok',
          },
          {
            label: '通知',
            value: notifications.length,
            tone:
              notifCounts.critical > 0 ? 'danger' : notifCounts.warn > 0 ? 'warn' : 'ok',
          },
          {
            label: t('dashboard.health'),
            value: health?.status ?? '—',
            tone: health?.status === 'ok' ? 'ok' : 'default',
          },
          {
            label: '系統變更',
            value: executeEnabled === true ? '已開' : executeEnabled === false ? '未開' : '—',
            tone: executeEnabled === true ? 'ok' : executeEnabled === false ? 'warn' : 'default',
          },
        ]}
      />

      {notifications.length > 0 ? (
        <Card>
          <CardSection
            title={`通知中心（${notifications.length}）`}
            description={`嚴重 ${notifCounts.critical} · 警告 ${notifCounts.warn} · 資訊 ${notifCounts.info}`}
          >
            <ul className="list-plain list-spaced">
              {notifications.slice(0, 12).map((n) => (
                <li key={n.id}>
                  <Badge
                    tone={
                      n.level === 'critical' ? 'danger' : n.level === 'warn' ? 'warn' : 'info'
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
          </CardSection>
        </Card>
      ) : null}

      {applyAudit && (applyAudit.summary.bad > 0 || applyAudit.summary.warn > 0) ? (
        <Card>
          <CardSection
            title="Apply 誠實審計"
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

      <h2 className="section-title">{t('dashboard.features', { defaultValue: '功能選單' })}</h2>
      <p className="muted meta-block">
        {t('dashboard.featuresHint', {
          defaultValue: '角標：就緒＝軟件已裝；未安裝＝需一鍵安裝；需權限＝未開系統變更。',
        })}
      </p>
      <FeatureIconGrid items={tiles} />

      <div className="grid u-mt-4">
        <div className="card">
          <h2 className="card__title">{t('dashboard.health')}</h2>
          {health ? (
            <>
              <p className="meta-block">
                <Badge tone={health.status === 'ok' ? 'ok' : 'warn'}>{health.status}</Badge>
              </p>
              <p className="muted meta-block--tight">
                {health.product} · v{health.version}
              </p>
              <p className="meta-block--top">
                {t('dashboard.protection')}:{' '}
                <strong className="u-font-bold">{health.protectionMode}</strong>
              </p>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">主機指標</h2>
          {metrics ? (
            <>
              <p className="meta-block">
                Load:{' '}
                <strong>
                  {Array.isArray(metrics.loadavg)
                    ? (metrics.loadavg as number[])
                        .map((n) => (typeof n === 'number' ? n.toFixed(2) : String(n)))
                        .join(' · ')
                    : String(metrics.loadavg ?? '—')}
                </strong>
              </p>
              <p className="muted meta-block--tight">
                CPUs: {String(metrics.cpuCount)} · Mem used:{' '}
                {metrics.memory && typeof metrics.memory === 'object'
                  ? `${Math.round(((metrics.memory as { usedRatio: number }).usedRatio || 0) * 100)}%`
                  : '—'}
              </p>
              <p className="meta-block--top">
                <Link to="/metrics">詳細指標</Link>
              </p>
            </>
          ) : (
            <span className="muted">—</span>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">
            <Link to="/projects">{t('nav.projects')}</Link>
          </h2>
          {projects.length === 0 ? (
            <p className="muted">尚未有專案</p>
          ) : (
            <ul className="list-plain list-spaced">
              {projects.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <Link to={`/projects/${p.id}`}>
                    <strong>{p.name}</strong>
                  </Link>{' '}
                  <Badge tone={p.processStatus === 'running' ? 'ok' : 'neutral'}>
                    {p.processStatus ?? p.status ?? '—'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <h2 className="card__title">{t('dashboard.audit')}</h2>
          {audit.length === 0 ? (
            <p className="muted">{t('dashboard.needLogin')}</p>
          ) : (
            <ul className="list-plain list-spaced">
              {audit.slice(0, 5).map((a) => (
                <li key={String(a.id)}>
                  <code className="inline">{String(a.action)}</code>{' '}
                  <span className="muted u-text-sm">
                    {String(a.created_at).replace('T', ' ').slice(0, 19)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {summary ? (
            <p className="muted meta-block--top">
              運行中專案{' '}
              {String((summary.projects as { running?: number })?.running ?? 0)}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
