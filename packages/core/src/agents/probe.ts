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

  // managed unit template location under dataDir not known here — check system unit
  if (host.pathExists('/bin/systemctl') || host.pathExists('/usr/bin/systemctl')) {
    const r = await host.runCommand(['systemctl', 'is-active', unitName], { timeoutMs: 5_000 });
    unitActive = (r.stdout || r.stderr || `exit_${r.exitCode}`).trim();
    notes.push(`服務狀態：${unitActive}`);
  } else {
    notes.push('此主機無 systemd 服務管理');
  }

  // npm global bin probe (best-effort)
  const which = await host.runCommand(
    ['bash', '-c', `command -v ${k} 2>/dev/null || command -v ${plan.runtime.name.toLowerCase()} 2>/dev/null || true`],
    { timeoutMs: 5_000 },
  );
  const bin = which.stdout.trim();
  if (bin) notes.push('已偵測到可執行檔');
  else notes.push('伺服器尚未安裝對應程式');

  let status: AgentRuntimeDto['status'] = 'unknown';
  if (unitActive === 'active') status = 'running';
  else if (pathExists || bin) status = 'stopped';
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
    probedAt: new Date().toISOString(),
  };
}

/**
 * Write a systemd unit template for an agent under dataDir/systemd.
 */
export function renderAgentSystemdUnit(opts: {
  kind: AgentRuntimeKind;
  installPath: string;
  nodePath?: string;
  user?: string;
}): string {
  const user = opts.user ?? 'root';
  const node = opts.nodePath ?? '/usr/bin/node';
  return `[Unit]
Description=YSK managed AI agent (${opts.kind})
After=network.target ysk-server.service

[Service]
Type=simple
User=${user}
WorkingDirectory=${opts.installPath}
Environment=NODE_ENV=production
Environment=YSK_AGENT_KIND=${opts.kind}
# Placeholder — replace ExecStart with real agent binary after install
ExecStart=${node} -e "console.log('ysk-agent-${opts.kind} placeholder'); setInterval(()=>{}, 3600000)"
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
}
