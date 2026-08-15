/**
 * Folder picker over Files roots (public / project).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { filesApi } from '../files/api';
import { Button } from '../../shared/components/ui';

export function FolderPicker(props: {
  root: string;
  path: string;
  onPath: (path: string) => void;
  onNewFolder?: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await filesApi.list(props.root, props.path || '.');
      const items = (r.items ?? []).filter((e) => e.type === 'dir');
      setDirs(items.map((e) => ({ name: e.name, path: e.path })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setDirs([]);
    }
  }, [props.root, props.path]);

  useEffect(() => {
    void load();
  }, [load]);

  const crumbs = (props.path || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="bt-folder">
      <div className="bt-folder__crumbs">
        <button
          type="button"
          className="bt-folder__crumb"
          onClick={() => props.onPath('')}
        >
          /
        </button>
        {crumbs.map((c, i) => {
          const p = crumbs.slice(0, i + 1).join('/');
          return (
            <span key={p}>
              <span className="muted">/</span>
              <button
                type="button"
                className="bt-folder__crumb"
                onClick={() => props.onPath(p)}
              >
                {c}
              </button>
            </span>
          );
        })}
      </div>
      {err ? <p className="bt-folder__err">{err}</p> : null}
      <ul className="bt-folder__list">
        {dirs.length === 0 ? (
          <li className="muted u-text-sm">{t('btTracker.folderEmpty')}</li>
        ) : (
          dirs.map((d) => (
            <li key={d.path}>
              <button
                type="button"
                className="bt-folder__dir"
                onClick={() => props.onPath(d.path)}
              >
                {d.name}
              </button>
            </li>
          ))
        )}
      </ul>
      {props.onNewFolder ? (
        <div className="bt-folder__new">
          <input
            className="input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('btTracker.newFolder')}
            aria-label={t('btTracker.newFolder')}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy || !newName.trim() || /[\\/]/.test(newName)}
            onClick={() => {
              const name = newName.trim();
              if (!name) return;
              setBusy(true);
              void props
                .onNewFolder!(name)
                .then(() => {
                  setNewName('');
                  return load();
                })
                .finally(() => setBusy(false));
            }}
          >
            {t('btTracker.newFolder')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
