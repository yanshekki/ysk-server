/**
 * Add .torrent / magnet → choose Files dest → start WebTorrent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Field,
  FormHint,
  FormLayout,
  Modal,
  SegRadio,
} from '../../shared/components/ui';
import { filesApi } from '../files/api';
import { projectsApi } from '../projects';
import { btTrackerApi, type BtLibraryDestMode, type BtLibraryDestProbe, type BtLibraryInspect } from './api';
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
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<'file' | 'magnet'>('file');
  const [magnet, setMagnet] = useState('');
  const [fileName, setFileName] = useState('');
  const [b64, setB64] = useState('');
  const [inspected, setInspected] = useState<BtLibraryInspect | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [root, setRoot] = useState('public');
  const [parent, setParent] = useState('downloads');
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [dragOver, setDragOver] = useState(false);
  const [probe, setProbe] = useState<BtLibraryDestProbe | null>(null);
  const [destMode, setDestMode] = useState<BtLibraryDestMode>('download');

  const destName = inspected ? sanitizeFolder(inspected.name) : '';
  const saveRelPath = [parent.replace(/^\/+|\/+$/g, ''), destName].filter(Boolean).join('/');

  const destLabel = useMemo(() => {
    const r = root === 'public' ? t('btTracker.saveRootPublic') : root;
    const rel =
      destMode === 'seed-existing' && probe?.seedRel
        ? probe.seedRel === '.'
          ? '/'
          : probe.seedRel
        : saveRelPath || '—';
    return `${r}／${rel}`;
  }, [root, saveRelPath, destMode, probe, t]);

  function reset() {
    setSource('file');
    setMagnet('');
    setFileName('');
    setB64('');
    setInspected(null);
    setErr(null);
    setParent('downloads');
    setDragOver(false);
    setProbe(null);
    setDestMode('download');
  }

  useEffect(() => {
    if (!props.open) return;
    void projectsApi
      .list()
      .then((list) => {
        const items = list.items ?? [];
        setProjects(items.map((p) => ({ id: p.id, name: p.name })));
      })
      .catch(() => undefined);
  }, [props.open]);

  useEffect(() => {
    if (!props.open || !inspected) {
      setProbe(null);
      return;
    }
    let cancelled = false;
    void btTrackerApi
      .probeDest({
        saveRoot: root,
        parentRel: parent,
        name: inspected.name,
        files: inspected.files,
      })
      .then((r) => {
        if (cancelled) return;
        setProbe(r);
        setDestMode(r.canSeedExisting ? 'seed-existing' : 'download');
      })
      .catch(() => {
        if (!cancelled) setProbe(null);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open, inspected, root, parent]);

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
        .then((r) => setInspected(r))
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

  const blockedConflict =
    destMode === 'download' && probe?.destKind === 'file-conflict' && !probe.canSeedExisting;
  const canStart =
    Boolean(inspected) &&
    (destMode === 'seed-existing' ? Boolean(probe?.canSeedExisting) : Boolean(saveRelPath)) &&
    !blockedConflict;

  function startAdd() {
    if (!inspected || !canStart) return;
    setBusy(true);
    setErr(null);
    void btTrackerApi
      .addLibrary({
        torrentBase64: b64 || undefined,
        magnet: magnet.trim() || undefined,
        saveRoot: root,
        saveRelPath,
        parentRel: parent,
        mode: destMode,
      })
      .then(() => {
        reset();
        props.onAdded();
        props.onClose();
      })
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
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={busy}
            disabled={!canStart}
            onClick={startAdd}
          >
            {t('btTracker.startDownload')}
          </Button>
        </>
      }
    >
      <div className="bt-add">
        {err ? <Alert variant="error">{err}</Alert> : null}

        <section className="bt-add__section" aria-label={t('btTracker.addSourceSection')}>
          <h3 className="bt-add__h">{t('btTracker.addSourceSection')}</h3>
          <SegRadio
            name="bt-add-src"
            size="sm"
            value={source}
            onChange={(v) => setSource(v as 'file' | 'magnet')}
            options={[
              { value: 'file', label: t('btTracker.addSourceFile') },
              { value: 'magnet', label: t('btTracker.addSourceMagnet') },
            ]}
          />

          {source === 'file' ? (
            <div
              className={`bt-drop${dragOver ? ' is-over' : ''}${fileName ? ' is-ready' : ''}`}
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
                const f = e.dataTransfer.files?.[0];
                if (f) readFile(f);
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
                  const f = e.target.files?.[0];
                  if (f) readFile(f);
                  e.target.value = '';
                }}
              />
              <strong>{t('btTracker.dropTorrent')}</strong>
              <span className="muted">{t('btTracker.chooseFile')}</span>
              {fileName ? (
                <span className="bt-add__filechip">
                  {fileName}
                  <button
                    type="button"
                    className="bt-add__filex"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFileName('');
                      setB64('');
                      setInspected(null);
                    }}
                    aria-label={t('btTracker.clearFile')}
                  >
                    ×
                  </button>
                </span>
              ) : null}
            </div>
          ) : (
            <Field label={t('btTracker.magnetLabel')} htmlFor="bt-magnet" flush>
              <div className="bt-add__magnet-row">
                <input
                  id="bt-magnet"
                  className="input"
                  value={magnet}
                  onChange={(e) => setMagnet(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      inspectMagnet();
                    }
                  }}
                  placeholder={t('btTracker.magnetPlaceholder')}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy || !magnet.trim()}
                  onClick={inspectMagnet}
                >
                  {t('btTracker.inspect')}
                </Button>
              </div>
            </Field>
          )}
        </section>

        {inspected ? (
          <>
            <section className="bt-add__section" aria-label={t('btTracker.previewSection')}>
              <h3 className="bt-add__h">{t('btTracker.previewSection')}</h3>
              <div className="bt-add__preview">
                <strong className="bt-add__name">{inspected.name}</strong>
                <p className="muted u-text-sm u-mb-0">
                  {formatBytes(inspected.sizeBytes)} · {inspected.files.length || 1}{' '}
                  {t('btTracker.filesInTorrent')}
                </p>
                {props.extraTrackerCount > 0 ? (
                  <FormHint>
                    {t('btTracker.extraTrackersPreview', { n: props.extraTrackerCount })}
                  </FormHint>
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
              </div>
            </section>

            <section className="bt-add__section" aria-label={t('btTracker.saveLocation')}>
              <h3 className="bt-add__h">{t('btTracker.saveLocation')}</h3>
              {probe?.canSeedExisting ? (
                <Field label={t('btTracker.destMode')} htmlFor="bt-dest-mode" flush>
                  <SegRadio
                    name="bt-dest-mode"
                    size="sm"
                    value={destMode}
                    onChange={(v) => setDestMode(v as BtLibraryDestMode)}
                    options={[
                      { value: 'seed-existing', label: t('btTracker.seedExisting') },
                      { value: 'download', label: t('btTracker.downloadNewFolder') },
                    ]}
                  />
                </Field>
              ) : null}
              {blockedConflict ? (
                <Alert variant="warn">{t('btTracker.destFileConflict', { name: probe?.conflictName || destName })}</Alert>
              ) : null}
              <FormLayout>
                <Field label={t('btTracker.saveRoot')} htmlFor="bt-save-root" flush>
                  <select
                    id="bt-save-root"
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
                </Field>
              </FormLayout>
              <p className="bt-add__path">
                <span className="muted">{t('btTracker.destPreview')}</span>
                <code>{destLabel}</code>
              </p>
              <div className="bt-add__folder">
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
            </section>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
