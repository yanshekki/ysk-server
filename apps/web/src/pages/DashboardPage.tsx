/**
 * Dashboard — health strip + feature tiles with capability badges.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../shared/hooks/useAuth';
import { useDashboard } from '../features/dashboard';
import { softwareApi, type SoftwareStatus } from '../features/software';
import {
  PageGuide,
  ActionBar,
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
  FeaturePageLayout,
  DataTable,
  PageTabs,
  type FeatureTileBadge,
  FormActions,
  FormHint,
  CheckboxField,
  SegRadio,
  buttonClassName } from '../shared/components/ui';
import { FEATURE_SECTIONS } from '../shared/nav/features';
import { api } from '../shared/services/api';
import { toast } from '../shared/stores/toast-store';
import { usePageTab } from '../shared/hooks/usePageTab';
import { bindSet, bindInput } from './bind-handlers';
import {
  defaultRuntimeInstallVersion,
  fetchRuntimeVersionChoices,
  runtimeVersionChoices } from '../features/projects/model/deploy-prefs';

const DASH_TABS = ['overview', 'wizard', 'notifications', 'features', 'about'] as const;

/** Map nav key → software feature id (for install probe) */
const KEY_TO_FEATURE: Record<string, string> = {
  nginx: 'nginx',
  ssl: 'ssl',
  dns: 'dns',
  ftp: 'ftp',
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
  email: 'email' };

export function badgeForKey(
  key: string,
  software: SoftwareStatus[],
  opts: { executeEnabled?: boolean; productionReady?: boolean },
  t: (k: string) => string,
): FeatureTileBadge | undefined {
  const feat = KEY_TO_FEATURE[key];
  if (feat) {
    const related = software.filter((s) => s.features?.includes(feat) || s.id === feat);
    if (related.length === 0) {
      // unknown software entry — neutral control-plane
      return { label: t('dashboard.badge.panel'), tone: 'info' };
    }
    const allInstalled = related.every((s) => s.installed);
    const anyActive = related.some((s) => s.active === 'active');
    if (!allInstalled) return { label: t('dashboard.badge.notInstalled'), tone: 'warn' };
    if (anyActive || allInstalled) return { label: t('dashboard.badge.ready'), tone: 'ok' };
    return { label: t('dashboard.badge.installed'), tone: 'info' };
  }

  // Control-plane features
  if (key === 'readiness') {
    return opts.productionReady
      ? { label: t('dashboard.badge.prodReady'), tone: 'ok' }
      : { label: t('dashboard.badge.check'), tone: 'warn' };
  }
  if (['security', 'ai', 'agents', 'updates', 'metrics', 'services', 'cron', 'backups', 'projects', 'files', 'publicFiles', 'systemd'].includes(key)) {
    if (opts.executeEnabled === false) return { label: t('dashboard.badge.needPerm'), tone: 'warn' };
    return { label: t('dashboard.badge.ready'), tone: 'ok' };
  }
  return { label: t('dashboard.badge.panel'), tone: 'neutral' };
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
    loading } = useDashboard();

  const [software, setSoftware] = useState<SoftwareStatus[]>([]);
  const [svcMatrix, setSvcMatrix] = useState<
    Array<{ id: string; label: string; active: string; activeLabel: string; href?: string }>
  >([]);
  const [wizName, setWizName] = useState('');
  const [wizDomain, setWizDomain] = useState('');
  const [wizRuntime, setWizRuntime] = useState<
    'node' | 'php' | 'static' | 'python' | 'go' | 'rust' | 'java' | 'kotlin' | 'bun'
  >('node');
  const [wizRuntimeVersion, setWizRuntimeVersion] = useState(() =>
    defaultRuntimeInstallVersion('node'),
  );
  const [wizVersionChoices, setWizVersionChoices] = useState<string[]>([]);
  const [wizDns, setWizDns] = useState(true);
  const [wizMail, setWizMail] = useState(true);
  const [wizDb, setWizDb] = useState(false);
  const [wizServerIp, setWizServerIp] = useState('');
  const [wizServerIpv6, setWizServerIpv6] = useState('');
  const [wizBusy, setWizBusy] = useState(false);
  const setWizMsg = useCallback((text: string | null) => {
    if (text) toast.ok(text);
  }, []);
  const setWizErr = useCallback((text: string | null) => {
    if (text) toast.error(text);
  }, []);

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
          runtimeVersion:
            wizRuntime !== 'static' && wizRuntimeVersion
              ? wizRuntimeVersion
              : undefined,
          serverIp: wizServerIp || undefined,
          serverIpv6: wizServerIpv6.trim() || undefined,
          createDns: wizDns && Boolean(wizDomain),
          createMail: wizMail && Boolean(wizDomain),
          createDb: wizDb }) });
      setWizMsg(
        (r.notes ?? []).join('；') ||
          (r.ok ? t('dashboard.wizardOk') : t('dashboard.wizardPartial')),
      );
      if (r.projectId) {
        setTimeout(() => navigate(`/projects/${r.projectId}`), 800);
      }
    } catch (err) {
      setWizErr(err instanceof Error ? err.message : t('common.createFailed'));
    } finally {
      setWizBusy(false);
    }
  }

  const running = projects.filter((p) => p.processStatus === 'running').length;
  const executeEnabled = health?.executeEnabled;

  const [tab, setTab] = usePageTab(DASH_TABS, 'overview');

  useEffect(() => {
    if (tab !== 'wizard') return;
    let cancelled = false;
    void fetchRuntimeVersionChoices(wizRuntime).then((r) => {
      if (cancelled) return;
      const choices = r.choices.length ? r.choices : runtimeVersionChoices(wizRuntime);
      setWizVersionChoices(choices);
      setWizRuntimeVersion((prev) =>
        choices.includes(prev) ? prev : r.latest || choices[0] || prev,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [tab, wizRuntime]);

  const featureGroups = useMemo(() => {
    return FEATURE_SECTIONS.filter((s) => s.sectionKey !== 'overview').map((s) => ({
      sectionKey: s.sectionKey,
      title: t(`nav.sections.${s.sectionKey}`, { defaultValue: s.sectionKey }),
      items: s.items
        .filter((i) => !['systemIndex'].includes(i.key) && i.to !== '/')
        .map((i) => ({
          ...i,
          title: t(`nav.${i.key}`, { defaultValue: i.key }),
          description: t(`features.desc.${i.key}`, { defaultValue: '' }),
          badge: badgeForKey(i.key, software, {
            executeEnabled,
            productionReady: readiness?.productionReady }, t) })),
    })).filter((g) => g.items.length > 0);
  }, [t, software, executeEnabled, readiness?.productionReady]);

  const notifBadge = notifications.length;
  const [notifQ, setNotifQ] = useState('');
  const [notifLevel, setNotifLevel] = useState<'all' | 'critical' | 'warn' | 'info'>('all');
  const [dismissedNotifs, setDismissedNotifs] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('ysk.notif.dismissed');
      const arr = raw ? (JSON.parse(raw) as unknown) : [];
      return Array.isArray(arr) ? arr.map(String) : [];
    } catch {
      return [];
    }
  });
  const visibleNotifs = useMemo(() => {
    const dismissed = new Set(dismissedNotifs);
    const q = notifQ.trim().toLowerCase();
    return notifications.filter((n) => {
      if (dismissed.has(n.id)) return false;
      if (notifLevel !== 'all' && n.level !== notifLevel) return false;
      if (!q) return true;
      return [n.title, n.body, n.source].join('\n').toLowerCase().includes(q);
    });
  }, [notifications, dismissedNotifs, notifQ, notifLevel]);
  const dismissNotif = useCallback((id: string) => {
    setDismissedNotifs((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      try {
        localStorage.setItem('ysk.notif.dismissed', JSON.stringify(next.slice(-200)));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const svcMatrixOrdered = useMemo(() => {
    const rank = (s: string) => (s === 'failed' ? 0 : s === 'active' ? 2 : 1);
    return [...svcMatrix].sort((a, b) => rank(a.active) - rank(b.active));
  }, [svcMatrix]);

  return (
    <FeaturePageLayout
      title={t('nav.dashboard')}
      status={{
        pill: {
          label:
            health?.status === 'ok'
              ? t('dashboard.status.healthy')
              : readiness?.productionReady
                ? t('dashboard.status.prodReady')
                : t('dashboard.status.needsCheck'),
          tone:
            health?.status === 'ok'
              ? 'ok'
              : notifCounts.critical > 0
                ? 'danger'
                : 'warn' },
        items: [
          { label: t('nav.projects'), value: projects.length },
          {
            label: t('projects.statRunning'),
            value: running,
            tone: running > 0 ? 'ok' : 'neutral' },
          { label: t('dashboard.stat.backups'), value: backups },
          {
            label: t('dashboard.stat.notifications'),
            value: notifications.length,
            tone:
              notifCounts.critical > 0
                ? 'danger'
                : notifCounts.warn > 0
                  ? 'warn'
                  : 'ok' },
          {
            label: t('dashboard.executeLabel', { defaultValue: 'EXECUTE' }),
            value:
              executeEnabled === true ? t('common.on') : executeEnabled === false ? t('common.off') : t('common.noneSelectedShort'),
            tone: executeEnabled === true ? 'ok' : 'warn' },
          {
            label: t('dashboard.stat.certExpiry'),
            value: expiringCerts?.length ?? 0,
            tone: (expiringCerts?.length ?? 0) > 0 ? 'warn' : 'ok' },
        ] }}
      actions={<ActionBar>
          <Link to="/projects" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('nav.projects')}
          </Link>
          <Link to="/services" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('nav.services')}
          </Link>
          <Link to="/system/readiness" className={buttonClassName({ variant: 'primary', size: 'sm' })}>
            {t('nav.readiness')}
          </Link>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {loading ? <LoadingBlock /> : null}
      {(() => {
        const urgent = notifications.filter(
          (n) => n.level === 'critical' || n.level === 'warn',
        );
        if (!urgent.length) return null;
        const first = urgent[0]!;
        return (
          <Alert variant={notifCounts.critical > 0 ? 'error' : 'warn'}>
            <strong>
              {t('dashboard.barTitle', { count: urgent.length })}
            </strong>
            {' · '}
            {first.title}
            {first.href ? (
              <>
                {' · '}
                <Link to={first.href}>{t('dashboard.go')}</Link>
              </>
            ) : null}
            {' · '}
            <Link to="/?tab=notifications">{t('dashboard.notifCenter')}</Link>
          </Alert>
        );
      })()}

      <PageTabs
        tabs={[
          { id: 'overview', label: t('dashboard.tabs.overview') },
          { id: 'wizard', label: t('dashboard.tabs.wizard') },
          {
            id: 'notifications',
            label: t('dashboard.tabs.notifications'),
            badge: notifBadge || undefined },
          { id: 'features', label: t('dashboard.tabs.features') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
            {svcMatrix.length > 0 ? (
              <Card>
                <CardSection title={t('dashboard.serviceHealth')} description={t('dashboard.serviceHealthDesc')}>
                  <div className="chip-row">
                    {svcMatrixOrdered.slice(0, 12).map((s) => (
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
                          {s.active === 'failed' ? ` · ${t('dashboard.goFix')}` : ''}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                  <p className="muted u-text-sm u-mt-4">
                    <Link to="/services">{t('dashboard.fullServiceMatrix')}</Link>
                  </p>
                </CardSection>
              </Card>
            ) : null}

            {readiness?.score ? (
              <Alert variant={readiness.productionReady ? 'ok' : 'info'}>
                <strong>{t('dashboard.readinessCheck')}</strong>
                {readiness.productionReady ? t('dashboard.prodOk') : t('dashboard.notFullyReady')}
                {' · '}
                {t('dashboard.modeScore', {
                  mode: t(`dashboard.mode.${readiness.mode ?? 'degraded'}`, {
                    defaultValue:
                      readiness.mode === 'production_capable'
                        ? t('dashboard.mode.production_capable')
                        : t('dashboard.mode.degraded') }),
                  ready: readiness.score.ready,
                  total: readiness.score.total })}
                {' · '}
                <Link to="/system/readiness">{t('dashboard.details')}</Link>
              </Alert>
            ) : null}

            {expiringCerts && expiringCerts.length > 0 ? (
              <Alert variant={expiringCerts.some((c) => c.days <= 7) ? 'error' : 'info'}>
                <strong>{t('dashboard.certExpiryTitle')}</strong>
                {expiringCerts
                  .slice(0, 4)
                  .map((c) =>
                    `${c.domain}（${c.days < 0 ? t('dashboard.certExpired') : t('dashboard.certDays', { days: c.days })}）`,
                  )
                  .join(' · ')}
                {' · '}
                <Link to="/ssl">SSL</Link>
              </Alert>
            ) : null}

            {/* Security strip — notifications + apply honesty + shortcuts */}
            <Card>
              <CardSection
                title={t('dashboard.securityStrip')}
                description={t('dashboard.securityStripDesc')}
              >
                <div className="chip-row u-mb-3">
                  <Badge
                    tone={
                      notifCounts.critical > 0
                        ? 'danger'
                        : notifCounts.warn > 0
                          ? 'warn'
                          : 'ok'
                    }
                  >
                    {t('dashboard.notifCount', { count: notifications.length })}
                    {notifCounts.critical > 0
                      ? t('dashboard.criticalCount', { count: notifCounts.critical })
                      : notifCounts.warn > 0
                        ? t('dashboard.warnCount', { count: notifCounts.warn })
                        : ''}
                  </Badge>
                  {applyAudit ? (
                    <Badge
                      tone={
                        applyAudit.summary.bad > 0
                          ? 'danger'
                          : applyAudit.summary.warn > 0
                            ? 'warn'
                            : 'ok'
                      }
                    >
                      {t('dashboard.applyAuditBadge', {
                        ok: applyAudit.summary.ok,
                        warn: applyAudit.summary.warn,
                        bad: applyAudit.summary.bad })}
                    </Badge>
                  ) : null}
                  <Badge tone={executeEnabled === true ? 'ok' : 'warn'}>
                    {t('dashboard.executeBadge', { state: executeEnabled === true ? t('common.on') : t('common.off') })}
                  </Badge>
                </div>
                {notifications.length > 0 ? (
                  <ul className="list-plain list-spaced u-mb-3">
                    {notifications
                      .filter(
                        (n) => n.level === 'critical' || n.level === 'warn',
                      )
                      .slice(0, 5)
                      .map((n) => (
                        <li key={n.id}>
                          <Badge
                            tone={n.level === 'critical' ? 'danger' : 'warn'}
                          >
                            {n.level === 'critical'
                              ? t('dashboard.levelCritical')
                              : t('dashboard.levelWarn')}
                          </Badge>{' '}
                          <strong>{n.title}</strong>
                          <span className="muted u-text-sm"> — {n.body}</span>
                          {n.href ? (
                            <>
                              {' '}
                              <Link to={n.href}>{t('dashboard.go')}</Link>
                            </>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="muted u-text-sm u-mb-3">
                    {t('dashboard.noCriticalWarn')}
                  </p>
                )}
                {applyAudit &&
                (applyAudit.summary.bad > 0 || applyAudit.summary.warn > 0) ? (
                  <ul className="list-plain list-spaced u-mb-3">
                    {applyAudit.findings
                      .filter((f) => f.severity !== 'ok')
                      .slice(0, 4)
                      .map((f, i) => (
                        <li key={`${f.kind}-${f.name}-${i}`}>
                          <Badge
                            tone={f.severity === 'bad' ? 'danger' : 'warn'}
                          >
                            {f.severity}
                          </Badge>{' '}
                          <span className="muted u-text-sm">{f.kind}</span>{' '}
                          <strong>{f.name}</strong>
                          {f.issue ? (
                            <span className="muted"> — {f.issue}</span>
                          ) : null}
                          {f.href ? (
                            <>
                              {' '}
                              <Link to={f.href}>{t('dashboard.open')}</Link>
                            </>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                ) : null}
                <ActionBar>
                  <Link to="/?tab=notifications" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
                    {t('dashboard.notifCenter')}
                  </Link>
                  <Link to="/protection" className={buttonClassName({ variant: 'primary', size: 'sm' })}>
                    {t('nav.protection')}
                  </Link>
                  <Link to="/security" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
                    {t('nav.security')}
                  </Link>
                </ActionBar>
              </CardSection>
            </Card>

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
                        {healthOk ? t('common.normal') : health ? String(health.status) : t('common.noneSelectedShort')}
                      </p>
                      <p className="dash-kpi__meta">
                        {health
                          ? `${health.product} · v${health.version}`
                          : t('dashboard.noHealthYet')}
                      </p>
                      <dl className="dash-kpi__facts">
                        <div>
                          <dt>{t('dashboard.protection')}</dt>
                          <dd>{health?.protectionMode ?? '—'}</dd>
                        </div>
                        <div>
                          <dt>{t('dashboard.sysChange')}</dt>
                          <dd>
                            {executeEnabled === true
                              ? t('dashboard.opened')
                              : executeEnabled === false
                                ? t('dashboard.closed')
                                : t('common.noneSelectedShort')}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <footer className="dash-kpi__foot">
                      <Link to="/system/readiness" className="dash-kpi__link">
                        {t('dashboard.readinessLink')}
                      </Link>
                    </footer>
                  </article>

                  {/* Host metrics */}
                  <article className="dash-kpi" role="listitem">
                    <header className="dash-kpi__head">
                      <span className="dash-kpi__label">{t('dashboard.hostMetrics')}</span>
                      <span className="dash-kpi__hint">
                        {metrics?.cpuCount != null ? `${String(metrics.cpuCount)} CPU` : '—'}
                      </span>
                    </header>
                    <div className="dash-kpi__body">
                      <p className="dash-kpi__value dash-kpi__value--sm">{loadStr}</p>
                      <p className="dash-kpi__meta">{t('dashboard.loadAvg')}</p>
                      {memPct != null ? (
                        <div className="dash-kpi__meter">
                          <div className="dash-kpi__meter-row">
                            <span>{t('common.memory')}</span>
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
                              } u-meter-fill`} style={{ ["--meter-pct" as string]: `${Math.min(100, memPct)}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <p className="dash-kpi__meta">{t('dashboard.memoryDash')}</p>
                      )}
                    </div>
                    <footer className="dash-kpi__foot">
                      <Link to="/metrics" className="dash-kpi__link">
                        {t('dashboard.metricsLink')}
                      </Link>
                    </footer>
                  </article>

                  {/* Projects */}
                  <article className="dash-kpi" role="listitem">
                    <header className="dash-kpi__head">
                      <span className="dash-kpi__label">{t('nav.projects')}</span>
                      <span className="dash-kpi__hint">
                        {t('dashboard.runningOf', { running, total: projects.length })}
                      </span>
                    </header>
                    <div className="dash-kpi__body">
                      {projects.length === 0 ? (
                        <div className="dash-kpi__empty">
                          <p className="dash-kpi__value dash-kpi__value--sm">0</p>
                          <p className="dash-kpi__meta">{t('dashboard.noProjects')}</p>
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
                          onClick={bindSet(setTab, 'wizard')}
                        >
                          {t('dashboard.wizardLink')}
                        </button>
                      ) : (
                        <Link to="/projects" className="dash-kpi__link">
                          {t('dashboard.allProjects')}
                        </Link>
                      )}
                    </footer>
                  </article>

                  {/* Audit */}
                  <article className="dash-kpi" role="listitem">
                    <header className="dash-kpi__head">
                      <span className="dash-kpi__label">{t('dashboard.audit')}</span>
                      <span className="dash-kpi__hint">
                        {audit.length > 0 ? t('dashboard.recentN', { n: Math.min(5, audit.length) }) : t('common.noneSelectedShort')}
                      </span>
                    </header>
                    <div className="dash-kpi__body">
                      {audit.length === 0 ? (
                        <div className="dash-kpi__empty">
                          <p className="dash-kpi__meta">
                            {t('dashboard.needLogin')}
                          </p>
                        </div>
                      ) : (
                        <ul className="dash-kpi__audit">
                          {audit.slice(0, 5).map((a) => {
                            const action = String(a.action ?? '');
                            const actionKey = `audit.actions.${action}`;
                            const actionLabel = t(actionKey, {
                              defaultValue: action });
                            return (
                              <li key={String(a.id)}>
                                <span className="inline" title={action}>
                                  {actionLabel === actionKey ? action : actionLabel}
                                </span>
                                <time className="dash-kpi__time">
                                  {String(a.created_at).replace('T', ' ').slice(5, 19)}
                                </time>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <footer className="dash-kpi__foot">
                      <span className="dash-kpi__hint">
                        {t('dashboard.runningCount', {
                          n: String((summary?.projects as { running?: number })?.running ?? running) })}
                      </span>
                      <Link to="/security" className="dash-kpi__link">
                        {t('dashboard.securityLink')}
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
                title={t('dashboard.wizardTitle')}
                description={t('dashboard.wizardDesc')}
              >
                <form onSubmit={(e) => void onWizard(e)}>
                  <FormLayout columns={2}>
                    <Field
                      label={t('dashboard.projectName')}
                      htmlFor="wiz-name"
                      flush
                      required
                      hint={t('dashboard.projectNameHint')}
                    >
                      <input
                        id="wiz-name"
                        value={wizName}
                        onChange={bindInput(setWizName)}
                        required
                        placeholder="my-app"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label={t('dashboard.domainOptional')}
                      htmlFor="wiz-dom"
                      flush
                      hint={t('dashboard.domainHint')}
                    >
                      <input
                        id="wiz-dom"
                        value={wizDomain}
                        onChange={bindInput(setWizDomain)}
                        placeholder="app.example.com"
                        spellCheck={false}
                      />
                    </Field>
                    <Field
                      label={t('dashboard.runtime')}
                      htmlFor="wiz-rt"
                      flush
                      required
                      hint={t('dashboard.runtimeHint')}
                    >
                      <SegRadio
                        name="wiz-rt"
                        aria-label={t('dashboard.runtime')}
                        value={wizRuntime}
                        onChange={(v) => {
                          const next = v as typeof wizRuntime;
                          setWizRuntime(next);
                          setWizVersionChoices([]);
                        }}
                        options={[
                          { value: 'node', label: 'Node' },
                          { value: 'php', label: 'PHP' },
                          { value: 'python', label: 'Python' },
                          { value: 'go', label: 'Go' },
                          { value: 'rust', label: 'Rust' },
                          { value: 'java', label: 'Java' },
                          { value: 'kotlin', label: 'Kotlin' },
                          { value: 'bun', label: 'Bun' },
                          { value: 'static', label: t('common.static') },
                        ]}
                      />
                    </Field>
                    {tab === 'wizard' && wizRuntime !== 'static' && wizVersionChoices.length === 0 ? (
                      <p className="muted u-text-sm">{t('common.loading')}</p>
                    ) : null}
                    {wizVersionChoices.length > 0 ? (
                      <Field
                        label={t('common.version')}
                        htmlFor="wiz-ver"
                        flush
                        required
                        hint={t('dashboard.versionHint')}
                      >
                        <SegRadio
                          name="wiz-ver"
                          aria-label={t('dashboard.runtimeVersion')}
                          value={
                            wizVersionChoices.includes(wizRuntimeVersion)
                              ? wizRuntimeVersion
                              : wizVersionChoices[0]!
                          }
                          onChange={setWizRuntimeVersion}
                          options={wizVersionChoices.map((v) => ({
                            value: v,
                            label:
                              wizRuntime === 'node' && (v === '20' || v === '22' || v === '24')
                                ? `${v} LTS`
                                : v }))}
                        />
                      </Field>
                    ) : null}
                  </FormLayout>
                  {(wizDns || wizMail) && wizDomain ? (
                    <FormLayout columns={2}>
                      <Field
                        label={t('dashboard.serverIpv4')}
                        htmlFor="wiz-ip"
                        flush
                        hint={t('dashboard.serverIpv4Hint')}
                      >
                        <input
                          id="wiz-ip"
                          value={wizServerIp}
                          onChange={bindInput(setWizServerIp)}
                          placeholder={t('dashboard.serverIpv4Ph')}
                          spellCheck={false}
                        />
                      </Field>
                      <Field
                        label={t('dashboard.serverIpv6')}
                        htmlFor="wiz-ip6"
                        flush
                        hint={t('dashboard.serverIpv6Hint')}
                      >
                        <input
                          id="wiz-ip6"
                          value={wizServerIpv6}
                          onChange={bindInput(setWizServerIpv6)}
                          placeholder={t('dashboard.serverIpv6Ph')}
                          spellCheck={false}
                        />
                      </Field>
                    </FormLayout>
                  ) : null}
                  <div className="form-check-row u-mt-4">
                    <CheckboxField
                      id="wiz-dns"
                      label={t('dashboard.withDns')}
                      description={t('dashboard.withDnsDesc')}
                      checked={wizDns}
                      onChange={setWizDns}
                      disabled={!wizDomain}
                    />
                    <CheckboxField
                      id="wiz-mail"
                      label={t('dashboard.withMail')}
                      description={t('dashboard.withMailDesc')}
                      checked={wizMail}
                      onChange={setWizMail}
                      disabled={!wizDomain}
                    />
                    <CheckboxField
                      id="wiz-db"
                      label={t('dashboard.withDb')}
                      description={t('dashboard.withDbDesc')}
                      checked={wizDb}
                      onChange={setWizDb}
                    />
                  </div>
                  <FormHint>
                    {t('dashboard.wizardHint')}
                  </FormHint>
                  <FormActions>
                    <Button type="submit" variant="primary" size="md" loading={wizBusy}>
                      {t('dashboard.wizardSubmit')}
                    </Button>
                  </FormActions>
                </form>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'notifications' ? (
          <div className="tab-panel">
            <DataTable
              title={t('dashboard.notifCenterTitle', { count: visibleNotifs.length })}
              description={t('dashboard.notifCenterDesc', {
                critical: notifCounts.critical,
                warn: notifCounts.warn,
                info: notifCounts.info,
              })}
              filters={
                <ActionBar>
                  <input
                    className="u-input u-w-control-xs"
                    value={notifQ}
                    onChange={(e) => setNotifQ(e.target.value)}
                    placeholder={t('dashboard.notifSearch')}
                    aria-label={t('dashboard.notifSearch')}
                  />
                  <SegRadio
                    name="dash-notif-level"
                    value={notifLevel}
                    onChange={(v) =>
                      setNotifLevel(v as 'all' | 'critical' | 'warn' | 'info')
                    }
                    options={[
                      { value: 'all', label: t('dashboard.notifAll') },
                      { value: 'critical', label: t('dashboard.levelCritical') },
                      { value: 'warn', label: t('dashboard.levelWarn') },
                      { value: 'info', label: t('dashboard.levelInfo') },
                    ]}
                  />
                </ActionBar>
              }
              columns={[
                {
                  key: 'level',
                  header: t('common.status'),
                  nowrap: true,
                  render: (n) => (
                    <Badge
                      tone={
                        n.level === 'critical'
                          ? 'danger'
                          : n.level === 'warn'
                            ? 'warn'
                            : 'info'
                      }
                    >
                      {n.level === 'critical'
                        ? t('dashboard.levelCritical')
                        : n.level === 'warn'
                          ? t('dashboard.levelWarn')
                          : t('dashboard.levelInfo')}
                    </Badge>
                  ),
                },
                {
                  key: 'title',
                  header: t('dashboard.colTitle'),
                  render: (n) => <strong>{n.title}</strong>,
                },
                {
                  key: 'body',
                  header: t('dashboard.colDetail'),
                  render: (n) => (
                    <span className="muted u-text-sm">{n.body}</span>
                  ),
                },
                {
                  key: 'source',
                  header: t('dashboard.colSource'),
                  nowrap: true,
                  render: (n) => n.source,
                },
              ]}
              rows={visibleNotifs}
              rowKey={(n) => n.id}
              rowActions={(n) => (
                <ActionBar align="end">
                  {n.href ? (
                    <Link
                      to={n.href}
                      className={buttonClassName({ variant: 'secondary', size: 'sm' })}
                    >
                      {t('dashboard.go')}
                    </Link>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissNotif(n.id)}
                  >
                    {t('dashboard.notifDismiss')}
                  </Button>
                </ActionBar>
              )}
              empty={
                <EmptyState
                  title={t('dashboard.noNotifs')}
                  description={t('dashboard.noNotifsDesc')}
                />
              }
            />
            {applyAudit && (applyAudit.summary.bad > 0 || applyAudit.summary.warn > 0) ? (
              <Card>
                <CardSection
                  title={t('dashboard.applyAuditTitle')}
                  description={t('dashboard.applyAuditDesc', {
                    ok: applyAudit.summary.ok,
                    warn: applyAudit.summary.warn,
                    bad: applyAudit.summary.bad })}
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
                            <Link to={f.href}>{t('dashboard.open')}</Link>
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
                {t('dashboard.features')}
              </h2>
              <p className="muted meta-block--tight">
{t('dashboard.featuresHint')}
              </p>
            </div>
            {featureGroups.map((g) => (
              <div key={g.sectionKey} className="u-mb-5">
                <h3 className="section-title">{g.title}</h3>
                <FeatureIconGrid items={g.items} />
              </div>
            ))}
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="dashboard" /> : null}
      </PageTabs>
    </FeaturePageLayout>
  );
}
