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
  buttonClassName } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { bindSet, bindCall1 } from '../bind-handlers';

const SDU_TABS = ['guide', 'status', 'install', 'about'] as const;

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

export function enabledLabel(v?: string): string {
  if (!v) return '—';
  if (v === 'enabled') return i18n.t('common.enabled');
  if (v === 'disabled') return i18n.t('systemd.disabled');
  if (v === 'not-found') return i18n.t('common.notInstalled');
  if (v === 'static') return 'static';
  if (v === 'indirect') return 'indirect';
  return v;
}

export function activeTone(active: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (active === 'active') return 'ok';
  if (active === 'activating' || active === 'reloading') return 'warn';
  if (active === 'failed') return 'danger';
  if (active === 'inactive' || active === 'not-found') return 'warn';
  return 'neutral';
}

export function activeLabel(active: string): string {
  if (active === 'active') return i18n.t('common.running');
  if (active === 'inactive') return i18n.t('systemd.notRunning');
  if (active === 'failed') return i18n.t('common.failed');
  if (active === 'activating') return i18n.t('systemd.activating');
  if (active === 'not-found') return i18n.t('systemd.unitMissing');
  return active || '—';
}

export function enabledTone(v?: string): 'ok' | 'warn' | 'neutral' {
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
        done: false });
    } else {
      steps.push({
        id: 'template',
        title: t('systemd.templateExists'),
        detail: status.managedUnitPath ?? 'dataDir/systemd/ysk-server.service',
        done: true });
    }

    if (!status.systemUnitExists || status.enabled === 'not-found') {
      steps.push({
        id: 'install',
        title: t('systemd.installEnable'),
        detail: canInstall
          ? t('systemd.installEnableDesc')
          : t('systemd.needExecuteRoot'),
        action: 'install',
        done: false });
    } else if (!running) {
      steps.push({
        id: 'start',
        title: t('systemd.serviceNotRunning'),
        detail: t('systemd.serviceNotRunningHint'),
        action: 'install',
        href: '/services',
        done: false });
    } else {
      steps.push({
        id: 'running',
        title: t('systemd.controlRunning'),
        detail: status.show?.mainPid
          ? t('systemd.pid', { pid: status.show.mainPid })
          : t('systemd.controlRunningHint'),
        done: true });
    }

    if (!canInstall) {
      steps.push({
        id: 'caps',
        title: t('systemd.unlockApply'),
        detail: t('systemd.startAsRoot'),
        href: '/system',
        done: false });
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
                tone: activeTone(active) },
              items: [
                {
                  label: t('common.status'),
                  value: activeLabel(active),
                  tone: activeTone(active) },
                {
                  label: t('systemd.bootEnabled'),
                  value: enabledLabel(status.enabled),
                  tone: enabledTone(status.enabled) },
                {
                  label: 'EXECUTE',
                  value: status.executeEnabled ? t('common.on') : t('common.off'),
                  tone: status.executeEnabled ? 'ok' : 'warn' },
                {
                  label: 'Root',
                  value: status.isRoot ? t('common.yes') : t('common.no'),
                  tone: status.isRoot ? 'ok' : 'warn' },
                {
                  label: t('systemd.canInstall'),
                  value: canInstall ? t('common.yes') : t('common.no'),
                  tone: canInstall ? 'ok' : 'warn' },
                {
                  label: 'Unit',
                  value: `${status.unit}.service` },
              ] }
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
      {loading && !status ? (
        <LoadingBlock label={t('systemd.probing')} />
      ) : status ? (
        <div className="sdu">
          <PageTabs
            tabs={[
              { id: 'guide', label: t('systemd.suggestedSteps') },
              { id: 'status', label: t('common.status') },
              { id: 'install', label: t('common.install') },
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
                              onClick={bindCall1(doInstall, false)}
                            >
                              {t('redis.writable')}
                            </Button>
                          ) : s.action === 'install' ? (
                            <Button
                              variant="primary"
                              size="sm"
                              loading={busy}
                              disabled={!canInstall && s.id === 'install'}
                              onClick={bindCall1(doInstall, true)}
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
              <div className="tab-panel stack">
                {/* Identity + health */}
                <section className="sdu-panel sdu-panel--primary" aria-labelledby="sdu-status-title">
                  <header className="sdu-panel__head sdu-status-head">
                    <div className="sdu-status-id">
                      <p className="sdu-status-kicker">{t('systemd.controlPlaneUnit')}</p>
                      <h3 id="sdu-status-title" className="sdu-status-name">
                        <code>{status.unit}.service</code>
                      </h3>
                      {status.show?.description ? (
                        <p className="sdu-status-desc">{status.show.description}</p>
                      ) : (
                        <p className="sdu-status-desc muted">{t('systemd.probeDetailSub')}</p>
                      )}
                    </div>
                    <Badge tone={activeTone(active)}>{activeLabel(active)}</Badge>
                  </header>

                  <div className="sdu-kpi" role="list">
                    <div className="sdu-kpi__card" role="listitem">
                      <span className="sdu-kpi__lab">{t('systemd.kpiRuntime')}</span>
                      <span className={`sdu-kpi__val sdu-kpi__val--${activeTone(active)}`}>
                        {activeLabel(active)}
                      </span>
                      <span className="sdu-kpi__meta">
                        <code>{active}</code>
                        {status.show?.mainPid ? (
                          <>
                            {' · '}
                            {t('systemd.pid', { pid: status.show.mainPid })}
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="sdu-kpi__card" role="listitem">
                      <span className="sdu-kpi__lab">{t('systemd.kpiBoot')}</span>
                      <span className={`sdu-kpi__val sdu-kpi__val--${enabledTone(status.enabled)}`}>
                        {enabledLabel(status.enabled)}
                      </span>
                      <span className="sdu-kpi__meta">
                        <code>{status.enabled || '—'}</code>
                      </span>
                    </div>
                    <div className="sdu-kpi__card" role="listitem">
                      <span className="sdu-kpi__lab">{t('systemd.kpiCaps')}</span>
                      <span
                        className={`sdu-kpi__val sdu-kpi__val--${canInstall ? 'ok' : 'warn'}`}
                      >
                        {canInstall ? t('systemd.capsReady') : t('systemd.capsBlocked')}
                      </span>
                      <span className="sdu-kpi__meta">
                        EXECUTE {status.executeEnabled ? t('common.on') : t('common.off')}
                        {' · '}
                        Root {status.isRoot ? t('common.yes') : t('common.no')}
                      </span>
                    </div>
                  </div>
                </section>

                {/* Unit files on disk */}
                <section className="sdu-panel" aria-labelledby="sdu-files-title">
                  <header className="sdu-panel__head">
                    <div>
                      <h3 id="sdu-files-title" className="sdu-panel__title">
                        {t('systemd.unitFiles')}
                      </h3>
                      <p className="sdu-panel__sub">{t('systemd.unitFilesSub')}</p>
                    </div>
                  </header>
                  <ul className="sdu-files">
                    <li className="sdu-file">
                      <div className="sdu-file__top">
                        <span className="sdu-file__name">{t('systemd.systemUnitFile')}</span>
                        <Badge tone={status.systemUnitExists ? 'ok' : 'warn'}>
                          {status.systemUnitExists ? t('systemd.exists') : t('systemd.missing')}
                        </Badge>
                      </div>
                      <code className="sdu-file__path">{status.unitPathHint}</code>
                      <p className="sdu-file__hint muted u-text-sm">
                        {t('systemd.systemUnitHint')}
                      </p>
                    </li>
                    <li className="sdu-file">
                      <div className="sdu-file__top">
                        <span className="sdu-file__name">{t('systemd.managedUnitFile')}</span>
                        <Badge tone={status.managedUnitExists ? 'ok' : 'warn'}>
                          {status.managedUnitExists ? t('systemd.exists') : t('systemd.notWritten')}
                        </Badge>
                      </div>
                      <code className="sdu-file__path">
                        {status.managedUnitPath ?? t('systemd.managedPathHint')}
                      </code>
                      <p className="sdu-file__hint muted u-text-sm">
                        {t('systemd.managedUnitHint')}
                      </p>
                    </li>
                    {status.show?.fragmentPath ? (
                      <li className="sdu-file">
                        <div className="sdu-file__top">
                          <span className="sdu-file__name">{t('systemd.fragmentPath')}</span>
                          <Badge tone="neutral">{t('systemd.fromSystemd')}</Badge>
                        </div>
                        <code className="sdu-file__path">{status.show.fragmentPath}</code>
                      </li>
                    ) : null}
                  </ul>
                </section>

                {/* Quick actions when not healthy */}
                {!running || !status.systemUnitExists ? (
                  <section className="sdu-panel sdu-panel--actions">
                    <header className="sdu-panel__head">
                      <h3 className="sdu-panel__title">{t('systemd.nextAction')}</h3>
                    </header>
                    <ActionBar>
                      {!status.managedUnitExists ? (
                        <Button
                          variant="secondary"
                          size="md"
                          loading={busy}
                          onClick={() => {
                            setTab('install');
                            void doInstall(false);
                          }}
                        >
                          {t('systemd.writeTemplateOnly')}
                        </Button>
                      ) : null}
                      <Button
                        variant="primary"
                        size="md"
                        loading={busy}
                        disabled={!canInstall}
                        onClick={() => {
                          setTab('install');
                          void doInstall(true);
                        }}
                      >
                        {t('systemd.installAndEnable')}
                      </Button>
                      <Link
                        to="/services"
                        className={buttonClassName({ variant: 'ghost', size: 'md' })}
                      >
                        {t('system.scServices')}
                      </Link>
                    </ActionBar>
                    {!canInstall ? (
                      <p className="sdu-callout sdu-callout--warn u-mt-3">
                        {t('systemd.cannotInstallFull')}{' '}
                        <Link to="/system">{t('updates.scHost')}</Link>
                      </p>
                    ) : null}
                  </section>
                ) : null}
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
                        onClick={bindCall1(doInstall, false)}
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
                        onClick={bindCall1(doInstall, true)}
                      >
                        {t('systemd.installAndEnable')}
                      </Button>
                    </article>
                  </div>
                </section>
              </div>
            ) : null}

            {tab === 'about' ? (
              <div className="tab-panel stack">
                <section className="sdu-panel sdu-panel--primary" aria-labelledby="sdu-about-policy">
                  <header className="sdu-panel__head">
                    <div>
                      <h3 id="sdu-about-policy" className="sdu-panel__title">
                        {t('systemd.aboutPolicyTitle')}
                      </h3>
                      <p className="sdu-panel__sub">{t('systemd.aboutPolicySub')}</p>
                    </div>
                  </header>
                  <ol className="sdu-policy">
                    <li className="sdu-policy__item">
                      <span className="sdu-policy__n" aria-hidden>1</span>
                      <div className="sdu-policy__body">
                        <div className="sdu-policy__title">{t('systemd.writeTemplateOnly')}</div>
                        <p className="sdu-policy__text">{t('systemd.policyWriteFull')}</p>
                      </div>
                    </li>
                    <li className="sdu-policy__item">
                      <span className="sdu-policy__n" aria-hidden>2</span>
                      <div className="sdu-policy__body">
                        <div className="sdu-policy__title">{t('systemd.installAndEnable')}</div>
                        <p className="sdu-policy__text">{t('systemd.policyInstallFull')}</p>
                      </div>
                    </li>
                    <li className="sdu-policy__item">
                      <span className="sdu-policy__n" aria-hidden>3</span>
                      <div className="sdu-policy__body">
                        <div className="sdu-policy__title">{t('systemd.policyBlockedTitle')}</div>
                        <p className="sdu-policy__text">{t('systemd.policyBlocked')}</p>
                      </div>
                    </li>
                    <li className="sdu-policy__item">
                      <span className="sdu-policy__n" aria-hidden>4</span>
                      <div className="sdu-policy__body">
                        <div className="sdu-policy__title">{t('systemd.policyNotEqualTitle')}</div>
                        <p className="sdu-policy__text">{t('systemd.policyNotEqualFull')}</p>
                      </div>
                    </li>
                  </ol>
                </section>

                <section className="sdu-panel" aria-labelledby="sdu-about-guide">
                  <header className="sdu-panel__head">
                    <h3 id="sdu-about-guide" className="sdu-panel__title">
                      {t('common.about')}
                    </h3>
                  </header>
                  <PageGuide guideId="systemd" />
                </section>
              </div>
            ) : null}
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
