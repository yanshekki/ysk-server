/**
 * AI tasks + playbooks — FeaturePageLayout + Button standard.
 */
import { FormEvent } from 'react';
import { useAiTasks } from '../features/llm';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  SummaryStrip,
} from '../shared/components/ui';

function taskTone(status: string): 'ok' | 'warn' | 'danger' | 'info' | 'neutral' {
  if (status === 'completed' || status === 'done') return 'ok';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'pending' || status === 'planned') return 'warn';
  return 'info';
}

export function AiPage() {
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
  } = useAiTasks();

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await createTask(prompt);
    } catch {
      /* hook sets error */
    }
  }

  return (
    <FeaturePageLayout
      title="AI 任務"
      subtitle="計劃 → 審批 → 執行 · 劇本受允許清單監督"
    >
      {error ? <Alert variant="error">{error}</Alert> : null}

      <SummaryStrip
        items={[
          { label: '任務', value: tasks.length },
          { label: '劇本', value: playbooks.length },
        ]}
      />

      <div className="stack">
        <Card>
          <CardSection
            title="建立任務"
            description="用自然語言產生計劃；需審批後才會執行（Plan → Review → Execute）"
          >
            <form onSubmit={(e) => void onCreate(e)}>
              <FormLayout>
                <Field
                  label="自然語言指令"
                  htmlFor="prompt"
                  fullWidth
                  flush
                  required
                  hint="描述想做的事；模型只會在允許清單內規劃工具"
                >
                  <textarea
                    id="prompt"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    required
                    rows={3}
                    placeholder="例如：檢查主機負載並回報"
                  />
                </Field>
              </FormLayout>
              <FormHint>
                產生計劃 ≠ 已執行。請在任務列表「批准並執行」，或拒絕個別步驟。
              </FormHint>
              <FormActions>
                <Button type="submit" variant="primary" size="md" loading={busy}>
                  產生計劃
                </Button>
              </FormActions>
            </form>
          </CardSection>
        </Card>

        <Card>
          <CardSection title="劇本（Playbooks）" description="預先定義、受 allowlist 監督的操作組合">
            {playbooks.length === 0 ? (
              <EmptyState title="尚無劇本" />
            ) : (
              <div className="kpi-grid kpi-grid--3">
                {playbooks.map((p) => (
                  <article key={p.id} className="kpi-card" role="listitem">
                    <header className="kpi-card__head">
                      <span className="kpi-card__label">{p.name}</span>
                    </header>
                    <div className="kpi-card__body">
                      <p className="dash-kpi__meta">{p.description || '—'}</p>
                    </div>
                    <footer className="kpi-card__foot">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => void runPlaybook(p.id)}
                      >
                        執行
                      </Button>
                    </footer>
                  </article>
                ))}
              </div>
            )}
          </CardSection>
        </Card>

        <Card>
          <CardSection title="最近任務">
            {tasks.length === 0 ? (
              <EmptyState title="尚未有任務" description="先建立計劃或跑一個 Playbook" />
            ) : (
              <div className="list-panel">
                {tasks.map((task) => (
                  <div key={task.id} className="list-row list-row--static">
                    <div className="list-row__main">
                      <div className="list-row__title">
                        <span>{task.prompt}</span>
                        <Badge tone={taskTone(task.status)}>{task.status}</Badge>
                      </div>
                    </div>
                    <div className="list-row__side btn-row">
                      <Button variant="secondary" size="sm" onClick={() => setSelected(task)}>
                        查看
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        disabled={
                          task.status === 'completed' ||
                          task.status === 'cancelled' ||
                          task.status === 'failed'
                        }
                        onClick={() => void approveAndRun(task.id)}
                      >
                        批准並執行
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        disabled={
                          task.status === 'completed' || task.status === 'cancelled'
                        }
                        onClick={() => void cancelTask(task.id)}
                      >
                        取消
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardSection>
        </Card>

        {selected ? (
          <Card>
            <CardSection title="計劃詳情" description={selected.planSummary}>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>工具</th>
                      <th>狀態</th>
                      <th>需審批</th>
                      <th>錯誤</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {selected.steps.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <code className="inline">{s.tool}</code>
                        </td>
                        <td>
                          <Badge tone={taskTone(s.status)}>{s.status}</Badge>
                        </td>
                        <td>{s.requiresApproval ? '是' : '否'}</td>
                        <td className="muted">{s.error ?? '—'}</td>
                        <td>
                          {s.status === 'planned' || s.status === 'approved' ? (
                            <Button
                              variant="danger"
                              size="sm"
                              loading={busy}
                              onClick={() => void rejectStep(selected.id, s.id)}
                            >
                              拒絕
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardSection>
          </Card>
        ) : null}
      </div>
    </FeaturePageLayout>
  );
}
