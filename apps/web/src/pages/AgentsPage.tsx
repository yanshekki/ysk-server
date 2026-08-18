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
import {
  WithPageGuide,
  ActionBar,
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
  ServerListFilters,
  buttonClassName } from '../shared/components/ui';
import { useServerList } from '../shared/hooks/useServerList';
import { toast } from '../shared/stores/toast-store';
import { bindCall1, bindCloseIfIdle, bindInput, bindSet, bindVoid } from './bind-handlers';

export function statusTone(status?: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (status === 'running' || status === 'connected') return 'ok';
  if (status === 'activating') return 'warn';
  if (status === 'not_installed' || status === 'registered' || status === 'stale') return 'warn';
  if (status === 'failed' || status === 'error' || status === 'disconnected') return 'danger';
  if (status === 'unknown') return 'neutral';
  return 'info';
}

export function worstFleetStatus(
  agents: Array<{ status?: string }>,
): string {
  const rank = (s?: string) => {
    if (s === 'disconnected' || s === 'failed' || s === 'error') return 4;
    if (s === 'stale') return 3;
    if (s === 'registered') return 2;
    if (s === 'connected' || s === 'running') return 1;
    return 0;
  };
  let worst = '';
  let best = -1;
  for (const a of agents) {
    const n = rank(a.status);
    if (n > best) {
      best = n;
      worst = a.status ?? '';
    }
  }
  return worst;
}

export function staleAgeLabel(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const ms = now - t;
  if (ms < 60_000) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function fleetDisplayStatus(
  status: string | undefined,
  lastSeenAt?: string,
  now = Date.now(),
): string {
  const s = status ?? '';
  if (s === 'stale' && lastSeenAt) {
    const t = Date.parse(lastSeenAt);
    if (Number.isFinite(t) && now - t > 5 * 60_000) return 'disconnected';
  }
  return s;
}

export function statusLabel(status: string | undefined, tr: (k: string) => string): string {
  if (status === 'running') return tr('agents.status.running');
  if (status === 'activating') return tr('agents.status.activating');
  if (status === 'connected') return tr('agents.status.connected');
  if (status === 'registered') return tr('agents.status.registered');
  if (status === 'stale') return tr('agents.status.stale');
  if (status === 'disconnected') return tr('agents.status.disconnected');
  if (status === 'not_installed') return tr('agents.status.not_installed');
  if (status === 'failed' || status === 'error') return tr('agents.status.failed');
  if (status === 'unknown') return tr('agents.status.unknown');
  return status ?? tr('agents.status.fallback');
}

export function cmdStatusTone(s: string): 'ok' | 'warn' | 'danger' | 'neutral' | 'info' {
  if (s === 'done') return 'ok';
  if (s === 'queued' || s === 'acked') return 'warn';
  if (s === 'error') return 'danger';
  return 'neutral';
}

export function prettyJson(p: unknown, max = 12_000): string {
  try {
    const s = JSON.stringify(p, null, 2);
    return s.length > max ? `${s.slice(0, max)}\n…` : s;
  } catch {
    return String(p);
  }
}

/** Human summary of queued payload */
export function summarizePayload(p: unknown): string {
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

export function asCliAck(result: unknown): CliAckShape | null {
  if (result == null || typeof result !== 'object') return null;
  return result as CliAckShape;
}

/** Nested CLI JSON stdout when edge wraps spawnSync output */
export function unwrapCliBody(ack: CliAckShape | null): unknown {
  if (!ack) return null;
  if (ack.result !== undefined) return ack.result;
  return ack;
}

export function exitCodeOf(cmd: FleetCommand): number | null {
  const ack = asCliAck(cmd.result);
  if (ack && typeof ack.exitCode === 'number') return ack.exitCode;
  if (cmd.status === 'error') return 1;
  if (cmd.status === 'done') return 0;
  return null;
}

export function exitTone(code: number | null): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (code === null) return 'neutral';
  if (code === 0) return 'ok';
  if (code === 2 || code === 3 || code === 4) return 'warn';
  return 'danger';
}

export function exitHint(code: number | null): string {
  if (code === null) return '';
  const map: Record<number, string> = {
    0: 'ok',
    1: 'error',
    2: 'validation',
    3: 'blocked',
    4: 'not_found',
    5: 'host_error' };
  return map[code] ?? `code ${code}`;
}

export function AgentsPage() {
  const { t } = useTranslation();
  const {
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
    installKind } = useAgents();
  const fleetList = useServerList<FleetAgent>({
    path: '/api/v1/fleet/agents',
    debounceMs: 300 });
  const agents = fleetList.items;
  const refreshAll = async () => {
    await Promise.all([refresh(), fleetList.refresh()]);
  };

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
  const [histBusy, setHistBusy] = useState(false);
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
  const liveAgents = agents.filter(
    (a) => fleetDisplayStatus(a.status, a.last_seen_at) === 'connected',
  ).length;
  const worstStatus = worstFleetStatus(agents);
  const worstTone = statusTone(worstStatus);
  const pillTone: 'ok' | 'warn' | 'danger' | 'neutral' =
    liveAgents > 0 && worstStatus === 'connected'
      ? 'ok'
      : worstTone === 'info'
        ? 'neutral'
        : worstTone;

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
            liveAgents > 0 && (worstStatus === 'connected' || worstStatus === 'running')
              ? t('agents.liveN', { count: liveAgents })
              : agents.length
                ? statusLabel(worstStatus, t)
                : t('agents.awaitProbe'),
          tone: pillTone,
        },
        items: [
          { label: t('agents.runtimes'), value: runtimeList.length },
          {
            label: t('agents.running'),
            value: running,
            tone: running > 0 ? 'ok' : 'neutral' },
          {
            label: t('agents.liveAgents'),
            value: liveAgents,
            tone: liveAgents > 0 ? 'ok' : 'warn' },
          { label: t('agents.fleet'), value: agents.length },
        ] }}
      actions={<ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            onClick={bindVoid(refreshAll)}
          >
            {t('common.refresh')}
          </Button>
          <Link to="/ai" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            {t('agents.aiTasks')}
          </Link>
          
        </ActionBar>
      }
    >
      <WithPageGuide guideId="agents">

      <Alert variant="info">
        <strong>{t('agents.expBanner')}</strong> {t('agents.expBody')}{' '}
        <code className="inline">ysk-server agents fleet commands --json</code>
        {' · '}
        {t('agents.expDocs')}{' '}
        <a
          href="https://github.com/ysk-limited/ysk-server/blob/main/docs/agent/README.md"
          target="_blank"
          rel="noreferrer"
        >
          docs/agent/README.md
        </a>
        {' · '}
        {t('agents.expEdge')}{' '}
        <code className="inline">ysk-server agent run --id …</code>
        {' · '}
        {t('agents.expPayload')}{' '}
        <code className="inline">{`{ "cli": ["projects", "list"] }`}</code>
      </Alert>
      {error ? <Alert variant="error">{error}</Alert> : null}
      <Card>
        <CardSection
          title={t('agents.fleetCan')}
          description={t('agents.fleetCanDesc')}
        >
          <ul className="list-plain list-spaced u-mb-0">
            <li>
              <strong>{t('agents.capRegister')}</strong>：{t('agents.capRegisterD')}
            </li>
            <li>
              <strong>{t('agents.capCommand')}</strong>：{t('agents.capCommandD')}
            </li>
            <li>
              <strong>{t('agents.capHistory')}</strong>：{t('agents.capHistoryD')}
            </li>
            <li>
              <strong>{t('agents.capDelete')}</strong>：{t('agents.capDeleteD')}
            </li>
            <li>
              <strong>{t('agents.capStatus')}</strong>：{t('agents.capStatusD')}
            </li>
            <li>
              <strong>{t('agents.statusFlowTitle')}</strong>：{t('agents.statusFlow')}
            </li>
          </ul>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('agents.fleetTitle', { count: agents.length })}
          description={t('agents.fleetDesc')}
        >
          <DataTable
            toolbar={
              <ActionBar>
                <Button variant="primary" size="sm" onClick={openRegister}>
                  {t('agents.registerPlus')}
                </Button>
              </ActionBar>
            }
            filters={
              <ServerListFilters
                q={fleetList.q}
                setQ={fleetList.setQ}
                searching={fleetList.searching}
                loading={fleetList.loading}
                total={fleetList.meta?.total ?? agents.length}
                shown={agents.length}
                activeFilterCount={fleetList.activeFilterCount}
                clear={fleetList.clear}
                chipGroups={[
                  {
                    key: 'status',
                    allLabel: t('common.all', { defaultValue: 'All' }),
                    value: fleetList.filters.status ?? '',
                    onChange: (v) => fleetList.setFilter('status', v),
                    chips: [
                      { id: 'connected', label: t('agents.status.connected') },
                      { id: 'registered', label: t('agents.status.registered') },
                      { id: 'stale', label: t('agents.status.stale'), tone: 'warn' },
                      { id: 'offline', label: t('agents.status.disconnected'), tone: 'danger' },
                    ] },
                ]}
              />
            }
            columns={[
              {
                key: 'id',
                header: t('agents.colId'),
                render: (a) => <code className="inline">{a.agent_id}</code> },
              {
                key: 'session',
                header: t('agents.colSession'),
                render: (a) => (
                  <span className="u-flex u-items-center u-gap-2">
                    <code className="inline u-truncate" title={a.id}>
                      {a.id}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      title={t('agents.copySession')}
                      onClick={() => {
                        void navigator.clipboard.writeText(a.id).then(
                          () => toast.ok(t('common.copied')),
                          () => undefined,
                        );
                      }}
                    >
                      {t('common.copy')}
                    </Button>
                  </span>
                ) },
              {
                key: 'status',
                header: t('agents.colStatus'),
                nowrap: true,
                render: (a) => {
                  const shown = fleetDisplayStatus(a.status, a.last_seen_at);
                  const age = staleAgeLabel(a.last_seen_at);
                  return (
                    <span title={age ? t('agents.staleFor', { age }) : undefined}>
                      <Badge tone={statusTone(shown)}>
                        {statusLabel(shown, t)}
                      </Badge>
                      {age ? (
                        <span className="muted u-text-sm"> · {t('agents.staleFor', { age })}</span>
                      ) : null}
                    </span>
                  );
                } },
              {
                key: 'group',
                header: t('agents.colGroup'),
                render: (a) => a.group ?? '—' },
              {
                key: 'last_seen',
                header: t('agents.colLastSeen'),
                nowrap: true,
                className: 'muted',
                render: (a) =>
                  a.last_seen_at?.slice(0, 19).replace('T', ' ') ?? '—' },
            ]}
            rows={agents}
            rowKey={(a) => a.id}
            rowActions={(a) => (
              <ActionBar align="end">
                <Button
                  variant="primary"
                  size="sm"
                  title={t('agents.commandTitle')}
                  onClick={() => {
                    setCmdPreset('ping');
                    setCmdAgent(a);
                  }}
                >
                  {t('agents.command')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={histBusy}
                  title={t('agents.historyTitleShort')}
                  onClick={() => {
                    setHistBusy(true);
                    void openHistory(a).finally(() => setHistBusy(false));
                  }}
                >
                  {t('agents.history')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  title={t('agents.deleteTitlePlain')}
                  onClick={bindSet(setDelAgent, a)}
                >
                  {t('common.delete')}
                </Button>
              </ActionBar>
            )}
            empty={
              <EmptyState
                title={t('agents.emptyAgents')}
                description={t('agents.emptyAgentsDesc')}
              />
            }
          />
        </CardSection>
      </Card>

      {histAgent ? (
        <Card>
          <CardSection
            title={t('agents.historyTitle', { id: histAgent.agent_id })}
            description={t('agents.historyDesc')}
          >
            <DataTable
              toolbar={
                <ActionBar>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={bindCall1(loadCommands, histAgent.id)}
                  >
                    {t('agents.refreshHistory')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setCmdPreset('cli-readiness');
                      setCmdAgent(histAgent);
                    }}
                  >
                    {t('agents.command')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={bindSet(setHistAgent, null)}
                  >
                    {t('common.close')}
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'time',
                  header: t('agents.colTime'),
                  nowrap: true,
                  className: 'muted',
                  render: (c) => (
                    <>
                      {c.created_at?.slice(0, 19).replace('T', ' ')}
                      {c.finished_at ? (
                        <div className="muted u-text-sm">
                          {t('agents.finishedAt', { at: c.finished_at.slice(0, 19).replace('T', ' ') })}
                        </div>
                      ) : null}
                    </>
                  ) },
                {
                  key: 'status',
                  header: t('agents.colStatus'),
                  nowrap: true,
                  render: (c) => (
                    <Badge tone={cmdStatusTone(c.status)}>{c.status}</Badge>
                  ) },
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
                  } },
                {
                  key: 'payload',
                  header: t('agents.colCommand'),
                  render: (c) => (
                    <code className="inline u-break-all">
                      {summarizePayload(c.payload)}
                    </code>
                  ) },
                {
                  key: 'summary',
                  header: t('agents.colResult'),
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
                    return t('agents.hasResult');
                  } },
              ]}
              rows={commands}
              rowKey={(c) => c.id}
              rowActions={(c) =>
                c.result != null ? (
                  <ActionBar align="end">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={bindSet(setResultCmd, c)}
                    >
                      JSON
                    </Button>
                  </ActionBar>
                ) : null
              }
              empty={
                <EmptyState
                  title={t('agents.emptyCmds')}
                  description={t('agents.emptyCmdsDesc')}
                />
              }
            />
          </CardSection>
        </Card>
      ) : null}

      <Card>
        <CardSection
          title={t('agents.edgeOnlineTitle')}
          description={t('agents.edgeOnlineDesc')}
        >
          <FormHint>
            {t('agents.controlPlaneApi')}<code className="inline">{controlPlane}</code>
            {t('agents.controlPlaneHint')}
          </FormHint>
          <pre className="ops-pre u-mt-3 u-pre-wrap">
            {`${t('agents.codeComment')}

controlPlane: ${controlPlane}
agentId: edge-1
group: default
intervalMs: 5000`}
          </pre>
          <p className="muted u-text-sm u-mt-3 u-mb-0">
            {t('agents.queueNote')}
          </p>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('agents.runtimeTitle')}
          description={t('agents.runtimeDesc')}
        >
          {runtimeList.length === 0 ? (
            <EmptyState
              title={t('agents.emptyRuntime')}
              description={t('agents.emptyRuntimeDesc')}
            />
          ) : (
            <InfoCardGrid cols={3}>
              {runtimeList.map((rt) => {
                const stuckActivating =
                  rt.unitActive === 'activating' && rt.status === 'failed';
                const honestStatus =
                  rt.pathExists === false ||
                  (!rt.pathExists && rt.status === 'stopped' && !rt.unitActive)
                    ? 'not_installed'
                    : stuckActivating
                      ? 'failed'
                      : rt.status;
                const pathLine = rt.installPath
                  ? `${rt.pathExists ? t('agents.pathExists') : t('agents.pathMissing')} · ${rt.installPath}`
                  : '—';
                const unitLine = rt.unitActive
                  ? `${rt.unitName ?? 'unit'} · ${rt.unitActive}`
                  : rt.unitName
                    ? t('agents.unitUnknown', { unit: rt.unitName })
                    : '—';
                return (
                  <InfoCard
                    key={rt.kind}
                    title={rt.name ?? rt.kind}
                    badge={{
                      label: statusLabel(honestStatus, t),
                      tone: statusTone(honestStatus) }}
                    facts={[
                      {
                        label: t('agents.path'),
                        value: pathLine,
                        mono: Boolean(rt.installPath) },
                      {
                        label: 'systemd',
                        value: unitLine,
                        mono: Boolean(rt.unitName) },
                    ]}
                    actions={
                      <ActionBar>
                        {rt.unitActive === 'activating' || honestStatus === 'failed' ? (
                          <Link
                            to={`/logs?unit=${encodeURIComponent(rt.unitName ?? `ysk-agent-${rt.kind}.service`)}`}
                            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                          >
                            {t('agents.journal')}
                          </Link>
                        ) : null}
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void probeKind(rt.kind).then(() => refreshAll())
                          }
                        >
                          {t('agents.probe')}
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={bindCall1(writeUnit, rt.kind)}
                        >
                          unit
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void installKind(rt.kind).then(() => refreshAll())
                          }
                        >
                          {t('agents.install')}
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
          <CardSection title={t('agents.recentOps')}>
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
        onClose={bindSet(setRegisterOpen, false)}
        title={t('agents.registerTitle')}
        description={t('agents.registerDesc')}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={bindSet(setRegisterOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="agent-register"
              variant="primary"
              size="md"
              loading={busy}
            >
              {t('agents.register')}
            </Button>
          </>
        }
      >
        <form id="agent-register" onSubmit={(e) => void onRegister(e)}>
          <FormLayout columns={1}>
            <Field
              label={t('agents.agentId')}
              htmlFor="aid"
              flush
              required
              hint={t('agents.agentIdHint')}
            >
              <input
                id="aid"
                value={agentId}
                onChange={bindInput(setAgentId)}
                placeholder="edge-1"
                spellCheck={false}
                autoComplete="off"
                required
              />
            </Field>
            <Field label={t('agents.group')} htmlFor="agroup" flush hint={t('agents.groupHint')}>
              <input
                id="agroup"
                value={agentGroup}
                onChange={bindInput(setAgentGroup)}
                placeholder="default"
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <FormHint>
            {t('agents.registerNote')}
          </FormHint>
        </form>
      </Modal>

      <Modal
        open={Boolean(cmdAgent)}
        onClose={bindSet(setCmdAgent, null)}
        title={cmdAgent ? t('agents.cmdTitle', { id: cmdAgent.agent_id }) : t('agents.cmdTitlePlain')}
        description={t('agents.cmdDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setCmdAgent, null)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="agent-cmd"
              variant="primary"
              size="md"
              loading={busy}
            >
              {t('agents.enqueue')}
            </Button>
          </>
        }
      >
        <form id="agent-cmd" onSubmit={(e) => void onSendCommand(e)}>
          <FormLayout columns={1}>
            <Field label={t('agents.cmdPreset')} htmlFor="cmd-preset" flush>
              <SegRadio
                name="cmd-preset"
                aria-label={t('agents.cmdTypeAria')}
                value={cmdPreset}
                onChange={(v) => setCmdPreset(v as CmdPreset)}
                options={[
                  { value: 'cli-readiness', label: 'readiness' },
                  { value: 'cli-host', label: 'host' },
                  { value: 'cli-projects', label: 'projects' },
                  { value: 'cli-services', label: 'services' },
                  { value: 'cli-defense', label: 'defense' },
                  { value: 'cli-logs', label: 'logs' },
                  { value: 'custom', label: t('agents.customCli') },
                  { value: 'ping', label: 'ping' },
                ]}
              />
            </Field>
            {cmdPreset === 'custom' ? (
              <Field
                label={t('agents.cliArgs')}
                htmlFor="cmd-custom"
                flush
                required
                hint={t('agents.cliArgsHint')}
              >
                <input
                  id="cmd-custom"
                  value={cmdCustom}
                  onChange={bindInput(setCmdCustom)}
                  spellCheck={false}
                  autoComplete="off"
                  required
                />
              </Field>
            ) : null}
          </FormLayout>
          <FormHint>
            {t('agents.cmdNote')}
          </FormHint>
        </form>
      </Modal>

      <Modal
        open={Boolean(resultCmd)}
        onClose={bindSet(setResultCmd, null)}
        title={
          resultCmd
            ? t('agents.resultTitle', { code: exitCodeOf(resultCmd) ?? '—' })
            : t('agents.resultTitlePlain')
        }
        description={
          resultCmd ? summarizePayload(resultCmd.payload) : undefined
        }
        footer={
          <Button variant="primary" size="md" onClick={bindSet(setResultCmd, null)}>
            {t('common.close')}
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
                <Badge tone="warn">{t('agents.badgeDryRun')}</Badge>
              ) : null}
              {asCliAck(resultCmd.result)?.blocked ? (
                <Badge tone="warn">{t('agents.badgeBlocked')}</Badge>
              ) : null}
            </ActionBar>
            <FormHint>{t('agents.resultOuterHint')}</FormHint>
            {asCliAck(resultCmd.result)?.stderr ? (
              <div>
                <div className="muted u-text-sm u-mb-1">{t('agents.labelStderr')}</div>
                <pre className="ops-pre u-pre-wrap u-scroll-sm">
                  {String(asCliAck(resultCmd.result)?.stderr).slice(0, 4000)}
                </pre>
              </div>
            ) : null}
            <div>
              <div className="muted u-text-sm u-mb-1">{t('agents.labelAckCli')}</div>
              <pre
                className="ops-pre u-pre-wrap u-scroll-xl"
              >
                {prettyJson(resultCmd.result)}
              </pre>
            </div>
            {unwrapCliBody(asCliAck(resultCmd.result)) !== resultCmd.result ? (
              <div>
                <div className="muted u-text-sm u-mb-1">{t('agents.labelStdoutBody')}</div>
                <pre
                  className="ops-pre u-pre-wrap u-scroll-lg"
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
        onClose={bindSet(setDelAgent, null)}
        title={
          delAgent
            ? t('agents.deleteTitle', { id: delAgent.agent_id })
            : t('agents.deleteTitlePlain')
        }
        description={t('agents.deleteDesc')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        severity="standard"
        onConfirm={() => {
          const a = delAgent;
          setDelAgent(null);
          if (a) void removeAgent(a.id);
        }}
      />
    
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
