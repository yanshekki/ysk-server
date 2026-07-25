/**
 * Probe multi-version Node/PHP binaries on the host + managed install plans.
 * Never fakes install success — apt/nodesource paths need root + YSK_EXECUTE.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import { listSupportedRuntimes, selectNodeRuntime, selectPhpRuntime } from './runtime.js';

export interface RuntimeProbeItem {
  kind: 'node' | 'php';
  version: string;
  binaryPath: string;
  available: boolean;
  resolvedPath?: string;
  versionOutput?: string;
  notes: string[];
}

export interface RuntimeProbeReport {
  node: RuntimeProbeItem[];
  php: RuntimeProbeItem[];
  hostNode?: string;
  hostPhp?: string;
  notes: string[];
}

/**
 * Probe which supported Node/PHP versions exist on PATH / well-known paths.
 */
export async function probeRuntimes(host: HostExecutor): Promise<RuntimeProbeReport> {
  const supported = listSupportedRuntimes();
  const notes: string[] = [];
  const node: RuntimeProbeItem[] = [];
  const php: RuntimeProbeItem[] = [];

  // host default node
  const hostNodeCmd = await host.runCommand(
    ['bash', '-c', 'command -v node; node -v 2>/dev/null || true'],
    { timeoutMs: 8_000 },
  );
  const hostNodeLines = hostNodeCmd.stdout.trim().split('\n').filter(Boolean);
  const hostNode = hostNodeLines[1] ?? hostNodeLines[0];

  const hostPhpCmd = await host.runCommand(
    ['bash', '-c', 'command -v php; php -v 2>/dev/null | head -1 || true'],
    { timeoutMs: 8_000 },
  );
  const hostPhpLines = hostPhpCmd.stdout.trim().split('\n').filter(Boolean);
  const hostPhp = hostPhpLines[1] ?? hostPhpLines[0];

  for (const v of supported.node) {
    const plan = selectNodeRuntime(v);
    const candidates = [
      plan.binaryPath,
      `/usr/bin/node${v}`,
      // nvm/fnm style — best-effort single check via bash
    ];
    let available = false;
    let resolvedPath: string | undefined;
    let versionOutput: string | undefined;
    const itemNotes: string[] = [];

    // Prefer `node -v` matching major if default node is this major
    if (hostNode && new RegExp(`v?${v}\\b`).test(hostNode)) {
      const which = await host.runCommand(['bash', '-c', 'command -v node || true'], {
        timeoutMs: 5_000,
      });
      if (which.stdout.trim()) {
        available = true;
        resolvedPath = which.stdout.trim();
        versionOutput = hostNode;
        itemNotes.push('matches host default node major');
      }
    }

    for (const c of candidates) {
      if (available) break;
      if (host.pathExists(c)) {
        const ver = await host.runCommand([c, '-v'], { timeoutMs: 5_000 });
        if (ver.exitCode === 0) {
          available = true;
          resolvedPath = c;
          versionOutput = ver.stdout.trim();
        }
      }
    }

    // try command -v node20 style
    if (!available) {
      const alt = await host.runCommand(
        ['bash', '-c', `command -v node${v} || command -v node-${v} || true`],
        { timeoutMs: 5_000 },
      );
      if (alt.stdout.trim()) {
        const p = alt.stdout.trim().split('\n')[0];
        const ver = await host.runCommand([p, '-v'], { timeoutMs: 5_000 });
        if (ver.exitCode === 0 && ver.stdout.includes(v)) {
          available = true;
          resolvedPath = p;
          versionOutput = ver.stdout.trim();
        }
      }
    }

    if (!available) itemNotes.push(`not found (plan path ${plan.binaryPath})`);
    node.push({
      kind: 'node',
      version: v,
      binaryPath: plan.binaryPath,
      available,
      resolvedPath,
      versionOutput,
      notes: itemNotes,
    });
  }

  for (const v of supported.php) {
    const plan = selectPhpRuntime(v);
    let available = false;
    let resolvedPath: string | undefined;
    let versionOutput: string | undefined;
    const itemNotes: string[] = [];

    const candidates = [plan.binaryPath, `/usr/bin/php${v}`, '/usr/bin/php'];
    for (const c of candidates) {
      if (!host.pathExists(c) && c !== '/usr/bin/php') continue;
      const which =
        c === '/usr/bin/php'
          ? await host.runCommand(['bash', '-c', 'command -v php || true'], { timeoutMs: 5_000 })
          : { stdout: host.pathExists(c) ? c : '', exitCode: 0, stderr: '', argv: [], dryRun: false };
      const path = c === '/usr/bin/php' ? which.stdout.trim() : c;
      if (!path) continue;
      const ver = await host.runCommand([path, '-v'], { timeoutMs: 5_000 });
      if (ver.exitCode === 0 && ver.stdout.includes(v)) {
        available = true;
        resolvedPath = path;
        versionOutput = ver.stdout.split('\n')[0];
        break;
      }
    }

    if (!available && hostPhp && hostPhp.includes(v)) {
      available = true;
      versionOutput = hostPhp;
      itemNotes.push('matches host default php');
    }
    if (!available) itemNotes.push(`not found (expected ${plan.binaryPath})`);

    php.push({
      kind: 'php',
      version: v,
      binaryPath: plan.binaryPath,
      available,
      resolvedPath,
      versionOutput,
      notes: itemNotes,
    });
  }

  notes.push(
    `Host node: ${hostNode ?? 'none'}`,
    `Host php: ${hostPhp ?? 'none'}`,
    `Node available: ${node.filter((n) => n.available).map((n) => n.version).join(', ') || 'none'}`,
    `PHP available: ${php.filter((p) => p.available).map((p) => p.version).join(', ') || 'none'}`,
  );

  return { node, php, hostNode, hostPhp, notes };
}

export interface RuntimeInstallResult {
  ok: boolean;
  kind: 'node' | 'php';
  version: string;
  written: string[];
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  requiresExecute: boolean;
  requiresRoot: boolean;
}

/**
 * Write install helper for a runtime version; optionally run apt/nodesource when root+EXECUTE.
 */
export async function planOrInstallRuntime(input: {
  dataDir: string;
  host: HostExecutor;
  kind: 'node' | 'php';
  version: string;
  /** When true, attempt package install (root + EXECUTE) */
  install?: boolean;
}): Promise<RuntimeInstallResult> {
  const notes: string[] = [];
  const written: string[] = [];
  const commandResults: RuntimeInstallResult['commandResults'] = [];
  const dir = join(input.dataDir, 'runtimes', input.kind, input.version);
  mkdirSync(dir, { recursive: true });

  let script = '';
  if (input.kind === 'node') {
    const plan = selectNodeRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Node.js ${plan.version}`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'if command -v node >/dev/null 2>&1; then node -v; fi',
      '# Nodesource (Debian/Ubuntu) or use nvm/fnm manually',
      'apt-get update',
      `curl -fsSL https://deb.nodesource.com/setup_${plan.version}.x | bash -`,
      'apt-get install -y nodejs',
      'node -v',
      `mkdir -p $(dirname ${plan.binaryPath})`,
      `ln -sfn "$(command -v node)" ${plan.binaryPath} || true`,
      '',
    ].join('\n');
    notes.push(`Node ${plan.version} install plan (nodesource)`);
  } else {
    const plan = selectPhpRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install PHP ${plan.version} + FPM`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update',
      'apt-get install -y software-properties-common',
      'add-apt-repository -y ppa:ondrej/php || true',
      'apt-get update',
      `apt-get install -y php${plan.version}-fpm php${plan.version}-cli php${plan.version}-mysql php${plan.version}-xml php${plan.version}-mbstring`,
      `php${plan.version} -v`,
      'systemctl enable --now php' + plan.version + '-fpm || true',
      '',
    ].join('\n');
    notes.push(`PHP ${plan.version} install plan (ondrej PPA)`);
  }

  const scriptPath = join(dir, 'install.sh');
  writeFileSync(scriptPath, script, 'utf8');
  written.push(scriptPath);
  notes.push(`Helper: ${scriptPath}`);

  const want = Boolean(input.install);
  const can = want && input.host.executeEnabled() && input.host.isRoot();
  if (want && !can) {
    notes.push('Install skipped: need root + YSK_EXECUTE=1 (never fake success)');
  }

  if (can) {
    const r = await input.host.runCommand(['bash', scriptPath], { timeoutMs: 600_000 });
    commandResults.push({
      argv: ['bash', scriptPath],
      exitCode: r.exitCode,
      stderr: r.stderr,
    });
    if (r.exitCode === 0) notes.push('Install script completed');
    else notes.push(`Install script failed: ${r.stderr || r.stdout}`);
  }

  const ranOk = commandResults.every((c) => c.exitCode === 0);
  return {
    ok: want ? can && ranOk : true,
    kind: input.kind,
    version: input.version,
    written,
    notes,
    commandResults,
    requiresExecute: !input.host.executeEnabled(),
    requiresRoot: !input.host.isRoot(),
  };
}
