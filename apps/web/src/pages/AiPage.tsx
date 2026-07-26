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
    <FeaturePageLayout title="AI 任務" subtitle="AI 任務與 Playbook（工具仍受 allowlist 限制）">
      {error ? <Alert variant="error">{error}</Alert> : null}

      <SummaryStrip
        items={[
          { label: '任務', value: tasks.length },
          { label: 'Playbooks', value: playbooks.length },
        ]}
      />

      <div className="stack">
        <Card>
          <CardSection title="建立任務" description="用自然語言建立計劃">
            <form onSubmit={(e) => void onCreate(e)}>
              <Field label="自然語言指令" techKey="prompt" htmlFor="prompt">
                <input
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  required
                  placeholder="例如：檢查主機負載並回報"
                />
              </Field>
              <div className="form-actions">
                <Button type="submit" variant="primary" size="md" loading={busy}>
                  產生計劃
                </Button>
              </div>
            </form>
          </CardSection>
        </Card>

        <Card>
          <CardSection title="Playbooks">
            {playbooks.length === 0 ? (
              <EmptyState title="無 playbook" />
            ) : (
              <div className="grid">
                {playbooks.map((p) => (
                  <div key={p.id} className="card">
                    <h3 className="card__title">{p.name}</h3>
                    <p className="card__desc">{p.description}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() => void runPlaybook(p.id)}
                    >
                      執行
                    </Button>
                  </div>
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
                        onClick={() => void approveAndRun(task.id)}
                      >
                        批准並執行
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
                      <th>Tool</th>
                      <th>Status</th>
                      <th>Approval</th>
                      <th>Error</th>
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
                        <td>{String(s.requiresApproval)}</td>
                        <td className="muted">{s.error ?? '—'}</td>
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
