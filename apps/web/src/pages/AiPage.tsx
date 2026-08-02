/**
 * AI ops console — Plan → Review → Execute.
 * Tasks: master–detail. Playbooks: dense action grid.
 * Create always in Modal.
 */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { useAiTasks } from '../features/llm';
import type { AiTask } from '../features/llm';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormHint,
  FormLayout,
  Modal,
  PageTabs,
  buttonClassName,
} from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';
import { bindSet, bindInput, bindCall1, bindCall2 } from './bind-handlers';

const AI_TABS = ['tasks', 'playbooks', 'about'] as const;

export function taskTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
  if (status === 'completed' || status === 'done' || status === 'executed') return 'ok';
  if (status === 'failed' || status === 'error' || status === 'rejected') return 'danger';
  if (
    status === 'pending' ||
    status === 'planned' ||
    status === 'running' ||
    status === 'approved'
  )
    return 'warn';
  if (status === 'cancelled') return 'neutral';
  return 'info';
}

export function statusLabel(status: string, t: TFunction): string {
  const key = `ai.status.${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

export function isTerminal(status: string): boolean {
  return ['completed', 'done', 'failed', 'error', 'cancelled'].includes(status);
}

export function canApprove(status: string): boolean {
  return ['pending', 'planned', 'approved'].includes(status);
}

export function canCancel(status: string): boolean {
  return !isTerminal(status);
}

export function pipelinePhase(status: string): 0 | 1 | 2 | 3 {
  if (status === 'completed' || status === 'done') return 3;
  if (status === 'running' || status === 'approved') return 2;
  if (status === 'planned' || status === 'pending') return 1;
  if (status === 'failed' || status === 'error' || status === 'cancelled') return 1;
  return 0;
}

export function stepCount(task: AiTask) {
  const steps = Array.isArray(task.steps) ? task.steps : [];
  const done = steps.filter((s) =>
    ['executed', 'completed', 'done'].includes(s.status),
  ).length;
  return { done, total: steps.length };
}

/** Progress fraction 0–1 for pipeline UI. */
export function stepProgress(task: AiTask): number {
  const { done, total } = stepCount(task);
  if (total <= 0) return 0;
  return Math.min(1, done / total);
}

/** Whether task can be re-run / re-planned. */
export function canRerun(status: string): boolean {
  return isTerminal(status) || status === 'rejected';
}

/** Sort key for task list (pending first). */
export function taskSortRank(status: string): number {
  if (status === 'running') return 0;
  if (status === 'pending' || status === 'planned' || status === 'approved') return 1;
  if (status === 'failed' || status === 'error') return 2;
  if (isTerminal(status)) return 3;
  return 4;
}

/** Truncate goal / prompt for list row. */
export function truncateGoal(goal: string | null | undefined, max = 80): string {
  const s = (goal ?? '').trim();
  if (!s) return '—';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/** Filter tasks by free-text query. */
export function filterTasksByQuery<
  T extends { goal?: string; title?: string; status?: string },
>(tasks: T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return tasks;
  return tasks.filter((t) => {
    const hay = `${t.goal ?? ''} ${t.title ?? ''} ${t.status ?? ''}`.toLowerCase();
    return hay.includes(s);
  });
}

/** Count non-terminal tasks. */
export function countActiveTasks(
  tasks: Array<{ status: string }> | null | undefined,
): number {
  return (tasks ?? []).filter((t) => !isTerminal(t.status)).length;
}

export function AiPage() {
  const { t } = useTranslation();
  const {
    prompt,
    setPrompt,
    tasks,
    playbooks,
    error,
    busy,
    selected,
    setSelected,
    createTask,
    approveAndRun,
    runPlaybook,
    cancelTask,
    rejectStep,
    refresh,
  } = useAiTasks();
  const [createOpen, setCreateOpen] = useState(false);
  const [tab, setTab] = usePageTab(AI_TABS, 'tasks');
  const [pbFilter, setPbFilter] = useState('');

  const stats = useMemo(() => {
    const active = tasks.filter((task) =>
      ['pending', 'planned', 'running', 'approved'].includes(task.status),
    ).length;
    const failed = tasks.filter((task) =>
      ['failed', 'error'].includes(task.status),
    ).length;
    const done = tasks.filter((task) =>
      ['completed', 'done'].includes(task.status),
    ).length;
    return { active, failed, done };
  }, [tasks]);

  useEffect(() => {
    if (!selected) {
      if (tasks[0]) setSelected(tasks[0]);
      return;
    }
    const fresh = tasks.find((task) => task.id === selected.id);
    if (fresh) setSelected(fresh);
    else if (tasks[0]) setSelected(tasks[0]);
    else setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only rebind when task ids/status change
  }, [tasks]);

  const filteredPlaybooks = useMemo(() => {
    const q = pbFilter.trim().toLowerCase();
    if (!q) return playbooks;
    return playbooks.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q),
    );
  }, [playbooks, pbFilter]);

  function openCreate() {
    setPrompt('');
    setCreateOpen(true);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await createTask(prompt);
      setCreateOpen(false);
      setPrompt('');
      setTab('tasks');
    } catch {
      /* hook */
    }
  }

  const phase = selected ? pipelinePhase(selected.status) : 0;
  const phases = [
    t('ai.phase.plan'),
    t('ai.phase.approve'),
    t('ai.phase.run'),
    t('ai.phase.done'),
  ] as const;

  return (
    <FeaturePageLayout
      title={t('nav.ai')}
      showCapability={false}
      status={{
        pill: {
          label:
            stats.active > 0
              ? t('ai.activeCount', { count: stats.active })
              : t('ai.taskCount', { count: tasks.length }),
          tone: stats.failed ? 'warn' : stats.active ? 'ok' : 'neutral',
        },
        items: [
          { label: t('ai.tasks'), value: tasks.length },
          { label: t('ai.active'), value: stats.active },
          { label: t('common.completed'), value: stats.done },
          {
            label: t('common.failed'),
            value: stats.failed,
            tone: stats.failed ? 'danger' : 'ok',
          },
        ],
      }}
      actions={
        <ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void refresh().catch(() => undefined)}
          >
            {t('common.refresh')}
          </Button>
          <Link to="/agents" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            Agents
          </Link>
        </ActionBar>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}

      <PageTabs
        tabs={[
          { id: 'tasks', label: t('ai.tasksTab', { count: tasks.length }) },
          { id: 'playbooks', label: t('ai.playbooksTab', { count: playbooks.length }) },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'tasks' ? (
          <div className="tab-panel">
            <div className="ai-console">
              <section className="ai-console__list ops-panel">
                <header className="ops-panel__head">
                  <div>
                    <h3 className="ops-panel__title">{t('ai.queueTitle')}</h3>
                    <p className="ops-panel__sub">{t('ai.queueSub')}</p>
                  </div>
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    {t('ai.createTaskPlus')}
                  </Button>
                </header>
                {tasks.length === 0 ? (
                  <EmptyState
                    title={t('ai.emptyTasks')}
                    description={t('ai.emptyTasksDesc')}
                  />
                ) : (
                  <div className="ai-task-list">
                    {tasks.map((task) => {
                      const sc = stepCount(task);
                      const active = selected?.id === task.id;
                      const tone = taskTone(task.status);
                      return (
                        <button
                          key={task.id}
                          type="button"
                          className={`ai-task-row ai-task-row--${tone}${
                            active ? ' is-active' : ''
                          }`}
                          onClick={bindSet(setSelected, task)}
                        >
                          <div className="ai-task-row__main">
                            <div className="ai-task-row__title">
                              <span className="ai-task-row__prompt">
                                {task.prompt || t('ai.noPrompt')}
                              </span>
                              <Badge tone={tone}>{statusLabel(task.status, t)}</Badge>
                            </div>
                            <div className="ai-task-row__meta">
                              <span>
                                {t('ai.stepsOf', {
                                  done: sc.done,
                                  total: sc.total || t('common.noneSelectedShort'),
                                })}
                              </span>
                              <span className="ai-task-row__id">
                                {task.id.slice(0, 8)}
                              </span>
                            </div>
                          </div>
                          <span className="ai-task-row__chev" aria-hidden>
                            ›
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="ai-console__detail ops-panel">
                {selected ? (
                  <>
                    <header className="ops-panel__head ops-panel__head--stack">
                      <div className="ops-panel__head-row">
                        <div>
                          <h3 className="ops-panel__title ai-detail__prompt">
                            {selected.prompt}
                          </h3>
                          <p className="ops-panel__sub">
                            {selected.planSummary || t('ai.noPlanSummary')}
                          </p>
                        </div>
                        <Badge tone={taskTone(selected.status)}>
                          {statusLabel(selected.status, t)}
                        </Badge>
                      </div>
                      <div className="ai-pipeline" aria-label={t('ai.pipelineAria')}>
                        {phases.map((label, i) => (
                          <div
                            key={label}
                            className={`ai-pipeline__step${
                              i <= phase ? ' is-done' : ''
                            }${i === phase ? ' is-current' : ''}`}
                          >
                            <span className="ai-pipeline__dot">{i + 1}</span>
                            <span className="ai-pipeline__lab">{label}</span>
                          </div>
                        ))}
                      </div>
                      <ActionBar>
                        {canApprove(selected.status) ? (
                          <Button
                            variant="primary"
                            size="md"
                            loading={busy}
                            onClick={bindCall1(approveAndRun, selected.id)}
                          >
                            {t('ai.approveRun')}
                          </Button>
                        ) : null}
                        {canCancel(selected.status) ? (
                          <Button
                            variant="ghost"
                            size="md"
                            loading={busy}
                            onClick={bindCall1(cancelTask, selected.id)}
                          >
                            {t('ai.cancelTask')}
                          </Button>
                        ) : null}
                        {isTerminal(selected.status) ? (
                          <span className="muted u-text-sm">{t('ai.terminalHint')}</span>
                        ) : null}
                      </ActionBar>
                    </header>

                    <div className="ai-steps">
                      <h4 className="ai-steps__title">
                        {t('ai.stepsTitle', {
                          count: Array.isArray(selected.steps)
                            ? selected.steps.length
                            : 0,
                        })}
                      </h4>
                      {!Array.isArray(selected.steps) ||
                      selected.steps.length === 0 ? (
                        <p className="ops-muted">{t('ai.noSteps')}</p>
                      ) : (
                        <ol className="ai-steps__list">
                          {selected.steps.map((s, idx) => (
                            <li
                              key={s.id}
                              className={`ai-step ai-step--${taskTone(s.status)}`}
                            >
                              <div className="ai-step__idx">{idx + 1}</div>
                              <div className="ai-step__body">
                                <div className="ai-step__head">
                                  <code className="ai-step__tool">{s.tool}</code>
                                  <Badge tone={taskTone(s.status)}>
                                    {statusLabel(s.status, t)}
                                  </Badge>
                                  {s.requiresApproval ? (
                                    <Badge tone="warn">{t('ai.needsApproval')}</Badge>
                                  ) : (
                                    <span className="muted u-text-sm">
                                      {t('ai.noApproval')}
                                    </span>
                                  )}
                                </div>
                                {s.error ? (
                                  <p className="ai-step__err">{s.error}</p>
                                ) : null}
                              </div>
                              {(s.status === 'planned' || s.status === 'approved') && (
                                <Button
                                  variant="danger"
                                  size="sm"
                                  loading={busy}
                                  onClick={bindCall2(rejectStep, selected.id, s.id)}
                                >
                                  {t('ai.reject')}
                                </Button>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  </>
                ) : (
                  <EmptyState
                    title={t('ai.selectTask')}
                    description={t('ai.selectTaskDesc')}
                  />
                )}
              </section>
            </div>
          </div>
        ) : null}

        {tab === 'playbooks' ? (
          <div className="tab-panel">
            <section className="ops-panel">
              <header className="ops-panel__head ops-panel__head--stack">
                <div className="ops-panel__head-row">
                  <div>
                    <h3 className="ops-panel__title">{t('ai.playbooksTitle')}</h3>
                    <p className="ops-panel__sub">{t('ai.playbooksSub')}</p>
                  </div>
                  <span className="ops-muted">
                    {t('ai.countItems', { count: filteredPlaybooks.length })}
                  </span>
                </div>
                <Field label={t('common.search')} htmlFor="pb-filter" flush>
                  <input
                    id="pb-filter"
                    value={pbFilter}
                    onChange={bindInput(setPbFilter)}
                    placeholder={t('ai.searchPh')}
                  />
                </Field>
              </header>
              {filteredPlaybooks.length === 0 ? (
                <EmptyState
                  title={t('ai.noPlaybooks')}
                  description={t('ai.noPlaybooksDesc')}
                />
              ) : (
                <div className="ai-pb-grid">
                  {filteredPlaybooks.map((p) => (
                    <article key={p.id} className="ai-pb-card">
                      <div className="ai-pb-card__body">
                        <h4 className="ai-pb-card__name">{p.name}</h4>
                        <p className="ai-pb-card__desc">
                          {p.description || t('common.noneSelectedShort')}
                        </p>
                      </div>
                      <footer className="ai-pb-card__foot">
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busy}
                          onClick={() => {
                            void (async () => {
                              try {
                                await runPlaybook(p.id);
                                setTab('tasks');
                              } catch {
                                /* hook */
                              }
                            })();
                          }}
                        >
                          {t('ai.run')}
                        </Button>
                      </footer>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="ai" /> : null}
      </PageTabs>

      <Modal
        open={createOpen}
        onClose={bindSet(setCreateOpen, false)}
        title={t('ai.createTitle')}
        description={t('ai.createDesc')}
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={bindSet(setCreateOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="ai-create"
              variant="primary"
              size="md"
              loading={busy}
            >
              {t('ai.generatePlan')}
            </Button>
          </>
        }
      >
        <form id="ai-create" onSubmit={(e) => void onCreate(e)}>
          <FormLayout>
            <Field
              label={t('ai.promptLabel')}
              htmlFor="prompt"
              fullWidth
              flush
              required
              hint={t('ai.promptHint')}
            >
              <textarea
                id="prompt"
                value={prompt}
                onChange={bindInput(setPrompt)}
                required
                rows={5}
                placeholder={t('ai.promptPh')}
              />
            </Field>
          </FormLayout>
          <FormHint>{t('ai.createHint')}</FormHint>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
