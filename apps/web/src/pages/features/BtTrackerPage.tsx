/**
 * BT Tracker — professional service console for self-hosted WebTorrent/BT shares.
 * Tabs: overview | torrents | jobs | settings | about
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DataTable,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SegRadio,
  type OpsResultLike,
} from '../../shared/components/ui';
import { ServiceAccessStrip } from '../../features/network/service-exposure';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { toast } from '../../shared/stores/toast-store';
import {
  btTrackerApi,
  type BtTrackerSettings,
  type BtTrackerStatusDto,
  type BtTrackerTorrentRow,
} from '../../features/bt-tracker';
import { bindInput } from '../bind-handlers';

/** jobs merged into torrents tab (background create-torrent under swarm list) */
const TABS = ['overview', 'torrents', 'settings', 'about'] as const;

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

function formatSpeed(n: number | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB/s`;
}

function shortHash(h: string): string {
  if (!h || h.length < 12) return h || '—';
  return `${h.slice(0, 8)}…${h.slice(-4)}`;
}

function announceProto(url: string): 'http' | 'ws' | 'udp' | 'other' {
  if (url.startsWith('ws://') || url.startsWith('wss://')) return 'ws';
  if (url.startsWith('udp://')) return 'udp';
  if (url.startsWith('http://') || url.startsWith('https://')) return 'http';
  return 'other';
}

function seedStatusTone(
  s?: string,
): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (s === 'seeding') return 'ok';
  if (s === 'pending') return 'warn';
  if (s === 'error') return 'danger';
  if (s === 'stopped') return 'neutral';
  return 'neutral';
}

export function BtTrackerPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'overview');
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const [status, setStatus] = useState<BtTrackerStatusDto | null>(null);
  const [torrents, setTorrents] = useState<BtTrackerTorrentRow[]>([]);
  const [jobs, setJobs] = useState<TorrentJobRow[]>([]);
  const [draft, setDraft] = useState<Partial<BtTrackerSettings>>({});
  const [torrentQ, setTorrentQ] = useState('');
  const [torrentFilter, setTorrentFilter] = useState<'all' | 'seeding' | 'other'>('all');

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
      const tr = await btTrackerApi.torrents();
      setTorrents(tr.items ?? []);
    } catch {
      setTorrents([]);
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
      void refreshJobs();
      if (tab === 'overview') {
        void btTrackerApi
          .status()
          .then((st) => setStatus(st))
          .catch(() => undefined);
      }
    }, 5_000);
    return () => window.clearInterval(id);
  }, [tab, refreshJobs]);

  const running = Boolean(status?.running);
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
  const announceList = status?.announceUrls ?? [];
  const hasPublicHost = Boolean(status?.settings?.publicAnnounceHost?.trim());
  const torrentCount = status?.stats?.torrents ?? torrents.length ?? 0;
  const peerCount = status?.stats?.peers ?? 0;

  const filteredTorrents = useMemo(() => {
    const q = torrentQ.trim().toLowerCase();
    return torrents.filter((r) => {
      if (torrentFilter === 'seeding' && r.seedStatus !== 'seeding') return false;
      if (torrentFilter === 'other' && r.seedStatus === 'seeding') return false;
      if (!q) return true;
      const name = (r.name || '').toLowerCase();
      const hash = (r.infoHash || '').toLowerCase();
      return name.includes(q) || hash.includes(q);
    });
  }, [torrents, torrentQ, torrentFilter]);

  const torrentRows = useMemo(
    () => filteredTorrents.map((r) => ({ ...r, id: r.infoHash })),
    [filteredTorrents],
  );

  function patchDraft<K extends keyof BtTrackerSettings>(key: K, value: BtTrackerSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function copyText(text: string) {
    void navigator.clipboard?.writeText(text).then(
      () => toast.ok(t('btTracker.copied')),
      () => undefined,
    );
  }

  function seedLabel(s?: string): string {
    if (s === 'seeding') return t('btTracker.seedStatusSeeding');
    if (s === 'pending') return t('btTracker.seedStatusPending');
    if (s === 'error') return t('btTracker.seedStatusError');
    if (s === 'stopped') return t('btTracker.seedStatusStopped');
    if (!s || s === 'none') return t('btTracker.seedStatusNone');
    return s;
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
      subtitle={t('btTracker.pageDesc')}
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
            <Button variant="danger" size="sm" loading={busy} onClick={onStop}>
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
                (torrents.length || 0) + activeJobs > 0
                  ? torrents.length + activeJobs
                  : undefined,
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
                      {status?.settings?.publicAnnounceHost || '127.0.0.1'}
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
                    <Button variant="danger" size="sm" loading={busy} onClick={onStop}>
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
                  {hasPublicHost ? '✓' : '1.'} {t('btTracker.step1Title')}
                </span>
                <span className={`bt-chip ${running ? 'bt-chip--ok' : 'bt-chip--todo'}`}>
                  {running ? '✓' : '2.'} {t('btTracker.step2Title')}
                </span>
                <span
                  className={`bt-chip ${torrents.length ? 'bt-chip--ok' : 'bt-chip--todo'}`}
                >
                  {torrents.length ? '✓' : '3.'} {t('btTracker.step3Title')}
                </span>
              </div>

              {!status?.executeEnabled ? (
                <Alert variant="warn">{t('btTracker.needExecute')}</Alert>
              ) : null}

              <Card>
                <CardSection
                  title={t('btTracker.exposureTitle')}
                  description={t('btTracker.applyHint')}
                >
                  <ServiceAccessStrip serviceId="bt-tracker" />
                </CardSection>
              </Card>

              <Card>
                <CardSection
                  title={t('btTracker.announceUrls')}
                  description={t('btTracker.announceDesc')}
                >
                  {announceList.length === 0 ? (
                    <div className="bt-empty">
                      <p className="bt-empty__title">{t('btTracker.torrentsEmpty')}</p>
                    </div>
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

              {status?.notes?.length ? (
                <Alert variant="info">
                  <ul>
                    {status.notes.slice(0, 4).map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
            </div>
          ) : null}

          {tab === 'torrents' ? (
            <div className="tab-panel tab-panel--fill">
              <div className="bt-toolbar">
                <input
                  className="input bt-toolbar__search"
                  value={torrentQ}
                  onChange={(e) => setTorrentQ(e.target.value)}
                  placeholder={t('btTracker.searchTorrents')}
                  aria-label={t('btTracker.searchTorrents')}
                />
                <SegRadio
                  name="bt-tf"
                  size="sm"
                  value={torrentFilter}
                  onChange={(v) => setTorrentFilter(v as 'all' | 'seeding' | 'other')}
                  options={[
                    { value: 'all', label: t('btTracker.filterAll') },
                    { value: 'seeding', label: t('btTracker.filterSeeding') },
                    { value: 'other', label: t('btTracker.filterOther') },
                  ]}
                />
                <span className="bt-toolbar__spacer" />
                <span className={`bt-live${running ? ' bt-live--on' : ''}`}>
                  <span className="bt-live__dot" aria-hidden />
                  {running ? t('btTracker.live') : t('btTracker.liveOff')}
                </span>
                {activeJobs > 0 ? (
                  <Badge tone="warn">
                    {t('btTracker.statsJobs')}: {activeJobs}
                  </Badge>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    void btTrackerApi
                      .torrents()
                      .then((tr) => setTorrents(tr.items ?? []))
                      .catch((e: Error) => setError(e.message));
                    void refreshJobs();
                  }}
                >
                  {t('btTracker.refresh')}
                </Button>
                <Link className="btn btn--secondary btn--sm" to="/files?tab=shares">
                  {t('btTracker.openShares')}
                </Link>
              </div>

              {!running ? <Alert variant="warn">{t('btTracker.stopped')}</Alert> : null}

              {torrents.length === 0 ? (
                <div className="bt-empty">
                  <p className="bt-empty__title">{t('btTracker.torrentsEmpty')}</p>
                  <p className="bt-empty__desc">{t('btTracker.torrentsEmptyHint')}</p>
                </div>
              ) : torrentRows.length === 0 ? (
                <div className="bt-empty">
                  <p className="bt-empty__title">{t('btTracker.noMatch')}</p>
                </div>
              ) : (
                <div className="bt-table-wrap">
                  <DataTable
                    columns={[
                      {
                        key: 'name',
                        header: t('btTracker.colName'),
                        render: (r) => (
                          <div>
                            <div>{r.name || shortHash(r.infoHash)}</div>
                            {r.shareId ? (
                              <div className="muted u-text-xs">{r.shareId}</div>
                            ) : null}
                          </div>
                        ),
                      },
                      {
                        key: 'hash',
                        header: t('btTracker.colHash'),
                        render: (r) => (
                          <button
                            type="button"
                            className="bt-hash"
                            title={r.infoHash}
                            onClick={() => copyText(r.infoHash)}
                          >
                            {shortHash(r.infoHash)}
                          </button>
                        ),
                      },
                      {
                        key: 'seeds',
                        header: t('btTracker.colSeeds'),
                        render: (r) => (
                          <span className="bt-speed">{r.seeders ?? 0}</span>
                        ),
                      },
                      {
                        key: 'leechers',
                        header: t('btTracker.colLeechers'),
                        render: (r) => (
                          <span className="bt-speed">{r.leechers ?? 0}</span>
                        ),
                      },
                      {
                        key: 'status',
                        header: t('btTracker.colStatus'),
                        render: (r) => (
                          <Badge tone={seedStatusTone(r.seedStatus)}>
                            {seedLabel(r.seedStatus)}
                          </Badge>
                        ),
                      },
                      {
                        key: 'up',
                        header: t('files.btUploadSpeed'),
                        render: (r) => (
                          <span className="bt-speed">↑ {formatSpeed(r.uploadSpeed)}</span>
                        ),
                      },
                      {
                        key: 'down',
                        header: t('files.btDownloadSpeed'),
                        render: (r) => (
                          <span className="bt-speed">↓ {formatSpeed(r.downloadSpeed)}</span>
                        ),
                      },
                    ]}
                    rows={torrentRows}
                    rowKey={(r) => r.infoHash}
                  />
                </div>
              )}

              {/* Background create-torrent jobs (merged from former Jobs tab) */}
              <div className="bt-jobs-block">
                <div className="bt-toolbar bt-jobs-block__head">
                  <strong className="u-text-sm">{t('btTracker.jobs')}</strong>
                  <span className="muted u-text-xs">{t('btTracker.jobsDesc')}</span>
                  <span className="bt-toolbar__spacer" />
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void refreshJobs()}
                  >
                    {t('btTracker.refreshJobs')}
                  </Button>
                </div>
                {jobs.length === 0 ? (
                  <div className="bt-empty bt-empty--compact">
                    <p className="bt-empty__desc">{t('btTracker.jobsEmptyHint')}</p>
                  </div>
                ) : (
                  <div className="bt-table-wrap bt-table-wrap--jobs">
                    <DataTable
                      columns={[
                        {
                          key: 'job',
                          header: t('btTracker.colJob'),
                          render: (r) => (
                            <code className="u-text-sm" title={r.id}>
                              {r.id.length > 22 ? `${r.id.slice(0, 18)}…` : r.id}
                            </code>
                          ),
                        },
                        {
                          key: 'share',
                          header: t('btTracker.colShare'),
                          render: (r) => r.shareId,
                        },
                        {
                          key: 'status',
                          header: t('btTracker.colJobStatus'),
                          render: (r) => {
                            const tone =
                              r.status === 'done'
                                ? 'ok'
                                : r.status === 'error'
                                  ? 'danger'
                                  : r.status === 'running'
                                    ? 'info'
                                    : 'warn';
                            return <Badge tone={tone}>{r.status}</Badge>;
                          },
                        },
                        {
                          key: 'enqueued',
                          header: t('btTracker.colEnqueued'),
                          render: (r) =>
                            r.enqueuedAt
                              ? new Date(r.enqueuedAt).toLocaleString()
                              : '—',
                        },
                        {
                          key: 'notes',
                          header: t('btTracker.colStatus'),
                          render: (r) => (
                            <span className="u-text-sm muted">
                              {(r.notes || []).slice(0, 2).join(' · ') || '—'}
                            </span>
                          ),
                        },
                      ]}
                      rows={jobs}
                      rowKey={(r) => r.id}
                    />
                  </div>
                )}
              </div>
            </div>
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
                  setMsg(t('btTracker.saveOk'));
                  await refresh();
                  return r;
                });
              }}
            >
              <div className="bt-settings__card">
                <h3 className="bt-settings__card-title">{t('btTracker.networkCard')}</h3>
                <p className="bt-settings__card-desc">{t('btTracker.networkCardDesc')}</p>
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
                  </Field>
                  <Field label={t('btTracker.listenHost')} htmlFor="bt-host" flush>
                    <input
                      id="bt-host"
                      className="input"
                      value={draft.listenHost ?? '0.0.0.0'}
                      onChange={bindInput((v) => patchDraft('listenHost', v))}
                    />
                  </Field>
                  <Field
                    label={t('btTracker.publicAnnounceHost')}
                    htmlFor="bt-pub"
                    flush
                    hint={t('btTracker.publicAnnounceHostHint')}
                  >
                    <input
                      id="bt-pub"
                      className="input"
                      value={draft.publicAnnounceHost ?? ''}
                      onChange={bindInput((v) => patchDraft('publicAnnounceHost', v))}
                      placeholder="example.com"
                    />
                  </Field>
                  <label className="bt-toggle" htmlFor="bt-ws">
                    <input
                      id="bt-ws"
                      type="checkbox"
                      checked={draft.wsEnabled !== false}
                      onChange={(e) => patchDraft('wsEnabled', e.target.checked)}
                    />
                    <span className="bt-toggle__text">
                      <span className="bt-toggle__lab">{t('btTracker.wsEnabled')}</span>
                      <span className="bt-toggle__hint">{t('btTracker.wsEnabledHint')}</span>
                    </span>
                  </label>
                </FormLayout>
              </div>

              <div className="bt-settings__card">
                <h3 className="bt-settings__card-title">{t('btTracker.seederCard')}</h3>
                <p className="bt-settings__card-desc">{t('btTracker.seederCardDesc')}</p>
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
                  <Field
                    label={t('btTracker.seederPorts')}
                    htmlFor="bt-smin"
                    flush
                    hint={t('btTracker.seederPortsHint')}
                  >
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
                <p className="bt-settings__card-desc">{t('btTracker.lifecycleCardDesc')}</p>
                <FormLayout columns={1}>
                  <label className="bt-toggle" htmlFor="bt-auto">
                    <input
                      id="bt-auto"
                      type="checkbox"
                      checked={Boolean(draft.autostart)}
                      onChange={(e) => patchDraft('autostart', e.target.checked)}
                    />
                    <span className="bt-toggle__text">
                      <span className="bt-toggle__lab">{t('btTracker.autostart')}</span>
                      <span className="bt-toggle__hint">{t('btTracker.autostartHint')}</span>
                    </span>
                  </label>
                  <Alert variant="info">{t('btTracker.bundledNote')}</Alert>
                  <FormHint>{t('btTracker.applyHint')}</FormHint>
                </FormLayout>
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
    </FeaturePageLayout>
  );
}
