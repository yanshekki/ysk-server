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
      itemNotes.push('符合主機預設版本');
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
      // PATH probe by kind
      let whichCmd = '';
      if (kind === 'python') whichCmd = `command -v python${v} || command -v python3 || true`;
      else if (kind === 'go') whichCmd = 'command -v go || true';
      else if (kind === 'rust') whichCmd = 'command -v cargo || true';
      else if (kind === 'node') whichCmd = `command -v node${v} || command -v node || true`;
      else whichCmd = `command -v php${v} || command -v php || true`;

      const alt = await host.runCommand(['bash', '-c', whichCmd], { timeoutMs: 5_000 });
      const p = alt.stdout.trim().split('\n')[0];
      if (p) {
        const ver = await host.runCommand(versionCmd(p), { timeoutMs: 8_000 });
        const text = ver.stdout + ver.stderr;
        if (ver.exitCode === 0 && match(text, v)) {
          available = true;
          resolvedPath = p;
          versionOutput = text.trim().split('\n')[0];
        }
      }
    }

    if (!available) itemNotes.push(`找不到（預期 ${plan.binaryPath}）`);
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

  const hostPyCmd = await host.runCommand(
    ['bash', '-c', 'command -v python3; python3 --version 2>&1 || true'],
    { timeoutMs: 8_000 },
  );
  const hostPyLines = hostPyCmd.stdout.trim().split('\n').filter(Boolean);
  const hostPython = hostPyLines[1] ?? hostPyLines[0];

  const hostGoCmd = await host.runCommand(
    ['bash', '-c', 'command -v go; go version 2>&1 || true'],
    { timeoutMs: 8_000 },
  );
  const hostGoLines = hostGoCmd.stdout.trim().split('\n').filter(Boolean);
  const hostGo = hostGoLines[1] ?? hostGoLines[0];

  const hostRustCmd = await host.runCommand(
    ['bash', '-c', 'command -v cargo; cargo --version 2>&1 || true'],
    { timeoutMs: 8_000 },
  );
  const hostRustLines = hostRustCmd.stdout.trim().split('\n').filter(Boolean);
  const hostRust = hostRustLines[1] ?? hostRustLines[0];

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
    `主機 node：${hostNode ?? '無'}`,
    `主機 php：${hostPhp ?? '無'}`,
    `主機 python：${hostPython ?? '無'}`,
    `主機 go：${hostGo ?? '無'}`,
    `主機 cargo：${hostRust ?? '無'}`,
    `Node 可用：${node.filter((n) => n.available).map((n) => n.version).join(', ') || '無'}`,
    `PHP 可用：${php.filter((p) => p.available).map((p) => p.version).join(', ') || '無'}`,
    `Python 可用：${python.filter((p) => p.available).map((p) => p.version).join(', ') || '無'}`,
    `Go 可用：${go.filter((g) => g.available).map((g) => g.version).join(', ') || '無'}`,
    `Rust 可用：${rust.filter((r) => r.available).map((r) => r.version).join(', ') || '無'}`,
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
      'if command -v node >/dev/null 2>&1; then node -v; fi',
      'apt-get update',
      `curl -fsSL https://deb.nodesource.com/setup_${plan.version}.x | bash -`,
      'apt-get install -y nodejs',
      'node -v',
      `mkdir -p $(dirname ${plan.binaryPath})`,
      'NODE_BIN="$(command -v node)"',
      'test -n "$NODE_BIN"',
      `ln -sfn "$NODE_BIN" ${plan.binaryPath}`,
      '',
    ].join('\n');
    notes.push(`準備安裝 Node ${plan.version}`);
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
    notes.push(`準備安裝 PHP ${plan.version}`);
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
    notes.push(`準備安裝 Python ${plan.version}`);
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
    notes.push(`準備安裝 Go ${plan.version} 到 /usr/local/ysk/go`);
  } else {
    const plan = selectRustRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Rust (${plan.version}) via rustup`,
      'set -euo pipefail',
      'export RUSTUP_HOME=/usr/local/ysk/rust',
      'export CARGO_HOME=/usr/local/ysk/rust',
      'mkdir -p /usr/local/ysk/rust',
      'if ! command -v rustup >/dev/null 2>&1 && [ ! -x /usr/local/ysk/rust/bin/rustup ]; then',
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
    notes.push(`準備安裝 Rust（${plan.version}）到 /usr/local/ysk/rust`);
  }

  const scriptPath = join(dir, 'install.sh');
  writeFileSync(scriptPath, script, 'utf8');
  written.push(scriptPath);
  notes.push('已寫入安裝腳本');

  const want = Boolean(input.install);
  const can = want && input.host.executeEnabled() && input.host.isRoot();
  if (want && !can) {
    if (!input.host.executeEnabled()) {
      notes.push('伺服器未開啟系統變更權限，無法在管理面板完成安裝');
    } else if (!input.host.isRoot()) {
      notes.push('需要系統管理員權限才能完成安裝');
    }
  }

  if (can) {
    const r = await input.host.runCommand(['bash', scriptPath], { timeoutMs: 600_000 });
    commandResults.push({
      argv: ['bash', scriptPath],
      exitCode: r.exitCode,
      stderr: r.stderr,
    });
    if (r.exitCode === 0) notes.push('安裝完成');
    else notes.push(`安裝失敗：${r.stderr || r.stdout}`);
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
