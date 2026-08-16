/**
 * BT Tracker — professional service console for self-hosted WebTorrent/BT shares.
 * Tabs: overview | torrents | tracker | settings | about
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  FeaturePageLayout,
  Field,
  FormActions,
  FormLayout,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  PresetChips,
  type OpsResultLike,
} from '../../shared/components/ui';
import { ServiceAccessStrip } from '../../features/network/service-exposure';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { toast } from '../../shared/stores/toast-store';
import {
  btTrackerApi,
  type BtLibraryLive,
  type BtTrackerSettings,
  type BtTrackerStatusDto,
  type BtTrackerTorrentRow,
} from '../../features/bt-tracker';
import { AddTorrentModal } from '../../features/bt-tracker/AddTorrentModal';
import { ExtraTrackersPanel } from '../../features/bt-tracker/ExtraTrackersPanel';
import { TorrentLibrary } from '../../features/bt-tracker/TorrentLibrary';
import { bindInput } from '../bind-handlers';

/** jobs merged into torrents tab (background create-torrent under swarm list) */
const TABS = ['overview', 'torrents', 'tracker', 'settings', 'about'] as const;

/** Library + share rows the Torrent tab shows vs leftover tracker announces. */
export function btVisibleAndLeftover(opts: {
  library: Array<{ infoHash?: string }>;
  swarm: Array<{ infoHash?: string; kind?: string }>;
  trackerTorrents?: number;
}): { visible: number; leftover: number } {
  const libHashes = new Set(
    opts.library.map((i) => String(i.infoHash || '').toLowerCase()).filter(Boolean),
  );
  const extraVisible = opts.swarm.filter((s) => {
    const h = String(s.infoHash || '').toLowerCase();
    if (!h || libHashes.has(h)) return false;
    return s.kind !== 'library';
  }).length;
  const visible = opts.library.length + extraVisible;
  const leftoverFromSwarm = opts.swarm.filter((s) => {
    const h = String(s.infoHash || '').toLowerCase();
    return Boolean(h) && !libHashes.has(h) && s.kind === 'library';
  }).length;
  const tracker = Number(opts.trackerTorrents);
  const leftoverFromStats =
    Number.isFinite(tracker) && tracker > visible ? tracker - visible : 0;
  return { visible, leftover: Math.max(leftoverFromStats, leftoverFromSwarm) };
}

type TorrentJobRow = {
  id: string;
  shareId: string;
  status: string;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  notes: string[];
  estimatedBytes?: number;
};

function announceProto(url: string): 'http' | 'ws' | 'udp' | 'other' {
  if (url.startsWith('ws://') || url.startsWith('wss://')) return 'ws';
  if (url.startsWith('udp://')) return 'udp';
  if (url.startsWith('http://') || url.startsWith('https://')) return 'http';
  return 'other';
}

export function BtTrackerPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'overview', {
    aliases: {
      trackers: 'tracker',
      extras: 'tracker',
      extra: 'tracker',
      jobs: 'torrents',
      torrent: 'torrents',
    },
  });
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const [status, setStatus] = useState<BtTrackerStatusDto | null>(null);
  const [torrents, setTorrents] = useState<BtTrackerTorrentRow[]>([]);
  const [library, setLibrary] = useState<BtLibraryLive[]>([]);
  const [jobs, setJobs] = useState<TorrentJobRow[]>([]);
  const [draft, setDraft] = useState<Partial<BtTrackerSettings>>({});
  const [torrentQ, setTorrentQ] = useState('');
  const [torrentFilter, setTorrentFilter] = useState('all');
  const [addOpen, setAddOpen] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);

  const refreshJobs = useCallback(async () => {
    try {
      const r = await btTrackerApi.jobs();
      setJobs((r.items ?? []) as TorrentJobRow[]);
    } catch {
      setJobs([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    const st = await btTrackerApi.status();
    setStatus(st);
    setDraft(st.settings ?? {});
    try {
      const [tr, lib] = await Promise.all([btTrackerApi.torrents(), btTrackerApi.library()]);
      setTorrents(tr.items ?? []);
      setLibrary(lib.items ?? []);
    } catch {
      setTorrents([]);
      setLibrary([]);
    }
    await refreshJobs();
  }, [refreshJobs, setError]);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh, setError]);

  useEffect(() => {
    if (tab !== 'torrents' && tab !== 'overview') return;
    const id = window.setInterval(() => {
      void btTrackerApi
        .torrents()
        .then((tr) => setTorrents(tr.items ?? []))
        .catch(() => undefined);
      void btTrackerApi
        .library()
        .then((lib) => setLibrary(lib.items ?? []))
        .catch(() => undefined);
      void refreshJobs();
      if (tab === 'overview') {
        void btTrackerApi
          .status()
          .then((st) => setStatus(st))
          .catch(() => undefined);
      }
    }, library.some((i) => i.status === 'downloading' || i.status === 'checking') ? 2_000 : 5_000);
    return () => window.clearInterval(id);
  }, [tab, refreshJobs, library]);

  const running = Boolean(status?.running);
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const announceList = status?.announceUrls ?? [];
  const hasPublicHost = Boolean(status?.settings?.publicAnnounceHost?.trim());
  const { visible: torrentCount, leftover: leftoverSwarm } = btVisibleAndLeftover({
    library,
    swarm: torrents,
    trackerTorrents: status?.stats?.torrents,
  });
  const peerCount = status?.stats?.peers ?? 0;

  function patchDraft<K extends keyof BtTrackerSettings>(key: K, value: BtTrackerSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text).then(
      () => toast.ok(t('btTracker.copied')),
      () => undefined,
    );
  }

  function protoLabel(p: ReturnType<typeof announceProto>): string {
    if (p === 'ws') return t('btTracker.protoWs');
    if (p === 'udp') return t('btTracker.protoUdp');
    if (p === 'http') return t('btTracker.protoHttp');
    return 'URL';
  }

  const onStart = () =>
    void run(async () => {
      const r = await btTrackerApi.start();
      setMsg(t('btTracker.startedOk'));
      await refresh();
      return r;
    });

  const onStop = () =>
    void run(async () => {
      const r = await btTrackerApi.stop();
      setMsg(t('btTracker.stoppedOk'));
      await refresh();
      return r;
    });

  const onRestore = () =>
    void run(async () => {
      const r = await btTrackerApi.restore();
      setMsg(t('btTracker.restoredOk'));
      await refresh();
      return r;
    });

  return (
    <FeaturePageLayout
      title={t('nav.btTracker')}
      subtitle={t('btTracker.sub')}
      showCapability={false}
      status={{
        pill: {
          label: running ? t('btTracker.running') : t('btTracker.stopped'),
          tone: running ? 'ok' : 'warn',
        },
        items: [
          {
            label: t('btTracker.statsTorrents'),
            value: String(torrentCount),
            tone: torrentCount > 0 ? 'ok' : 'neutral',
          },
          {
            label: t('btTracker.statsPeers'),
            value: String(peerCount),
            tone: peerCount > 0 ? 'ok' : 'neutral',
          },
          {
            label: t('btTracker.statsAnnounces'),
            value: String(status?.stats?.announces ?? 0),
          },
          {
            label: t('btTracker.statsJobs'),
            value: String(activeJobs),
            tone: activeJobs > 0 ? 'warn' : 'neutral',
          },
          {
            label: t('btTracker.port'),
            value: String(status?.settings?.httpPort ?? '—'),
          },
          {
            label: t('btTracker.announceHost'),
            value:
              status?.settings?.publicAnnounceHost?.trim() ||
              t('btTracker.announceHostUnset'),
            tone: status?.settings?.publicAnnounceHost?.trim() ? 'ok' : 'warn',
          },
        ],
      }}
      actions={
        <ActionBar>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            {t('btTracker.refresh')}
          </Button>
          {!running ? (
            <Button variant="primary" size="sm" loading={busy} onClick={onStart}>
              {t('btTracker.start')}
            </Button>
          ) : (
            <Button
              variant="danger"
              size="sm"
              loading={busy}
              title={t('btTracker.stopTitle')}
              onClick={() => setStopOpen(true)}
            >
              {t('btTracker.stop')}
            </Button>
          )}
        </ActionBar>
      }
    >
      <div className="bt-page">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {msg ? <Alert variant="ok">{msg}</Alert> : null}
        {result ? <OpsResultPanel result={result as OpsResultLike} /> : null}

        <PageTabs
          tabs={[
            { id: 'overview', label: t('btTracker.tabOverview') },
            {
              id: 'torrents',
              label: t('btTracker.tabTorrents'),
              badge:
                library.length + torrents.length + activeJobs > 0
                  ? library.length + torrents.length + activeJobs
                  : undefined,
            },
            {
              id: 'tracker',
              label: t('btTracker.tabTrackers'),
              badge: (status?.settings?.extraTrackers ?? []).filter((x) => x.enabled).length || undefined,
            },
            { id: 'settings', label: t('btTracker.tabSettings') },
            { id: 'about', label: t('btTracker.tabAbout') },
          ]}
          active={tab}
          onChange={(id) => setTab(id as (typeof TABS)[number])}
        >
          {tab === 'overview' ? (
            <div className="tab-panel bt-overview">
              <div className="bt-strip">
                <div className="bt-strip__status">
                  <Badge tone={running ? 'ok' : 'warn'}>
                    {running ? t('btTracker.running') : t('btTracker.stopped')}
                  </Badge>
                </div>
                <div className="bt-strip__meta">
                  <span>
                    {t('btTracker.port')}{' '}
                    <strong>{status?.settings?.httpPort ?? '—'}</strong>
                  </span>
                  <span>
                    {t('btTracker.announceHost')}{' '}
                    <strong>
                      {status?.settings?.publicAnnounceHost?.trim() ||
                        t('btTracker.announceHostUnset')}
                    </strong>
                  </span>
                  <span>
                    {t('btTracker.pid')} <strong>{status?.pid ?? '—'}</strong>
                  </span>
                </div>
                <div className="bt-strip__actions">
                  {!running ? (
                    <Button variant="primary" size="sm" loading={busy} onClick={onStart}>
                      {t('btTracker.start')}
                    </Button>
                  ) : (
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      title={t('btTracker.stopTitle')}
                      onClick={() => setStopOpen(true)}
                    >
                      {t('btTracker.stop')}
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={onRestore}
                    title={t('btTracker.restoreSeedsHint')}
                  >
                    {t('btTracker.restoreSeeds')}
                  </Button>
                  <Link className="btn btn--secondary btn--sm" to="/files?tab=shares">
                    {t('btTracker.openShares')}
                  </Link>
                  <Button variant="ghost" size="sm" onClick={() => setTab('settings')}>
                    {t('btTracker.goSettings')}
                  </Button>
                </div>
              </div>

              <div className="bt-chips" aria-label={t('btTracker.quickStart')}>
                <span className={`bt-chip ${hasPublicHost ? 'bt-chip--ok' : 'bt-chip--todo'}`}>
                  {hasPublicHost ? '✓' : '1'} {t('btTracker.step1Title')}
                </span>
                <span className={`bt-chip ${running ? 'bt-chip--ok' : 'bt-chip--todo'}`}>
                  {running ? '✓' : '2'} {t('btTracker.step2Title')}
                </span>
                <span
                  className={`bt-chip ${torrents.length ? 'bt-chip--ok' : 'bt-chip--todo'}`}
                >
                  {torrents.length ? '✓' : '3'} {t('btTracker.step3Title')}
                </span>
              </div>

              {!status?.executeEnabled ? (
                <Alert variant="warn">{t('btTracker.needExecute')}</Alert>
              ) : null}
              {leftoverSwarm > 0 ? (
                <Alert variant="warn">
                  {t('btTracker.swarmLeftover', { count: leftoverSwarm })}
                </Alert>
              ) : null}

              <Card>
                <CardSection title={t('btTracker.exposureTitle')}>
                  <ServiceAccessStrip serviceId="bt-tracker" compact />
                </CardSection>
              </Card>

              <Card>
                <CardSection title={t('btTracker.announceUrls')}>
                  {announceList.length === 0 ? (
                    <p className="muted u-text-sm">{t('btTracker.announceHostUnset')}</p>
                  ) : (
                    <div className="bt-announce">
                      {announceList.map((u) => {
                        const p = announceProto(u);
                        return (
                          <div key={u} className="bt-announce__row">
                            <span
                              className={`bt-announce__proto${
                                p === 'ws'
                                  ? ' bt-announce__proto--ws'
                                  : p === 'udp'
                                    ? ' bt-announce__proto--udp'
                                    : ''
                              }`}
                            >
                              {protoLabel(p)}
                            </span>
                            <code className="bt-announce__url" title={u}>
                              {u}
                            </code>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => copyText(u)}
                            >
                              {t('btTracker.copy')}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardSection>
              </Card>
            </div>
          ) : null}

          {tab === 'torrents' ? (
            <>
            {leftoverSwarm > 0 ? (
              <Alert variant="warn">
                {t('btTracker.swarmLeftover', { count: leftoverSwarm })}
              </Alert>
            ) : null}
            <TorrentLibrary
              library={library}
              swarm={torrents}
              query={torrentQ}
              onQuery={setTorrentQ}
              filter={torrentFilter}
              onFilter={setTorrentFilter}
              running={running}
              busy={busy}
              onAdd={() => setAddOpen(true)}
              onDropFiles={() => setAddOpen(true)}
              onPause={(id) => {
                void run(async () => {
                  const r = await btTrackerApi.pauseLibrary(id);
                  await refresh();
                  return r;
                });
              }}
              onResume={(id) => {
                void run(async () => {
                  const r = await btTrackerApi.resumeLibrary(id);
                  await refresh();
                  return r;
                });
              }}
              onRemove={(id, deleteFiles) => {
                void run(async () => {
                  const r = await btTrackerApi.removeLibrary(id, deleteFiles);
                  await refresh();
                  return r;
                });
              }}
            />
            {jobs.length > 0 ? (
              <div className="bt-jobs-block">
                <strong className="u-text-sm">
                  {t('btTracker.jobs')} ({jobs.length})
                </strong>
                <ul className="bt-extras__list">
                  {jobs.map((j) => (
                    <li key={j.id} className="bt-extras__row">
                      <Badge
                        tone={
                          j.status === 'done'
                            ? 'ok'
                            : j.status === 'error'
                              ? 'danger'
                              : j.status === 'running'
                                ? 'info'
                                : 'warn'
                        }
                      >
                        {j.status}
                      </Badge>
                      <code className="bt-extras__url">{j.shareId}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            </>
          ) : null}

          {tab === 'tracker' ? (
            <ExtraTrackersPanel
              settings={status?.settings ?? null}
              busy={busy}
              onSave={async (extra) => {
                await run(async () => {
                  const r = await btTrackerApi.saveSettings({ extraTrackers: extra });
                  await refresh();
                  return r;
                });
              }}
              onApplied={() => {
                toast.ok(t('btTracker.extraTrackerApplyOk'));
              }}
            />
          ) : null}

          {tab === 'settings' ? (
            <form
              className="tab-panel bt-settings"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const body: Partial<BtTrackerSettings> = {
                    httpPort: Number(draft.httpPort) || 8000,
                    udpPort: Number(draft.udpPort) || 0,
                    listenHost: String(draft.listenHost || '0.0.0.0'),
                    wsEnabled: draft.wsEnabled !== false,
                    autostart: Boolean(draft.autostart),
                    publicAnnounceHost: String(draft.publicAnnounceHost || ''),
                    maxSeeds: Number(draft.maxSeeds) || 32,
                    seederPortMin: Number(draft.seederPortMin) || 6881,
                    seederPortMax: Number(draft.seederPortMax) || 6889,
                  };
                  const r = await btTrackerApi.saveSettings(body);
                  setMsg(
                    r.restartRequired
                      ? t('btTracker.saveOkRestart')
                      : t('btTracker.saveOk'),
                  );
                  await refresh();
                  return r;
                });
              }}
            >
              <div className="bt-settings__card">
                <h3 className="bt-settings__card-title">{t('btTracker.networkCard')}</h3>
                <FormLayout columns={2}>
                  <Field label={t('btTracker.httpPort')} htmlFor="bt-http" flush required>
                    <input
                      id="bt-http"
                      type="number"
                      min={1}
                      max={65535}
                      className="input"
                      value={draft.httpPort ?? 8000}
                      onChange={(e) => patchDraft('httpPort', Number(e.target.value))}
                    />
                    <div className="u-mt-2">
                      <PresetChips
                        options={[
                          { value: '8000', label: t('btTracker.portSuggest8000') },
                          { value: '6881', label: '6881' },
                          { value: '2710', label: '2710' },
                        ]}
                        value={String(draft.httpPort ?? 8000)}
                        onChange={(v) => patchDraft('httpPort', Number(v) || 8000)}
                      />
                    </div>
                  </Field>
                  <Field label={t('btTracker.udpPort')} htmlFor="bt-udp" flush>
                    <input
                      id="bt-udp"
                      type="number"
                      min={0}
                      max={65535}
                      className="input"
                      value={draft.udpPort ?? 0}
                      onChange={(e) => patchDraft('udpPort', Number(e.target.value))}
                    />
                    <div className="u-mt-2">
                      <PresetChips
                        options={[
                          { value: '0', label: t('btTracker.udpPortOff') },
                          {
                            value: String(draft.httpPort || 8000),
                            label: t('btTracker.udpPortSameHttp', {
                              port: String(draft.httpPort || 8000),
                            }),
                          },
                          { value: '6969', label: t('btTracker.udpPortClassic') },
                          { value: '8000', label: '8000' },
                        ]}
                        value={String(draft.udpPort ?? 0)}
                        onChange={(v) => patchDraft('udpPort', Number(v) || 0)}
                      />
                    </div>
                  </Field>
                  <Field label={t('btTracker.listenHost')} htmlFor="bt-host" flush>
                    <input
                      id="bt-host"
                      className="input"
                      value={draft.listenHost ?? '0.0.0.0'}
                      onChange={bindInput((v) => patchDraft('listenHost', v))}
                    />
                  </Field>
                  <Field label={t('btTracker.publicAnnounceHost')} htmlFor="bt-pub" flush>
                    <input
                      id="bt-pub"
                      className="input"
                      value={draft.publicAnnounceHost ?? ''}
                      onChange={bindInput((v) => patchDraft('publicAnnounceHost', v))}
                      placeholder="example.com"
                    />
                    {!String(draft.publicAnnounceHost || '').trim() &&
                    window.location.hostname.includes('.') ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title={t('btTracker.fillPublicHostTitle')}
                        onClick={() =>
                          patchDraft('publicAnnounceHost', window.location.hostname)
                        }
                      >
                        {t('btTracker.fillPublicHost', {
                          host: window.location.hostname,
                        })}
                      </Button>
                    ) : null}
                  </Field>
                  <label className="bt-toggle bt-toggle--compact" htmlFor="bt-ws">
                    <input
                      id="bt-ws"
                      type="checkbox"
                      checked={draft.wsEnabled !== false}
                      onChange={(e) => patchDraft('wsEnabled', e.target.checked)}
                    />
                    <span className="bt-toggle__lab">{t('btTracker.wsEnabled')}</span>
                  </label>
                </FormLayout>
              </div>

              <div className="bt-settings__card">
                <h3 className="bt-settings__card-title">{t('btTracker.seederCard')}</h3>
                <FormLayout columns={2}>
                  <Field label={t('btTracker.maxSeeds')} htmlFor="bt-max" flush>
                    <input
                      id="bt-max"
                      type="number"
                      min={1}
                      max={256}
                      className="input"
                      value={draft.maxSeeds ?? 32}
                      onChange={(e) => patchDraft('maxSeeds', Number(e.target.value))}
                    />
                  </Field>
                  <Field label={t('btTracker.seederPorts')} htmlFor="bt-smin" flush>
                    <div className="u-flex u-gap-sm u-items-center">
                      <input
                        id="bt-smin"
                        type="number"
                        min={1}
                        max={65535}
                        className="input"
                        value={draft.seederPortMin ?? 6881}
                        onChange={(e) =>
                          patchDraft('seederPortMin', Number(e.target.value))
                        }
                      />
                      <span className="muted">–</span>
                      <input
                        id="bt-smax"
                        type="number"
                        min={1}
                        max={65535}
                        className="input"
                        value={draft.seederPortMax ?? 6889}
                        onChange={(e) =>
                          patchDraft('seederPortMax', Number(e.target.value))
                        }
                      />
                    </div>
                  </Field>
                </FormLayout>
              </div>

              <div className="bt-settings__card">
                <h3 className="bt-settings__card-title">{t('btTracker.lifecycleCard')}</h3>
                <label className="bt-toggle bt-toggle--compact" htmlFor="bt-auto">
                  <input
                    id="bt-auto"
                    type="checkbox"
                    checked={Boolean(draft.autostart)}
                    onChange={(e) => patchDraft('autostart', e.target.checked)}
                  />
                  <span className="bt-toggle__lab">{t('btTracker.autostart')}</span>
                </label>
              </div>

              <FormActions>
                <Button type="submit" variant="primary" size="md" loading={busy}>
                  {t('btTracker.saveSettings')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  disabled={busy}
                  onClick={() => setDraft(status?.settings ?? {})}
                >
                  {t('common.cancel', { defaultValue: 'Cancel' })}
                </Button>
              </FormActions>
            </form>
          ) : null}

          {tab === 'about' ? <PageGuide guideId="btTracker" /> : null}
        </PageTabs>
      </div>
      <ConfirmDialog
        open={stopOpen}
        onClose={() => setStopOpen(false)}
        title={t('btTracker.stopTitle')}
        description={t('btTracker.stopDesc')}
        danger
        confirmLabel={t('btTracker.stop')}
        onConfirm={() => {
          setStopOpen(false);
          onStop();
        }}
      />
      <AddTorrentModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        extraTrackerCount={(status?.settings?.extraTrackers ?? []).filter((x) => x.enabled).length}
        onAdded={() => {
          toast.ok(t('btTracker.addOk'));
          void refresh();
        }}
      />
    </FeaturePageLayout>
  );
}
