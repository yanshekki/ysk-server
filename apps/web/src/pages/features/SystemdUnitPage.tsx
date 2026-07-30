/**
 * Control-plane systemd unit — tabbed ops console (honest write vs enable).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  LoadingBlock,
  OpsResultPanel,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';

const SDU_TABS = ['guide', 'status', 'install', 'policy', 'about'] as const;

type SystemdStatus = {
  unit: string;
  unitPathHint: string;
  active: string;
  enabled: string;
  executeEnabled: boolean;
  isRoot: boolean;
  canInstall?: boolean;
  systemUnitExists?: boolean;
  managedUnitPath?: string | null;
  managedUnitExists?: boolean;
  show?: {
    mainPid: string | null;
    activeEnterTimestamp: string | null;
    fragmentPath: string | null;
    description: string | null;
  };
};

function enabledLabel(v?: string): string {
  if (!v) return '—';
  if (v === 'enabled') return i18n.t('common.enabled');
  if (v === 'disabled') return i18n.t('systemd.disabled');
  if (v === 'not-found') return i18n.t('common.notInstalled');
  if (v === 'static') return 'static';
  if (v === 'indirect') return 'indirect';
  return v;
}

function activeTone(active: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (active === 'active') return 'ok';
  if (active === 'activating' || active === 'reloading') return 'warn';
  if (active === 'failed') return 'danger';
  if (active === 'inactive' || active === 'not-found') return 'warn';
  return 'neutral';
}

function activeLabel(active: string): string {
  if (active === 'active') return i18n.t('common.running');
  if (active === 'inactive') return i18n.t('systemd.notRunning');
  if (active === 'failed') return i18n.t('common.failed');
  if (active === 'activating') return i18n.t('systemd.activating');
  if (active === 'not-found') return i18n.t('systemd.unitMissing');
  return active || '—';
}

function enabledTone(v?: string): 'ok' | 'warn' | 'neutral' {
  if (v === 'enabled') return 'ok';
  if (v === 'disabled' || v === 'not-found') return 'warn';
  return 'neutral';
}

export function SystemdUnitPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<SystemdStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const [tab, setTab] = usePageTab(SDU_TABS, 'guide');

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await systemApi.systemdStatus());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function doInstall(enable: boolean) {
    await run(async () => {
      try {
        const r = await systemApi.systemdInstall({ enable });
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.opFailed');
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, enable ? t('systemd.installedEnabled') : t('systemd.unitTemplateWritten'));
  }

  const active = status?.active ?? '—';
  const running = active === 'active';
  const canInstall =
    status?.canInstall ?? Boolean(status?.executeEnabled && status?.isRoot);

  const nextSteps = useMemo(() => {
    if (!status) return [];
    const steps: Array<{
      id: string;
      title: string;
      detail: string;
      href?: string;
      action?: 'template' | 'install';
      done?: boolean;
    }> = [];

    if (!status.managedUnitExists) {
      steps.push({
        id: 'template',
        title: t('systemd.writeTemplate'),
        detail: t('systemd.writeTemplateDesc'),
        action: 'template',
        done: false,
      });
    } else {
      steps.push({
        id: 'template',
        title: t('systemd.templateExists'),
        detail: status.managedUnitPath ?? 'dataDir/systemd/ysk-server.service',
        done: true,
      });
    }

    if (!status.systemUnitExists || status.enabled === 'not-found') {
      steps.push({
        id: 'install',
        title: t('systemd.installEnable'),
        detail: canInstall
          ? t('systemd.installEnableDesc')
          : t('systemd.needExecuteRoot'),
        action: 'install',
        done: false,
      });
    } else if (!running) {
      steps.push({
        id: 'start',
        title: t('systemd.serviceNotRunning'),
        detail: t('systemd.serviceNotRunningHint'),
        action: 'install',
        href: '/services',
        done: false,
      });
    } else {
      steps.push({
        id: 'running',
        title: t('systemd.controlRunning'),
        detail: status.show?.mainPid
          ? `MainPID ${status.show.mainPid}`
          : 'systemctl is-active: active',
        done: true,
      });
    }

    if (!canInstall) {
      steps.push({
        id: 'caps',
        title: t('systemd.unlockApply'),
        detail: t('systemd.startAsRoot'),
        href: '/system',
        done: false,
      });
    }

    return steps;
  }, [status, canInstall, running]);

  return (
    <FeaturePageLayout
      title={t('nav.systemd', { defaultValue: 'systemd' })}
      showCapability={false}
      status={
        status
          ? {
              pill: {
                label: activeLabel(active),
                tone: activeTone(active),
              },
              items: [
                {
                  label: t('common.status'),
                  value: activeLabel(active),
                  tone: activeTone(active),
                },
                {
                  label: t('systemd.bootEnabled'),
                  value: enabledLabel(status.enabled),
                  tone: enabledTone(status.enabled),
                },
                {
                  label: 'EXECUTE',
                  value: status.executeEnabled ? t('common.on') : t('common.off'),
                  tone: status.executeEnabled ? 'ok' : 'warn',
                },
                {
                  label: 'Root',
                  value: status.isRoot ? t('common.yes') : t('common.no'),
                  tone: status.isRoot ? 'ok' : 'warn',
                },
                {
                  label: t('systemd.canInstall'),
                  value: canInstall ? t('common.yes') : t('common.no'),
                  tone: canInstall ? 'ok' : 'warn',
                },
                {
                  label: 'Unit',
                  value: `${status.unit}.service`,
                },
              ],
            }
          : undefined
      }
      actions={
        <ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy || loading}
            onClick={() => {
              setError(null);
              setMsg(null);
              setLoading(true);
              void refresh().finally(() => setLoading(false));
            }}
          >
            {t('common.refresh')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => {
              setTab('install');
              void doInstall(false);
            }}
          >
            {t('systemd.writeTemplateOnly')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!canInstall}
            onClick={() => {
              setTab('install');
              void doInstall(true);
            }}
            title={
              canInstall
                ? t('systemd.copyEnable')
                : t('systemd.needExecuteRootShort')
            }
          >
            {t('systemd.installAndEnable')}
          </Button>
          <Link to="/services" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('system.scServices')}
          </Link>
        </ActionBar>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      {loading && !status ? (
        <LoadingBlock label={t('systemd.probing')} />
      ) : status ? (
        <div className="sdu">
          <PageTabs
            tabs={[
              { id: 'guide', label: t('systemd.suggestedSteps') },
              { id: 'status', label: t('common.status') },
              { id: 'install', label: t('common.install') },
              { id: 'policy', label: t('updates.tabPolicy') },
            
          { id: 'about', label: t('common.about') },
        ]}
            active={tab}
            onChange={setTab}
            variant="scroll"
          >
            {tab === 'guide' ? (
              <div className="tab-panel">
                <section className="sdu-panel sdu-panel--primary">
                  <header className="sdu-panel__head">
                    <div>
                      <h3 className="sdu-panel__title">{t('systemd.suggestedSteps')}</h3>
                      <p className="sdu-panel__sub">{t('systemd.stepReport')}</p>
                    </div>
                  </header>
                  <ol className="sdu-steps">
                    {nextSteps.map((s, i) => (
                      <li
                        key={s.id}
                        className={`sdu-step${s.done ? ' sdu-step--done' : ''}`}
                      >
                        <span className="sdu-step__num" aria-hidden>
                          {s.done ? '✓' : i + 1}
                        </span>
                        <div className="sdu-step__body">
                          <div className="sdu-step__title">{s.title}</div>
                          <div className="sdu-step__detail">{s.detail}</div>
                        </div>
                        <div className="sdu-step__action">
                          {s.done ? (
                            <span className="sdu-step__ok">{t('ssl.step.ok')}</span>
                          ) : s.action === 'template' ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={busy}
                              onClick={() => void doInstall(false)}
                            >
                              {t('redis.writable')}
                            </Button>
                          ) : s.action === 'install' ? (
                            <Button
                              variant="primary"
                              size="sm"
                              loading={busy}
                              disabled={!canInstall && s.id === 'install'}
                              onClick={() => void doInstall(true)}
                            >
                              {t('systemd.installEnableShort')}
                            </Button>
                          ) : s.href ? (
                            <Link to={s.href} className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
                              {t('protection.goTo')}
                            </Link>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                  {!canInstall ? (
                    <div className="sdu-callout sdu-callout--warn">
                      {t('systemd.cannotInstall')}{' '}
                      {t('systemd.cannotInstallFull')}{' '}
                      <Link to="/system">{t('updates.scHost')}</Link> /{' '}
                      <Link to="/system/readiness">{t('updates.scReadiness')}</Link>。
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}

            {tab === 'status' ? (
              <div className="tab-panel">
                <section className="sdu-panel">
                  <header className="sdu-panel__head">
                    <h3 className="sdu-panel__title">{t('systemd.probeDetail')}</h3>
                    <p className="sdu-panel__sub">{t('systemd.probeDetailSub')}</p>
                  </header>
                  <dl className="sdu-dl">
                    <div>
                      <dt>{t('systemd.unit')}</dt>
                      <dd>
                        <code>{status.unit}.service</code>
                      </dd>
                    </div>
                    <div>
                      <dt>is-active</dt>
                      <dd>
                        <Badge tone={activeTone(active)}>{active}</Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>is-enabled</dt>
                      <dd>
                        <Badge tone={enabledTone(status.enabled)}>
                          {status.enabled}
                        </Badge>
                      </dd>
                    </div>
                    <div>
                      <dt>{t('logs.catSystem')}</dt>
                      <dd>
                        {status.systemUnitExists ? t('systemd.exists') : t('systemd.missing')} ·{' '}
                        <code className="sdu-dl__path">{status.unitPathHint}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>{t('systemd.manageTemplate')}</dt>
                      <dd>
                        {status.managedUnitExists ? t('systemd.exists') : t('systemd.notWritten')}
                        {status.managedUnitPath ? (
                          <>
                            <br />
                            <code className="sdu-dl__path">
                              {status.managedUnitPath}
                            </code>
                          </>
                        ) : null}
                      </dd>
                    </div>
                    {status.show?.fragmentPath ? (
                      <div>
                        <dt>Fragment</dt>
                        <dd>
                          <code className="sdu-dl__path">
                            {status.show.fragmentPath}
                          </code>
                        </dd>
                      </div>
                    ) : null}
                    {status.show?.mainPid ? (
                      <div>
                        <dt>MainPID</dt>
                        <dd>
                          <code>{status.show.mainPid}</code>
                        </dd>
                      </div>
                    ) : null}
                    {status.show?.description ? (
                      <div>
                        <dt>Description</dt>
                        <dd>{status.show.description}</dd>
                      </div>
                    ) : null}
                  </dl>
                </section>
              </div>
            ) : null}

            {tab === 'install' ? (
              <div className="tab-panel">
                <section className="sdu-panel">
                  <header className="sdu-panel__head">
                    <div>
                      <h3 className="sdu-panel__title">{t('systemd.installOps')}</h3>
                      <p className="sdu-panel__sub">
                        {t('systemd.twoModes')}
                      </p>
                    </div>
                  </header>
                  <div className="sdu-actions">
                    <article className="sdu-action-card">
                      <h4 className="sdu-action-card__title">{t('systemd.writeTemplateOnly')}</h4>
                      <p className="sdu-action-card__body">
                        {t('systemd.writeOnlyBody')}
                        {t('systemd.willNotEnable')}
                      </p>
                      <Button
                        variant="secondary"
                        size="md"
                        loading={busy}
                        onClick={() => void doInstall(false)}
                      >
                        {t('systemd.writeTemplateBtn')}
                      </Button>
                    </article>
                    <article className="sdu-action-card sdu-action-card--primary">
                      <h4 className="sdu-action-card__title">{t('systemd.installAndEnable')}</h4>
                      <p className="sdu-action-card__body">
                        {t('systemd.installEnableBody')}
                      </p>
                      <Button
                        variant="primary"
                        size="md"
                        loading={busy}
                        disabled={!canInstall}
                        onClick={() => void doInstall(true)}
                      >
                        {t('systemd.installAndEnable')}
                      </Button>
                    </article>
                  </div>
                </section>
              </div>
            ) : null}

            {tab === 'policy' ? (
              <div className="tab-panel stack">
                <section className="sdu-panel">
                  <header className="sdu-panel__head">
                    <h3 className="sdu-panel__title">{t('updates.tabPolicy')}</h3>
                  </header>
                  <ul className="sdu-bullets">
                    <li>
                      {t('systemd.policyWriteFull')}
                    </li>
                    <li>
                      <strong>{t('systemd.installAndEnable')}</strong> — cp + daemon-reload + enable
                      --now
                    </li>
                    <li>{t('systemd.policyBlocked')}</li>
                    <li>{t('systemd.policyNotEqualFull')}</li>
                  </ul>
                </section>
                <nav className="sdu-shortcuts" aria-label={t('updates.relatedAria')}>
                  <Link to="/system" className="sdu-shortcut">
                    <span className="sdu-shortcut__t">{t('updates.scHost')}</span>
                    <span className="sdu-shortcut__d">{t('systemd.shortcutPower')}</span>
                  </Link>
                  <Link to="/services" className="sdu-shortcut">
                    <span className="sdu-shortcut__t">{t('system.scServices')}</span>
                    <span className="sdu-shortcut__d">{t('systemd.shortcutOther')}</span>
                  </Link>
                  <Link to="/system/readiness" className="sdu-shortcut">
                    <span className="sdu-shortcut__t">{t('updates.scReadiness')}</span>
                    <span className="sdu-shortcut__d">{t('updates.scReadinessD')}</span>
                  </Link>
                  <Link to="/logs" className="sdu-shortcut">
                    <span className="sdu-shortcut__t">{t('system.scLogs')}</span>
                    <span className="sdu-shortcut__d">journal</span>
                  </Link>
                </nav>
              </div>
            ) : null}
          
        {tab === 'about' ? <PageGuide guideId="systemd" /> : null}
      </PageTabs>

          <OpsResultPanel
            title={t('systemd.opsResult')}
            result={result}
            message={msg}
            busy={busy}
          />
        </div>
      ) : null}
    </FeaturePageLayout>
  );
}
