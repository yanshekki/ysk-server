import { tl } from '@ysk/shared';
/**
 * Probe multi-version runtimes on the host + managed install plans.
 * Never fakes install success — package installs need root + YSK_EXECUTE.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import {
  listSupportedRuntimes,
  selectGoRuntime,
  selectNodeRuntime,
  selectPhpRuntime,
  selectPythonRuntime,
  selectRustRuntime,
  type RuntimeKind,
} from './runtime.js';
import { resolveBin, shellBinExists, shellResolveBin } from './software-probe/index.js';

export interface RuntimeProbeItem {
  kind: RuntimeKind;
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
  python: RuntimeProbeItem[];
  go: RuntimeProbeItem[];
  rust: RuntimeProbeItem[];
  hostNode?: string;
  hostPhp?: string;
  hostPython?: string;
  hostGo?: string;
  hostRust?: string;
  notes: string[];
}

async function probeBinaryVersions(
  host: HostExecutor,
  kind: RuntimeKind,
  versions: string[],
  select: (v: string) => { binaryPath: string; version: string },
  versionCmd: (path: string) => string[],
  match: (output: string, version: string) => boolean,
  hostDefault?: string,
): Promise<RuntimeProbeItem[]> {
  const out: RuntimeProbeItem[] = [];
  for (const v of versions) {
    const plan = select(v);
    let available = false;
    let resolvedPath: string | undefined;
    let versionOutput: string | undefined;
    const itemNotes: string[] = [];

    if (hostDefault && match(hostDefault, v)) {
      available = true;
      versionOutput = hostDefault;
      itemNotes.push(tl('notes.auto.n1302'));
    }

    if (!available && host.pathExists(plan.binaryPath)) {
      const ver = await host.runCommand(versionCmd(plan.binaryPath), { timeoutMs: 8_000 });
      if (ver.exitCode === 0 && match(ver.stdout + ver.stderr, v)) {
        available = true;
        resolvedPath = plan.binaryPath;
        versionOutput = (ver.stdout || ver.stderr).trim().split('\n')[0];
      }
    }

    if (!available) {
      // PATH probe via unified resolveBin (same PATH rules as HostSoftwareProbe)
      const candidates: string[] =
        kind === 'python'
          ? [`python${v}`, 'python3']
          : kind === 'go'
            ? ['go']
            : kind === 'rust'
              ? ['cargo']
              : kind === 'node'
                ? [`node${v}`, 'node']
                : [`php${v}`, 'php'];
      for (const name of candidates) {
        const p = await resolveBin(host, name);
        if (!p) continue;
        const ver = await host.runCommand(versionCmd(p), { timeoutMs: 8_000 });
        const text = ver.stdout + ver.stderr;
        if (ver.exitCode === 0 && match(text, v)) {
          available = true;
          resolvedPath = p;
          versionOutput = text.trim().split('\n')[0];
          break;
        }
      }
    }

    if (!available) itemNotes.push(tl('notes.auto.t0395', { v0: (plan.binaryPath) }));
    out.push({
      kind,
      version: v,
      binaryPath: plan.binaryPath,
      available,
      resolvedPath,
      versionOutput,
      notes: itemNotes,
    });
  }
  return out;
}

/**
 * Probe which supported runtime versions exist on PATH / well-known paths.
 */
export async function probeRuntimes(host: HostExecutor): Promise<RuntimeProbeReport> {
  const supported = listSupportedRuntimes();
  const notes: string[] = [];

  async function hostDefault(bin: string, versionArgv: string[]): Promise<string | undefined> {
    const p = await resolveBin(host, bin);
    if (!p) return undefined;
    const ver = await host.runCommand(versionArgv, { timeoutMs: 8_000 });
    const text = (ver.stdout || ver.stderr || '').trim().split('\n')[0];
    return text || undefined;
  }

  const hostNode = await hostDefault('node', ['node', '-v']);
  const hostPhp = await hostDefault('php', ['php', '-v']);
  const hostPython = await hostDefault('python3', ['python3', '--version']);
  const hostGo = await hostDefault('go', ['go', 'version']);
  const hostRust = await hostDefault('cargo', ['cargo', '--version']);

  const node = await probeBinaryVersions(
    host,
    'node',
    supported.node,
    selectNodeRuntime,
    (p) => [p, '-v'],
    (out, v) => new RegExp(`v?${v}\\b`).test(out),
    hostNode,
  );

  const php = await probeBinaryVersions(
    host,
    'php',
    supported.php,
    selectPhpRuntime,
    (p) => [p, '-v'],
    (out, v) => out.includes(v),
    hostPhp,
  );

  const python = await probeBinaryVersions(
    host,
    'python',
    supported.python,
    selectPythonRuntime,
    (p) => [p, '--version'],
    (out, v) => out.includes(v),
    hostPython,
  );

  const go = await probeBinaryVersions(
    host,
    'go',
    supported.go,
    selectGoRuntime,
    (p) => [p, 'version'],
    (out, v) => out.includes(`go${v}`) || out.includes(v),
    hostGo,
  );

  const rust = await probeBinaryVersions(
    host,
    'rust',
    supported.rust,
    selectRustRuntime,
    (p) => [p, '--version'],
    (out, v) => {
      if (v === 'stable') return /cargo\s+\d/i.test(out);
      return out.includes(v);
    },
    hostRust,
  );

  notes.push(
    tl('notes.auto.t0396', { v0: (hostNode ?? tl('notes.tpl.none')) }),
    tl('notes.auto.t0397', { v0: (hostPhp ?? tl('notes.tpl.none')) }),
    tl('notes.auto.t0398', { v0: (hostPython ?? tl('notes.tpl.none')) }),
    tl('notes.auto.t0399', { v0: (hostGo ?? tl('notes.tpl.none')) }),
    tl('notes.auto.t0400', { v0: (hostRust ?? tl('notes.tpl.none')) }),
    tl('notes.auto.t0401', { v0: (node.filter((n) => n.available).map((n) => n.version).join(', ') || tl('notes.tpl.none')) }),
    tl('notes.auto.t0402', { v0: (php.filter((p) => p.available).map((p) => p.version).join(', ') || tl('notes.tpl.none')) }),
    tl('notes.auto.t0403', { v0: (python.filter((p) => p.available).map((p) => p.version).join(', ') || tl('notes.tpl.none')) }),
    tl('notes.auto.t0404', { v0: (go.filter((g) => g.available).map((g) => g.version).join(', ') || tl('notes.tpl.none')) }),
    tl('notes.auto.t0405', { v0: (rust.filter((r) => r.available).map((r) => r.version).join(', ') || tl('notes.tpl.none')) }),
  );

  return {
    node,
    php,
    python,
    go,
    rust,
    hostNode,
    hostPhp,
    hostPython,
    hostGo,
    hostRust,
    notes,
  };
}

export interface RuntimeInstallResult {
  ok: boolean;
  kind: RuntimeKind;
  version: string;
  written: string[];
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  requiresExecute: boolean;
  requiresRoot: boolean;
}

/**
 * Write install helper for a runtime version; optionally run when root+EXECUTE.
 */
export async function planOrInstallRuntime(input: {
  dataDir: string;
  host: HostExecutor;
  kind: RuntimeKind;
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
      `if ${shellBinExists('node')}; then node -v; fi`,
      'apt-get update',
      `curl -fsSL https://deb.nodesource.com/setup_${plan.version}.x | bash -`,
      'apt-get install -y nodejs',
      'node -v',
      `mkdir -p $(dirname ${plan.binaryPath})`,
      `NODE_BIN="$(${shellResolveBin('node')})"`,
      'test -n "$NODE_BIN"',
      `ln -sfn "$NODE_BIN" ${plan.binaryPath}`,
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0406', { v0: (plan.version) }));
  } else if (input.kind === 'php') {
    const plan = selectPhpRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install PHP ${plan.version} + FPM`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update',
      'apt-get install -y software-properties-common',
      'add-apt-repository -y ppa:ondrej/php 2>/dev/null || echo "skip ondrej PPA"',
      'apt-get update',
      `apt-get install -y php${plan.version}-fpm php${plan.version}-cli php${plan.version}-mysql php${plan.version}-xml php${plan.version}-mbstring`,
      `php${plan.version} -v`,
      'systemctl enable --now php' + plan.version + '-fpm',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0407', { v0: (plan.version) }));
  } else if (input.kind === 'python') {
    const plan = selectPythonRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Python ${plan.version}`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update',
      'apt-get install -y software-properties-common',
      'add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || echo "skip deadsnakes PPA"',
      'apt-get update',
      `if ! apt-get install -y python${plan.version} python${plan.version}-venv python${plan.version}-dev; then apt-get install -y python3 python3-venv python3-dev; fi`,
      `python${plan.version} --version 2>/dev/null || python3 --version`,
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0408', { v0: (plan.version) }));
  } else if (input.kind === 'go') {
    const plan = selectGoRuntime(input.version);
    const arch = 'linux-amd64';
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Go ${plan.version}`,
      'set -euo pipefail',
      `VER=${plan.version}`,
      `DEST=/usr/local/ysk/go/$VER`,
      'mkdir -p /usr/local/ysk/go /tmp/ysk-go-install',
      'cd /tmp/ysk-go-install',
      `curl -fsSL "https://go.dev/dl/go\${VER}.${arch}.tar.gz" -o go.tgz`,
      'rm -rf "$DEST"',
      'mkdir -p "$DEST"',
      'tar -C "$DEST" --strip-components=1 -xzf go.tgz',
      'ln -sfn "$DEST/bin/go" /usr/local/bin/go || true',
      '"$DEST/bin/go" version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0409', { v0: (plan.version) }));
  } else {
    const plan = selectRustRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Rust (${plan.version}) via rustup`,
      'set -euo pipefail',
      'export RUSTUP_HOME=/usr/local/ysk/rust',
      'export CARGO_HOME=/usr/local/ysk/rust',
      'mkdir -p /usr/local/ysk/rust',
      `if ! ${shellBinExists('rustup')} && [ ! -x /usr/local/ysk/rust/bin/rustup ]; then`,
      '  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain ' +
        (plan.version === 'stable' ? 'stable' : plan.version),
      'fi',
      'export PATH="/usr/local/ysk/rust/bin:$PATH"',
      plan.version === 'stable'
        ? 'rustup default stable || true'
        : `rustup toolchain install ${plan.version} || true`,
      'cargo --version',
      'rustc --version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0410', { v0: (plan.version) }));
  }

  const scriptPath = join(dir, 'install.sh');
  writeFileSync(scriptPath, script, 'utf8');
  written.push(scriptPath);
  notes.push(tl('notes.auto.n0762'));

  const want = Boolean(input.install);
  const can = want && input.host.executeEnabled() && input.host.isRoot();
  if (want && !can) {
    if (!input.host.executeEnabled()) {
      notes.push(tl('ops.blocked.install'));
    } else if (!input.host.isRoot()) {
      notes.push(tl('notes.auto.n1582'));
    }
  }

  if (can) {
    const r = await input.host.runCommand(['bash', scriptPath], { timeoutMs: 600_000 });
    commandResults.push({
      argv: ['bash', scriptPath],
      exitCode: r.exitCode,
      stderr: r.stderr,
    });
    if (r.exitCode === 0) notes.push(tl('notes.auto.n0656'));
    else notes.push(tl('notes.auto.t0411', { v0: (r.stderr || r.stdout) }));
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
