/**
 * ownCloud-style file manager — public + project roots, trash, shares, upload.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ActionBar,
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
  buttonClassName,
} from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';

const FILE_TABS = ['browse', 'trash', 'shares', 'webdav'] as const;
import { filesApi, fileToBase64, type FileEntry, type TrashEntry, type FileShare } from '../features/files/api';
import { projectsApi } from '../features/projects';
import { authStore } from '../shared/stores/auth-store';

type ViewMode = 'list' | 'grid';
type SideView = 'all' | 'favorites' | 'shares' | 'trash';
type SortKey = 'name' | 'size' | 'mtime';

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function iconFor(e: FileEntry): string {
  if (e.type === 'dir') return '📁';
  const m = e.mime ?? '';
  if (m.startsWith('image/')) return '🖼';
  if (m === 'application/pdf') return '📄';
  if (m.startsWith('video/')) return '🎬';
  if (m.startsWith('audio/')) return '🎵';
  if (m.startsWith('text/') || m.includes('json')) return '📝';
  return '📎';
}

function joinPath(dir: string, name: string): string {
  if (!dir || dir === '.') return name;
  return `${dir.replace(/\/$/, '')}/${name}`;
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

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
      const r = await filesApi.list(root, path, { sort, order, q: query || undefined });
      let list = r.items;
      if (side === 'favorites') {
        list = list.filter((i) => i.favorite);
      }
      setItems(list);
      setUsage(r.usage ?? null);
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : '載入失敗');
    }
  }, [root, path, sort, order, query, side]);

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

  const crumbs = useMemo(() => {
    if (path === '.' || !path) return [] as string[];
    return path.split('/').filter(Boolean);
  }, [path]);

  async function run(fn: () => Promise<void>, okMsg?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (okMsg) setMsg(okMsg);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗');
    } finally {
      setBusy(false);
    }
  }

  async function onUploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).slice(0, 30);
    if (!files.length) return;
    await run(async () => {
      const payload = [];
      for (const f of files) {
        payload.push({ name: f.name, base64: await fileToBase64(f) });
      }
      await filesApi.upload(root, path, payload);
    }, `已上傳 ${files.length} 個檔案`);
  }

  function toggleSelect(p: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }

  function selectAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.path)));
  }

  async function openEntry(e: FileEntry) {
    if (e.type === 'dir') {
      setPath(e.path);
      setSide('all');
      return;
    }
    const mime = e.mime ?? '';
    if (mime.startsWith('image/')) {
      try {
        const tkn = authStore.getToken();
        const res = await fetch(filesApi.downloadUrl(root, e.path), {
          headers: tkn ? { Authorization: `Bearer ${tkn}` } : {},
        });
        if (!res.ok) throw new Error('preview failed');
        const blob = await res.blob();
        setPreview({ entry: e, kind: 'image', url: URL.createObjectURL(blob) });
      } catch {
        setPreview({ entry: e, kind: 'other' });
      }
      return;
    }
    if (mime === 'application/pdf') {
      setPreview({ entry: e, kind: 'pdf' });
      return;
    }
    if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript')) {
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
        headers: tkn ? { Authorization: `Bearer ${tkn}` } : {},
      });
      if (!res.ok) throw new Error(`下載失敗 (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = p.split('/').pop() || 'file';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : '下載失敗');
    } finally {
      setBusy(false);
    }
  }

  const selectedEntries = items.filter((i) => selected.has(i.path));

  const [tab, setTab] = usePageTab(FILE_TABS, 'browse');

  return (
    <FeaturePageLayout
      title={t('nav.files', { defaultValue: '檔案' })}
      status={{
        pill: {
          label: `${items.filter((i) => i.type === 'file').length} 檔`,
          tone: 'ok',
        },
        items: [
          {
            label: '檔案',
            value: String(
              usage?.fileCount ?? items.filter((i) => i.type === 'file').length,
            ),
          },
          {
            label: '資料夾',
            value: String(
              usage?.dirCount ?? items.filter((i) => i.type === 'dir').length,
            ),
          },
          { label: '用量', value: formatBytes(usage?.bytes ?? 0) },
          { label: '已選', value: String(selected.size) },
          { label: '回收桶', value: trash.length },
          { label: '分享', value: shares.length },
        ],
      }}
      actions={<ActionBar>
          <Link to="/files/public" className={buttonClassName({ variant: 'secondary', size: 'sm' })}>
            公用站設定
          </Link>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void refresh()}>
            重新整理
          </Button>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}
      {opsNote ? (
        <div className="stack">
          <OpsResultPanel
            title="檔案操作結果"
            result={{
              ok: opsNote.ok,
              notes: opsNote.notes,
            }}
            busy={busy}
          />
          <ActionBar size="sm">
            <Button variant="ghost" size="sm" onClick={() => setOpsNote(null)}>
              關閉結果
            </Button>
          </ActionBar>
        </div>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'browse', label: '瀏覽' },
          { id: 'trash', label: '回收桶', badge: trash.length || undefined },
          { id: 'shares', label: '分享', badge: shares.length || undefined },
          { id: 'webdav', label: 'WebDAV' },
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
            <div className="fm-sidebar__label">空間</div>
            <button
              type="button"
              className={`fm-side-item${root === 'public' ? ' is-active' : ''}`}
              onClick={() => changeRoot('public')}
            >
              📁 公用檔案
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`fm-side-item${root === `project:${p.id}` ? ' is-active' : ''}`}
                onClick={() => changeRoot(`project:${p.id}`)}
              >
                ▣ {p.name}
              </button>
            ))}
          </div>
          <div className="fm-sidebar__section">
            <div className="fm-sidebar__label">視圖</div>
            {(
              [
                ['all', '全部檔案'],
                ['favorites', '收藏'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`fm-side-item${side === id ? ' is-active' : ''}`}
                onClick={() => {
                  setSide(id);
                  setTab('browse');
                }}
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
                    上傳
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
                  <Button variant="secondary" size="md" onClick={() => setMkdirOpen(true)}>
                    新建資料夾
                  </Button>
                  <Button variant="secondary" size="md" onClick={() => setNewFileOpen(true)}>
                    新建文字檔
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
                        下載
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          setMoveTarget({ entries: selectedEntries, mode: 'copy' });
                          setMoveDest(path === '.' ? '' : path);
                        }}
                      >
                        複製
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          setMoveTarget({ entries: selectedEntries, mode: 'move' });
                          setMoveDest(path === '.' ? '' : path);
                        }}
                      >
                        移動
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={busy}
                        onClick={() => {
                          setChmodMode('644');
                          setChmodOpen(true);
                        }}
                      >
                        chmod
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        disabled={busy}
                        onClick={() => {
                          setZipName(`archive-${Date.now()}.zip`);
                          setZipOpen(true);
                        }}
                      >
                        壓縮 zip
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
                                  notes: r.notes ?? [`已解壓 ${zipPath}`],
                                });
                                setMsg(`已解壓 ${zipPath}`);
                                await refresh();
                              } catch (e) {
                                setError(e instanceof Error ? e.message : 'unzip 失敗');
                              } finally {
                                setBusy(false);
                              }
                            })();
                          }}
                        >
                          解壓
                        </Button>
                      ) : null}
                      <Button
                        variant="danger"
                        size="md"
                        onClick={() => setDelPaths([...selected])}
                      >
                        刪除
                      </Button>
                    </>
                  ) : null}
                </ActionBar>
                <ActionBar>
                  <input
                    className="fm-search"
                    placeholder="搜尋檔名…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <SegRadio
                    name="fm-sort"
                    aria-label="排序"
                    size="sm"
                    value={`${sort}:${order}`}
                    onChange={(v) => {
                      const [s, o] = v.split(':') as [SortKey, 'asc' | 'desc'];
                      setSort(s);
                      setOrder(o);
                    }}
                    options={[
                      { value: 'name:asc', label: '名↑' },
                      { value: 'name:desc', label: '名↓' },
                      { value: 'size:asc', label: '小↑' },
                      { value: 'size:desc', label: '小↓' },
                      { value: 'mtime:desc', label: '最新' },
                      { value: 'mtime:asc', label: '最舊' },
                    ]}
                  />
                  <Button
                    variant={view === 'list' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setView('list')}
                  >
                    列表
                  </Button>
                  <Button
                    variant={view === 'grid' ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => setView('grid')}
                  >
                    圖示
                  </Button>
                </ActionBar>
              </div>

              {/* Breadcrumb */}
              <nav className="fm-breadcrumb action-bar" aria-label="路徑">
                <Button variant="ghost" size="sm" onClick={() => setPath('.')}>
                  {root === 'public' ? '公用' : '專案'}
                </Button>
                {crumbs.map((c, i) => {
                  const p = crumbs.slice(0, i + 1).join('/');
                  return (
                    <Button key={p} variant="ghost" size="sm" onClick={() => setPath(p)}>
                      / {c}
                    </Button>
                  );
                })}
              </nav>

              {/* Drop zone + content */}
              <div
                className={`fm-drop${dragOver ? ' is-drag' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.length) void onUploadFiles(e.dataTransfer.files);
                }}
              >
                {items.length === 0 ? (
                  <EmptyState
                    title={side === 'favorites' ? '尚未有收藏' : '此資料夾是空的'}
                    description="拖放檔案到此處上傳，或按「上傳」"
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
                            aria-label={`選擇 ${e.name}`}
                          />
                        ),
                      },
                      {
                        key: 'name',
                        header: '名稱',
                        render: (e) => (
                          <button
                            type="button"
                            className="fm-name-btn"
                            onClick={() => void openEntry(e)}
                          >
                            <span aria-hidden>{iconFor(e)}</span> {e.name}
                            {e.favorite ? ' ★' : ''}
                          </button>
                        ),
                      },
                      {
                        key: 'size',
                        header: '大小',
                        nowrap: true,
                        render: (e) =>
                          e.type === 'dir' ? '—' : formatBytes(e.size),
                      },
                      {
                        key: 'mtime',
                        header: '修改',
                        className: 'muted',
                        nowrap: true,
                        render: (e) =>
                          e.mtime.slice(0, 19).replace('T', ' '),
                      },
                    ]}
                    rows={items}
                    rowKey={(e) => e.path}
                    rowActions={(e) => (
                      <ActionBar align="end">
                        {e.type === 'file' ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void doDownload(e.path)}
                          >
                            下載
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setRenameTarget(e);
                            setRenameTo(e.name);
                          }}
                        >
                          重新命名
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
                          {e.favorite ? '取消收藏' : '收藏'}
                        </Button>
                        {e.type === 'file' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSharePath(e.path);
                                setSharePass('');
                                setShareResult(null);
                              }}
                            >
                              分享
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
                              版本
                            </Button>
                          </>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDelPaths([e.path])}
                        >
                          刪除
                        </Button>
                      </ActionBar>
                    )}
                    empty={
                      <EmptyState
                        title={
                          side === 'favorites' ? '尚未有收藏' : '此資料夾是空的'
                        }
                        description="拖放檔案到此處上傳，或按「上傳」"
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
                            aria-label="全選"
                          />{' '}
                          全選
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
                          {e.type === 'dir' ? '資料夾' : formatBytes(e.size)}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {dragOver ? <div className="fm-drop-hint">放開以上傳</div> : null}
              </div>
            </>

        </div>
      </div>
          </div>
        ) : null}

        {tab === 'trash' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={`回收桶 (${trash.length})`}
                description="刪除的檔案可還原或永久清除"
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
                          }, '已清空回收桶')
                        }
                      >
                        清空回收桶
                      </Button>
                    </ActionBar>
                  }
                  columns={[
                    {
                      key: 'name',
                      header: '名稱',
                      render: (t) => (
                        <>
                          {iconFor(t)} {t.name}
                        </>
                      ),
                    },
                    {
                      key: 'path',
                      header: '原路徑',
                      render: (t) => (
                        <code className="inline">{t.originalPath}</code>
                      ),
                    },
                    {
                      key: 'deleted',
                      header: '刪除時間',
                      className: 'muted',
                      nowrap: true,
                      render: (t) =>
                        t.deletedAt.slice(0, 19).replace('T', ' '),
                    },
                  ]}
                  rows={trash}
                  rowKey={(t) => t.trashId}
                  rowActions={(t) => (
                    <ActionBar align="end">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            await filesApi.restoreTrash(root, t.trashId);
                          }, '已還原')
                        }
                      >
                        還原
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            await filesApi.purgeTrash(root, t.trashId);
                          }, '已永久刪除')
                        }
                      >
                        永久刪除
                      </Button>
                    </ActionBar>
                  )}
                  empty={<EmptyState title="回收桶是空的" />}
                />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'shares' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={`公開分享連結 (${shares.length})`}>
                <DataTable
                  columns={[
                    {
                      key: 'path',
                      header: '路徑',
                      render: (s) => (
                        <code className="inline">{s.path}</code>
                      ),
                    },
                    {
                      key: 'url',
                      header: '連結',
                      render: (s) => (
                        <code className="inline u-break-all">
                          {s.url ?? `/api/v1/public/files/${s.token}`}
                        </code>
                      ),
                    },
                    {
                      key: 'downloads',
                      header: '下載次數',
                      nowrap: true,
                      render: (s) => s.downloadCount,
                    },
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
                          }, '已取消分享')
                        }
                      >
                        取消
                      </Button>
                    </ActionBar>
                  )}
                  empty={
                    <EmptyState
                      title="尚未建立分享"
                      description="在檔案列按「分享」"
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
          description="Basic 用戶 ysk · 掛載 /webdav → 公用檔案根；token 只顯示一次"
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
                    setMsg(r.notes?.join('；') ?? '已簽發 token');
                  })
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              啟用並簽發 token
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
                    setMsg(s.enabled ? `已啟用 · ${s.mountPath}` : '未啟用');
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            >
              狀態
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
                    setMsg('已停用 WebDAV');
                  })
                  .catch((e: Error) => setError(e.message));
              }}
            >
              停用
            </Button>
          </ActionBar>
          {webdavToken ? (
            <p className="u-mt-2">
              <code className="inline u-break-all">{webdavToken}</code>
            </p>
          ) : (
            <p className="muted u-text-sm u-mt-2">
              {webdavEnabled ? '已啟用（token 不回顯）' : '預設關閉'}
            </p>
          )}
        </CardSection>
      </Card>
          </div>
        ) : null}
      </PageTabs>

      {/* Mkdir */}
      <Modal
        open={mkdirOpen}
        onClose={() => setMkdirOpen(false)}
        title="新建資料夾"
        description={`將建立於「${path || '/'}」`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setMkdirOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const name = mkdirName.trim();
                  if (!name) throw new Error('請輸入名稱');
                  await filesApi.mkdir(root, joinPath(path, name));
                  setMkdirOpen(false);
                  setMkdirName('');
                }, '已建立資料夾')
              }
            >
              建立
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field
            label="資料夾名稱"
            htmlFor="mn"
            flush
            required
            hint="不可含路徑分隔符"
          >
            <input
              id="mn"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
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
        onClose={() => setNewFileOpen(false)}
        title="新建文字檔"
        description={`將建立於「${path || '/'}」`}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setNewFileOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const name = newFileName.trim();
                  if (!name) throw new Error('請輸入檔名');
                  await filesApi.createText(root, joinPath(path, name), '');
                  setNewFileOpen(false);
                }, '已建立文字檔')
              }
            >
              建立
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field label="檔名" htmlFor="nf" flush required hint="例如 readme.md 或 notes.txt">
            <input
              id="nf"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
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
        onClose={() => {
          setVersionsPath(null);
          setVersions([]);
        }}
        title={`版本 — ${versionsPath ?? ''}`}
        description="覆寫前自動快照（.versions）；最多保留 20 版"
        footer={
          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              setVersionsPath(null);
              setVersions([]);
            }}
          >
            關閉
          </Button>
        }
      >
        {versions.length === 0 ? (
          <EmptyState title="尚無版本" description="修改並儲存檔案後會產生快照" />
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
                        setMsg(r.notes?.join('；') ?? '已還原');
                        return refresh();
                      })
                      .catch((e: Error) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  還原
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Rename */}
      <Modal
        open={Boolean(renameTarget)}
        onClose={() => setRenameTarget(null)}
        title="重新命名"
        description={renameTarget ? `目前：${renameTarget.name}` : undefined}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setRenameTarget(null)}>
              取消
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
                }, '已重新命名')
              }
            >
              確認
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field label="新名稱" htmlFor="rn" flush required hint="僅改檔名，不變更所在目錄">
            <input
              id="rn"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Move / copy */}
      <Modal
        open={Boolean(moveTarget)}
        onClose={() => setMoveTarget(null)}
        title={moveTarget?.mode === 'copy' ? '複製到…' : '移動到…'}
        description={
          moveTarget
            ? `${moveTarget.mode === 'copy' ? '複製' : '移動'} ${moveTarget.entries.length} 個項目`
            : undefined
        }
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setMoveTarget(null)}>
              取消
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
                }, moveTarget?.mode === 'copy' ? '已複製' : '已移動')
              }
            >
              確認
            </Button>
          </>
        }
      >
        <FormLayout>
          <Field
            label="目標資料夾路徑"
            htmlFor="md"
            flush
            hint="相對 root，例如 docs 或 docs/a；留空 = 根目錄"
          >
            <input
              id="md"
              value={moveDest}
              onChange={(e) => setMoveDest(e.target.value)}
              placeholder="docs/archive"
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Share */}
      <Modal
        open={Boolean(sharePath)}
        onClose={() => setSharePath(null)}
        title="建立公開分享連結"
        description="產生可對外下載的連結；可選密碼保護"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setSharePath(null)}>
              關閉
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
                      password: sharePass || undefined,
                    });
                    const url = `${window.location.origin}${r.share.url ?? `/api/v1/public/files/${r.share.token}`}`;
                    setShareResult(url);
                  })
                }
              >
                建立連結
              </Button>
            ) : null}
          </>
        }
      >
        <FormHint>
          路徑：<code className="inline">{sharePath}</code>
        </FormHint>
        <FormLayout>
          <Field
            label="密碼（可選）"
            htmlFor="sp"
            flush
            hint="留空則任何人持有連結即可下載"
          >
            <input
              id="sp"
              type="password"
              value={sharePass}
              onChange={(e) => setSharePass(e.target.value)}
              autoComplete="new-password"
              placeholder="（可留空）"
            />
          </Field>
        </FormLayout>
        {shareResult ? (
          <Alert variant="ok">
            連結已建立：
            <code className="inline u-break-all">{shareResult}</code>
          </Alert>
        ) : null}
      </Modal>

      {/* chmod */}
      <Modal
        open={chmodOpen}
        onClose={() => !busy && setChmodOpen(false)}
        title="修改權限（chmod）"
        size="sm"
        footer={
          <FormActions align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setChmodOpen(false)}
            >
              取消
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
                        `已 chmod ${chmodMode.trim()} → ${selected.size} 個項目`,
                      ],
                    });
                    setMsg(`已 chmod ${chmodMode.trim()}`);
                    setChmodOpen(false);
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'chmod 失敗');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              套用
            </Button>
          </FormActions>
        }
      >
        <FormHint>
          將套用到已選 {selected.size} 個項目（八進位，如 644 / 755）
        </FormHint>
        <div className="u-mb-3">
          <PresetChips
            options={[
              { value: '644', label: '644 檔' },
              { value: '755', label: '755 可執行' },
              { value: '600', label: '600 私密' },
              { value: '700', label: '700 目錄私密' },
              { value: '775', label: '775 群組寫' },
            ]}
            value={chmodMode}
            onChange={setChmodMode}
            allowCustom
            customPlaceholder="自訂 0644…"
            disabled={busy}
          />
        </div>
        <FormLayout>
          <Field label="模式" htmlFor="fm-chmod-mode" required flush>
            <input
              id="fm-chmod-mode"
              value={chmodMode}
              onChange={(e) => setChmodMode(e.target.value)}
              placeholder="644"
              pattern="[0-7]{3,4}"
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* zip */}
      <Modal
        open={zipOpen}
        onClose={() => !busy && setZipOpen(false)}
        title="壓縮為 zip"
        size="sm"
        footer={
          <FormActions align="end">
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setZipOpen(false)}
            >
              取消
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
                      notes: r.notes ?? [`已建立 ${destPath}`],
                    });
                    setMsg(`已壓縮 → ${destPath}`);
                    setZipOpen(false);
                    setSelected(new Set());
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'zip 失敗');
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              壓縮
            </Button>
          </FormActions>
        }
      >
        <FormHint>
          將壓縮已選 {selected.size} 個項目到目前資料夾（需系統有 zip 指令）
        </FormHint>
        <FormLayout>
          <Field
            label="目標檔名"
            htmlFor="fm-zip-name"
            required
            flush
            hint={`路徑：${path === '.' ? '' : path + '/'}${zipName || '….zip'}`}
          >
            <input
              id="fm-zip-name"
              value={zipName}
              onChange={(e) => setZipName(e.target.value)}
              placeholder="archive.zip"
            />
          </Field>
        </FormLayout>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={Boolean(delPaths?.length)}
        onClose={() => setDelPaths(null)}
        onConfirm={() =>
          void run(async () => {
            for (const p of delPaths ?? []) {
              await filesApi.remove(root, p, false);
            }
            setDelPaths(null);
          }, '已移至回收桶')
        }
        title="移至回收桶？"
        description={`將刪除 ${delPaths?.length ?? 0} 個項目（可於回收桶還原）`}
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />

      {/* Preview */}
      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.entry.name ?? '預覽'}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setPreview(null)}>
              關閉
            </Button>
            {preview ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => void doDownload(preview.entry.path)}
              >
                下載
              </Button>
            ) : null}
          </>
        }
      >
        {preview?.kind === 'text' ? (
          <pre className="code" style={{ maxHeight: 400, overflow: 'auto' }}>
            {preview.content}
          </pre>
        ) : null}
        {preview?.kind === 'image' && preview.url ? (
          <img
            src={preview.url}
            alt={preview.entry.name}
            style={{ maxWidth: '100%', maxHeight: 400 }}
            onError={() => setError('圖片預覽需要已登入；請改用下載')}
          />
        ) : null}
        {preview?.kind === 'pdf' && preview.url ? (
          <p className="muted">PDF 請按下載開啟（需授權標頭）</p>
        ) : null}
        {preview?.kind === 'other' ? (
          <p className="muted">此類型無法內嵌預覽，請下載。</p>
        ) : null}
      </Modal>
    </FeaturePageLayout>
  );
}
