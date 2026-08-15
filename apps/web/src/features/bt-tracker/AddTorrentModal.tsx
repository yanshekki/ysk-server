/**
 * Add .torrent / magnet → choose Files dest → start WebTorrent.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal } from '../../shared/components/ui';
import { filesApi } from '../files/api';
import { projectsApi } from '../projects';
import { btTrackerApi, type BtLibraryInspect } from './api';
import { FolderPicker } from './FolderPicker';

function sanitizeFolder(name: string): string {
  const s = String(name || '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return s || 'download';
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AddTorrentModal(props: {
  open: boolean;
  onClose: () => void;
  extraTrackerCount: number;
  onAdded: () => void;
}) {
  const { t } = useTranslation();
  const [magnet, setMagnet] = useState('');
  const [fileName, setFileName] = useState('');
  const [b64, setB64] = useState('');
  const [inspected, setInspected] = useState<BtLibraryInspect | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [root, setRoot] = useState('public');
  const [parent, setParent] = useState('downloads');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);

  const destName = inspected ? sanitizeFolder(inspected.name) : '';
  const saveRelPath = [parent.replace(/^\/+|\/+$/g, ''), destName].filter(Boolean).join('/');

  const destLabel = useMemo(() => {
    const r = root === 'public' ? t('btTracker.saveRootPublic') : root;
    return `${r}／${saveRelPath || '—'}`;
  }, [root, saveRelPath, t]);

  function reset() {
    setMagnet('');
    setFileName('');
    setB64('');
    setInspected(null);
    setErr(null);
    setParent('downloads');
  }

  function readFile(f: File) {
    setErr(null);
    if (!/\.torrent$/i.test(f.name) && f.type !== 'application/x-bittorrent') {
      setErr(t('btTracker.needTorrentFile'));
      return;
    }
    if (f.size > 8 * 1024 * 1024) {
      setErr(t('btTracker.torrentTooBig'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      if (!(buf instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(buf);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
      const encoded = btoa(bin);
      setB64(encoded);
      setFileName(f.name);
      setBusy(true);
      void btTrackerApi
        .inspect({ torrentBase64: encoded })
        .then((r) => {
          setInspected(r);
          void projectsApi
            .list()
            .then((list) => {
              const items = list.items ?? [];
              setProjects(items.map((p) => ({ id: p.id, name: p.name })));
            })
            .catch(() => undefined);
        })
        .catch((e: Error) => setErr(e.message))
        .finally(() => setBusy(false));
    };
    reader.readAsArrayBuffer(f);
  }

  function inspectMagnet() {
    const m = magnet.trim();
    if (!m) return;
    setBusy(true);
    setErr(null);
    void btTrackerApi
      .inspect({ magnet: m })
      .then((r) => setInspected(r))
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  }

  return (
    <Modal
      open={props.open}
      onClose={() => {
        reset();
        props.onClose();
      }}
      title={t('btTracker.addTorrentTitle')}
      description={t('btTracker.addTorrentHint')}
      size="lg"
      className="bt-add-modal"
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              props.onClose();
            }}
          >
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={busy}
            disabled={!inspected || !saveRelPath}
            onClick={() => {
              if (!inspected) return;
              setBusy(true);
              setErr(null);
              void btTrackerApi
                .addLibrary({
                  torrentBase64: b64 || undefined,
                  magnet: magnet.trim() || undefined,
                  saveRoot: root,
                  saveRelPath,
                })
                .then(() => {
                  reset();
                  props.onAdded();
                  props.onClose();
                })
                .catch((e: Error) => setErr(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {t('btTracker.startDownload')}
          </Button>
        </>
      }
    >
      <div className="bt-add">
        {err ? <p className="bt-add__err">{err}</p> : null}
        <label
          className="bt-drop"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) readFile(f);
          }}
        >
          <input
            type="file"
            accept=".torrent,application/x-bittorrent"
            className="u-sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = '';
            }}
          />
          <strong>{t('btTracker.dropTorrent')}</strong>
          <span className="muted">{fileName || t('btTracker.chooseFile')}</span>
        </label>
        <label className="bt-add__magnet">
          <span>{t('btTracker.magnetLabel')}</span>
          <div className="bt-add__magnet-row">
            <input
              className="input"
              value={magnet}
              onChange={(e) => setMagnet(e.target.value)}
              placeholder={t('btTracker.magnetPlaceholder')}
            />
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={inspectMagnet}>
              {t('btTracker.inspect')}
            </Button>
          </div>
        </label>

        {inspected ? (
          <div className="bt-add__meta">
            <div>
              <strong>{inspected.name}</strong>
              <div className="muted u-text-sm">
                {formatBytes(inspected.sizeBytes)} · {inspected.files.length || 1}{' '}
                {t('btTracker.filesInTorrent')}
              </div>
            </div>
            {props.extraTrackerCount > 0 ? (
              <p className="muted u-text-sm">
                {t('btTracker.extraTrackersPreview', { n: props.extraTrackerCount })}
              </p>
            ) : null}
            {inspected.files.length > 1 ? (
              <ul className="bt-add__files">
                {inspected.files.slice(0, 12).map((f) => (
                  <li key={f.path}>
                    {f.path}{' '}
                    <span className="muted">{formatBytes(f.length)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            <label className="bt-add__root">
              <span>{t('btTracker.saveLocation')}</span>
              <select
                className="input"
                value={root}
                onChange={(e) => setRoot(e.target.value)}
              >
                <option value="public">{t('btTracker.saveRootPublic')}</option>
                {projects.map((p) => (
                  <option key={p.id} value={`project:${p.id}`}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted u-text-sm">
              {t('btTracker.destPreview')}: {destLabel}
            </p>
            <FolderPicker
              root={root}
              path={parent}
              onPath={setParent}
              onNewFolder={async (name) => {
                const next = [parent, name].filter(Boolean).join('/');
                await filesApi.mkdir(root, next, { leafOnly: true, name });
                setParent(next);
              }}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
