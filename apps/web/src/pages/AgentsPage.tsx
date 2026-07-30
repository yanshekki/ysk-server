/**
 * Agents — fleet ops (register / command / history / remove) + runtime probe/install.
 * Panel register ≠ online; commands queue until edge agent pulls.
 * History shows CLI exit codes + pretty JSON when edge acks { cli: [...] }.
 */
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAgents } from '../features/agents';
import type { FleetAgent, FleetCommand } from '../features/agents/api';
import { ActionBar,
  ConfirmDialog,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DataTable,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  InfoCard,
  InfoCardGrid,
  Field,
  FormHint,
  FormLayout,
  Modal,
  SegRadio,
  buttonClassName,
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

function prettyJson(p: unknown, max = 12_000): string {
  try {
    const s = JSON.stringify(p, null, 2);
    return s.length > max ? `${s.slice(0, max)}\n…` : s;
  } catch {
    return String(p);
  }
}

/** Human summary of queued payload */
function summarizePayload(p: unknown): string {
  if (p == null) return '—';
  if (typeof p !== 'object') return String(p);
  const o = p as Record<string, unknown>;
  if (Array.isArray(o.cli)) {
    return `ysk-server ${o.cli.map(String).join(' ')}`;
  }
  if (typeof o.op === 'string') {
    return o.op === 'echo' && o.message != null
      ? `op:echo ${String(o.message)}`
      : `op:${o.op}`;
  }
  try {
    const s = JSON.stringify(p);
    return s.length > 80 ? `${s.slice(0, 80)}…` : s;
  } catch {
    return '…';
  }
}

type CliAckShape = {
  ok?: boolean;
  exitCode?: number;
  result?: unknown;
  stderr?: string;
  blocked?: boolean;
  dryRun?: boolean;
  error?: string;
  at?: string;
  op?: string;
  echo?: unknown;
  note?: string;
};

function asCliAck(result: unknown): CliAckShape | null {
  if (result == null || typeof result !== 'object') return null;
  return result as CliAckShape;
}

/** Nested CLI JSON stdout when edge wraps spawnSync output */
function unwrapCliBody(ack: CliAckShape | null): unknown {
  if (!ack) return null;
  if (ack.result !== undefined) return ack.result;
  return ack;
}

function exitCodeOf(cmd: FleetCommand): number | null {
  const ack = asCliAck(cmd.result);
  if (ack && typeof ack.exitCode === 'number') return ack.exitCode;
  if (cmd.status === 'error') return 1;
  if (cmd.status === 'done') return 0;
  return null;
}

function exitTone(code: number | null): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (code === null) return 'neutral';
  if (code === 0) return 'ok';
  if (code === 2 || code === 3 || code === 4) return 'warn';
  return 'danger';
}

function exitHint(code: number | null): string {
  if (code === null) return '';
  const map: Record<number, string> = {
    0: 'ok',
    1: 'error',
    2: 'validation',
    3: 'blocked',
    4: 'not_found',
    5: 'host_error',
  };
  return map[code] ?? `code ${code}`;
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
  /** Prefer CLI payloads — edge agent runs ysk-server with these argv */
  type CmdPreset =
    | 'cli-readiness'
    | 'cli-host'
    | 'cli-projects'
    | 'cli-services'
    | 'cli-defense'
    | 'cli-logs'
    | 'ping'
    | 'custom';
  const [cmdPreset, setCmdPreset] = useState<CmdPreset>('cli-readiness');
  const [cmdCustom, setCmdCustom] = useState('projects list --json');

  const [histAgent, setHistAgent] = useState<FleetAgent | null>(null);
  const [resultCmd, setResultCmd] = useState<FleetCommand | null>(null);
  const [delAgent, setDelAgent] = useState<FleetAgent | null>(null);

  function buildCliPayload(cli: string[]): { cli: string[] } {
    const argv = cli.map(String);
    if (!argv.includes('--json')) argv.push('--json');
    return { cli: argv };
  }

  function parseCustomCli(line: string): string[] {
    // simple split; quote-aware not required for our presets
    return line
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => t !== 'ysk-server');
  }

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

  // Auto-refresh command history while open (edge may ack shortly after queue)
  useEffect(() => {
    if (!histAgent) return;
    const t = window.setInterval(() => {
      void loadCommands(histAgent.id);
    }, 4000);
    return () => window.clearInterval(t);
  }, [histAgent, loadCommands]);

  async function onSendCommand(e: FormEvent) {
    e.preventDefault();
    if (!cmdAgent) return;
    let payload: unknown;
    switch (cmdPreset) {
      case 'cli-readiness':
        payload = buildCliPayload(['readiness']);
        break;
      case 'cli-host':
        payload = buildCliPayload(['host', 'overview']);
        break;
      case 'cli-projects':
        payload = buildCliPayload(['projects', 'list']);
        break;
      case 'cli-services':
        payload = buildCliPayload(['services', 'matrix']);
        break;
      case 'cli-defense':
        payload = buildCliPayload(['defense', 'status']);
        break;
      case 'cli-logs':
        payload = buildCliPayload(['logs', 'query', '--source', 'journal:', '--lines', '50']);
        break;
      case 'custom': {
        const parts = parseCustomCli(cmdCustom);
        if (!parts.length) return;
        payload = buildCliPayload(parts);
        break;
      }
      case 'ping':
      default:
        payload = { op: 'ping', at: new Date().toISOString() };
        break;
    }
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
      status={{
        pill: {
          label:
            liveAgents > 0
              ? `${liveAgents} 上線`
              : agents.length
                ? '僅登記'
                : '待探測',
          tone: liveAgents > 0 ? 'ok' : 'warn',
        },
        items: [
          { label: '運行時', value: runtimeList.length },
          {
            label: '運行中',
            value: running,
            tone: running > 0 ? 'ok' : 'neutral',
          },
          {
            label: '上線 agent',
            value: liveAgents,
            tone: liveAgents > 0 ? 'ok' : 'warn',
          },
          { label: '機群', value: agents.length },
        ],
      }}
      actions={<ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={() => void refresh()}
          >
            重新整理
          </Button>
          <Link to="/ai" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            AI 任務
          </Link>
          
        </ActionBar>
      }
    >
      <Alert variant="info">
        <strong>實驗。</strong> 登記 ≠ 上線。真實運維用 CLI：
        <code className="inline"> ysk-server … --json</code>
        。文件：repo <code className="inline">docs/agent/README.md</code>
        。Edge：
        <code className="inline">ysk-server agent run --id …</code>
        ；指令 payload 建議{' '}
        <code className="inline">{`{ "cli": ["projects", "list"] }`}</code>。
      </Alert>
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

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
              <strong>下指令</strong>：CLI preset（readiness / host / projects…）或自訂；邊緣 pull 後跑{' '}
              <code className="inline">ysk-server</code> 並 ack
            </li>
            <li>
              <strong>指令紀錄</strong>：queued / done / error、exit code、pretty JSON result
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
          <DataTable
            toolbar={
              <ActionBar>
                <Button variant="primary" size="sm" onClick={openRegister}>
                  + 登記 Agent
                </Button>
              </ActionBar>
            }
            columns={[
              {
                key: 'id',
                header: '識別碼',
                render: (a) => <code className="inline">{a.agent_id}</code>,
              },
              {
                key: 'status',
                header: '狀態',
                nowrap: true,
                render: (a) => (
                  <Badge tone={statusTone(a.status)}>
                    {statusLabel(a.status)}
                  </Badge>
                ),
              },
              {
                key: 'group',
                header: '群組',
                render: (a) => a.group ?? '—',
              },
              {
                key: 'last_seen',
                header: '最後上線',
                nowrap: true,
                className: 'muted',
                render: (a) =>
                  a.last_seen_at?.slice(0, 19).replace('T', ' ') ?? '—',
              },
            ]}
            rows={agents}
            rowKey={(a) => a.id}
            rowActions={(a) => (
              <ActionBar align="end">
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
                  onClick={() => setDelAgent(a)}
                >
                  刪除
                </Button>
              </ActionBar>
            )}
            empty={
              <EmptyState
                title="尚未登記 agent"
                description="用列表右上角登記，或等邊緣進程自行 register"
              />
            }
          />
        </CardSection>
      </Card>

      {histAgent ? (
        <Card>
          <CardSection
            title={`指令紀錄 · ${histAgent.agent_id}`}
            description="queued 等節點 pull；done/error 為 ack。CLI 結果含 exit code + JSON（約 4s 自動刷新）"
          >
            <DataTable
              toolbar={
                <ActionBar>
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
                      setCmdPreset('cli-readiness');
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
                </ActionBar>
              }
              columns={[
                {
                  key: 'time',
                  header: '時間',
                  nowrap: true,
                  className: 'muted',
                  render: (c) => (
                    <>
                      {c.created_at?.slice(0, 19).replace('T', ' ')}
                      {c.finished_at ? (
                        <div className="muted u-text-sm">
                          完成 {c.finished_at.slice(0, 19).replace('T', ' ')}
                        </div>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'status',
                  header: '狀態',
                  nowrap: true,
                  render: (c) => (
                    <Badge tone={cmdStatusTone(c.status)}>{c.status}</Badge>
                  ),
                },
                {
                  key: 'exit',
                  header: 'exit',
                  nowrap: true,
                  render: (c) => {
                    const code = exitCodeOf(c);
                    return code != null ? (
                      <Badge tone={exitTone(code)}>
                        {code}
                        {exitHint(code) ? ` · ${exitHint(code)}` : ''}
                      </Badge>
                    ) : (
                      <span className="muted">—</span>
                    );
                  },
                },
                {
                  key: 'payload',
                  header: '指令',
                  render: (c) => (
                    <code className="inline u-break-all">
                      {summarizePayload(c.payload)}
                    </code>
                  ),
                },
                {
                  key: 'summary',
                  header: '結果摘要',
                  className: 'muted u-break-all',
                  render: (c) => {
                    const code = exitCodeOf(c);
                    const ack = asCliAck(c.result);
                    const body = unwrapCliBody(ack);
                    const flags: string[] = [];
                    if (ack?.dryRun) flags.push('dry-run');
                    if (ack?.blocked) flags.push('blocked');
                    if (ack && ack.ok === false) flags.push('ok:false');
                    if (
                      body &&
                      typeof body === 'object' &&
                      (body as { dryRun?: boolean }).dryRun
                    ) {
                      flags.push('plan');
                    }
                    if (c.result == null) return '—';
                    if (ack?.error) return String(ack.error);
                    if (flags.length) return flags.join(' · ');
                    if (code === 0) return 'ok';
                    if (code != null) return exitHint(code);
                    return '有結果';
                  },
                },
              ]}
              rows={commands}
              rowKey={(c) => c.id}
              rowActions={(c) =>
                c.result != null ? (
                  <ActionBar align="end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setResultCmd(c)}
                    >
                      JSON
                    </Button>
                  </ActionBar>
                ) : null
              }
              empty={
                <EmptyState
                  title="尚未有指令"
                  description="按「下指令」排隊；邊緣 agent 未上線時會一直 queued"
                />
              }
            />
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
                  size="sm"
                  loading={busy}
                  onClick={() => void refresh()}
                >
                  重新整理
                </Button>
              }
            />
          ) : (
            <InfoCardGrid cols={3}>
              {runtimeList.map((rt) => {
                const pathLine = rt.installPath
                  ? `${rt.pathExists ? '已存在' : '尚未安裝'} · ${rt.installPath}`
                  : '—';
                const unitLine = rt.unitActive
                  ? `${rt.unitName ?? 'unit'} · ${rt.unitActive}`
                  : rt.unitName
                    ? `${rt.unitName} · 未知`
                    : '—';
                return (
                  <InfoCard
                    key={rt.kind}
                    title={rt.name ?? rt.kind}
                    badge={{
                      label: statusLabel(rt.status),
                      tone: statusTone(rt.status),
                    }}
                    facts={[
                      {
                        label: '路徑',
                        value: pathLine,
                        mono: Boolean(rt.installPath),
                      },
                      {
                        label: 'systemd',
                        value: unitLine,
                        mono: Boolean(rt.unitName),
                      },
                    ]}
                    actions={
                      <ActionBar>
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
                      </ActionBar>
                    }
                  />
                );
              })}
            </InfoCardGrid>
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
            <Field label="指令（CLI 優先）" htmlFor="cmd-preset" flush>
              <SegRadio
                name="cmd-preset"
                aria-label="指令類型"
                value={cmdPreset}
                onChange={(v) => setCmdPreset(v as CmdPreset)}
                options={[
                  { value: 'cli-readiness', label: 'readiness' },
                  { value: 'cli-host', label: 'host' },
                  { value: 'cli-projects', label: 'projects' },
                  { value: 'cli-services', label: 'services' },
                  { value: 'cli-defense', label: 'defense' },
                  { value: 'cli-logs', label: 'logs' },
                  { value: 'custom', label: '自訂 CLI' },
                  { value: 'ping', label: 'ping' },
                ]}
              />
            </Field>
            {cmdPreset === 'custom' ? (
              <Field
                label="CLI 參數"
                htmlFor="cmd-custom"
                flush
                required
                hint="唔使寫 ysk-server；例：logs journal --unit nginx.service"
              >
                <input
                  id="cmd-custom"
                  value={cmdCustom}
                  onChange={(e) => setCmdCustom(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  required
                />
              </Field>
            ) : null}
          </FormLayout>
          <FormHint>
            Edge <code className="inline">ysk-server agent run</code> 收到{' '}
            <code className="inline">{`{ "cli": ["…"] }`}</code> 會喺本機執行 CLI（自動加
            --json）。改系統仍要邊緣設 <code className="inline">YSK_EXECUTE=1</code>。
            完成後喺「紀錄」睇 exit code 同 JSON。
          </FormHint>
        </form>
      </Modal>

      <Modal
        open={Boolean(resultCmd)}
        onClose={() => setResultCmd(null)}
        title={
          resultCmd
            ? `指令結果 · exit ${exitCodeOf(resultCmd) ?? '—'}`
            : '指令結果'
        }
        description={
          resultCmd ? summarizePayload(resultCmd.payload) : undefined
        }
        footer={
          <Button variant="primary" size="md" onClick={() => setResultCmd(null)}>
            關閉
          </Button>
        }
      >
        {resultCmd ? (
          <div className="stack-gap">
            <ActionBar>
              <Badge tone={cmdStatusTone(resultCmd.status)}>{resultCmd.status}</Badge>
              {exitCodeOf(resultCmd) != null ? (
                <Badge tone={exitTone(exitCodeOf(resultCmd))}>
                  exit {exitCodeOf(resultCmd)} · {exitHint(exitCodeOf(resultCmd))}
                </Badge>
              ) : null}
              {asCliAck(resultCmd.result)?.dryRun ? (
                <Badge tone="warn">dry-run</Badge>
              ) : null}
              {asCliAck(resultCmd.result)?.blocked ? (
                <Badge tone="warn">blocked</Badge>
              ) : null}
            </ActionBar>
            <FormHint>
              外層：edge ack（exitCode / stderr）。內層 <code className="inline">result</code>：
              CLI --json stdout。
            </FormHint>
            {asCliAck(resultCmd.result)?.stderr ? (
              <div>
                <div className="muted u-text-sm u-mb-1">stderr</div>
                <pre className="ops-pre" style={{ whiteSpace: 'pre-wrap', maxHeight: 160 }}>
                  {String(asCliAck(resultCmd.result)?.stderr).slice(0, 4000)}
                </pre>
              </div>
            ) : null}
            <div>
              <div className="muted u-text-sm u-mb-1">ack + CLI JSON</div>
              <pre
                className="ops-pre"
                style={{ whiteSpace: 'pre-wrap', maxHeight: 420, overflow: 'auto' }}
              >
                {prettyJson(resultCmd.result)}
              </pre>
            </div>
            {unwrapCliBody(asCliAck(resultCmd.result)) !== resultCmd.result ? (
              <div>
                <div className="muted u-text-sm u-mb-1">CLI stdout body</div>
                <pre
                  className="ops-pre"
                  style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}
                >
                  {prettyJson(unwrapCliBody(asCliAck(resultCmd.result)))}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={delAgent != null}
        onClose={() => setDelAgent(null)}
        title={delAgent ? `刪除 ${delAgent.agent_id}？` : '刪除 agent？'}
        description="相關指令紀錄一併移除。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        onConfirm={() => {
          const a = delAgent;
          setDelAgent(null);
          if (a) void removeAgent(a.id);
        }}
      />
    </FeaturePageLayout>
  );
}
