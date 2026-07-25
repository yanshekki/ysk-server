import { FormEvent, useEffect, useState } from 'react';
import { api } from '../shared/services/api';

type Entry = { name: string; path: string; type: string; size: number; mtime: string };

export function FilesPage() {
  const [path, setPath] = useState('.');
  const [items, setItems] = useState<Entry[]>([]);
  const [content, setContent] = useState('');
  const [editPath, setEditPath] = useState('notes.txt');
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function refresh(p = path) {
    const r = await api.requestRaw<{ items: Entry[] }>(
      `/api/v1/files?root=public&path=${encodeURIComponent(p)}`,
    );
    setItems(r.items);
    setPath(p);
  }

  useEffect(() => {
    void refresh('.').catch((e: Error) => setError(e.message));
  }, []);

  async function openEntry(e: Entry) {
    setError(null);
    if (e.type === 'dir') {
      await refresh(e.path);
      return;
    }
    const r = await api.requestRaw<{ content: string; path: string }>(
      `/api/v1/files/read?root=public&path=${encodeURIComponent(e.path)}`,
    );
    setEditPath(r.path);
    setContent(r.content);
  }

  async function onSave(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    try {
      await api.requestRaw('/api/v1/files/write?root=public', {
        method: 'PUT',
        body: JSON.stringify({ path: editPath, content }),
      });
      setMsg(`Saved ${editPath}`);
      await refresh(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    }
  }

  async function onMkdir() {
    const name = `folder-${Date.now()}`;
    const p = path === '.' ? name : `${path}/${name}`;
    await api.requestRaw('/api/v1/files/mkdir?root=public', {
      method: 'POST',
      body: JSON.stringify({ path: p }),
    });
    await refresh(path);
  }

  return (
    <div>
      <header className="page-header">
        <h1>檔案管理</h1>
        <p>沙箱根目錄：dataDir/files/public（禁止路徑穿越）</p>
      </header>
      {error && <div className="alert alert--error">{error}</div>}
      {msg && <div className="alert alert--ok">{msg}</div>}

      <div className="card">
        <h2 className="card__title">瀏覽：{path}</h2>
        <div className="form-actions">
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void refresh('.')}>
            Root
          </button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void onMkdir()}>
            New folder
          </button>
        </div>
        <div className="table-wrap u-mt-4">
          <table className="data">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Modified</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.path}>
                  <td>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void openEntry(e)}>
                      {e.name}
                    </button>
                  </td>
                  <td>
                    <span className="badge">{e.type}</span>
                  </td>
                  <td>{e.size}</td>
                  <td className="muted u-nowrap">{e.mtime.slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2 className="card__title">編輯 / 上傳文字</h2>
        <form onSubmit={(e) => void onSave(e)}>
          <div className="field">
            <label htmlFor="fpath">Path</label>
            <input id="fpath" value={editPath} onChange={(e) => setEditPath(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="fcontent">Content</label>
            <textarea id="fcontent" rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
