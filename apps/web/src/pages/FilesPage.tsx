import { FormEvent } from 'react';
import { useFiles } from '../features/files';

export function FilesPage() {
  const {
    path,
    items,
    content,
    setContent,
    editPath,
    setEditPath,
    error,
    msg,
    refresh,
    openEntry,
    save,
    mkdir,
  } = useFiles();

  async function onSave(ev: FormEvent) {
    ev.preventDefault();
    try {
      await save(editPath, content);
    } catch {
      /* hook sets error */
    }
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
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void mkdir()}>
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
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => void openEntry(e)}
                    >
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
            <textarea
              id="fcontent"
              rows={8}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
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
