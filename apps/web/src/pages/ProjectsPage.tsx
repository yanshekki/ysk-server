/**
 * Projects list — FeaturePageLayout aligned with recent UX.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ProjectCreateModal,
  ProjectList,
  ProjectSummaryStrip,
  useProjects,
} from '../features/projects';
import { Alert, Button, FeaturePageLayout } from '../shared/components/ui';

export function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { items, error, setError, busy, create, refresh } = useProjects();
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [runtimeFilter, setRuntimeFilter] = useState<
    'all' | 'node' | 'php' | 'static' | 'python' | 'go' | 'rust'
  >('all');
  const [msg, setMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((p) => {
      if (runtimeFilter !== 'all' && p.runtime !== runtimeFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.domain?.toLowerCase().includes(q) ?? false) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [items, query, runtimeFilter]);

  return (
    <FeaturePageLayout
      title={t('projects.title')}
      subtitle={t('projects.subtitle')}
      actions={
        <div className="btn-row">
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            {t('common.refresh')}
          </Button>
          <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
            + {t('projects.create')}
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

      <ProjectSummaryStrip items={items} />

      <Alert variant="info">
        專案詳情內部署／發布需<strong>系統變更權限</strong>；Nginx 發布會寫管理 conf，成功 reload 才算真正上線。
      </Alert>

      <div className="page-toolbar">
        <div className="page-toolbar__search">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('projects.searchPlaceholder')}
            aria-label={t('projects.searchPlaceholder')}
          />
        </div>
        <select
          value={runtimeFilter}
          onChange={(e) => setRuntimeFilter(e.target.value as typeof runtimeFilter)}
          aria-label={t('projects.runtime')}
        >
          <option value="all">{t('projects.filterAll')}</option>
          <option value="node">Node.js</option>
          <option value="php">PHP</option>
          <option value="python">Python</option>
          <option value="go">Go</option>
          <option value="rust">Rust</option>
          <option value="static">靜態</option>
        </select>
      </div>

      <ProjectList
        items={filtered}
        emptyTitle={items.length === 0 ? t('projects.empty') : t('projects.emptyFilter')}
        emptyDescription={
          items.length === 0 ? t('projects.emptyHint') : t('projects.emptyFilterHint')
        }
        emptyAction={
          items.length === 0 ? (
            <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
              + {t('projects.create')}
            </Button>
          ) : undefined
        }
      />

      <ProjectCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        busy={busy}
        onSubmit={async (input) => {
          setMsg(null);
          setError(null);
          try {
            const r = await create(input);
            const extra = r.extras?.notes?.length ? ` · ${r.extras.notes.join('；')}` : '';
            setMsg(`${t('projects.created', { name: r.project.name })}${extra}`);
            setCreateOpen(false);
            navigate(`/projects/${r.project.id}?tab=deploy&fresh=1`);
          } catch {
            /* error from hook */
          }
        }}
      />
    </FeaturePageLayout>
  );
}
