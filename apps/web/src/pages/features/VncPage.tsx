/**
 * VNC — multi-account server (Linux users) + client dual path + noVNC.
 * PR-A: skeleton tabs, install banners, status probe.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  LoadingBlock,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  SummaryStrip,
  type OpsResultLike,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { notifyOk, notifyWarn } from '../../shared/lib/notify';
import {
  vncApi,
  type VncDesktopProfile,
  type VncRfbBind,
  type VncStackStatus,
  type VncStatusResponse,
} from '../../features/vnc/api';

const TABS = ['overview', 'accounts', 'client', 'install', 'settings', 'about'] as const;

export function VncPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VncStatusResponse | null>(null);
  const [lastOps, setLastOps] = useState<OpsResultLike | null>(null);

  // Settings form (local until save)
  const [desktop, setDesktop] = useState<VncDesktopProfile>('minimal');
  const [geometry, setGeometry] = useState('1920x1080');
  const [depth, setDepth] = useState(24);
  const [rfbBind, setRfbBind] = useState<VncRfbBind>('localhost');
  const [autostart, setAutostart] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await vncApi.status();
      setStatus(s);
      if (s.settings) {
        setDesktop(s.settings.defaultDesktop);
        setGeometry(s.settings.defaultGeometry);
        setDepth(s.settings.defaultDepth);
        setRfbBind(s.settings.defaultRfbBind);
        setAutostart(s.settings.defaultAutostart);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stackBadge = (s: VncStackStatus) => (
    <div key={s.id} className="vpn-engine-card">
      <div className="vpn-engine-card__head">
        <strong>{s.title}</strong>
        <Badge tone={s.installed ? 'ok' : 'warn'}>
          {s.installed ? t('vnc.installed') : t('vnc.notInstalled')}
        </Badge>
      </div>
      <p className="muted u-text-sm u-mb-0">
        {s.bins.length
          ? t('vnc.stackBins', { bins: s.bins.join(', ') })
          : t('vnc.stackMissing', { bins: s.missingBins.slice(0, 3).join(', ') || '—' })}
      </p>
      {s.notes?.[0] ? <p className="muted u-text-xs">{s.notes[0]}</p> : null}
    </div>
  );

  const saveSettings = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await vncApi.patchSettings({
        defaultDesktop: desktop,
        defaultGeometry: geometry,
        defaultDepth: depth,
        defaultRfbBind: rfbBind,
        defaultAutostart: autostart,
      });
      setLastOps({ ok: r.ok, notes: [t('vnc.settingsSaved')] });
      if (r.ok) notifyOk(t('vnc.settingsSaved'));
      else notifyWarn(t('common.opFailed'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FeaturePageLayout title={t('nav.vnc')} subtitle={t('vnc.pageDesc')}>
      <PageTabs
        tabs={TABS.map((id) => ({ id, label: t(`vnc.tab.${id}`) }))}
        active={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        {lastOps ? <OpsResultPanel title={t('vnc.result')} result={lastOps} /> : null}

        {tab === 'overview' ? (
          <div className="stack">
            {!status ? (
              <LoadingBlock />
            ) : (
              <>
                <Alert variant="info">
                  {status.executeEnabled ? t('vnc.executeOn') : t('vnc.executeOff')}
                </Alert>
                <SummaryStrip
                  items={[
                    {
                      label: t('vnc.statAccounts'),
                      value: String(status.accountCount),
                    },
                    {
                      label: t('vnc.statRunning'),
                      value: String(status.runningCount),
                    },
                    {
                      label: t('vnc.statClients'),
                      value: String(status.clientProfileCount),
                    },
                    {
                      label: t('vnc.statEndpoint'),
                      value: status.endpointHint || '—',
                    },
                  ]}
                />
                <div className="vpn-engine-grid">{status.stacks.map(stackBadge)}</div>
                <div className="u-flex-gap">
                  <Button size="sm" onClick={() => setTab('accounts')}>
                    {t('vnc.goAccounts')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setTab('client')}>
                    {t('vnc.goClient')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setTab('install')}>
                    {t('vnc.goInstall')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void load()}
                    disabled={busy}
                  >
                    {t('common.refresh')}
                  </Button>
                </div>
                {status.notes?.length ? (
                  <Alert variant="warn">{status.notes.join(' · ')}</Alert>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        {tab === 'accounts' ? (
          <div className="stack">
            <SoftwareInstallBanner feature="tigervnc" title={t('vnc.needTigerVnc')} />
            <Alert variant="info">{t('vnc.accountsComing')}</Alert>
            <EmptyState
              title={t('vnc.accountsEmptyTitle')}
              description={t('vnc.accountsEmptyDesc')}
            />
          </div>
        ) : null}

        {tab === 'client' ? (
          <div className="stack">
            <SoftwareInstallBanner feature="vnc" title={t('vnc.needViewerOrNovnc')} />
            <Alert variant="info">{t('vnc.clientPathHint')}</Alert>
            <EmptyState
              title={t('vnc.clientEmptyTitle')}
              description={t('vnc.clientEmptyDesc')}
            />
          </div>
        ) : null}

        {tab === 'install' ? (
          <div className="stack">
            <Alert variant="info">{t('vnc.installHint')}</Alert>
            <SoftwareInstallBanner feature="tigervnc" title={t('vnc.needTigerVnc')} />
            <SoftwareVersionBar softwareId="tigervnc" />
            <SoftwareInstallBanner feature="novnc" title={t('vnc.needNovnc')} />
            <SoftwareVersionBar softwareId="novnc" />
            <SoftwareInstallBanner feature="vnc" title={t('vnc.needXfce')} />
            <SoftwareVersionBar softwareId="vnc-desktop-xfce" />
            <SoftwareInstallBanner feature="vnc" title={t('vnc.needViewer')} />
            <SoftwareVersionBar softwareId="tigervnc-viewer" />
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="stack">
            <Alert variant="info">{t('vnc.settingsHint')}</Alert>
            <FormLayout columns={2}>
              <Field label={t('vnc.defaultDesktop')} htmlFor="vnc-desk" flush>
                <select
                  id="vnc-desk"
                  value={desktop}
                  onChange={(e) => setDesktop(e.target.value as VncDesktopProfile)}
                >
                  <option value="minimal">{t('vnc.desktop.minimal')}</option>
                  <option value="xfce">{t('vnc.desktop.xfce')}</option>
                  <option value="none">{t('vnc.desktop.none')}</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultGeometry')} htmlFor="vnc-geo" flush>
                <select
                  id="vnc-geo"
                  value={geometry}
                  onChange={(e) => setGeometry(e.target.value)}
                >
                  <option value="1280x720">1280×720</option>
                  <option value="1600x900">1600×900</option>
                  <option value="1920x1080">1920×1080</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultDepth')} htmlFor="vnc-depth" flush>
                <select
                  id="vnc-depth"
                  value={depth}
                  onChange={(e) => setDepth(Number(e.target.value))}
                >
                  <option value={16}>16</option>
                  <option value={24}>24</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultRfbBind')} htmlFor="vnc-bind" flush>
                <select
                  id="vnc-bind"
                  value={rfbBind}
                  onChange={(e) => setRfbBind(e.target.value as VncRfbBind)}
                >
                  <option value="localhost">{t('vnc.bind.localhost')}</option>
                  <option value="all">{t('vnc.bind.all')}</option>
                </select>
              </Field>
              <Field label={t('vnc.defaultAutostart')} htmlFor="vnc-auto" flush>
                <label className="u-flex u-items-center u-gap-2">
                  <input
                    id="vnc-auto"
                    type="checkbox"
                    checked={autostart}
                    onChange={(e) => setAutostart(e.target.checked)}
                  />
                  {t('vnc.autostartLabel')}
                </label>
              </Field>
            </FormLayout>
            <div className="u-flex-gap">
              <Button size="sm" variant="primary" loading={busy} onClick={() => void saveSettings()}>
                {t('common.save')}
              </Button>
            </div>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="vnc" /> : null}
      </PageTabs>
    </FeaturePageLayout>
  );
}
