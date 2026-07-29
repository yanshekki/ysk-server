/**
 * Projects list — FeaturePageLayout aligned with recent UX.
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ProjectCreateModal,
  ProjectList,
  ProjectSummaryStrip,
  useProjects,
} from '../features/projects';
import {
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  OpsHero,
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

  return (
    <FeaturePageLayout
      title={t('nav.projects', { defaultValue: '專案' })}
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

      <OpsHero
        pill={`${items.length}`}
        pillTone={items.length ? 'ok' : 'warn'}
        tone={items.length ? 'ok' : 'warn'}
        meta={
          <>
            <span>
              {filtered.length}/{items.length}
            </span>
            {runtimeFilter !== 'all' ? (
              <>
                <span className="ops-hero__dot" />
                <span>{runtimeFilter}</span>
              </>
            ) : null}
          </>
        }
        cta={
          <>
            <Button variant="primary" size="md" onClick={() => setCreateOpen(true)}>
              + 建立專案
            </Button>
            <Link to="/nginx" className="btn btn--secondary btn--md">
              Nginx
            </Link>
            <Link to="/ssl" className="btn btn--ghost btn--md">
              SSL
            </Link>
            <Link to="/system/readiness" className="btn btn--ghost btn--md">
              就緒
            </Link>
          </>
        }
        stats={[
          { label: '專案', value: items.length },
          {
            label: 'Node',
            value: items.filter((p) => p.runtime === 'node').length,
          },
          {
            label: 'PHP',
            value: items.filter((p) => p.runtime === 'php').length,
          },
          {
            label: '其他',
            value: items.filter(
              (p) => !['node', 'php'].includes(p.runtime),
            ).length,
          },
        ]}
      />

      <ProjectSummaryStrip items={items} />

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

      <ProjectList
        items={filtered}
        emptyTitle={items.length === 0 ? t('projects.empty') : t('projects.emptyFilter')}
        emptyDescription={
          items.length === 0 ? t('projects.emptyHint') : t('projects.emptyFilterHint')
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
