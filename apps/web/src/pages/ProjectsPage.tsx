/**
 * Projects list — server-backed search / runtime filter + ListToolbar.
 */
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ProjectDto } from '@ysk/shared';
import {
  ProjectCreateModal,
  ProjectList,
  projectsApi,
} from '../features/projects';
import { summarizeProjects } from '../features/projects/model/status';
import {
  ActionBar,
  Alert,
  Button,
  FeaturePageLayout,
  ListPanel,
  ListToolbar,
  WithPageGuide,
} from '../shared/components/ui';
import { useServerList } from '../shared/hooks/useServerList';
import { toast } from '../shared/stores/toast-store';
import { bindFilter, bindFormSubmit, bindInput, bindSet, bindValueSet } from './bind-handlers';

export function ProjectsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const list = useServerList<ProjectDto>({ path: '/api/v1/projects', debounceMs: 300 });
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const setMsg = useCallback((text: string | null) => {
    if (text) toast.ok(text);
  }, []);

  const items = list.items;
  const stats = useMemo(() => summarizeProjects(items), [items]);
  const total = list.meta?.total ?? items.length;
  const facets = list.meta?.facets;
  const runtime = list.filters.runtime ?? '';

  return (
    <FeaturePageLayout
      title={t('nav.projects', { defaultValue: t('common.project') })}
      status={{
        pill: {
          label: total
            ? t('projects.statProjects', { count: total })
            : t('projects.noProjectsShort'),
          tone: total ? 'ok' : 'warn',
        },
        items: [
          { label: t('projects.statTotal'), value: total },
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
      actions={
        <ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={list.loading || busy}
            onClick={() => void list.refresh().catch((e: Error) => list.setError(e.message))}
          >
            {t('common.refresh')}
          </Button>
        </ActionBar>
      }
    >
      <WithPageGuide guideId="projects">
        {list.error ? <Alert variant="error">{list.error}</Alert> : null}

        <ListPanel
          title={t('nav.projects', { defaultValue: t('common.project') })}
          description={t('projects.searchPlaceholder')}
          toolbar={
            <ActionBar>
              <Button variant="primary" size="sm" onClick={bindSet(setCreateOpen, true)}>
                + {t('projects.create')}
              </Button>
            </ActionBar>
          }
          filters={
            <ListToolbar
              search={list.q}
              onSearchChange={list.setQ}
              searchPlaceholder={t('projects.searchPlaceholder')}
              searchAriaLabel={t('projects.searchPlaceholder')}
              searching={list.searching}
              loading={list.loading}
              total={total}
              shown={items.length}
              activeFilterCount={list.activeFilterCount}
              onClear={list.clear}
              chipGroups={[
                {
                  key: 'runtime',
                  ariaLabel: t('projects.runtime'),
                  allLabel: t('projects.filterAll'),
                  value: runtime,
                  onChange: ((setFilter) => (v: string) => setFilter('runtime', v))(list.setFilter),
                  chips: [
                    { id: 'node', label: 'Node', count: facets?.runtime?.node },
                    { id: 'php', label: 'PHP', count: facets?.runtime?.php },
                    { id: 'python', label: 'Python', count: facets?.runtime?.python },
                    { id: 'go', label: 'Go', count: facets?.runtime?.go },
                    { id: 'rust', label: 'Rust', count: facets?.runtime?.rust },
                    { id: 'java', label: 'Java', count: facets?.runtime?.java },
                    { id: 'kotlin', label: 'Kotlin', count: facets?.runtime?.kotlin },
                    { id: 'bun', label: 'Bun', count: facets?.runtime?.bun },
                    {
                      id: 'static',
                      label: t('common.static'),
                      count: facets?.runtime?.static,
                    },
                  ],
                },
              ]}
            />
          }
          empty={items.length === 0}
          emptyTitle={
            list.activeFilterCount > 0
              ? t('projects.emptyFilter')
              : t('projects.empty')
          }
          emptyDescription={
            list.activeFilterCount > 0
              ? t('projects.emptyFilterHint')
              : t('projects.emptyHint')
          }
        >
          <ProjectList
            items={items}
            emptyTitle={
              list.activeFilterCount > 0
                ? t('projects.emptyFilter')
                : t('projects.empty')
            }
            emptyDescription={
              list.activeFilterCount > 0
                ? t('projects.emptyFilterHint')
                : t('projects.emptyHint')
            }
          />
        </ListPanel>

        <ProjectCreateModal
          open={createOpen}
          onClose={bindSet(setCreateOpen, false)}
          busy={busy}
          onSubmit={async (input) => {
            setMsg(null);
            list.setError(null);
            setBusy(true);
            try {
              const r = await projectsApi.create(input);
              const extra = r.extras?.notes?.length
                ? ` · ${r.extras.notes.join('；')}`
                : '';
              setMsg(`${t('projects.created', { name: r.project.name })}${extra}`);
              setCreateOpen(false);
              await list.refresh();
              navigate(`/projects/${r.project.id}?tab=deploy&fresh=1`);
            } catch (e) {
              list.setError(e instanceof Error ? e.message : t('common.createFailed'));
            } finally {
              setBusy(false);
            }
          }}
        />
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
