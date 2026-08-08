/**
 * ownCloud-style file manager — public + project roots, trash, shares, upload.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  highlightToHtml,
  syntaxLangFromName,
} from '../shared/lib/simple-syntax';
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

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other';

/** Extension → kind when server mime is missing or generic. */
export function previewKindFromName(name?: string | null): PreviewKind | null {
  const n = String(name ?? '')
    .trim()
    .toLowerCase();
  const ext = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : '';
  if (!ext) return null;
  if (
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'heif'].includes(
      ext,
    )
  ) {
    return 'image';
  }
  if (['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'mkv', 'avi'].includes(ext)) {
    return 'video';
  }
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus'].includes(ext)) {
    return 'audio';
  }
  if (ext === 'pdf') return 'pdf';
  if (
    [
      'txt',
      'md',
      'markdown',
      'json',
      'js',
      'mjs',
      'cjs',
      'ts',
      'tsx',
      'jsx',
      'css',
      'scss',
      'less',
      'html',
      'htm',
      'xml',
      'svg',
      'yml',
      'yaml',
      'toml',
      'ini',
      'cfg',
      'conf',
      'config',
      'log',
      'csv',
      'tsv',
      'sh',
      'bash',
      'zsh',
      'fish',
      'env',
      'php',
      'phtml',
      'py',
      'rb',
      'go',
      'rs',
      'java',
      'kt',
      'c',
      'h',
      'cpp',
      'hpp',
      'cs',
      'sql',
      'vue',
      'svelte',
      'astro',
      'r',
      'pl',
      'pm',
      'lua',
      'swift',
      'dockerfile',
      'makefile',
      'cmake',
      'gradle',
      'properties',
      'gitignore',
      'dockerignore',
      'editorconfig',
      'nginx',
      'service',
      'timer',
      'lock',
    ].includes(ext)
  ) {
    return 'text';
  }
  // names without extension
  if (
    ['dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'readme', 'license', 'changelog'].includes(
      n,
    )
  ) {
    return 'text';
  }
  return null;
}

export function iconFor(e: FileEntry): string {
  if (e.type === 'dir') return '📁';
  const kind = previewKind(e.mime, e.name);
  if (kind === 'image') return '🖼';
  if (kind === 'pdf') return '📄';
  if (kind === 'video') return '🎬';
  if (kind === 'audio') return '🎵';
  if (kind === 'text') return '📝';
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
  name?: string | null,
): PreviewKind {
  const m = (mime ?? '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (
    m.startsWith('text/') ||
    m.includes('json') ||
    m.includes('javascript') ||
    m.includes('typescript') ||
    m.includes('xml') ||
    m.includes('php') ||
    m.includes('python') ||
    m.includes('shell') ||
    m.includes('script') ||
    m.includes('yaml') ||
    m.includes('toml') ||
    m.includes('sql') ||
    m.includes('ruby') ||
    m.includes('rust') ||
    m.includes('x-sh') ||
    m.includes('x-csh') ||
    m.includes('x-httpd-php')
  ) {
    return 'text';
  }
  // Fallback by filename (server may omit mime or use application/octet-stream)
  return previewKindFromName(name) ?? 'other';
}

/** Resolve share expiry ISO string from preset / custom datetime-local. */
/** VS Code–style language label from filename. */
export function editorLanguageLabel(name: string): string {
  const base = name.split('/').pop() || name;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile') return 'Dockerfile';
  if (lower === 'makefile') return 'Makefile';
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const map: Record<string, string> = {
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    jsx: 'JavaScript React',
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    json: 'JSON',
    md: 'Markdown',
    markdown: 'Markdown',
    php: 'PHP',
    phtml: 'PHP',
    py: 'Python',
    rb: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    c: 'C',
    h: 'C',
    cpp: 'C++',
    hpp: 'C++',
    cs: 'C#',
    sh: 'Shell Script',
    bash: 'Shell Script',
    zsh: 'Shell Script',
    sql: 'SQL',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    svg: 'XML',
    env: 'Properties',
    conf: 'Properties',
    ini: 'Properties',
    log: 'Log',
    txt: 'Plain Text',
    vue: 'Vue',
    svelte: 'Svelte',
  };
  return map[ext] || 'Plain Text';
}

export function cursorFromOffset(text: string, offset: number): { line: number; col: number } {
  const pos = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

export function resolveShareExpiresAt(
  preset: string,
  customLocal?: string,
): string | null {
  const now = Date.now();
  if (preset === 'never' || !preset) return null;
  if (preset === '1h') return new Date(now + 3600_000).toISOString();
  if (preset === '1d') return new Date(now + 86400_000).toISOString();
  if (preset === '7d') return new Date(now + 7 * 86400_000).toISOString();
  if (preset === '30d') return new Date(now + 30 * 86400_000).toISOString();
  if (preset === 'custom') {
    const raw = String(customLocal || '').trim();
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getTime() <= now) return null;
    return d.toISOString();
  }
  return null;
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
    kind: PreviewKind;
    content?: string;
    url?: string;
  } | null>(null);
  /** Draft for text editor (dirty tracking vs preview.content) */
  const [editorDraft, setEditorDraft] = useState('');
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorBytes, setEditorBytes] = useState(0);
  const [editorCursor, setEditorCursor] = useState({ line: 1, col: 1 });
  const editorAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const editorGutterRef = useRef<HTMLDivElement | null>(null);
  const editorHighlightRef = useRef<HTMLPreElement | null>(null);
  const editorBodyRef = useRef<HTMLDivElement | null>(null);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [shares, setShares] = useState<FileShare[]>([]);
  const [sharePath, setSharePath] = useState<string | null>(null);
  const [sharePass, setSharePass] = useState('');
  const [shareResult, setShareResult] = useState<string | null>(null);
  /** never | 1h | 1d | 7d | 30d | custom */
  const [shareExpirePreset, setShareExpirePreset] = useState('7d');
  const [shareExpireCustom, setShareExpireCustom] = useState('');
  const [shareResultExpires, setShareResultExpires] = useState<string | null>(null);
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

  const editorDirty =
    preview?.kind === 'text' && editorDraft !== (preview.content ?? '');

  const editorLineCount = useMemo(() => {
    if (preview?.kind !== 'text') return 1;
    // count lines without allocating huge arrays for multi-MB paste edge cases
    let n = 1;
    for (let i = 0; i < editorDraft.length; i++) {
      if (editorDraft.charCodeAt(i) === 10) n += 1;
    }
    return n;
  }, [editorDraft, preview?.kind]);

  const editorLineLabels = useMemo(() => {
    if (preview?.kind !== 'text') return '';
    // Cap gutter render for very large files (still editable)
    const max = Math.min(editorLineCount, 20_000);
    let s = '';
    for (let i = 1; i <= max; i++) s += `${i}\n`;
    if (editorLineCount > max) s += '…\n';
    return s;
  }, [editorLineCount, preview?.kind]);

  const editorHighlightHtml = useMemo(() => {
    if (preview?.kind !== 'text') return '';
    const lang = syntaxLangFromName(preview.entry.name);
    return highlightToHtml(editorDraft, lang);
  }, [editorDraft, preview]);

  /**
   * Grow textarea (+ highlight) to full content height so `.fm-vscode__body`
   * is the only scroller — scrollbar thumb then matches real line count.
   */
  const layoutTextEditor = useCallback(() => {
    const area = editorAreaRef.current;
    const body = editorBodyRef.current;
    const hi = editorHighlightRef.current;
    const gutter = editorGutterRef.current;
    if (!area || !body) return;

    // Reset so scrollHeight reflects content, not previous forced height
    area.style.height = '0px';
    const contentH = area.scrollHeight;
    const viewH = body.clientHeight || 0;
    const h = Math.max(contentH, viewH);
    area.style.height = `${h}px`;
    if (hi) {
      hi.style.height = `${h}px`;
      hi.style.minHeight = `${h}px`;
    }
    if (gutter) {
      gutter.style.minHeight = `${h}px`;
    }
  }, []);

  useEffect(() => {
    if (preview?.kind !== 'text') return;
    // After paint: draft / highlight HTML ready
    const id = requestAnimationFrame(() => {
      layoutTextEditor();
      // second frame: fonts/line-wrap settle
      requestAnimationFrame(layoutTextEditor);
    });
    return () => cancelAnimationFrame(id);
  }, [editorDraft, editorHighlightHtml, preview?.kind, layoutTextEditor]);

  useEffect(() => {
    if (preview?.kind !== 'text') return;
    const onResize = () => layoutTextEditor();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [preview?.kind, layoutTextEditor]);

  function updateEditorCursor(el: HTMLTextAreaElement) {
    setEditorCursor(cursorFromOffset(editorDraft, el.selectionStart));
  }

  function closePreview() {
    if (editorDirty) {
      const ok = window.confirm(t('files.editorDiscardConfirm'));
      if (!ok) return;
    }
    setPreview((prev) => {
      if (prev?.url) {
        try {
          URL.revokeObjectURL(prev.url);
        } catch {
          /* */
        }
      }
      return null;
    });
    setEditorDraft('');
    setEditorBytes(0);
  }

  async function saveTextEditor() {
    if (!preview || preview.kind !== 'text') return;
    setEditorSaving(true);
    try {
      await filesApi.write(root, preview.entry.path, editorDraft);
      setPreview({ ...preview, content: editorDraft });
      setEditorBytes(new TextEncoder().encode(editorDraft).length);
      setMsg(t('files.editorSaved', { name: preview.entry.name }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('files.editorSaveFailed'));
    } finally {
      setEditorSaving(false);
    }
  }

  async function openBlobPreview(
    e: FileEntry,
    kind: 'image' | 'video' | 'audio' | 'pdf',
  ) {
    try {
      setBusy(true);
      const tkn = authStore.getToken();
      const res = await fetch(filesApi.downloadUrl(root, e.path), {
        headers: tkn ? { Authorization: `Bearer ${tkn}` } : {},
      });
      if (!res.ok) throw new Error(t('files.previewFailed'));
      const blob = await res.blob();
      // Prefer server Content-Type when blob is generic
      const fallbackType =
        kind === 'image'
          ? e.mime || 'image/*'
          : kind === 'video'
            ? e.mime || 'video/mp4'
            : kind === 'audio'
              ? e.mime || 'audio/*'
              : 'application/pdf';
      const typed =
        blob.type && blob.type !== 'application/octet-stream'
          ? blob
          : new Blob([blob], { type: fallbackType });
      setPreview((prev) => {
        if (prev?.url) {
          try {
            URL.revokeObjectURL(prev.url);
          } catch {
            /* */
          }
        }
        return { entry: e, kind, url: URL.createObjectURL(typed) };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('files.previewFailed'));
      setPreview({ entry: e, kind: 'other' });
    } finally {
      setBusy(false);
    }
  }

  async function openEntry(e: FileEntry) {
    if (e.type === 'dir') {
      setPath(e.path);
      setSide('all');
      return;
    }
    const kind = previewKind(e.mime, e.name);
    if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf') {
      await openBlobPreview(e, kind);
      return;
    }
    if (kind === 'text') {
      try {
        setBusy(true);
        const r = await filesApi.read(root, e.path);
        const body = r.content ?? '';
        setEditorDraft(body);
        setEditorBytes(r.bytes ?? new TextEncoder().encode(body).length);
        setPreview({ entry: e, kind: 'text', content: body });
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('files.previewFailed');
        setError(msg);
        // Large-file / validation errors: still offer download
        setPreview({ entry: e, kind: 'other' });
        setEditorDraft('');
        setEditorBytes(0);
      } finally {
        setBusy(false);
      }
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
              {/* Toolbar — single dense row: actions | search+sort+view */}
              <div className="fm-toolbar">
                <div className="fm-toolbar__primary" role="toolbar" aria-label={t('files.toolbarAria')}>
                  <label
                    className={`${buttonClassName({ variant: 'primary', size: 'sm' })} fm-upload-btn`}
                  >
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
                  <label
                    className={`${buttonClassName({ variant: 'secondary', size: 'sm' })} fm-upload-btn`}
                  >
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
                  <Button variant="secondary" size="sm" onClick={bindSet(setMkdirOpen, true)}>
                    {t('files.newFolder')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={bindSet(setNewFileOpen, true)}>
                    {t('files.newTextFile')}
                  </Button>
                  {selected.size > 0 ? (
                    <>
                      <span className="fm-toolbar__sep" aria-hidden />
                      <Button
                        variant="secondary"
                        size="sm"
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
                        size="sm"
                        onClick={bindOpenMoveCopy(setMoveTarget, setMoveDest, selectedEntries, 'copy', path)}
                      >
                        {t('files.copy')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={bindOpenMoveCopy(setMoveTarget, setMoveDest, selectedEntries, 'move', path)}
                      >
                        {t('files.move')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={bindOpenChmod(setChmodMode, setChmodOpen)}
                      >
                        chmod
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={bindOpenZip(setZipName, setZipOpen)}
                      >
                        {t('files.zip')}
                      </Button>
                      {selectedEntries.length === 1 &&
                      selectedEntries[0]?.name.toLowerCase().endsWith('.zip') ? (
                        <Button
                          variant="secondary"
                          size="sm"
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
                        size="sm"
                        onClick={bindCall1(setDelPaths, [...selected])}
                      >
                        {t('files.delete')}
                      </Button>
                    </>
                  ) : null}
                </div>
                <div className="fm-toolbar__tools">
                  <input
                    className="fm-search input"
                    type="search"
                    placeholder={t('files.searchName')}
                    value={query}
                    onChange={bindInput(setQuery)}
                    aria-label={t('files.searchName')}
                  />
                  <select
                    className="fm-sort input"
                    aria-label={t('files.sortAria')}
                    value={`${sort}:${order}`}
                    onChange={(e) => {
                      const { sort: s, order: o } = parseSortValue(e.target.value);
                      setSort(s);
                      setOrder(o);
                    }}
                  >
                    <option value="name:asc">{t('files.sortNameAsc')}</option>
                    <option value="name:desc">{t('files.sortNameDesc')}</option>
                    <option value="size:asc">{t('files.sortSizeAsc')}</option>
                    <option value="size:desc">{t('files.sortSizeDesc')}</option>
                    <option value="mtime:desc">{t('files.sortMtimeDesc')}</option>
                    <option value="mtime:asc">{t('files.sortMtimeAsc')}</option>
                  </select>
                  <div className="fm-view-toggle" role="group" aria-label={t('files.viewAria')}>
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
                  </div>
                </div>
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
                        {e.type === 'file' &&
                        ['image', 'video', 'audio', 'text', 'pdf'].includes(
                          previewKind(e.mime, e.name),
                        ) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={busy}
                            onClick={() => void openEntry(e)}
                          >
                            {previewKind(e.mime, e.name) === 'text'
                              ? t('files.edit')
                              : t('files.preview')}
                          </Button>
                        ) : null}
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
                      render: (s) => {
                        const path = s.url ?? `/share/${s.token}`;
                        const abs = path.startsWith('http')
                          ? path
                          : `${window.location.origin}${path}`;
                        return (
                          <code className="inline u-break-all">{abs}</code>
                        );
                      },
                    },
                    {
                      key: 'expires',
                      header: t('files.colExpires'),
                      nowrap: true,
                      render: (s) =>
                        s.expiresAt
                          ? new Date(s.expiresAt).toLocaleString()
                          : t('files.shareExpireNever'),
                    },
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

      {/* Share — create → copy-link success */}
      <Modal
        open={Boolean(sharePath)}
        onClose={() => {
          if (busy) return;
          setSharePath(null);
          setSharePass('');
          setShareResult(null);
          setShareResultExpires(null);
          setShareExpirePreset('7d');
          setShareExpireCustom('');
        }}
        title={
          shareResult ? t('files.shareReadyTitle') : t('files.shareCreateTitle')
        }
        description={
          shareResult ? t('files.shareReadyDesc') : t('files.shareCreateDesc')
        }
        size="md"
        footer={
          shareResult ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setShareResult(null);
                  setShareResultExpires(null);
                  setSharePass('');
                }}
              >
                {t('files.shareAgain')}
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  setSharePath(null);
                  setSharePass('');
                  setShareResult(null);
                  setShareResultExpires(null);
                  setShareExpirePreset('7d');
                  setShareExpireCustom('');
                }}
              >
                {t('common.done')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                size="md"
                disabled={busy}
                onClick={() => {
                  setSharePath(null);
                  setSharePass('');
                  setShareResult(null);
                  setShareResultExpires(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() =>
                  void run(async () => {
                    if (!sharePath) return;
                    const expiresAt = resolveShareExpiresAt(
                      shareExpirePreset,
                      shareExpireCustom,
                    );
                    if (shareExpirePreset === 'custom' && !expiresAt) {
                      setError(t('files.shareExpireInvalid'));
                      return;
                    }
                    const r = await filesApi.createShare(root, {
                      path: sharePath,
                      password: sharePass || undefined,
                      expiresAt: expiresAt || undefined,
                    });
                    const path =
                      r.share.url ??
                      (r.share.token
                        ? `/share/${r.share.token}`
                        : `/api/v1/public/files/${r.share.token}`);
                    const url = path.startsWith('http')
                      ? path
                      : `${window.location.origin}${path}`;
                    setShareResult(url);
                    setShareResultExpires(
                      r.share.expiresAt ?? expiresAt ?? null,
                    );
                    toast.ok(t('files.shareCreatedToast'));
                  })
                }
              >
                {t('files.createLink')}
              </Button>
            </>
          )
        }
      >
        {!shareResult ? (
          <div className="fm-share">
            <div className="fm-share__file">
              <span className="fm-share__file-icon" aria-hidden>
                📎
              </span>
              <div className="fm-share__file-body">
                <div className="fm-share__file-name">
                  {sharePath?.split('/').pop() || sharePath}
                </div>
                <code className="fm-share__file-path">{sharePath}</code>
              </div>
            </div>
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
            <Field
              label={t('files.shareExpireLabel')}
              htmlFor="share-exp"
              flush
              hint={t('files.shareExpireHint')}
            >
              <select
                id="share-exp"
                className="input"
                value={shareExpirePreset}
                onChange={(e) => setShareExpirePreset(e.target.value)}
              >
                <option value="never">{t('files.shareExpireNever')}</option>
                <option value="1h">{t('files.shareExpire1h')}</option>
                <option value="1d">{t('files.shareExpire1d')}</option>
                <option value="7d">{t('files.shareExpire7d')}</option>
                <option value="30d">{t('files.shareExpire30d')}</option>
                <option value="custom">{t('files.shareExpireCustom')}</option>
              </select>
            </Field>
            {shareExpirePreset === 'custom' ? (
              <Field
                label={t('files.shareExpireAt')}
                htmlFor="share-exp-at"
                flush
                required
              >
                <input
                  id="share-exp-at"
                  type="datetime-local"
                  className="input"
                  value={shareExpireCustom}
                  onChange={bindInput(setShareExpireCustom)}
                />
              </Field>
            ) : null}
          </div>
        ) : (
          <div className="fm-share fm-share--ready">
            <div className="fm-share__status">
              <Badge tone="ok">{t('files.shareReadyBadge')}</Badge>
              {sharePass ? (
                <Badge tone="warn">{t('files.shareProtected')}</Badge>
              ) : (
                <Badge tone="neutral">{t('files.shareOpenAccess')}</Badge>
              )}
              {shareResultExpires ? (
                <Badge tone="info">
                  {t('files.shareExpiresAt', {
                    at: new Date(shareResultExpires).toLocaleString(),
                  })}
                </Badge>
              ) : (
                <Badge tone="neutral">{t('files.shareExpireNever')}</Badge>
              )}
            </div>
            <label className="fm-share__link-label" htmlFor="fm-share-url">
              {t('files.shareLinkLabel')}
            </label>
            <div className="fm-share__link-row">
              <input
                id="fm-share-url"
                className="fm-share__link-input input"
                readOnly
                value={shareResult}
                onFocus={(e) => e.target.select()}
              />
              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(shareResult)
                    .then(() => toast.ok(t('files.linkCopied')))
                    .catch(() => {
                      try {
                        const el = document.getElementById(
                          'fm-share-url',
                        ) as HTMLInputElement | null;
                        el?.select();
                        document.execCommand('copy');
                        toast.ok(t('files.linkCopied'));
                      } catch {
                        toast.error(t('files.linkCopyFailed'));
                      }
                    });
                }}
              >
                {t('common.copy')}
              </Button>
            </div>
            <p className="fm-share__hint muted">{t('files.shareCopyHint')}</p>
          </div>
        )}
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

      {/* Preview / VS Code–style text editor */}
      <Modal
        open={Boolean(preview)}
        onClose={closePreview}
        title={
          preview?.kind === 'text'
            ? `${preview.entry.name}${editorDirty ? ' ●' : ''}`
            : (preview?.entry.name ?? t('files.preview'))
        }
        description={
          preview?.kind === 'text'
            ? preview.entry.path
            : undefined
        }
        className={preview?.kind === 'text' ? 'fm-editor-modal' : undefined}
        size={
          preview?.kind === 'image' ||
          preview?.kind === 'video' ||
          preview?.kind === 'audio' ||
          preview?.kind === 'text' ||
          preview?.kind === 'pdf'
            ? 'xl'
            : 'md'
        }
        footer={
          preview?.kind === 'text' ? (
            <>
              <Button variant="ghost" size="sm" onClick={closePreview}>
                {t('common.close')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={bindCall1(doDownload, preview.entry.path)}
              >
                {t('files.download')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={editorSaving}
                disabled={!editorDirty || editorSaving}
                onClick={() => void saveTextEditor()}
              >
                {editorDirty ? t('files.editorSave') : t('files.editorSavedIdle')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="md" onClick={closePreview}>
                {t('common.close')}
              </Button>
              {preview ? (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={bindCall1(doDownload, preview.entry.path)}
                >
                  {t('files.download')}
                </Button>
              ) : null}
            </>
          )
        }
      >
        {preview?.kind === 'text' ? (
          <div className="fm-vscode">
            <div className="fm-vscode__tabbar">
              <div className={`fm-vscode__tab${editorDirty ? ' is-dirty' : ''}`}>
                <span className="fm-vscode__tab-icon" aria-hidden>
                  {preview.entry.name.toLowerCase().endsWith('.html') ||
                  preview.entry.name.toLowerCase().endsWith('.htm')
                    ? '〈/〉'
                    : '📄'}
                </span>
                <span className="fm-vscode__tab-name">
                  {preview.entry.name}
                  {editorDirty ? (
                    <span className="fm-vscode__dirty" title={t('files.editorDirty')}>
                      ●
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="fm-vscode__actions">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={editorSaving}
                  disabled={!editorDirty || editorSaving}
                  onClick={() => void saveTextEditor()}
                  title={`${t('files.editorSave')} (Ctrl+S)`}
                >
                  {editorDirty ? t('files.editorSave') : t('files.editorSavedIdle')}
                </Button>
              </div>
            </div>
            {editorBytes > 512_000 ? (
              <div className="fm-vscode__banner">{t('files.editorLargeHint')}</div>
            ) : null}
            <div ref={editorBodyRef} className="fm-vscode__body">
              <div
                ref={editorGutterRef}
                className="fm-vscode__gutter"
                aria-hidden
              >
                {editorLineLabels}
              </div>
              <div className="fm-vscode__code">
                <pre
                  ref={editorHighlightRef}
                  className="fm-vscode__highlight"
                  aria-hidden
                  dangerouslySetInnerHTML={{
                    __html: editorHighlightHtml || ' ',
                  }}
                />
                <textarea
                  ref={editorAreaRef}
                  className="fm-vscode__area"
                  value={editorDraft}
                  rows={Math.min(Math.max(editorLineCount, 20), 500)}
                  onChange={(e) => {
                    setEditorDraft(e.target.value);
                    updateEditorCursor(e.target);
                    requestAnimationFrame(layoutTextEditor);
                  }}
                  onClick={(e) => updateEditorCursor(e.currentTarget)}
                  onKeyUp={(e) => updateEditorCursor(e.currentTarget)}
                  onSelect={(e) => updateEditorCursor(e.currentTarget)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                      e.preventDefault();
                      if (editorDirty && !editorSaving) void saveTextEditor();
                      return;
                    }
                    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return;
                    e.preventDefault();
                    const el = e.currentTarget;
                    const start = el.selectionStart;
                    const end = el.selectionEnd;
                    const next =
                      editorDraft.slice(0, start) + '  ' + editorDraft.slice(end);
                    setEditorDraft(next);
                    requestAnimationFrame(() => {
                      el.selectionStart = el.selectionEnd = start + 2;
                      updateEditorCursor(el);
                      layoutTextEditor();
                    });
                  }}
                  spellCheck={false}
                  wrap="off"
                  aria-label={t('files.editorAria', { name: preview.entry.name })}
                />
              </div>
            </div>
            <div className="fm-vscode__statusbar" role="status">
              <span className="fm-vscode__status-item fm-vscode__status-item--accent">
                {editorDirty ? t('files.editorDirty') : t('files.editorClean')}
              </span>
              <span className="fm-vscode__status-item">
                {t('files.editorLnCol', {
                  line: editorCursor.line,
                  col: editorCursor.col,
                })}
              </span>
              <span className="fm-vscode__status-item">
                {t('files.editorLines', { count: editorLineCount })}
              </span>
              <span className="fm-vscode__status-spacer" />
              <span className="fm-vscode__status-item">
                {formatBytes(
                  editorBytes || new TextEncoder().encode(editorDraft).length,
                )}
              </span>
              <span className="fm-vscode__status-item">UTF-8</span>
              <span className="fm-vscode__status-item">
                {t('files.editorSpaces', { n: 2 })}
              </span>
              <span className="fm-vscode__status-item fm-vscode__status-item--lang">
                {editorLanguageLabel(preview.entry.name)}
              </span>
            </div>
          </div>
        ) : null}
        {preview?.kind === 'image' && preview.url ? (
          <div className="fm-media-preview">
            <img
              src={preview.url}
              alt={preview.entry.name}
              className="fm-media-preview__img"
              onError={() => setError(t('files.imagePreviewNeedLogin'))}
            />
          </div>
        ) : null}
        {preview?.kind === 'video' && preview.url ? (
          <div className="fm-media-preview">
            <video
              className="fm-media-preview__video"
              src={preview.url}
              controls
              playsInline
              preload="metadata"
            >
              {t('files.videoNotSupported')}
            </video>
          </div>
        ) : null}
        {preview?.kind === 'audio' && preview.url ? (
          <div className="fm-media-preview fm-media-preview--audio">
            <audio className="fm-media-preview__audio" src={preview.url} controls preload="metadata">
              {t('files.audioNotSupported')}
            </audio>
          </div>
        ) : null}
        {preview?.kind === 'pdf' && preview.url ? (
          <div className="fm-pdf-preview">
            <iframe
              className="fm-pdf-preview__frame"
              title={preview.entry.name}
              src={preview.url}
            />
            <p className="fm-pdf-preview__fallback muted">
              {t('files.pdfInlineHint')}{' '}
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => void doDownload(preview.entry.path)}
              >
                {t('files.download')}
              </button>
            </p>
          </div>
        ) : null}
        {preview?.kind === 'pdf' && !preview.url ? (
          <p className="muted">{t('files.pdfDownloadHint')}</p>
        ) : null}
        {preview?.kind === 'other' ? (
          <p className="muted">{t('files.noEmbedPreview')}</p>
        ) : null}
      </Modal>
    </FeaturePageLayout>
  );
}
