/**
 * Projects list — FeaturePageLayout aligned with recent UX.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ProjectCreateModal,
  ProjectList,
  useProjects,
} from '../features/projects';
import { summarizeProjects } from '../features/projects/model/status';
import {
  ActionBar,
  Alert,
  Button,
  FeaturePageLayout,
  ListPanel,
  SegRadio,
} from '../shared/components/ui';

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

  const stats = useMemo(() => summarizeProjects(items), [items]);

  return (
    <FeaturePageLayout
      title={t('nav.projects', { defaultValue: '專案' })}
      status={{
        pill: {
          label: stats.total ? `${stats.total} 專案` : '尚無專案',
          tone: stats.total ? 'ok' : 'warn',
        },
        items: [
          { label: t('projects.statTotal'), value: stats.total },
          { label: t('projects.statRunning'), value: stats.running, tone: 'ok' },
          { label: t('projects.statDegraded'), value: stats.degraded, tone: 'warn' },
          {
            label: t('projects.statPendingOs'),
            value: stats.pendingOs,
            tone: stats.pendingOs > 0 ? 'warn' : undefined,
          },
          {
            label: t('projects.statUnhealthy'),
            value: stats.unhealthy,
            tone: 'danger',
          },
          { label: t('projects.statStopped'), value: stats.stopped },
        ],
      }}
      actions={<ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void refresh().catch((e: Error) => setError(e.message))}
          >
            {t('common.refresh')}
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

      <ListPanel
        title={t('nav.projects', { defaultValue: '專案' })}
        description={t('projects.searchPlaceholder')}
        toolbar={
          <ActionBar>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              + {t('projects.create')}
            </Button>
          </ActionBar>
        }
        filters={
          <div className="page-toolbar" style={{ margin: 0, border: 'none', padding: 0 }}>
            <div className="page-toolbar__search">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('projects.searchPlaceholder')}
                aria-label={t('projects.searchPlaceholder')}
              />
            </div>
            <SegRadio
              name="proj-rt-filter"
              aria-label={t('projects.runtime')}
              size="sm"
              value={runtimeFilter}
              onChange={(v) => setRuntimeFilter(v as typeof runtimeFilter)}
              options={[
                { value: 'all', label: t('projects.filterAll') },
                { value: 'node', label: 'Node' },
                { value: 'php', label: 'PHP' },
                { value: 'python', label: 'Python' },
                { value: 'go', label: 'Go' },
                { value: 'rust', label: 'Rust' },
                { value: 'static', label: '靜態' },
              ]}
            />
          </div>
        }
        empty={filtered.length === 0}
        emptyTitle={items.length === 0 ? t('projects.empty') : t('projects.emptyFilter')}
        emptyDescription={
          items.length === 0 ? t('projects.emptyHint') : t('projects.emptyFilterHint')
        }
      >
        <ProjectList
          items={filtered}
          emptyTitle={items.length === 0 ? t('projects.empty') : t('projects.emptyFilter')}
          emptyDescription={
            items.length === 0 ? t('projects.emptyHint') : t('projects.emptyFilterHint')
          }
        />
      </ListPanel>

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
