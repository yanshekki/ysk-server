/**
 * ownCloud-style file manager — public + project roots, trash, shares, upload.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  FeaturePageLayout,
  Field,
  Modal,
  SummaryStrip,
} from '../shared/components/ui';
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

  return (
    <FeaturePageLayout
      title="檔案"
      subtitle="公用 / 專案 · 版本 · WebDAV · 分享"
      actions={
        <div className="btn-row">
          <Link to="/files/public">
            <Button variant="secondary" size="md">
              公用站設定
            </Button>
          </Link>
          <Button variant="secondary" size="md" loading={busy} onClick={() => void refresh()}>
            重新整理
          </Button>
        </div>
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

      <SummaryStrip
        items={[
          { label: '檔案', value: String(usage?.fileCount ?? items.filter((i) => i.type === 'file').length) },
          { label: '資料夾', value: String(usage?.dirCount ?? items.filter((i) => i.type === 'dir').length) },
          { label: '用量', value: formatBytes(usage?.bytes ?? 0) },
          { label: '已選', value: String(selected.size) },
        ]}
      />

      <Card>
        <CardSection
          title="WebDAV"
          description="Basic 用戶 ysk · 掛載 /webdav → 公用檔案根；token 只顯示一次"
        >
          <div className="btn-row">
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
          </div>
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
                ['shares', '已分享連結'],
                ['trash', '回收桶'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`fm-side-item${side === id ? ' is-active' : ''}`}
                onClick={() => setSide(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </aside>

        {/* Main */}
        <div className="fm-main">
          {side === 'all' || side === 'favorites' ? (
            <>
              {/* Toolbar */}
              <div className="fm-toolbar">
                <div className="btn-row">
                  <label className="btn btn--primary btn--md fm-upload-btn">
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
                        loading={busy}
                        onClick={() => {
                          const mode = window.prompt('chmod 八進位（如 644 或 755）', '644');
                          if (!mode) return;
                          void (async () => {
                            setBusy(true);
                            try {
                              for (const p of selected) {
                                await filesApi.chmod(root, p, mode);
                              }
                              await refresh();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'chmod 失敗');
                            } finally {
                              setBusy(false);
                            }
                          })();
                        }}
                      >
                        chmod
                      </Button>
                      <Button
                        variant="secondary"
                        size="md"
                        loading={busy}
                        onClick={() => {
                          const dest =
                            window.prompt(
                              '壓縮目標檔名（.zip）',
                              `archive-${Date.now()}.zip`,
                            ) || '';
                          if (!dest.endsWith('.zip')) return;
                          const destPath = path === '.' ? dest : `${path}/${dest}`;
                          void (async () => {
                            setBusy(true);
                            try {
                              await filesApi.zip(root, [...selected], destPath);
                              await refresh();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : 'zip 失敗');
                            } finally {
                              setBusy(false);
                            }
                          })();
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
                              try {
                                await filesApi.unzip(root, zipPath, path === '.' ? '.' : path);
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
                </div>
                <div className="btn-row">
                  <input
                    className="fm-search"
                    placeholder="搜尋檔名…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    value={`${sort}:${order}`}
                    onChange={(e) => {
                      const [s, o] = e.target.value.split(':') as [SortKey, 'asc' | 'desc'];
                      setSort(s);
                      setOrder(o);
                    }}
                    aria-label="排序"
                  >
                    <option value="name:asc">名稱 ↑</option>
                    <option value="name:desc">名稱 ↓</option>
                    <option value="size:asc">大小 ↑</option>
                    <option value="size:desc">大小 ↓</option>
                    <option value="mtime:desc">最新</option>
                    <option value="mtime:asc">最舊</option>
                  </select>
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
                </div>
              </div>

              {/* Breadcrumb */}
              <nav className="fm-breadcrumb btn-row" aria-label="路徑">
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
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th style={{ width: 40 }}>
                            <input
                              type="checkbox"
                              checked={selected.size === items.length && items.length > 0}
                              onChange={selectAll}
                              aria-label="全選"
                            />
                          </th>
                          <th>名稱</th>
                          <th>大小</th>
                          <th>修改</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((e) => (
                          <tr key={e.path} className={selected.has(e.path) ? 'is-selected' : ''}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selected.has(e.path)}
                                onChange={() => toggleSelect(e.path)}
                              />
                            </td>
                            <td>
                              <button type="button" className="fm-name-btn" onClick={() => void openEntry(e)}>
                                <span aria-hidden>{iconFor(e)}</span> {e.name}
                                {e.favorite ? ' ★' : ''}
                              </button>
                            </td>
                            <td>{e.type === 'dir' ? '—' : formatBytes(e.size)}</td>
                            <td className="muted u-nowrap">
                              {e.mtime.slice(0, 19).replace('T', ' ')}
                            </td>
                            <td>
                              <div className="btn-row">
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
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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
          ) : null}

          {side === 'trash' ? (
            <Card>
              <CardSection
                title={`回收桶 (${trash.length})`}
                description="刪除的檔案可還原或永久清除"
              >
                <div className="btn-row u-mb-3">
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
                </div>
                {trash.length === 0 ? (
                  <EmptyState title="回收桶是空的" />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>名稱</th>
                          <th>原路徑</th>
                          <th>刪除時間</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trash.map((t) => (
                          <tr key={t.trashId}>
                            <td>
                              {iconFor(t)} {t.name}
                            </td>
                            <td>
                              <code className="inline">{t.originalPath}</code>
                            </td>
                            <td className="muted u-nowrap">
                              {t.deletedAt.slice(0, 19).replace('T', ' ')}
                            </td>
                            <td>
                              <div className="btn-row">
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
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardSection>
            </Card>
          ) : null}

          {side === 'shares' ? (
            <Card>
              <CardSection title={`公開分享連結 (${shares.length})`}>
                {shares.length === 0 ? (
                  <EmptyState title="尚未建立分享" description="在檔案列按「分享」" />
                ) : (
                  <div className="table-wrap">
                    <table className="data">
                      <thead>
                        <tr>
                          <th>路徑</th>
                          <th>連結</th>
                          <th>下載次數</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shares.map((s) => (
                          <tr key={s.id}>
                            <td>
                              <code className="inline">{s.path}</code>
                            </td>
                            <td>
                              <code className="inline u-break-all">
                                {s.url ?? `/api/v1/public/files/${s.token}`}
                              </code>
                            </td>
                            <td>{s.downloadCount}</td>
                            <td>
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
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardSection>
            </Card>
          ) : null}
        </div>
      </div>

      {/* Mkdir */}
      <Modal
        open={mkdirOpen}
        onClose={() => setMkdirOpen(false)}
        title="新建資料夾"
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
        <Field label="資料夾名稱" htmlFor="mn">
          <input id="mn" value={mkdirName} onChange={(e) => setMkdirName(e.target.value)} autoFocus />
        </Field>
      </Modal>

      {/* New text file */}
      <Modal
        open={newFileOpen}
        onClose={() => setNewFileOpen(false)}
        title="新建文字檔"
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
        <Field label="檔名" htmlFor="nf">
          <input
            id="nf"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            autoFocus
          />
        </Field>
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
              <li key={v.id} className="btn-row">
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
        <Field label="新名稱" htmlFor="rn">
          <input id="rn" value={renameTo} onChange={(e) => setRenameTo(e.target.value)} />
        </Field>
      </Modal>

      {/* Move / copy */}
      <Modal
        open={Boolean(moveTarget)}
        onClose={() => setMoveTarget(null)}
        title={moveTarget?.mode === 'copy' ? '複製到…' : '移動到…'}
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
        <Field label="目標資料夾路徑" htmlFor="md" hint="相對 root，例如 docs 或 docs/a（空=根目錄）">
          <input id="md" value={moveDest} onChange={(e) => setMoveDest(e.target.value)} />
        </Field>
      </Modal>

      {/* Share */}
      <Modal
        open={Boolean(sharePath)}
        onClose={() => setSharePath(null)}
        title="建立公開分享連結"
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
        <p className="muted u-text-sm">路徑：{sharePath}</p>
        <Field label="密碼（可選）" htmlFor="sp">
          <input
            id="sp"
            type="password"
            value={sharePass}
            onChange={(e) => setSharePass(e.target.value)}
            autoComplete="new-password"
          />
        </Field>
        {shareResult ? (
          <Alert variant="ok">
            連結已建立：
            <code className="inline u-break-all">{shareResult}</code>
          </Alert>
        ) : null}
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
