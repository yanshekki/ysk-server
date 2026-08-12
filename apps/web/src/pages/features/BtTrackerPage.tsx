/**
 * BT Tracker — self-hosted bittorrent-tracker for file-share WebTorrent/BT.
 * Tabs: overview | torrents | settings | about
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  PageGuide,
  PageTabs,
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

const TABS = ['overview', 'torrents', 'settings', 'about'] as const;

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

export function BtTrackerPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'overview');
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();
  const [status, setStatus] = useState<BtTrackerStatusDto | null>(null);
  const [torrents, setTorrents] = useState<BtTrackerTorrentRow[]>([]);
  const [draft, setDraft] = useState<Partial<BtTrackerSettings>>({});

  const refresh = useCallback(async () => {
    setError(null);
    const st = await btTrackerApi.status();
    setStatus(st);
    setDraft(st.settings ?? {});
    if (st.running) {
      try {
        const tr = await btTrackerApi.torrents();
        setTorrents(tr.items ?? []);
      } catch {
        setTorrents([]);
      }
    } else {
      setTorrents([]);
    }
  }, [setError]);

  useEffect(() => {
    void refresh().catch((e: Error) => setError(e.message));
  }, [refresh, setError]);

  useEffect(() => {
    if (!status?.running || tab !== 'torrents') return;
    const id = window.setInterval(() => {
      void btTrackerApi
        .torrents()
        .then((tr) => setTorrents(tr.items ?? []))
        .catch(() => undefined);
    }, 5_000);
    return () => window.clearInterval(id);
  }, [status?.running, tab]);

  const running = Boolean(status?.running);
  const pill = running
    ? { label: t('btTracker.running'), tone: 'ok' as const }
    : { label: t('btTracker.stopped'), tone: 'warn' as const };

  const announceList = status?.announceUrls ?? [];

  const torrentRows = useMemo(
    () =>
      torrents.map((r) => ({
        ...r,
        id: r.infoHash,
      })),
    [torrents],
  );

  function patchDraft<K extends keyof BtTrackerSettings>(key: K, value: BtTrackerSettings[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  return (
    <FeaturePageLayout
      title={t('nav.btTracker')}
      showCapability={false}
      status={{
        pill,
        items: [
          {
            label: t('btTracker.statsTorrents'),
            value: String(status?.stats?.torrents ?? torrents.length ?? 0),
          },
          {
            label: t('btTracker.statsPeers'),
            value: String(status?.stats?.peers ?? 0),
          },
          {
            label: t('btTracker.statsAnnounces'),
            value: String(status?.stats?.announces ?? 0),
          },
        ],
      }}
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? <Alert variant="ok">{msg}</Alert> : null}
      {result ? <OpsResultPanel result={result as OpsResultLike} /> : null}

      <PageTabs
        tabs={[
          { id: 'overview', label: t('btTracker.status') },
          {
            id: 'torrents',
            label: t('btTracker.torrents'),
            badge: torrents.length || undefined,
          },
          { id: 'settings', label: t('btTracker.settings') },
          { id: 'about', label: t('common.about', { defaultValue: 'About' }) },
        ]}
        active={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      >
        {tab === 'overview' ? (
          <div className="tab-panel u-stack u-gap-md">
            <ActionBar>
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => void refresh().catch((e: Error) => setError(e.message))}
              >
                {t('common.refresh', { defaultValue: 'Refresh' })}
              </Button>
              {!running ? (
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await btTrackerApi.start();
                      setMsg(t('btTracker.running'));
                      await refresh();
                      return r;
                    })
                  }
                >
                  {t('btTracker.start')}
                </Button>
              ) : (
                <Button
                  variant="danger"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = await btTrackerApi.stop();
                      setMsg(t('btTracker.stopped'));
                      await refresh();
                      return r;
                    })
                  }
                >
                  {t('btTracker.stop')}
                </Button>
              )}
              <Link className="btn btn--secondary btn--md" to="/files?tab=shares">
                {t('btTracker.openShares')}
              </Link>
            </ActionBar>

            <ServiceAccessStrip serviceId="bt-tracker" />

            {!status?.executeEnabled ? (
              <Alert variant="warn">{t('btTracker.needExecute')}</Alert>
            ) : null}

            <FormLayout columns={2}>
              <Field label={t('btTracker.status')} htmlFor="bt-st" flush>
                <div id="bt-st">
                  <Badge tone={running ? 'ok' : 'warn'}>
                    {running ? t('btTracker.running') : t('btTracker.stopped')}
                  </Badge>
                </div>
              </Field>
              <Field label={t('btTracker.installed')} htmlFor="bt-inst" flush>
                <div id="bt-inst">
                  <Badge tone="ok">{t('btTracker.installed')}</Badge>
                </div>
              </Field>
              <Field label={t('btTracker.httpPort')} htmlFor="bt-port-r" flush>
                <code id="bt-port-r">{status?.settings?.httpPort ?? '—'}</code>
              </Field>
              <Field label={t('btTracker.listenHost')} htmlFor="bt-host-r" flush>
                <code id="bt-host-r">{status?.settings?.listenHost ?? '—'}</code>
              </Field>
              <Field label={t('btTracker.wsEnabled')} htmlFor="bt-ws-r" flush>
                <div id="bt-ws-r">
                  <Badge tone={status?.settings?.wsEnabled ? 'ok' : 'neutral'}>
                    {status?.settings?.wsEnabled ? 'on' : 'off'}
                  </Badge>
                </div>
              </Field>
              <Field label={t('btTracker.publicAnnounceHost')} htmlFor="bt-pub-r" flush>
                <code id="bt-pub-r">{status?.settings?.publicAnnounceHost || '—'}</code>
              </Field>
            </FormLayout>

            <div>
              <h3 className="u-text-sm u-mb-sm">{t('btTracker.announceUrls')}</h3>
              {announceList.length === 0 ? (
                <EmptyState title={t('btTracker.torrentsEmpty')} />
              ) : (
                <ul className="u-stack u-gap-xs">
                  {announceList.map((u) => (
                    <li key={u} className="u-flex u-gap-sm u-items-center">
                      <code className="u-text-sm">{u}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard?.writeText(u).then(
                            () => toast.ok(t('btTracker.copy')),
                            () => undefined,
                          );
                        }}
                      >
                        {t('btTracker.copy')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {status?.notes?.length ? (
              <Alert variant="info">
                <ul>
                  {status.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
          </div>
        ) : null}

        {tab === 'torrents' ? (
          <div className="tab-panel u-stack u-gap-md">
            <ActionBar>
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() =>
                  void btTrackerApi
                    .torrents()
                    .then((tr) => setTorrents(tr.items ?? []))
                    .catch((e: Error) => setError(e.message))
                }
              >
                {t('common.refresh', { defaultValue: 'Refresh' })}
              </Button>
            </ActionBar>
            {!running ? <Alert variant="warn">{t('btTracker.stopped')}</Alert> : null}
            {torrentRows.length === 0 ? (
              <EmptyState title={t('btTracker.torrentsEmpty')} />
            ) : (
              <DataTable
                columns={[
                  {
                    key: 'name',
                    header: t('btTracker.colName'),
                    render: (r) => r.name || shortHash(r.infoHash),
                  },
                  {
                    key: 'hash',
                    header: t('btTracker.colHash'),
                    render: (r) => (
                      <code title={r.infoHash}>{shortHash(r.infoHash)}</code>
                    ),
                  },
                  {
                    key: 'seeds',
                    header: t('btTracker.colSeeds'),
                    render: (r) => String(r.seeders ?? 0),
                  },
                  {
                    key: 'leechers',
                    header: t('btTracker.colLeechers'),
                    render: (r) => String(r.leechers ?? 0),
                  },
                  {
                    key: 'status',
                    header: t('btTracker.colStatus'),
                    render: (r) => r.seedStatus || '—',
                  },
                  {
                    key: 'up',
                    header: t('files.btUploadSpeed'),
                    render: (r) => formatSpeed(r.uploadSpeed),
                  },
                  {
                    key: 'down',
                    header: t('files.btDownloadSpeed'),
                    render: (r) => formatSpeed(r.downloadSpeed),
                  },
                ]}
                rows={torrentRows}
                rowKey={(r) => r.infoHash}
              />
            )}
          </div>
        ) : null}

        {tab === 'settings' ? (
          <form
            className="tab-panel u-stack u-gap-md"
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
                setMsg(t('btTracker.saveSettings'));
                await refresh();
                return r;
              });
            }}
          >
            <FormHint>{t('btTracker.applyHint')}</FormHint>
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
                  placeholder="example.com:8000"
                />
              </Field>
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
                <div className="u-flex u-gap-sm">
                  <input
                    id="bt-smin"
                    type="number"
                    min={1}
                    max={65535}
                    className="input"
                    value={draft.seederPortMin ?? 6881}
                    onChange={(e) => patchDraft('seederPortMin', Number(e.target.value))}
                  />
                  <span>–</span>
                  <input
                    id="bt-smax"
                    type="number"
                    min={1}
                    max={65535}
                    className="input"
                    value={draft.seederPortMax ?? 6889}
                    onChange={(e) => patchDraft('seederPortMax', Number(e.target.value))}
                  />
                </div>
              </Field>
              <Field label={t('btTracker.wsEnabled')} htmlFor="bt-ws" flush>
                <label className="u-flex u-gap-sm u-items-center">
                  <input
                    id="bt-ws"
                    type="checkbox"
                    checked={draft.wsEnabled !== false}
                    onChange={(e) => patchDraft('wsEnabled', e.target.checked)}
                  />
                  <span>WebSocket</span>
                </label>
              </Field>
              <Field label={t('btTracker.autostart')} htmlFor="bt-auto" flush>
                <label className="u-flex u-gap-sm u-items-center">
                  <input
                    id="bt-auto"
                    type="checkbox"
                    checked={Boolean(draft.autostart)}
                    onChange={(e) => patchDraft('autostart', e.target.checked)}
                  />
                  <span>autostart</span>
                </label>
              </Field>
            </FormLayout>
            <FormActions>
              <Button type="submit" variant="primary" size="md" loading={busy}>
                {t('btTracker.saveSettings')}
              </Button>
            </FormActions>
          </form>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="btTracker" /> : null}
      </PageTabs>
    </FeaturePageLayout>
  );
}
