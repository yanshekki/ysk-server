/**
 * Probe managed AI agent runtimes on disk + systemd (real host truth).
 */

import type { AgentRuntimeDto, AgentRuntimeKind } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import { listAgentRuntimes, parseAgentKind, planAgentInstall } from './runtime.js';

export interface AgentRuntimeProbe extends AgentRuntimeDto {
  pathExists: boolean;
  unitActive?: string;
  unitName: string;
  installPlan: string[];
  supervision: string[];
  notes: string[];
  probedAt: string;
  /** Absolute path to CLI if found */
  binaryPath?: string;
}

/**
 * Probe all catalog runtimes.
 */
export async function probeAllAgentRuntimes(host: HostExecutor): Promise<AgentRuntimeProbe[]> {
  const kinds = listAgentRuntimes().map((r) => r.kind);
  const out: AgentRuntimeProbe[] = [];
  for (const kind of kinds) {
    out.push(await probeAgentRuntime(kind, host));
  }
  return out;
}

/**
 * Resolve first available binary for a kind (command -v).
 */
export async function resolveAgentBinary(
  kind: AgentRuntimeKind | string,
  host: HostExecutor,
): Promise<string | undefined> {
  const k = typeof kind === 'string' ? parseAgentKind(kind) : kind;
  const plan = planAgentInstall(k);
  const names = plan.binNames.length
    ? plan.binNames
    : [k, plan.runtime.name.toLowerCase()];
  const script = names
    .map((n) => `command -v ${JSON.stringify(n)} 2>/dev/null`)
    .join(' || ');
  const which = await host.runCommand(['bash', '-c', script], { timeoutMs: 5_000 });
  const bin = which.stdout.trim().split('\n')[0]?.trim();
  return bin || undefined;
}

/**
 * Probe a single runtime: install path, optional binary, systemd unit.
 */
export async function probeAgentRuntime(
  kind: AgentRuntimeKind | string,
  host: HostExecutor,
): Promise<AgentRuntimeProbe> {
  const k = typeof kind === 'string' ? parseAgentKind(kind) : kind;
  const plan = planAgentInstall(k);
  const path = plan.runtime.installPath ?? `/opt/ysk-server/agents/${k}`;
  const pathExists = host.pathExists(path);
  const unitName = `ysk-agent-${k}.service`;
  const notes: string[] = [];
  let unitActive: string | undefined;

  if (host.pathExists('/bin/systemctl') || host.pathExists('/usr/bin/systemctl')) {
    const r = await host.runCommand(['systemctl', 'is-active', unitName], { timeoutMs: 5_000 });
    unitActive = (r.stdout || r.stderr || `exit_${r.exitCode}`).trim();
    notes.push(`服務狀態：${unitActive}`);
  } else {
    notes.push('此主機無 systemd 服務管理');
  }

  const binaryPath = await resolveAgentBinary(k, host);
  if (binaryPath) notes.push(`已偵測到可執行檔：${binaryPath}`);
  else notes.push('伺服器尚未安裝對應程式（command -v 無結果）');

  let status: AgentRuntimeDto['status'] = 'unknown';
  if (unitActive === 'active') {
    // active unit with only placeholder is still "running" but probe notes honesty
    status = 'running';
    if (!binaryPath) {
      notes.push('警告：unit 為 active 但找不到 CLI binary（可能係舊 placeholder unit）');
    }
  } else if (pathExists || binaryPath) status = 'stopped';
  else status = 'not_installed';

  return {
    kind: k,
    name: plan.runtime.name,
    status,
    installPath: path,
    pathExists,
    unitActive,
    unitName,
    installPlan: plan.commands,
    supervision: plan.supervision,
    notes,
    binaryPath,
    probedAt: new Date().toISOString(),
  };
}

/**
 * Write a systemd unit for an agent.
 * When binaryPath is set → real ExecStart.
 * When missing → unit stays disabled template with honest comment (install refuses enable).
 */
export function renderAgentSystemdUnit(opts: {
  kind: AgentRuntimeKind;
  installPath: string;
  nodePath?: string;
  user?: string;
  /** Real CLI absolute path — required for production enable */
  binaryPath?: string;
  /** Extra args after binary */
  binaryArgs?: string[];
}): string {
  const user = opts.user ?? 'root';
  const args = (opts.binaryArgs ?? []).map((a) => JSON.stringify(a)).join(' ');
  let execStart: string;
  let comment: string;
  if (opts.binaryPath) {
    execStart = args
      ? `${opts.binaryPath} ${args}`
      : opts.binaryPath;
    comment = `# Real agent binary: ${opts.binaryPath}`;
  } else {
    // Fail-closed: Type=oneshot that exits non-zero so enable --now cannot look healthy
    const node = opts.nodePath ?? '/usr/bin/node';
    execStart = `${node} -e "console.error('ysk-agent-${opts.kind}: no CLI binary installed — refuse to run placeholder'); process.exit(1)"`;
    comment =
      '# No CLI binary detected — unit exits 1 (not a silent success placeholder)';
  }
  return `[Unit]
Description=YSK managed AI agent (${opts.kind})
After=network.target ysk-server.service

[Service]
Type=simple
User=${user}
WorkingDirectory=${opts.installPath}
Environment=NODE_ENV=production
Environment=YSK_AGENT_KIND=${opts.kind}
${comment}
ExecStart=${execStart}
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}
