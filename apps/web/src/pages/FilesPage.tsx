/**
 * ownCloud-style file manager — public + project roots, trash, shares, upload.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormHint,
  FormLayout,
  Modal,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  PageTabs,
  FormActions,
  buttonClassName } from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';

const FILE_TABS = ['browse', 'trash', 'shares', 'webdav', 'about'] as const;
import {
  filesApi,
  fileToBase64,
  type FileEntry,
  type TrashEntry,
  type FileShare,
} from '../features/files/api';
import {
  collectFromDataTransfer,
  collectFromFileList,
  type CollectedUpload,
} from '../features/files/drop-collect';
import { projectsApi } from '../features/projects';
import { authStore } from '../shared/stores/auth-store';
import { toast } from '../shared/stores/toast-store';
import {
  bindSet,
  bindInput,
  bindVoid,
  bindCall1,
  bindOpenRename,
  bindOpenMoveCopy,
  bindOpenShare,
  bindOpenZip,
  bindOpenChmod,
  bindFilesSide,
  bindCloseVersions,
  bindCloseIfIdle } from './bind-handlers';

type ViewMode = 'list' | 'grid';
type SideView = 'all' | 'favorites' | 'shares' | 'trash';
type SortKey = 'name' | 'size' | 'mtime';

type UploadJobStatus = 'queued' | 'uploading' | 'done' | 'error';

type UploadJob = {
  id: string;
  relativePath: string;
  folderLabel: string;
  kind: 'file' | 'dir';
  status: UploadJobStatus;
  /** 0–100 */
  progress: number;
  error?: string;
  file?: File;
};

const UPLOAD_CONCURRENCY = 4;
const UPLOAD_MAX_ITEMS = 200;

function joinUploadPath(dir: string, relativePath: string): string {
  const rel = relativePath.replace(/^\/+/, '');
  if (!dir || dir === '.') return rel;
  return `${dir.replace(/\/$/, '')}/${rel}`;
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const n = Math.max(1, concurrency);
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        await worker(items[idx]!);
      }
    }),
  );
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function iconFor(e: FileEntry): string {
  if (e.type === 'dir') return '📁';
  const m = e.mime ?? '';
  if (m.startsWith('image/')) return '🖼';
  if (m === 'application/pdf') return '📄';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m.startsWith('text/') || m.includes('json')) return '📝';
  return '📎';
}

export function joinPath(dir: string, name: string): string {
  if (!dir || dir === '.') return name;
  return `${dir.replace(/\/$/, '')}/${name}`;
}

/** Breadcrumb segments for a relative path (`.` / empty → none). */
export function pathCrumbs(path: string): string[] {
  if (path === '.' || !path) return [];
  return path.split('/').filter(Boolean);
}

export function previewKind(
  mime?: string | null,
): 'image' | 'pdf' | 'text' | 'other' {
  const m = mime ?? '';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('text/') || m.includes('json') || m.includes('javascript'))
    return 'text';
  return 'other';
}

export function parseSortValue(v: string): {
  sort: SortKey;
  order: 'asc' | 'desc';
} {
  const [s, o] = v.split(':') as [SortKey, 'asc' | 'desc'];
  return { sort: s, order: o };
}

export function togglePathInSet(prev: Set<string>, p: string): Set<string> {
  const n = new Set(prev);
  if (n.has(p)) n.delete(p);
  else n.add(p);
  return n;
}

/** Format mtime cell for table (ISO → local-ish short). */
export function formatMtimeCell(mtime: string | null | undefined): string {
  const s = (mtime ?? '').toString().slice(0, 19).replace('T', ' ');
  return s || '—';
}

/** Whether entry is a directory. */
export function isDirEntry(e: { isDir?: boolean; type?: string }): boolean {
  return Boolean(e.isDir) || e.type === 'directory' || e.type === 'dir';
}

/** Parent directory of a path. */
export function parentPath(path: string): string {
  const p = path.replace(/\/+$/, '');
  if (!p || p === '/') return '/';
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i) || '/';
}

/** Filter entries by free-text name. */
export function filterEntriesByName<T extends { name: string }>(
  entries: T[],
  q: string,
): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return entries;
  return entries.filter((e) => e.name.toLowerCase().includes(s));
}

/** Sort entries by field. */
export function sortEntries<
  T extends { name: string; size?: number; mtime?: string; isDir?: boolean },
>(
  entries: T[],
  sort: { field: string; dir: 'asc' | 'desc' },
): T[] {
  const mul = sort.dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    // dirs first
    const ad = isDirEntry(a) ? 0 : 1;
    const bd = isDirEntry(b) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    if (sort.field === 'size') {
      return ((a.size ?? 0) - (b.size ?? 0)) * mul;
    }
    if (sort.field === 'mtime') {
      return String(a.mtime ?? '').localeCompare(String(b.mtime ?? '')) * mul;
    }
    return a.name.localeCompare(b.name) * mul;
  });
}

/** Selection count label. */
export function selectionLabel(count: number): string {
  return String(count);
}

/** Whether path is absolute. */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/');
}

export function selectAllPaths(
  items: Array<{ path: string }>,
  selectedSize: number,
): Set<string> {
  if (selectedSize === items.length) return new Set();
  return new Set(items.map((i) => i.path));
}

export function FilesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rootFromQuery = searchParams.get('root') || 'public';
  const [root, setRoot] = useState(rootFromQuery);
  const [path, setPath] = useState('.');
  const [items, setItems] = useState<FileEntry[]>([]);
  const [usage, setUsage] = useState<{ bytes: number; fileCount: number; dirCount: number } | null>(
    null,
  );
  const [side, setSide] = useState<SideView>('all');
  const [view, setView] = useState<ViewMode>('list');
  const [sort, setSort] = useState<SortKey>('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setErrorRaw] = useState<string | null>(null);
  const setError = useCallback((text: string | null) => {
    if (text) toast.error(text);
    setErrorRaw(null);
  }, []);
  const setMsg = useCallback((text: string | null) => {
    if (text) toast.ok(text);
  }, []);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [uploadPanelOpen, setUploadPanelOpen] = useState(false);

  // dialogs
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState('');
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newFileName, setNewFileName] = useState('untitled.txt');
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [moveTarget, setMoveTarget] = useState<{ entries: FileEntry[]; mode: 'move' | 'copy' } | null>(
    null,
  );
  const [moveDest, setMoveDest] = useState('');
  const [delPaths, setDelPaths] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<{
    entry: FileEntry;
    kind: 'text' | 'image' | 'pdf' | 'other';
    content?: string;
    url?: string;
  } | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [shares, setShares] = useState<FileShare[]>([]);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [sharePass, setSharePass] = useState('');
  const [shareResult, setShareResult] = useState<string | null>(null);
  const [versionsPath, setVersionsPath] = useState<string | null>(null);
  const [versions, setVersions] = useState<
    Array<{ id: string; path: string; createdAt: string; bytes: number }>
  >([]);
  const [webdavToken, setWebdavToken] = useState<string | null>(null);
  const [webdavEnabled, setWebdavEnabled] = useState(false);
  const [chmodOpen, setChmodOpen] = useState(false);
  const [chmodMode, setChmodMode] = useState('644');
  const [zipOpen, setZipOpen] = useState(false);
  const [zipName, setZipName] = useState('');
  const [opsNote, setOpsNote] = useState<{ ok: boolean; notes: string[] } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    setError(null);
    try {
      if (side === 'trash') {
        const r = await filesApi.trash(root);
        setTrash(r.items);
        setItems([]);
        return;
      }
      if (side === 'shares') {
        const r = await filesApi.listShares(root);
        setShares(r.items);
        setItems([]);
        return;
      }
      const r = await filesApi.list(root, path, {
        sort,
        order,
        q: debouncedQuery || undefined });
      let list = r.items;
      if (side === 'favorites') {
        list = list.filter((i) => i.favorite);
      }
      setItems(list);
      setUsage(r.usage ?? null);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [root, path, sort, order, debouncedQuery, side, t]);

  useEffect(() => {
    const tmr = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(tmr);
  }, [query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void projectsApi
      .list()
      .then((r) => setProjects(r.items.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => setProjects([]));
  }, []);

  // Honor ?root=public|project:<id> once on mount
  useEffect(() => {
    const q = searchParams.get('root');
    if (q) {
      setRoot(q);
      setPath('.');
      setSide('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeRoot(next: string) {
    setRoot(next);
    setPath('.');
    setSide('all');
    setSelected(new Set());
    setSearchParams(next === 'public' ? {} : { root: next }, { replace: true });
  }

  const crumbs = useMemo(() => pathCrumbs(path), [path]);

  async function run(fn: () => Promise<void>, okMsg?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  const patchUpload = useCallback((id: string, patch: Partial<UploadJob>) => {
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  async function enqueueUploads(collected: CollectedUpload[]) {
    if (!collected.length) return;
    if (collected.length > UPLOAD_MAX_ITEMS) {
      toast.warn(
        t('files.uploadTruncated', { max: UPLOAD_MAX_ITEMS, total: collected.length }),
      );
    }
    const batch = collected.slice(0, UPLOAD_MAX_ITEMS);

    const jobs: UploadJob[] = batch.map((c, i) => ({
      id: `${Date.now()}-${i}-${c.relativePath}`,
      relativePath: c.relativePath,
      folderLabel: c.folderLabel,
      kind: c.kind,
      status: 'queued',
      progress: 0,
      file: c.file,
    }));

    setUploads((prev) => [...jobs, ...prev].slice(0, 300));
    setUploadPanelOpen(true);

    const targetDir = path;
    const rootKey = root;
    let okCount = 0;
    let errCount = 0;

    await runPool(jobs, UPLOAD_CONCURRENCY, async (job) => {
      patchUpload(job.id, { status: 'uploading', progress: 2 });
      try {
        if (job.kind === 'dir') {
          const full = joinUploadPath(targetDir, job.relativePath);
          await filesApi.mkdir(rootKey, full);
          patchUpload(job.id, { status: 'done', progress: 100 });
          okCount += 1;
          return;
        }
        if (!job.file) {
          patchUpload(job.id, {
            status: 'error',
            progress: 0,
            error: t('files.uploadNoFile'),
          });
          errCount += 1;
          return;
        }
        const base64 = await fileToBase64(job.file, (ratio) => {
          // Reading local file: 0–70%
          patchUpload(job.id, {
            status: 'uploading',
            progress: Math.round(ratio * 70),
          });
        });
        patchUpload(job.id, { progress: 75 });
        await filesApi.upload(rootKey, targetDir, [
          { name: job.relativePath, base64 },
        ]);
        patchUpload(job.id, { status: 'done', progress: 100 });
        okCount += 1;
      } catch (e) {
        patchUpload(job.id, {
          status: 'error',
          progress: 0,
          error: e instanceof Error ? e.message : t('common.opFailed'),
        });
        errCount += 1;
      }
    });

    await refresh();
    if (okCount > 0) setMsg(t('files.uploadDone', { count: okCount }));
    if (errCount > 0) setError(t('files.uploadSomeFailed', { count: errCount }));
  }

  async function onUploadFiles(fileList: FileList | File[]) {
    await enqueueUploads(collectFromFileList(fileList));
  }

  async function onDropTransfer(dt: DataTransfer) {
    const collected = await collectFromDataTransfer(dt);
    await enqueueUploads(collected);
  }

  const uploadStats = useMemo(() => {
    const total = uploads.length;
    const active = uploads.filter((u) => u.status === 'uploading' || u.status === 'queued');
    const done = uploads.filter((u) => u.status === 'done').length;
    const err = uploads.filter((u) => u.status === 'error').length;
    const overall =
      total === 0
        ? 0
        : Math.round(
            uploads.reduce((s, u) => s + (u.status === 'done' ? 100 : u.progress), 0) /
              total,
          );
    // Active first so progress list shows what's running now
    const rank: Record<UploadJobStatus, number> = {
      uploading: 0,
      queued: 1,
      error: 2,
      done: 3,
    };
    const visible = [...uploads]
      .sort((a, b) => rank[a.status] - rank[b.status])
      .slice(0, 40);
    return { total, active: active.length, done, err, overall, visible };
  }, [uploads]);

  function toggleSelect(p: string) {
    setSelected((prev) => togglePathInSet(prev, p));
  }

  function selectAll() {
    setSelected(selectAllPaths(items, selected.size));
  }

  async function openEntry(e: FileEntry) {
    if (e.type === 'dir') {
      setPath(e.path);
      setSide('all');
      return;
    }
    const kind = previewKind(e.mime);
    if (kind === 'image') {
      try {
        const tkn = authStore.getToken();
        const res = await fetch(filesApi.downloadUrl(root, e.path), {
          headers: tkn ? { Authorization: `Bearer ${tkn}` } : {} });
        if (!res.ok) throw new Error('preview failed');
        const blob = await res.blob();
        setPreview({ entry: e, kind: 'image', url: URL.createObjectURL(blob) });
      } catch {
        setPreview({ entry: e, kind: 'other' });
      }
      return;
    }
    if (kind === 'pdf') {
      setPreview({ entry: e, kind: 'pdf' });
      return;
    }
    if (kind === 'text') {
      const r = await filesApi.read(root, e.path);
      setPreview({ entry: e, kind: 'text', content: r.content });
      return;
    }
    setPreview({ entry: e, kind: 'other' });
  }

  async function doDownload(p: string) {
    setBusy(true);
    try {
      const tkn = authStore.getToken();
      const res = await fetch(filesApi.downloadUrl(root, p), {
        headers: tkn ? { Authorization: `Bearer ${tkn}` } : {} });
      if (!res.ok) throw new Error(t('files.downloadFailedStatus', { status: res.status }));
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = p.split('/').pop() || 'file';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('files.downloadFailed'));
    } finally {
      setBusy(false);
    }
  }

  const selectedEntries = items.filter((i) => selected.has(i.path));

  const [tab, setTab] = usePageTab(FILE_TABS, 'browse');

  return (
    <FeaturePageLayout
      title={t('nav.files')}
      status={{
        pill: {
          label: t('files.pillFiles', { count: items.filter((i) => i.type === 'file').length }),
          tone: 'ok' },
        items: [
          {
            label: t('files.statFiles'),
            value: String(
              usage?.fileCount ?? items.filter((i) => i.type === 'file').length,
            ) },
          {
            label: t('files.statFolders'),
            value: String(
              usage?.dirCount ?? items.filter((i) => i.type === 'dir').length,
            ) },
          { label: t('files.statUsage'), value: formatBytes(usage?.bytes ?? 0) },
          { label: t('files.statSelected'), value: String(selected.size) },
          { label: t('files.statTrash'), value: trash.length },
          { label: t('files.statShares'), value: shares.length },
        ] }}
      actions={<ActionBar>
          <Link to="/files/public" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
            {t('files.publicSiteSettings')}
          </Link>
          <Button variant="secondary" size="sm" loading={busy} onClick={bindVoid(refresh)}>
            {t('common.refresh')}
          </Button>
        </ActionBar>
      }
    >

      {opsNote ? (
        <div className="stack">
          <OpsResultPanel
            title={t('files.opsResultTitle')}
            result={{
              ok: opsNote.ok,
              notes: opsNote.notes }}
            busy={busy}
          />
          <ActionBar size="sm">
            <Button variant="ghost" size="sm" onClick={bindSet(setOpsNote, null)}>
              {t('files.closeResult')}
            </Button>
          </ActionBar>
        </div>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'browse', label: t('files.tabBrowse') },
          { id: 'trash', label: t('files.tabTrash'), badge: trash.length || undefined },
          { id: 'shares', label: t('files.tabShares'), badge: shares.length || undefined },
          { id: 'webdav', label: 'WebDAV' },
        
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={(id) => {
          setTab(id);
          if (id === 'browse' && (side === 'trash' || side === 'shares')) setSide('all');
          if (id === 'trash') setSide('trash');
          if (id === 'shares') setSide('shares');
        }}
        variant="scroll"
      >
        {tab === 'browse' ? (
          <div className="tab-panel">
      <div className="fm-layout">
        {/* Sidebar */}
        <aside className="fm-sidebar">
          <div className="fm-sidebar__section">
            <div className="fm-sidebar__label">{t('files.spaceLabel')}</div>
            <button
              type="button"
              className={`fm-side-item${root === 'public' ? ' is-active' : ''}`}
              onClick={bindCall1(changeRoot, 'public')}
            >
              📁 {t('files.publicFiles')}
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`fm-side-item${root === `project:${p.id}` ? ' is-active' : ''}`}
                onClick={bindCall1(changeRoot, `project:${p.id}`)}
              >
                ▣ {p.name}
              </button>
            ))}
          </div>
          <div className="fm-sidebar__section">
            <div className="fm-sidebar__label">{t('files.viewLabel')}</div>
            {(
              [
                ['all', t('files.allFiles')],
                ['favorites', t('files.favorites')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`fm-side-item${side === id ? ' is-active' : ''}`}
                onClick={bindFilesSide(setSide, setTab, id)}
              >
                {label}
              </button>
            ))}
          </div>
        </aside>

        {/* Main */}
        <div className="fm-main">
                      <>
              {/* Toolbar */}
              <div className="fm-toolbar">
                <ActionBar>
                  <label className={`${buttonClassName({ variant: 'primary', size: 'md' })} fm-upload-btn`}>
                    {t('files.upload')}
                    <input
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => {
                        if (e.target.files) void onUploadFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <label className={`${buttonClassName({ variant: 'secondary', size: 'md' })} fm-upload-btn`}>
                    {t('files.uploadFolder')}
                    <input
                      type="file"
                      multiple
                      hidden
                      ref={(el) => {
                        if (el) {
                          el.setAttribute('webkitdirectory', '');
                          el.setAttribute('directory', '');
                        }
                      }}
                      onChange={(e) => {
                        if (e.target.files) void onUploadFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <Button variant="secondary" size="md" onClick={bindSet(setMkdirOpen, true)}>
                    {t('files.newFolder')}
                  </Button>
                  <Button variant="secondary" size="md" onClick={bindSet(setNewFileOpen, true)}>
                    {t('files.newTextFile')}
                  </Button>
                  {selected.size > 0 ? (
                    <>
                      <Button
                        variant="secondary"
                        size="md"
                        loading={busy}
                        onClick={() => {
                          const first = selectedEntries[0];
                          if (first && first.type === 'file') void doDownload(first.path);
                        }}
                      >
                        {t('files.download')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={bindOpenMoveCopy(setMoveTarget, setMoveDest, selectedEntries, 'copy', path)}
                      >
                        {t('files.copy')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={bindOpenMoveCopy(setMoveTarget, setMoveDest, selectedEntries, 'move', path)}
                      >
                        {t('files.move')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={busy}
                        onClick={bindOpenChmod(setChmodMode, setChmodOpen)}
                      >
                        chmod
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={busy}
                        onClick={bindOpenZip(setZipName, setZipOpen)}
                      >
                        {t('files.zip')}
                      </Button>
                      {selectedEntries.length === 1 &&
                      selectedEntries[0]?.name.toLowerCase().endsWith('.zip') ? (
                        <Button
                          variant="secondary"
                          size="md"
                          loading={busy}
                          onClick={() => {
                            const zipPath = selectedEntries[0]!.path;
                            void (async () => {
                              setBusy(true);
                              setOpsNote(null);
                              try {
                                const r = await filesApi.unzip(
                                  root,
                                  zipPath,
                                  path === '.' ? '.' : path,
                                );
                                setOpsNote({
                                  ok: true,
                                  notes: r.notes ?? [t('files.unzipDone', { path: zipPath })] });
                                setMsg(t('files.unzipDone', { path: zipPath }));
                                await refresh();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : t('files.unzipFailed'));
                              } finally {
                                setBusy(false);
                              }
                            })();
                          }}
                        >
                          {t('files.unzip')}
                        </Button>
                      ) : null}
                      <Button
                        variant="danger"
                        size="md"
                        onClick={bindCall1(setDelPaths, [...selected])}
                      >
                        {t('files.delete')}
                      </Button>
                    </>
                  ) : null}
                </ActionBar>
                <ActionBar>
                  <input
                    className="fm-search"
                    placeholder={t('files.searchName')}
                    value={query}
                    onChange={bindInput(setQuery)}
                  />
                  <SegRadio
                    name="fm-sort"
                    aria-label={t('files.sortAria')}
                    size="sm"
                    value={`${sort}:${order}`}
                    onChange={(v) => {
                      const { sort: s, order: o } = parseSortValue(v);
                      setSort(s);
                      setOrder(o);
                    }}
                    options={[
                      { value: 'name:asc', label: t('files.sortNameAsc') },
                      { value: 'name:desc', label: t('files.sortNameDesc') },
                      { value: 'size:asc', label: t('files.sortSizeAsc') },
                      { value: 'size:desc', label: t('files.sortSizeDesc') },
                      { value: 'mtime:desc', label: t('files.sortMtimeDesc') },
                      { value: 'mtime:asc', label: t('files.sortMtimeAsc') },
                    ]}
                  />
                  <Button
                    variant={view === 'list' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={bindSet(setView, 'list')}
                  >
                    {t('files.viewList')}
                  </Button>
                  <Button
                    variant={view === 'grid' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={bindSet(setView, 'grid')}
                  >
                    {t('files.viewIcons')}
                  </Button>
                </ActionBar>
              </div>

              {/* Breadcrumb */}
              <nav className="fm-breadcrumb action-bar" aria-label={t('files.pathAria')}>
                <Button variant="ghost" size="sm" onClick={bindSet(setPath, '.')}>
                  {root === 'public' ? t('files.rootPublic') : t('files.rootProject')}
                </Button>
                {crumbs.map((c, i) => {
                  const p = crumbs.slice(0, i + 1).join('/');
                  return (
                    <Button key={p} variant="ghost" size="sm" onClick={bindSet(setPath, p)}>
                      / {c}
                    </Button>
                  );
                })}
              </nav>

              {/* Drop zone + content */}
              <div
                className={`fm-drop${dragOver ? ' is-drag' : ''}`}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragDepth((d) => d + 1);
                  setDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragDepth((d) => {
                    const next = Math.max(0, d - 1);
                    if (next === 0) setDragOver(false);
                    return next;
                  });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragDepth(0);
                  setDragOver(false);
                  void onDropTransfer(e.dataTransfer);
                }}
              >
                {items.length === 0 ? (
                  <EmptyState
                    title={side === 'favorites' ? t('files.emptyFavorites') : t('files.emptyFolder')}
                    description={t('files.emptyFolderHint')}
                  />
                ) : view === 'list' ? (
                  <DataTable
                    columns={[
                      {
                        key: 'select',
                        header: '',
                        className: 'u-nowrap',
                        nowrap: true,
                        render: (e) => (
                          <input
                            type="checkbox"
                            checked={selected.has(e.path)}
                            onChange={() => toggleSelect(e.path)}
                            aria-label={t('files.selectItem', { name: e.name })}
                          />
                        ) },
                      {
                        key: 'name',
                        header: t('files.colName'),
                        render: (e) => (
                          <button
                            type="button"
                            className="fm-name-btn"
                            onClick={bindCall1(openEntry, e)}
                          >
                            <span aria-hidden>{iconFor(e)}</span> {e.name}
                            {e.favorite ? ' ★' : ''}
                          </button>
                        ) },
                      {
                        key: 'size',
                        header: t('files.colSize'),
                        nowrap: true,
                        render: (e) =>
                          e.type === 'dir' ? '—' : formatBytes(e.size) },
                      {
                        key: 'mtime',
                        header: t('files.colMtime'),
                        className: 'muted',
                        nowrap: true,
                        render: (e) =>
                          formatMtimeCell(e.mtime) },
                    ]}
                    rows={items}
                    rowKey={(e) => e.path}
                    rowActions={(e) => (
                      <ActionBar align="end">
                        {e.type === 'file' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={bindCall1(doDownload, e.path)}
                          >
                            {t('files.download')}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={bindOpenRename(setRenameTarget, setRenameTo, e)}
                        >
                          {t('files.rename')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            void run(async () => {
                              await filesApi.toggleFavorite(root, e.path);
                            })
                          }
                        >
                          {e.favorite ? t('files.unfavorite') : t('files.favorite')}
                        </Button>
                        {e.type === 'file' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={bindOpenShare(setSharePath, setSharePass, setShareResult, e.path)}
                            >
                              {t('files.share')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={busy}
                              onClick={() => {
                                setBusy(true);
                                void filesApi
                                  .listVersions(root, e.path)
                                  .then((r) => {
                                    setVersionsPath(e.path);
                                    setVersions(r.items ?? []);
                                  })
                                  .catch((err: Error) => setError(err.message))
                                  .finally(() => setBusy(false));
                              }}
                            >
                              {t('files.versions')}
                            </Button>
                          </>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={bindCall1(setDelPaths, [e.path])}
                        >
                          {t('files.delete')}
                        </Button>
                      </ActionBar>
                    )}
                    empty={
                      <EmptyState
                        title={
                          side === 'favorites' ? t('files.emptyFavorites') : t('files.emptyFolder')
                        }
                        description={t('files.emptyFolderHint')}
                      />
                    }
                    toolbar={
                      <ActionBar>
                        <label className="u-nowrap u-text-sm">
                          <input
                            type="checkbox"
                            checked={
                              selected.size === items.length && items.length > 0
                            }
                            onChange={selectAll}
                            aria-label={t('files.selectAllAria')}
                          />{' '}
                          {t('files.selectAll')}
                        </label>
                      </ActionBar>
                    }
                  />
                ) : (
                  <div className="fm-grid">
                    {items.map((e) => (
                      <button
                        key={e.path}
                        type="button"
                        className={`fm-grid-item${selected.has(e.path) ? ' is-selected' : ''}`}
                        onClick={(ev) => {
                          if (ev.ctrlKey || ev.metaKey) toggleSelect(e.path);
                          else void openEntry(e);
                        }}
                      >
                        <span className="fm-grid-icon">{iconFor(e)}</span>
                        <span className="fm-grid-name">{e.name}</span>
                        <span className="muted u-text-sm">
                          {e.type === 'dir' ? t('files.folder') : formatBytes(e.size)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {dragOver ? (
                  <div className="fm-drop-hint">{t('files.dropFolderOrFile')}</div>
                ) : null}
              </div>

              {uploads.length > 0 ? (
                uploadPanelOpen ? (
                  <div className="fm-upload-panel" role="status" aria-live="polite">
                    <div className="fm-upload-panel__head">
                      <div>
                        <strong>{t('files.uploadPanelTitle')}</strong>
                        <span className="muted u-text-sm">
                          {' '}
                          {t('files.uploadPanelStats', {
                            done: uploadStats.done,
                            total: uploadStats.total,
                            err: uploadStats.err,
                          })}
                        </span>
                      </div>
                      <ActionBar>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setUploads((prev) =>
                              prev.filter(
                                (u) => u.status === 'uploading' || u.status === 'queued',
                              ),
                            )
                          }
                        >
                          {t('files.uploadClearDone')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setUploadPanelOpen(false)}
                        >
                          {t('common.close')}
                        </Button>
                      </ActionBar>
                    </div>
                    <div className="fm-upload-panel__overall">
                      <div
                        className="fm-upload-panel__bar"
                        style={{ width: `${uploadStats.overall}%` }}
                      />
                    </div>
                    <ul className="fm-upload-panel__list">
                      {uploadStats.visible.map((u) => (
                        <li key={u.id} className={`fm-upload-item is-${u.status}`}>
                          <div className="fm-upload-item__row">
                            <span className="fm-upload-item__name" title={u.relativePath}>
                              {u.kind === 'dir' ? '📁 ' : '📄 '}
                              {u.relativePath}
                            </span>
                            <span className="fm-upload-item__meta muted u-text-sm">
                              {u.folderLabel
                                ? t('files.uploadInFolder', { folder: u.folderLabel })
                                : null}{' '}
                              {u.status === 'done'
                                ? t('files.uploadStatusDone')
                                : u.status === 'error'
                                  ? t('files.uploadStatusError')
                                  : u.status === 'queued'
                                    ? t('files.uploadStatusQueued')
                                    : `${u.progress}%`}
                            </span>
                          </div>
                          <div className="fm-upload-item__track">
                            <div
                              className={`fm-upload-item__bar${u.status === 'error' ? ' is-error' : ''}${u.status === 'done' ? ' is-done' : ''}`}
                              style={{
                                width: `${u.status === 'done' ? 100 : u.progress}%`,
                              }}
                            />
                          </div>
                          {u.error ? (
                            <div className="fm-upload-item__err muted u-text-sm">{u.error}</div>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="fm-upload-dock"
                    onClick={() => setUploadPanelOpen(true)}
                  >
                    <span className="fm-upload-dock__label">
                      {t('files.uploadPanelTitle')}
                      <span className="muted u-text-sm">
                        {' '}
                        {t('files.uploadPanelStats', {
                          done: uploadStats.done,
                          total: uploadStats.total,
                          err: uploadStats.err,
                        })}
                      </span>
                    </span>
                    <span className="fm-upload-dock__track" aria-hidden>
                      <span
                        className="fm-upload-dock__bar"
                        style={{ width: `${uploadStats.overall}%` }}
                      />
                    </span>
                  </button>
                )
              ) : null}
            </>

        </div>
      </div>
          </div>
        ) : null}

        {tab === 'trash' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('files.trashTitle', { count: trash.length })}
                description={t('files.trashDesc')}
              >
                <DataTable
                  toolbar={
                    <ActionBar>
                      <Button
                        variant="danger"
                        size="md"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            await filesApi.purgeTrash(root);
                          }, t('files.emptyTrashDone'))
                        }
                      >
                        {t('files.emptyTrash')}
                      </Button>
                    </ActionBar>
                  }
                  columns={[
                    {
                      key: 'name',
                      header: t('files.colName'),
                      render: (t) => (
                        <>
                          {iconFor(t)} {t.name}
                        </>
                      ) },
                    {
                      key: 'path',
                      header: t('files.colOrigPath'),
                      render: (t) => (
                        <code className="inline">{t.originalPath}</code>
                      ) },
                    {
                      key: 'deleted',
                      header: t('files.colDeletedAt'),
                      className: 'muted',
                      nowrap: true,
                      render: (t) =>
                        (t.deletedAt ?? '').slice(0, 19).replace('T', ' ') || '—' },
                  ]}
                  rows={trash}
                  rowKey={(entry) => entry.trashId}
                  rowActions={(entry) => (
                    <ActionBar align="end">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            await filesApi.restoreTrash(root, entry.trashId);
                          }, t('files.restored'))
                        }
                      >
                        {t('files.restore')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            await filesApi.purgeTrash(root, entry.trashId);
                          }, t('files.purged'))
                        }
                      >
                        {t('files.purgeForever')}
                      </Button>
                    </ActionBar>
                  )}
                  empty={<EmptyState title={t('files.trashEmpty')} />}
                />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'shares' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('files.sharesTitle', { count: shares.length })}>
                <DataTable
                  columns={[
                    {
                      key: 'path',
                      header: t('files.colPath'),
                      render: (s) => (
                        <code className="inline">{s.path}</code>
                      ) },
                    {
                      key: 'url',
                      header: t('files.colLink'),
                      render: (s) => (
                        <code className="inline u-break-all">
                          {s.url ?? `/api/v1/public/files/${s.token}`}
                        </code>
                      ) },
                    {
                      key: 'downloads',
                      header: t('files.colDownloads'),
                      nowrap: true,
                      render: (s) => s.downloadCount },
                  ]}
                  rows={shares}
                  rowKey={(s) => s.id}
                  rowActions={(s) => (
                    <ActionBar align="end">
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            await filesApi.deleteShare(root, s.id);
                          }, t('files.unshareDone'))
                        }
                      >
                        {t('files.unshare')}
                      </Button>
                    </ActionBar>
                  )}
                  empty={
                    <EmptyState
                      title={t('files.sharesEmpty')}
                      description={t('files.sharesEmptyHint')}
                    />
                  }
                />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'webdav' ? (
          <div className="tab-panel">
      <Card>
        <CardSection
          title="WebDAV"
          description={t('files.webdavDesc')}
        >
          <ActionBar>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void filesApi
                  .webdavIssueToken()
                  .then((r) => {
                    setWebdavToken(r.token);
                    setWebdavEnabled(true);
                    setMsg(r.notes?.join(' · ') ?? t('files.tokenIssued'));
                  })
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('files.enableIssueToken')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={busy}
              onClick={() => {
                void filesApi
                  .webdavStatus()
                  .then((s) => {
                    setWebdavEnabled(s.enabled);
                    setMsg(s.enabled ? t('files.enabledMount', { path: s.mountPath }) : t('files.notEnabled'));
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            >
              {t('files.status')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy}
              onClick={() => {
                void filesApi
                  .webdavDisable()
                  .then(() => {
                    setWebdavEnabled(false);
                    setWebdavToken(null);
                    setMsg(t('files.webdavDisabled'));
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            >
              {t('files.disable')}
            </Button>
          </ActionBar>
          {webdavToken ? (
            <p className="u-mt-2">
              <code className="inline u-break-all">{webdavToken}</code>
            </p>
          ) : (
            <p className="muted u-text-sm u-mt-2">
              {webdavEnabled ? t('files.webdavEnabledNoEcho') : t('files.webdavDefaultOff')}
            </p>
          )}
        </CardSection>
      </Card>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="files" /> : null}
      </PageTabs>

      {/* Mkdir */}
      <Modal
        open={mkdirOpen}
        onClose={bindSet(setMkdirOpen, false)}
        title={t('files.newFolderTitle')}
        description={t('files.willCreateAt', { path: path || '/' })}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setMkdirOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const name = mkdirName.trim();
                  if (!name) throw new Error(t('files.nameRequired'));
                  await filesApi.mkdir(root, joinPath(path, name));
                  setMkdirOpen(false);
                  setMkdirName('');
                }, t('files.folderCreated'))
              }
            >
              {t('files.create')}
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field
            label={t('files.folderName')}
            htmlFor="mn"
            flush
            required
            hint={t('files.noPathSepHint')}
          >
            <input
              id="mn"
              value={mkdirName}
              onChange={bindInput(setMkdirName)}
              autoFocus
              placeholder="docs"
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* New text file */}
      <Modal
        open={newFileOpen}
        onClose={bindSet(setNewFileOpen, false)}
        title={t('files.newTextTitle')}
        description={t('files.willCreateAt', { path: path || '/' })}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setNewFileOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const name = newFileName.trim();
                  if (!name) throw new Error(t('files.fileNameRequired'));
                  await filesApi.createText(root, joinPath(path, name), '');
                  setNewFileOpen(false);
                }, t('files.textFileCreated'))
              }
            >
              {t('files.create')}
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field label={t('files.fileName')} htmlFor="nf" flush required hint={t('files.fileNameHint')}>
            <input
              id="nf"
              value={newFileName}
              onChange={bindInput(setNewFileName)}
              autoFocus
              placeholder="readme.md"
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Versions */}
      <Modal
        open={Boolean(versionsPath)}
        onClose={bindCloseVersions(setVersionsPath, setVersions)}
        title={t('files.versionsTitle', { path: versionsPath ?? '' })}
        description={t('files.versionsDesc')}
        footer={
          <Button
            variant="secondary"
            size="md"
            onClick={bindCloseVersions(setVersionsPath, setVersions)}
          >
            {t('common.close')}
          </Button>
        }
      >
        {versions.length === 0 ? (
          <EmptyState title={t('files.noVersions')} description={t('files.noVersionsHint')} />
        ) : (
          <ul className="list-plain list-spaced">
            {versions.map((v) => (
              <li key={v.id} className="">
                <span className="muted u-text-sm">
                  {new Date(v.createdAt).toLocaleString()} · {formatBytes(v.bytes)}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => {
                    if (!versionsPath) return;
                    setBusy(true);
                    void filesApi
                      .restoreVersion(root, versionsPath, v.id)
                      .then((r) => {
                        setMsg(r.notes?.join(' · ') ?? t('files.versionRestored'));
                        return refresh();
                      })
                      .catch((e: Error) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  {t('files.restore')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Rename */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={bindSet(setRenameTarget, null)}
        title={t('files.renameTitle')}
        description={renameTarget ? t('files.renameCurrent', { name: renameTarget.name }) : undefined}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setRenameTarget, null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  if (!renameTarget) return;
                  const parent = renameTarget.path.includes('/')
                    ? renameTarget.path.slice(0, renameTarget.path.lastIndexOf('/'))
                    : '.';
                  const to = joinPath(parent, renameTo.trim());
                  await filesApi.rename(root, renameTarget.path, to);
                  setRenameTarget(null);
                }, t('files.renamed'))
              }
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field label={t('files.newName')} htmlFor="rn" flush required hint={t('files.newNameHint')}>
            <input
              id="rn"
              value={renameTo}
              onChange={bindInput(setRenameTo)}
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Move / copy */}
      <Modal
        open={Boolean(moveTarget)}
        onClose={bindSet(setMoveTarget, null)}
        title={moveTarget?.mode === 'copy' ? t('files.copyTo') : t('files.moveTo')}
        description={
          moveTarget
            ? t('files.copyMoveDesc', {
                action: moveTarget.mode === 'copy' ? t('files.actionCopy') : t('files.actionMove'),
                count: moveTarget.entries.length })
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setMoveTarget, null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  if (!moveTarget) return;
                  const destDir = moveDest.trim() || '.';
                  for (const e of moveTarget.entries) {
                    const to = joinPath(destDir, e.name);
                    if (moveTarget.mode === 'copy') await filesApi.copy(root, e.path, to);
                    else await filesApi.move(root, e.path, to);
                  }
                  setMoveTarget(null);
                }, moveTarget?.mode === 'copy' ? t('files.copied') : t('files.moved'))
              }
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field
            label={t('files.targetFolderPath')}
            htmlFor="md"
            flush
            hint={t('files.targetFolderHint')}
          >
            <input
              id="md"
              value={moveDest}
              onChange={bindInput(setMoveDest)}
              placeholder="docs/archive"
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Share */}
      <Modal
        open={Boolean(sharePath)}
        onClose={bindSet(setSharePath, null)}
        title={t('files.shareCreateTitle')}
        description={t('files.shareCreateDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setSharePath, null)}>
              {t('common.close')}
            </Button>
            {!shareResult ? (
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    if (!sharePath) return;
                    const r = await filesApi.createShare(root, {
                      path: sharePath,
                      password: sharePass || undefined });
                    const url = `${window.location.origin}${r.share.url ?? `/api/v1/public/files/${r.share.token}`}`;
                    setShareResult(url);
                  })
                }
              >
                {t('files.createLink')}
              </Button>
            ) : null}
          </>
        }
      >
        <FormHint>
          {t('files.sharePath')}<code className="inline">{sharePath}</code>
        </FormHint>
        <FormLayout>
          <Field
            label={t('files.passwordOptional')}
            htmlFor="sp"
            flush
            hint={t('files.passwordOptionalHint')}
          >
            <input
              id="sp"
              type="password"
              value={sharePass}
              onChange={bindInput(setSharePass)}
              autoComplete="new-password"
              placeholder={t('files.passwordPlaceholder')}
            />
          </Field>
        </FormLayout>
        {shareResult ? (
          <Alert variant="ok">
            {t('files.linkCreated')}
            <code className="inline u-break-all">{shareResult}</code>
          </Alert>
        ) : null}
      </Modal>

      {/* chmod */}
      <Modal
        open={chmodOpen}
        onClose={bindCloseIfIdle(busy, () => setChmodOpen(false))}
        title={t('files.chmodTitle')}
        size="sm"
        footer={
          <FormActions align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={bindSet(setChmodOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  setError(null);
                  setOpsNote(null);
                  try {
                    for (const p of selected) {
                      await filesApi.chmod(root, p, chmodMode.trim());
                    }
                    setOpsNote({
                      ok: true,
                      notes: [
                        t('files.chmodDone', { mode: chmodMode.trim(), count: selected.size }),
                      ] });
                    setMsg(t('files.chmodDoneShort', { mode: chmodMode.trim() }));
                    setChmodOpen(false);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('files.chmodFailed'));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {t('files.apply')}
            </Button>
          </FormActions>
        }
      >
        <FormHint>
          {t('files.chmodApplyHint', { count: selected.size })}
        </FormHint>
        <div className="u-mb-3">
          <PresetChips
            options={[
              { value: '644', label: t('files.chmod644') },
              { value: '755', label: t('files.chmod755') },
              { value: '600', label: t('files.chmod600') },
              { value: '700', label: t('files.chmod700') },
              { value: '775', label: t('files.chmod775') },
            ]}
            value={chmodMode}
            onChange={setChmodMode}
            allowCustom
            customPlaceholder={t('files.chmodCustomPh')}
            disabled={busy}
          />
        </div>
        <FormLayout>
          <Field label={t('files.mode')} htmlFor="fm-chmod-mode" required flush>
            <input
              id="fm-chmod-mode"
              value={chmodMode}
              onChange={bindInput(setChmodMode)}
              placeholder="644"
              pattern="[0-7]{3,4}"
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* zip */}
      <Modal
        open={zipOpen}
        onClose={bindCloseIfIdle(busy, () => setZipOpen(false))}
        title={t('files.zipTitle')}
        size="sm"
        footer={
          <FormActions align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={bindSet(setZipOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!zipName.trim().toLowerCase().endsWith('.zip')}
              onClick={() => {
                const dest = zipName.trim();
                if (!dest.toLowerCase().endsWith('.zip')) return;
                const destPath = path === '.' ? dest : `${path}/${dest}`;
                void (async () => {
                  setBusy(true);
                  setError(null);
                  setOpsNote(null);
                  try {
                    const r = await filesApi.zip(root, [...selected], destPath);
                    setOpsNote({
                      ok: true,
                      notes: r.notes ?? [t('files.zipCreated', { path: destPath })] });
                    setMsg(t('files.zipDone', { path: destPath }));
                    setZipOpen(false);
                    setSelected(new Set());
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : t('files.zipFailed'));
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              {t('files.compress')}
            </Button>
          </FormActions>
        }
      >
        <FormHint>
          {t('files.zipHint', { count: selected.size })}
        </FormHint>
        <FormLayout>
          <Field
            label={t('files.destFileName')}
            htmlFor="fm-zip-name"
            required
            flush
            hint={t('files.destPathHint', { path: `${path === '.' ? '' : path + '/'}${zipName || '….zip'}` })}
          >
            <input
              id="fm-zip-name"
              value={zipName}
              onChange={bindInput(setZipName)}
              placeholder="archive.zip"
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={Boolean(delPaths?.length)}
        onClose={bindSet(setDelPaths, null)}
        onConfirm={() =>
          void run(async () => {
            for (const p of delPaths ?? []) {
              await filesApi.remove(root, p, false);
            }
            setDelPaths(null);
          }, t('files.movedToTrash'))
        }
        title={t('files.moveToTrashTitle')}
        description={t('files.moveToTrashDesc', { count: delPaths?.length ?? 0 })}
        confirmLabel={t('files.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />

      {/* Preview */}
      <Modal
        open={Boolean(preview)}
        onClose={bindSet(setPreview, null)}
        title={preview?.entry.name ?? t('files.preview')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setPreview, null)}>
              {t('common.close')}
            </Button>
            {preview ? (
              <Button
                variant="primary"
                size="md"
                onClick={bindCall1(doDownload, preview.entry.path)}
              >
                {t('files.download')}
              </Button>
            ) : null}
          </>
        }
      >
        {preview?.kind === 'text' ? (
          <pre className="code u-scroll-preview">
            {preview.content}
          </pre>
        ) : null}
        {preview?.kind === 'image' && preview.url ? (
          <img
            src={preview.url}
            alt={preview.entry.name}
            className="u-max-w-full u-scroll-preview"
            onError={() => setError(t('files.imagePreviewNeedLogin'))}
          />
        ) : null}
        {preview?.kind === 'pdf' && preview.url ? (
          <p className="muted">{t('files.pdfDownloadHint')}</p>
        ) : null}
        {preview?.kind === 'other' ? (
          <p className="muted">{t('files.noEmbedPreview')}</p>
        ) : null}
      </Modal>
    </FeaturePageLayout>
  );
}
