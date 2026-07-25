/**
 * Apply agent runtime install plan under EXECUTE policy (never fake success).
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentRuntimeKind } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import { planAgentInstall, parseAgentKind } from './runtime.js';
import { renderAgentSystemdUnit, probeAgentRuntime } from './probe.js';

export interface AgentInstallResult {
  ok: boolean;
  kind: AgentRuntimeKind;
  written: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  notes: string[];
  requiresExecute: boolean;
  requiresRoot: boolean;
  enabled: boolean;
  probe?: Awaited<ReturnType<typeof probeAgentRuntime>>;
}

/**
 * Write install dir + unit under dataDir; optionally run install commands + systemctl enable.
 */
export async function applyAgentInstall(input: {
  dataDir: string;
  kind: AgentRuntimeKind | string;
  host: HostExecutor;
  /** Run plan.commands and enable unit (needs EXECUTE; root preferred for system paths) */
  execute?: boolean;
  enableUnit?: boolean;
  nodePath?: string;
}): Promise<AgentInstallResult> {
  const kind = parseAgentKind(typeof input.kind === 'string' ? input.kind : input.kind);
  const plan = planAgentInstall(kind);
  const installPath = plan.runtime.installPath ?? `/opt/ysk-server/agents/${kind}`;
  const notes = [...plan.supervision];
  const written: string[] = [];
  const commandResults: AgentInstallResult['commandResults'] = [];

  // Always write managed artifacts under dataDir
  const managedDir = join(input.dataDir, 'agents', kind);
  mkdirSync(managedDir, { recursive: true });
  const readme = join(managedDir, 'README.txt');
  writeFileSync(
    readme,
    [
      `YSK managed agent: ${kind}`,
      `Target install path: ${installPath}`,
      'Commands:',
      ...plan.commands.map((c) => `  ${c}`),
      '',
      'Supervision:',
      ...plan.supervision.map((s) => `  - ${s}`),
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(readme);

  const unitsDir = join(input.dataDir, 'systemd');
  mkdirSync(unitsDir, { recursive: true });
  const unitName = `ysk-agent-${kind}.service`;
  const unitPath = join(unitsDir, unitName);
  const unit = renderAgentSystemdUnit({
    kind,
    installPath,
    nodePath: input.nodePath ?? process.execPath,
  });
  writeFileSync(unitPath, unit, 'utf8');
  written.push(unitPath);
  notes.push(`Unit template: ${unitPath}`);

  const want = Boolean(input.execute);
  const can = want && input.host.executeEnabled();
  let enabled = false;

  if (want && !can) {
    notes.push('Install commands skipped: set YSK_EXECUTE=1');
  }

  if (can) {
    // mkdir install path (may need root for /opt)
    const mk = await input.host.runCommand(['mkdir', '-p', installPath], { timeoutMs: 10_000 });
    commandResults.push({
      argv: ['mkdir', '-p', installPath],
      exitCode: mk.exitCode,
      stderr: mk.stderr,
    });
    if (mk.exitCode !== 0) {
      notes.push(`mkdir ${installPath} failed (need root for /opt?): ${mk.stderr}`);
    }
    for (const cmd of plan.commands) {
      const r = await input.host.runCommand(['bash', '-c', cmd], { timeoutMs: 180_000 });
      commandResults.push({
        argv: ['bash', '-c', cmd],
        exitCode: r.exitCode,
        stderr: r.stderr,
      });
      notes.push(`${cmd} => exit ${r.exitCode}`);
    }

    if (input.enableUnit !== false && input.host.isRoot()) {
      const cp = await input.host.runCommand(
        ['cp', unitPath, `/etc/systemd/system/${unitName}`],
        { timeoutMs: 10_000 },
      );
      commandResults.push({
        argv: ['cp', unitPath, `/etc/systemd/system/${unitName}`],
        exitCode: cp.exitCode,
        stderr: cp.stderr,
      });
      const reload = await input.host.runCommand(['systemctl', 'daemon-reload'], {
        timeoutMs: 15_000,
      });
      commandResults.push({
        argv: ['systemctl', 'daemon-reload'],
        exitCode: reload.exitCode,
        stderr: reload.stderr,
      });
      const en = await input.host.runCommand(['systemctl', 'enable', '--now', unitName], {
        timeoutMs: 30_000,
      });
      commandResults.push({
        argv: ['systemctl', 'enable', '--now', unitName],
        exitCode: en.exitCode,
        stderr: en.stderr,
      });
      enabled = cp.exitCode === 0 && en.exitCode === 0;
      notes.push(enabled ? `systemd enabled ${unitName}` : `systemd enable failed: ${en.stderr}`);
    } else if (input.enableUnit !== false) {
      notes.push('Unit enable skipped: not root');
    }
  }

  const probe = await probeAgentRuntime(kind, input.host);
  const ranOk = commandResults.every((c) => c.exitCode === 0);
  // ok only if we either only wrote files (no execute) or all executed commands succeeded
  const ok = want ? can && ranOk : true;

  return {
    ok,
    kind,
    written,
    commandResults,
    notes,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot(),
    enabled,
    probe,
  };
}

/** Ensure install path marker file exists under dataDir for non-root demos */
export function markAgentManaged(dataDir: string, kind: string): string {
  const dir = join(dataDir, 'agents', kind);
  mkdirSync(dir, { recursive: true });
  const marker = join(dir, 'managed.json');
  if (!existsSync(marker)) {
    writeFileSync(
      marker,
      JSON.stringify({ kind, managedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  }
  return marker;
}
