/**
 * WebTorrent library list — progress rows, not a hash admin table.
 */
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, EmptyState, Modal, SegRadio } from '../../shared/components/ui';
import type { BtLibraryLive, BtTrackerTorrentRow } from './api';

function formatSpeed(n: number | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${Math.round(n)} B/s`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB/s`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB/s`;
}

function formatBytes(n: number | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function statusTone(s?: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (s === 'seeding') return 'ok';
  if (s === 'downloading' || s === 'checking') return 'info';
  if (s === 'error') return 'danger';
  if (s === 'paused' || s === 'queued') return 'warn';
  return 'neutral';
}

export function TorrentLibrary(props: {
  library: BtLibraryLive[];
  swarm: BtTrackerTorrentRow[];
  query: string;
  onQuery: (q: string) => void;
  filter: string;
  onFilter: (f: string) => void;
  running: boolean;
  busy: boolean;
  onAdd: () => void;
  onDropFiles: (files: FileList) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRemove: (id: string, deleteFiles: boolean) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const rows = useMemo(() => {
    const q = props.query.trim().toLowerCase();
    const fromLib = props.library.map((i) => ({
      key: i.id,
      libraryId: i.id,
      name: i.name,
      infoHash: i.infoHash,
      status: i.status,
      progress: i.progress ?? (i.status === 'seeding' ? 1 : 0),
      sizeBytes: i.sizeBytes,
      downloaded: i.downloaded,
      uploadSpeed: i.uploadSpeed,
      downloadSpeed: i.downloadSpeed,
      peers: i.peers,
      saveRoot: i.saveRoot,
      saveRelPath: i.saveRelPath,
      kind: 'library' as const,
      errorNote: i.errorNote,
      hint: i.hint,
    }));
    const libHashes = new Set(fromLib.map((r) => r.infoHash));
    const fromShare = props.swarm
      .filter((s) => s.kind !== 'library' && s.infoHash && !libHashes.has(s.infoHash))
      .map((s) => ({
        key: s.shareId || s.infoHash,
        libraryId: undefined as string | undefined,
        name: s.name || s.infoHash,
        infoHash: s.infoHash,
        status: s.seedStatus || 'none',
        progress: s.progress ?? (s.seedStatus === 'seeding' ? 1 : 0),
        sizeBytes: s.sizeBytes,
        downloaded: s.downloaded,
        uploadSpeed: s.uploadSpeed,
        downloadSpeed: s.downloadSpeed,
        peers: (s.seeders ?? 0) + (s.leechers ?? 0),
        saveRoot: s.saveRoot,
        saveRelPath: s.saveRelPath,
        kind: (s.kind === 'share' ? 'share' : 'swarm') as 'share' | 'swarm',
        errorNote: undefined as string | undefined,
        hint: undefined as string | undefined,
      }));
    return [...fromLib, ...fromShare].filter((r) => {
      if (props.filter === 'downloading' && r.status !== 'downloading' && r.status !== 'checking') {
        return false;
      }
      if (props.filter === 'seeding' && r.status !== 'seeding') return false;
      if (props.filter === 'paused' && r.status !== 'paused' && r.status !== 'queued') return false;
      if (props.filter === 'error' && r.status !== 'error') return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.infoHash.toLowerCase().includes(q);
    });
  }, [props.library, props.swarm, props.query, props.filter]);

  function statusLabel(s: string): string {
    if (s === 'seeding') return t('btTracker.seedStatusSeeding');
    if (s === 'downloading') return t('btTracker.seedStatusDownloading');
    if (s === 'checking') return t('btTracker.seedStatusChecking');
    if (s === 'paused') return t('btTracker.seedStatusPaused');
    if (s === 'queued') return t('btTracker.seedStatusQueued');
    if (s === 'error') return t('btTracker.seedStatusError');
    if (s === 'pending') return t('btTracker.seedStatusPending');
    if (s === 'stopped') return t('btTracker.seedStatusStopped');
    return s;
  }

  const emptyLib = props.library.length === 0 && props.swarm.length === 0;

  return (
    <div className="tab-panel tab-panel--fill">
      {!props.running ? (
        <p className="muted u-text-sm">{t('btTracker.stopped')}</p>
      ) : null}
      <div className="bt-toolbar">
        <Button variant="primary" size="sm" onClick={props.onAdd}>
          {t('btTracker.addTorrent')}
        </Button>
        <input
          className="input bt-toolbar__search"
          value={props.query}
          onChange={(e) => props.onQuery(e.target.value)}
          placeholder={t('btTracker.searchTorrents')}
          aria-label={t('btTracker.searchTorrents')}
        />
        <SegRadio
          name="bt-tf"
          size="sm"
          value={props.filter}
          onChange={(v) => props.onFilter(v)}
          options={[
            { value: 'all', label: t('btTracker.filterAll') },
            { value: 'downloading', label: t('btTracker.filterDownloading') },
            { value: 'seeding', label: t('btTracker.filterSeeding') },
            { value: 'paused', label: t('btTracker.filterPaused') },
            { value: 'error', label: t('btTracker.filterError') },
          ]}
        />
        <span className="bt-toolbar__spacer" />
        <Link className="btn btn--secondary btn--sm" to="/files?tab=shares">
          {t('btTracker.openShares')}
        </Link>
      </div>

      {rows.length === 0 && emptyLib ? (
        <div
          className={`bt-drop bt-drop--page${dragOver ? ' is-over' : ''}`}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) props.onDropFiles(e.dataTransfer.files);
          }}
          role="button"
          tabIndex={0}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".torrent,application/x-bittorrent"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => {
              if (e.target.files?.length) props.onDropFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <EmptyState title={t('btTracker.emptyDrop')} description={t('btTracker.emptyHint')} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t('btTracker.noMatch')} />
      ) : (
        <ul className="bt-lib">
          {rows.map((r) => {
            const pct = Math.max(0, Math.min(100, Math.round((r.progress ?? 0) * 100)));
            const filesHref =
              r.saveRoot && r.saveRelPath
                ? `/files?root=${encodeURIComponent(r.saveRoot)}&path=${encodeURIComponent(r.saveRelPath)}`
                : null;
            return (
              <li key={r.key} className="bt-lib__row">
                <div className="bt-lib__top">
                  <button
                    type="button"
                    className="bt-lib__main"
                    onClick={() => setOpenId((id) => (id === r.key ? null : r.key))}
                  >
                    <div className="bt-lib__title">
                      <strong>{r.name}</strong>
                      {r.kind === 'share' ? (
                        <Badge tone="neutral">{t('btTracker.kindShare')}</Badge>
                      ) : null}
                      <Badge tone={statusTone(r.status)}>{statusLabel(r.status)}</Badge>
                    </div>
                  </button>
                  <div className="bt-lib__actions">
                    {r.libraryId && (r.status === 'paused' || r.status === 'queued') ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={props.busy}
                        onClick={() => props.onResume(r.libraryId!)}
                      >
                        {t('btTracker.resume')}
                      </Button>
                    ) : r.libraryId ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={props.busy}
                        onClick={() => props.onPause(r.libraryId!)}
                      >
                        {t('btTracker.pause')}
                      </Button>
                    ) : null}
                    {filesHref ? (
                      <Link className="btn btn--secondary btn--sm" to={filesHref}>
                        {t('btTracker.openFolder')}
                      </Link>
                    ) : null}
                    {r.libraryId ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={props.busy}
                        onClick={() => setRemoveId(r.libraryId!)}
                      >
                        {t('btTracker.remove')}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="bt-lib__bar" aria-hidden>
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="bt-lib__meta">
                  <span>
                    {pct}% · {formatBytes(r.downloaded)} / {formatBytes(r.sizeBytes)}
                  </span>
                  {r.saveRelPath ? (
                    <span>
                      {t('btTracker.savedTo')}{' '}
                      {r.saveRoot === 'public' ? t('btTracker.saveRootPublic') : r.saveRoot}／
                      {r.saveRelPath}
                    </span>
                  ) : null}
                  <span>
                    ↓ {formatSpeed(r.downloadSpeed)} · ↑ {formatSpeed(r.uploadSpeed)} ·{' '}
                    {r.peers ?? 0} peers
                  </span>
                </div>
                {r.hint ? <p className="muted u-text-sm u-mb-0">{r.hint}</p> : null}
                {openId === r.key ? (
                  <div className="bt-lib__detail">
                    <code>{r.infoHash}</code>
                    {r.errorNote ? <p className="bt-add__err">{r.errorNote}</p> : null}
                    {r.hint ? <p className="muted u-text-sm">{r.hint}</p> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={Boolean(removeId)}
        onClose={() => setRemoveId(null)}
        title={t('btTracker.remove')}
        description={t('btTracker.removeConfirm')}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setRemoveId(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (removeId) props.onRemove(removeId, false);
                setRemoveId(null);
              }}
            >
              {t('btTracker.removeKeep')}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                if (removeId) props.onRemove(removeId, true);
                setRemoveId(null);
              }}
            >
              {t('btTracker.removeDelete')}
            </Button>
          </>
        }
      >
        <p className="muted">{t('btTracker.removeConfirm')}</p>
      </Modal>
    </div>
  );
}
