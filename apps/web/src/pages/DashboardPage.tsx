/**
 * Dashboard — health strip + feature tiles with capability badges.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../shared/hooks/useAuth';
import { useDashboard } from '../features/dashboard';
import { softwareApi, type SoftwareStatus } from '../features/software';
import {
  Alert,
  Badge,
  FeatureIconGrid,
  LoadingBlock,
  PageHeader,
  SummaryStrip,
  type FeatureTileBadge,
} from '../shared/components/ui';
import { allFeatureTiles } from '../shared/nav/features';

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
  const { health, audit, metrics, projects, backups, summary, readiness, error, loading } =
    useDashboard();
  const [software, setSoftware] = useState<SoftwareStatus[]>([]);

  useEffect(() => {
    void softwareApi
      .list()
      .then((r) => setSoftware(r.items ?? []))
      .catch(() => setSoftware([]));
  }, []);

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
      {loading ? <LoadingBlock /> : null}

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

      <SummaryStrip
        items={[
          { label: t('nav.projects'), value: projects.length },
          { label: t('projects.statRunning'), value: running, tone: running > 0 ? 'ok' : 'default' },
          { label: '備份', value: backups },
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
