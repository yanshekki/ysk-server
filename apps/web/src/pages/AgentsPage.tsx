/**
 * Agents — fleet ops (register / command / history / remove) + runtime probe/install.
 * Panel register ≠ online; commands queue until edge agent pulls.
 */
import { FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAgents } from '../features/agents';
import type { FleetAgent, FleetCommand } from '../features/agents/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormHint,
  FormLayout,
  Modal,
  OpsHero,
  SegRadio,
} from '../shared/components/ui';

function statusTone(status?: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (status === 'running' || status === 'connected') return 'ok';
  if (status === 'not_installed' || status === 'registered' || status === 'stale') return 'warn';
  if (status === 'failed' || status === 'error' || status === 'disconnected') return 'danger';
  if (status === 'unknown') return 'neutral';
  return 'info';
}

function statusLabel(status?: string): string {
  if (status === 'running') return '運行中';
  if (status === 'connected') return '上線';
  if (status === 'registered') return '僅登記';
  if (status === 'stale') return '逾時';
  if (status === 'disconnected') return '離線';
  if (status === 'not_installed') return '未安裝';
  if (status === 'failed' || status === 'error') return '失敗';
  if (status === 'unknown') return '未探測';
  return status ?? '未知';
}

function cmdStatusTone(s: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (s === 'done') return 'ok';
  if (s === 'queued' || s === 'acked') return 'warn';
  if (s === 'error') return 'danger';
  return 'neutral';
}

function formatPayload(p: unknown): string {
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}

export function AgentsPage() {
  const { t } = useTranslation();
  const {
    agents,
    runtimes,
    commands,
    error,
    busy,
    msg,
    setMsg,
    detailNotes,
    detailFacts,
    refresh,
    register,
    removeAgent,
    enqueueCommand,
    loadCommands,
    probeKind,
    writeUnit,
    installKind,
  } = useAgents();

  const [agentId, setAgentId] = useState('edge-1');
  const [agentGroup, setAgentGroup] = useState('default');
  const [registerOpen, setRegisterOpen] = useState(false);

  const [cmdAgent, setCmdAgent] = useState<FleetAgent | null>(null);
  const [cmdPreset, setCmdPreset] = useState<'ping' | 'echo' | 'sysinfo'>('ping');
  const [cmdEcho, setCmdEcho] = useState('hello from panel');

  const [histAgent, setHistAgent] = useState<FleetAgent | null>(null);

  const runtimeList = runtimes;
  const running = runtimeList.filter((r) => r.status === 'running').length;
  const unitActive = runtimeList.filter((r) => r.unitActive === 'active').length;
  const liveAgents = agents.filter((a) => a.status === 'connected').length;

  const controlPlane = useMemo(() => {
    if (typeof window === 'undefined') return 'http://127.0.0.1:9287';
    // API default; panel may proxy
    return `${window.location.protocol}//${window.location.hostname}:9287`;
  }, []);

  function openRegister() {
    setAgentId('edge-1');
    setAgentGroup('default');
    setRegisterOpen(true);
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    const id = agentId.trim();
    if (!id) return;
    try {
      await register(id, agentGroup.trim() || 'default');
      setRegisterOpen(false);
    } catch {
      /* hook */
    }
  }

  async function openHistory(a: FleetAgent) {
    setHistAgent(a);
    try {
      await loadCommands(a.id);
    } catch {
      /* hook */
    }
  }

  async function onSendCommand(e: FormEvent) {
    e.preventDefault();
    if (!cmdAgent) return;
    const payload =
      cmdPreset === 'ping'
        ? { op: 'ping', at: new Date().toISOString() }
        : cmdPreset === 'sysinfo'
          ? { op: 'sysinfo' }
          : { op: 'echo', message: cmdEcho };
    try {
      await enqueueCommand(cmdAgent.id, payload);
      setCmdAgent(null);
      setHistAgent(cmdAgent);
      await loadCommands(cmdAgent.id);
    } catch {
      /* hook */
    }
  }

  return (
    <FeaturePageLayout
      title={t('nav.agents', { defaultValue: 'AI Agent' })}
      actions={
        <div className="btn-row">
          <Button variant="primary" size="md" onClick={openRegister}>
            + 登記 Agent
          </Button>
          <Button
            variant="secondary"
            size="md"
            loading={busy}
            onClick={() => void refresh()}
          >
            重新整理
          </Button>
          <Link to="/ai" className="btn btn--ghost btn--md">
            AI 任務
          </Link>
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
        pill={
          liveAgents > 0
            ? `${liveAgents} 上線`
            : agents.length
              ? '僅登記'
              : '待探測'
        }
        pillTone={liveAgents > 0 ? 'ok' : agents.length ? 'warn' : 'warn'}
        tone={liveAgents > 0 ? 'ok' : 'warn'}
        cta={
          <>
            <Button variant="primary" size="md" onClick={openRegister}>
              + 登記 Agent
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => void refresh()}
            >
              重新整理
            </Button>
          </>
        }
        stats={[
          { label: '運行時', value: runtimeList.length },
          {
            label: '運行中',
            value: <Badge tone={running > 0 ? 'ok' : 'neutral'}>{running}</Badge>,
          },
          {
            label: '上線 agent',
            value: (
              <Badge tone={liveAgents > 0 ? 'ok' : 'warn'}>{liveAgents}</Badge>
            ),
          },
          { label: '機群', value: agents.length },
        ]}
      />

      <Card>
        <CardSection
          title="機群能做乜"
          description="唔係空殼列表 — 以下係控制面對邊緣節點嘅真實能力"
        >
          <ul className="list-plain list-spaced u-mb-0">
            <li>
              <strong>登記</strong>：寫入控制面清單（狀態「僅登記」）— 唔代表進程已跑
            </li>
            <li>
              <strong>下指令</strong>：ping / echo / sysinfo 排隊；邊緣 agent pull 後執行並 ack
            </li>
            <li>
              <strong>指令紀錄</strong>：睇 queued / done / error 同 result
            </li>
            <li>
              <strong>刪除</strong>：移除 session 同相關訊息
            </li>
            <li>
              <strong>狀態</strong>：僅登記 → 上線（heartbeat）→ 逾時（&gt;60s 無心跳）
            </li>
          </ul>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={`機群（${agents.length}）`}
          description="控制面登記清單 · 登記 ≠ 節點已上線"
        >
          <div className="btn-row u-mb-3">
            <Button variant="primary" size="sm" onClick={openRegister}>
              + 登記 Agent
            </Button>
          </div>
          {agents.length === 0 ? (
            <EmptyState
              title="尚未登記 agent"
              description="可先面板登記預留識別碼，或等邊緣進程自行 register"
              action={
                <Button variant="primary" size="md" onClick={openRegister}>
                  + 登記 Agent
                </Button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>識別碼</th>
                    <th>狀態</th>
                    <th>群組</th>
                    <th>最後上線</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {agents.map((a) => (
                    <tr key={a.id}>
                      <td>
                        <code className="inline">{a.agent_id}</code>
                      </td>
                      <td>
                        <Badge tone={statusTone(a.status)}>
                          {statusLabel(a.status)}
                        </Badge>
                      </td>
                      <td>{a.group ?? '—'}</td>
                      <td className="muted u-nowrap">
                        {a.last_seen_at?.slice(0, 19).replace('T', ' ')}
                      </td>
                      <td>
                        <div className="btn-row">
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              setCmdPreset('ping');
                              setCmdAgent(a);
                            }}
                          >
                            下指令
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={busy}
                            onClick={() => void openHistory(a)}
                          >
                            紀錄
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              if (
                                !confirm(
                                  `刪除 ${a.agent_id}？相關指令紀錄一併移除。`,
                                )
                              )
                                return;
                              void removeAgent(a.id);
                            }}
                          >
                            刪除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>
      </Card>

      {histAgent ? (
        <Card>
          <CardSection
            title={`指令紀錄 · ${histAgent.agent_id}`}
            description="queued 等節點 pull；done/error 為 ack 後結果"
          >
            <div className="btn-row u-mb-3">
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={() => void loadCommands(histAgent.id)}
              >
                重新整理紀錄
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setCmdPreset('ping');
                  setCmdAgent(histAgent);
                }}
              >
                下指令
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setHistAgent(null)}
              >
                關閉
              </Button>
            </div>
            {commands.length === 0 ? (
              <EmptyState
                title="尚未有指令"
                description="按「下指令」排隊；邊緣 agent 未上線時會一直 queued"
              />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>時間</th>
                      <th>狀態</th>
                      <th>payload</th>
                      <th>result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {commands.map((c: FleetCommand) => (
                      <tr key={c.id}>
                        <td className="muted u-nowrap">
                          {c.created_at?.slice(0, 19).replace('T', ' ')}
                        </td>
                        <td>
                          <Badge tone={cmdStatusTone(c.status)}>{c.status}</Badge>
                        </td>
                        <td>
                          <code className="inline u-break-all">
                            {formatPayload(c.payload)}
                          </code>
                        </td>
                        <td className="muted u-break-all">
                          {c.result != null ? formatPayload(c.result) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardSection>
        </Card>
      ) : null}

      <Card>
        <CardSection
          title="邊緣 agent 點樣真正上線"
          description="面板登記後，節點要跑 outbound loop 先會 heartbeat / pull 指令"
        >
          <FormHint>
            控制面 API：<code className="inline">{controlPlane}</code>
            （需網路可達；生產請改成實際面板地址）
          </FormHint>
          <pre className="ops-pre u-mt-3" style={{ whiteSpace: 'pre-wrap' }}>
            {`# 概念：register → heartbeat loop → pull commands → ack
# 程式庫：@ysk/core runOutboundAgent / agentCycle

controlPlane: ${controlPlane}
agentId: edge-1
group: default
intervalMs: 5000`}
          </pre>
          <p className="muted u-text-sm u-mt-3 u-mb-0">
            未有邊緣進程時，「下指令」仍然有效：會入佇列（queued），等 agent 上線再消化。
          </p>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="AI 運行時"
          description="探測路徑與 unit；安裝會嘗試 enable systemd（需系統變更與 root）"
        >
          {runtimeList.length === 0 ? (
            <EmptyState
              title="尚未有探測結果"
              description="按重新整理載入運行時清單，或逐個探測"
              action={
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => void refresh()}
                >
                  重新整理
                </Button>
              }
            />
          ) : (
            <div className="kpi-grid kpi-grid--3">
              {runtimeList.map((rt) => (
                <article className="kpi-card" key={rt.kind} role="listitem">
                  <header className="kpi-card__head">
                    <span className="kpi-card__label">{rt.name ?? rt.kind}</span>
                    <Badge tone={statusTone(rt.status)}>
                      {statusLabel(rt.status)}
                    </Badge>
                  </header>
                  <div className="kpi-card__body">
                    <DescriptionList
                      columns={1}
                      items={[
                        {
                          label: '路徑',
                          value: rt.installPath
                            ? `${rt.pathExists ? '已存在' : '尚未安裝'} · ${rt.installPath}`
                            : '—',
                        },
                        {
                          label: 'systemd',
                          value: rt.unitActive
                            ? `${rt.unitName ?? 'unit'} · ${rt.unitActive}`
                            : rt.unitName
                              ? `${rt.unitName} · 未知`
                              : '—',
                        },
                      ]}
                    />
                  </div>
                  <footer className="kpi-card__foot">
                    <div className="btn-row">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => void probeKind(rt.kind)}
                      >
                        探測
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={() => void writeUnit(rt.kind)}
                      >
                        unit
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busy}
                        onClick={() => void installKind(rt.kind)}
                      >
                        安裝
                      </Button>
                    </div>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </CardSection>
      </Card>

      {detailNotes.length > 0 || detailFacts.length > 0 ? (
        <Card>
          <CardSection title="最近操作">
            {detailFacts.length > 0 ? (
              <DescriptionList columns={2} items={detailFacts} />
            ) : null}
            {detailNotes.length > 0 ? (
              <ul className="list-plain list-spaced u-mt-3">
                {detailNotes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
          </CardSection>
        </Card>
      ) : null}

      <Modal
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        title="登記 Agent"
        description="只寫入控制面清單；唔等於節點已上線"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setRegisterOpen(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              form="agent-register"
              variant="primary"
              size="md"
              loading={busy}
            >
              登記
            </Button>
          </>
        }
      >
        <form id="agent-register" onSubmit={(e) => void onRegister(e)}>
          <FormLayout columns={1}>
            <Field
              label="Agent 識別碼"
              htmlFor="aid"
              flush
              required
              hint="唯一 ID，例如 edge-1 或 office-gateway"
            >
              <input
                id="aid"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="edge-1"
                spellCheck={false}
                autoComplete="off"
                required
              />
            </Field>
            <Field label="群組" htmlFor="agroup" flush hint="用於分區／列表篩選">
              <input
                id="agroup"
                value={agentGroup}
                onChange={(e) => setAgentGroup(e.target.value)}
                placeholder="default"
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <FormHint>
            狀態會顯示「僅登記」。節點跑 outbound agent 並 heartbeat 後先變「上線」。
          </FormHint>
        </form>
      </Modal>

      <Modal
        open={Boolean(cmdAgent)}
        onClose={() => setCmdAgent(null)}
        title={cmdAgent ? `下指令 · ${cmdAgent.agent_id}` : '下指令'}
        description="寫入佇列；邊緣 agent pull 後執行並 ack（未上線會一直 queued）"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setCmdAgent(null)}>
              取消
            </Button>
            <Button
              type="submit"
              form="agent-cmd"
              variant="primary"
              size="md"
              loading={busy}
            >
              排隊
            </Button>
          </>
        }
      >
        <form id="agent-cmd" onSubmit={(e) => void onSendCommand(e)}>
          <FormLayout columns={1}>
            <Field label="指令類型" htmlFor="cmd-preset" flush>
              <SegRadio
                name="cmd-preset"
                aria-label="指令類型"
                value={cmdPreset}
                onChange={(v) => setCmdPreset(v as 'ping' | 'echo' | 'sysinfo')}
                options={[
                  { value: 'ping', label: 'ping' },
                  { value: 'echo', label: 'echo' },
                  { value: 'sysinfo', label: 'sysinfo' },
                ]}
              />
            </Field>
            {cmdPreset === 'echo' ? (
              <Field label="訊息" htmlFor="cmd-echo" flush required>
                <input
                  id="cmd-echo"
                  value={cmdEcho}
                  onChange={(e) => setCmdEcho(e.target.value)}
                  required
                />
              </Field>
            ) : null}
          </FormLayout>
          <FormHint>
            實際執行取決於邊緣 agent 的 <code className="inline">onCommand</code>{' '}
            handler；預設會 echo payload。
          </FormHint>
        </form>
      </Modal>
    </FeaturePageLayout>
  );
}
