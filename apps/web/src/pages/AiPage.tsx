/**
 * AI ops console — Plan → Review → Execute.
 * Tasks: master–detail. Playbooks: dense action grid.
 * Create always in Modal.
 */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const AI_TABS = ['tasks', 'playbooks', 'about'] as const;

function taskTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
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

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    completed: '已完成',
    done: '已完成',
    executed: '已執行',
    failed: '失敗',
    error: '錯誤',
    rejected: '已拒絕',
    pending: '待處理',
    planned: '待審批',
    approved: '已批准',
    running: '執行中',
    cancelled: '已取消',
  };
  return map[status] ?? status;
}

function isTerminal(status: string): boolean {
  return ['completed', 'done', 'failed', 'error', 'cancelled'].includes(status);
}

function canApprove(status: string): boolean {
  return ['pending', 'planned', 'approved'].includes(status);
}

function canCancel(status: string): boolean {
  return !isTerminal(status);
}

function pipelinePhase(status: string): 0 | 1 | 2 | 3 {
  if (status === 'completed' || status === 'done') return 3;
  if (status === 'running' || status === 'approved') return 2;
  if (status === 'planned' || status === 'pending') return 1;
  if (status === 'failed' || status === 'error' || status === 'cancelled') return 1;
  return 0;
}

function stepCount(task: AiTask) {
  const done = task.steps.filter((s) =>
    ['executed', 'completed', 'done'].includes(s.status),
  ).length;
  return { done, total: task.steps.length };
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
    const active = tasks.filter((t) =>
      ['pending', 'planned', 'running', 'approved'].includes(t.status),
    ).length;
    const failed = tasks.filter((t) =>
      ['failed', 'error'].includes(t.status),
    ).length;
    const done = tasks.filter((t) =>
      ['completed', 'done'].includes(t.status),
    ).length;
    return { active, failed, done };
  }, [tasks]);

  // Keep selected in sync with list after refresh
  useEffect(() => {
    if (!selected) {
      if (tasks[0]) setSelected(tasks[0]);
      return;
    }
    const fresh = tasks.find((t) => t.id === selected.id);
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

  return (
    <FeaturePageLayout
      title={t('nav.ai', { defaultValue: 'AI 任務' })}
      showCapability={false}
      status={{
        pill: {
          label:
            stats.active > 0 ? `${stats.active} 進行中` : `${tasks.length} 任務`,
          tone: stats.failed ? 'warn' : stats.active ? 'ok' : 'neutral',
        },
        items: [
          { label: '任務', value: tasks.length },
          { label: '進行中', value: stats.active },
          { label: '已完成', value: stats.done },
          {
            label: '失敗',
            value: stats.failed,
            tone: stats.failed ? 'danger' : 'ok',
          },
        ],
      }}
      actions={<ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void refresh().catch(() => undefined)}
          >
            重新整理
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
          { id: 'tasks', label: `任務 (${tasks.length})` },
          { id: 'playbooks', label: `劇本 (${playbooks.length})` },
        
          { id: 'about', label: '說明' },
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
                      <h3 className="ops-panel__title">任務佇列</h3>
                      <p className="ops-panel__sub">
                        點選查看計劃與步驟 · 終態唔顯示多餘操作
                      </p>
                    </div>
                    <Button variant="primary" size="sm" onClick={openCreate}>
                      + 建立任務
                    </Button>
                  </header>
                  {tasks.length === 0 ? (
                    <EmptyState
                      title="尚未有任務"
                      description="用列表右上角建立任務，或從劇本庫一鍵產生"
                      action={
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setTab('playbooks')}
                        >
                          瀏覽劇本
                        </Button>
                      }
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
                          onClick={() => setSelected(task)}
                        >
                          <div className="ai-task-row__main">
                            <div className="ai-task-row__title">
                              <span className="ai-task-row__prompt">
                                {task.prompt || '（無提示）'}
                              </span>
                              <Badge tone={tone}>{statusLabel(task.status)}</Badge>
                            </div>
                            <div className="ai-task-row__meta">
                              <span>
                                步驟 {sc.done}/{sc.total || '—'}
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
                              {selected.planSummary || '（無計劃摘要）'}
                            </p>
                          </div>
                          <Badge tone={taskTone(selected.status)}>
                            {statusLabel(selected.status)}
                          </Badge>
                        </div>
                        <div className="ai-pipeline" aria-label="任務階段">
                          {(['計劃', '審批', '執行', '完成'] as const).map(
                            (label, i) => (
                              <div
                                key={label}
                                className={`ai-pipeline__step${
                                  i <= phase ? ' is-done' : ''
                                }${i === phase ? ' is-current' : ''}`}
                              >
                                <span className="ai-pipeline__dot">{i + 1}</span>
                                <span className="ai-pipeline__lab">{label}</span>
                              </div>
                            ),
                          )}
                        </div>
                        <ActionBar>
                          {canApprove(selected.status) ? (
                            <Button
                              variant="primary"
                              size="md"
                              loading={busy}
                              onClick={() => void approveAndRun(selected.id)}
                            >
                              批准並執行
                            </Button>
                          ) : null}
                          {canCancel(selected.status) ? (
                            <Button
                              variant="ghost"
                              size="md"
                              loading={busy}
                              onClick={() => void cancelTask(selected.id)}
                            >
                              取消任務
                            </Button>
                          ) : null}
                          {isTerminal(selected.status) ? (
                            <span className="muted u-text-sm">
                              任務已終結，可建立新任務或執行劇本
                            </span>
                          ) : null}
                        </ActionBar>
                      </header>

                      <div className="ai-steps">
                        <h4 className="ai-steps__title">
                          步驟（{selected.steps.length}）
                        </h4>
                        {selected.steps.length === 0 ? (
                          <p className="ops-muted">尚未產生步驟</p>
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
                                      {statusLabel(s.status)}
                                    </Badge>
                                    {s.requiresApproval ? (
                                      <Badge tone="warn">需審批</Badge>
                                    ) : (
                                      <span className="muted u-text-sm">免審批</span>
                                    )}
                                  </div>
                                  {s.error ? (
                                    <p className="ai-step__err">{s.error}</p>
                                  ) : null}
                                </div>
                                {(s.status === 'planned' ||
                                  s.status === 'approved') && (
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    loading={busy}
                                    onClick={() =>
                                      void rejectStep(selected.id, s.id)
                                    }
                                  >
                                    拒絕
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
                      title="選擇任務"
                      description="左側點一筆任務查看計劃與步驟"
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
                    <h3 className="ops-panel__title">劇本庫</h3>
                    <p className="ops-panel__sub">
                      預設操作組合 · 執行後會建立任務並切去任務 tab
                    </p>
                  </div>
                  <span className="ops-muted">{filteredPlaybooks.length} 個</span>
                </div>
                <Field label="搜尋" htmlFor="pb-filter" flush>
                  <input
                    id="pb-filter"
                    value={pbFilter}
                    onChange={(e) => setPbFilter(e.target.value)}
                    placeholder="名稱 / 說明"
                  />
                </Field>
              </header>
              {filteredPlaybooks.length === 0 ? (
                <EmptyState title="無符合劇本" description="改關鍵字或清空搜尋" />
              ) : (
                <div className="ai-pb-grid">
                  {filteredPlaybooks.map((p) => (
                    <article key={p.id} className="ai-pb-card">
                      <div className="ai-pb-card__body">
                        <h4 className="ai-pb-card__name">{p.name}</h4>
                        <p className="ai-pb-card__desc">
                          {p.description || '—'}
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
                          執行
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
        onClose={() => setCreateOpen(false)}
        title="建立 AI 任務"
        description="產生計劃 ≠ 已執行。工具只會在 allowlist 內。"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="ai-create"
              variant="primary"
              size="md"
              loading={busy}
            >
              產生計劃
            </Button>
          </>
        }
      >
        <form id="ai-create" onSubmit={(e) => void onCreate(e)}>
          <FormLayout>
            <Field
              label="自然語言指令"
              htmlFor="prompt"
              fullWidth
              flush
              required
              hint="例如：檢查主機負載並回報；或 nginx 狀態"
            >
              <textarea
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                required
                rows={5}
                placeholder="描述想做的事…"
              />
            </Field>
          </FormLayout>
          <FormHint>
            下一步：在任務詳情按「批准並執行」，或拒絕個別步驟。
          </FormHint>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
