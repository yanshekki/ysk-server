import { tl } from '@ysk/shared';
/**
 * Probe multi-version runtimes on the host + managed install plans.
 * Never fakes install success — package installs need root + YSK_EXECUTE.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import {
  goLastKnownPatchShellCase,
  listSupportedRuntimes,
  selectBunRuntime,
  selectGoRuntime,
  selectJavaRuntime,
  selectKotlinRuntime,
  selectNodeRuntime,
  selectPhpRuntime,
  selectPythonRuntime,
  selectRustRuntime,
  type RuntimeKind,
} from './runtime.js';
import { resolvePhpAptPackages } from './php-extensions.js';
import { buildRuntimePluginScriptLines } from './runtime-plugins.js';
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
  java: RuntimeProbeItem[];
  kotlin: RuntimeProbeItem[];
  bun: RuntimeProbeItem[];
  hostNode?: string;
  hostPhp?: string;
  hostPython?: string;
  hostGo?: string;
  hostRust?: string;
  hostJava?: string;
  hostKotlin?: string;
  hostBun?: string;
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
                : kind === 'java'
                  ? ['java', 'javac']
                  : kind === 'kotlin'
                    ? ['kotlin', 'kotlinc']
                    : kind === 'bun'
                      ? ['bun']
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
  const hostJava = await hostDefault('java', ['java', '-version']);
  const hostKotlin =
    (await hostDefault('kotlinc', ['kotlinc', '-version'])) ||
    (await hostDefault('kotlin', ['kotlin', '-version']));
  const hostBun = await hostDefault('bun', ['bun', '--version']);

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

  const java = await probeBinaryVersions(
    host,
    'java',
    supported.java,
    selectJavaRuntime,
    (p) => [p, '-version'],
    (out, v) => out.includes(`"${v}`) || out.includes(`version ${v}`) || new RegExp(`\\b${v}\\b`).test(out),
    hostJava,
  );

  const kotlin = await probeBinaryVersions(
    host,
    'kotlin',
    supported.kotlin,
    selectKotlinRuntime,
    (p) => [p, '-version'],
    (out, v) => out.includes(v) || /kotlinc/i.test(out),
    hostKotlin,
  );

  const bun = await probeBinaryVersions(
    host,
    'bun',
    supported.bun,
    selectBunRuntime,
    (p) => [p, '--version'],
    (out, v) => {
      if (v === 'latest') return /\d+\.\d+/.test(out);
      return out.includes(v);
    },
    hostBun,
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
    java,
    kotlin,
    bun,
    hostNode,
    hostPhp,
    hostPython,
    hostGo,
    hostRust,
    hostJava,
    hostKotlin,
    hostBun,
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
  /** True when install was requested but host lacks EXECUTE/root */
  blocked?: boolean;
  blockMessage?: string;
  /** PHP: resolved apt package names for the selected extensions */
  packages?: string[];
  /** PHP: extension ids that were resolved into packages */
  extensionIds?: string[];
  /** Companion tools (pm2, poetry, maven, …) */
  pluginIds?: string[];
}

/** Compress install stderr for panel notes (avoid dumping full apt logs). */
function summarizeInstallLog(stderr: string, stdout: string): string {
  const text = `${stderr || ''}\n${stdout || ''}`.trim();
  if (!text) return '';
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter(
      (l) =>
        !/^(Get:|Hit:|Ign:|Reading package|Building dependency|Preparing to unpack|Unpacking |Setting up |Processing triggers|Fetched )/i.test(
          l,
        ),
    );
  const pick = (lines.length ? lines : text.split('\n')).slice(-6).join(' · ');
  return pick.replace(/\s+/g, ' ').slice(0, 360);
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
  /**
   * PHP only: extension ids from php-extensions catalog (mysql, gd, redis, …).
   * Omit for recommended defaults; pass [] for core-only (fpm/cli/common).
   */
  extensions?: string[];
  /**
   * Companion plugins (node: pm2/yarn; python: poetry; go: air; …).
   * Omit for recommended defaults; pass [] for none.
   * PHP still uses `extensions` for apt modules; can also pass plugins if defined.
   */
  plugins?: string[];
}): Promise<RuntimeInstallResult> {
  const notes: string[] = [];
  const written: string[] = [];
  const commandResults: RuntimeInstallResult['commandResults'] = [];
  const dir = join(input.dataDir, 'runtimes', input.kind, input.version);
  mkdirSync(dir, { recursive: true });

  let script = '';
  let packages: string[] | undefined;
  let extensionIds: string[] | undefined;
  let pluginIds: string[] | undefined;
  if (input.kind === 'node') {
    const plan = selectNodeRuntime(input.version);
    // Official binary tarball → /usr/local/ysk/node/<major> (same layout as go/rust).
    // Reuse PATH node when major already matches; NodeSource apt is fallback only.
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Node.js ${plan.version}`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      `MAJOR="${plan.version}"`,
      `DEST="/usr/local/ysk/node/${plan.version}"`,
      'mkdir -p /usr/local/ysk/node /tmp/ysk-node-install',
      '# Reuse existing node when major version already matches',
      `if ${shellBinExists('node')}; then`,
      '  CUR="$(node -v 2>/dev/null | sed "s/^v//" || true)"',
      '  case "$CUR" in',
      '    ${MAJOR}.*)',
      '      mkdir -p "$DEST/bin"',
      `      NODE_BIN="$(${shellResolveBin('node')})"`,
      '      test -n "$NODE_BIN"',
      '      ln -sfn "$NODE_BIN" "$DEST/bin/node"',
      `      if ${shellBinExists('npm')}; then ln -sfn "$(${shellResolveBin('npm')})" "$DEST/bin/npm" || true; fi`,
      '      "$DEST/bin/node" -v',
      '      # fall through to companion tools (do not exit — plugins still run)',
      '      SKIP_NODE_TARBALL=1',
      '      ;;',
      '  esac',
      'fi',
      'if [ "${SKIP_NODE_TARBALL:-0}" != "1" ]; then',
      'case "$(uname -m)" in aarch64|arm64) ARCH=linux-arm64 ;; *) ARCH=linux-x64 ;; esac',
      'cd /tmp/ysk-node-install',
      'rm -f SHASUMS256.txt node.tgz',
      'curl -fsSL "https://nodejs.org/dist/latest-v${MAJOR}.x/SHASUMS256.txt" -o SHASUMS256.txt',
      '# Prefer .tar.gz (no xz dependency); fall back to .tar.xz',
      'TARBALL=$(grep -E "node-v${MAJOR}\\.[0-9]+\\.[0-9]+-${ARCH}\\.tar\\.gz$" SHASUMS256.txt | awk \'{print $2}\' | head -1)',
      'if [ -z "$TARBALL" ]; then',
      '  TARBALL=$(grep -E "node-v${MAJOR}\\.[0-9]+\\.[0-9]+-${ARCH}\\.tar\\.xz$" SHASUMS256.txt | awk \'{print $2}\' | head -1)',
      'fi',
      'if [ -n "$TARBALL" ]; then',
      '  curl -fsSL "https://nodejs.org/dist/latest-v${MAJOR}.x/$TARBALL" -o node.tgz',
      '  rm -rf "$DEST"',
      '  mkdir -p "$DEST"',
      '  if echo "$TARBALL" | grep -q "\\.xz$"; then tar -C "$DEST" --strip-components=1 -xJf node.tgz',
      '  else tar -C "$DEST" --strip-components=1 -xzf node.tgz; fi',
      '  ln -sfn "$DEST/bin/node" /usr/local/bin/node || true',
      '  ln -sfn "$DEST/bin/npm" /usr/local/bin/npm || true',
      '  ln -sfn "$DEST/bin/npx" /usr/local/bin/npx || true',
      '  "$DEST/bin/node" -v',
      'else',
      '  echo "official tarball resolve failed; trying NodeSource apt fallback" >&2',
      '  apt-get update -qq',
      '  curl -fsSL "https://deb.nodesource.com/setup_${MAJOR}.x" | bash -',
      '  apt-get install -y nodejs',
      '  node -v',
      '  mkdir -p "$DEST/bin"',
      `  NODE_BIN="$(${shellResolveBin('node')})"`,
      '  test -n "$NODE_BIN"',
      '  ln -sfn "$NODE_BIN" "$DEST/bin/node"',
      'fi',
      'fi', // SKIP_NODE_TARBALL
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0406', { v0: plan.version }));
  } else if (input.kind === 'php') {
    const plan = selectPhpRuntime(input.version);
    const resolved = resolvePhpAptPackages(plan.version, input.extensions);
    packages = resolved.packages;
    extensionIds = resolved.resolvedIds;
    const pkgLine = packages.map((p) => `'${p.replace(/'/g, '')}'`).join(' ');
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install PHP ${plan.version} + selected extensions`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update -qq',
      'apt-get install -y software-properties-common ca-certificates apt-transport-https 2>/dev/null || true',
      'add-apt-repository -y ppa:ondrej/php 2>/dev/null || echo "skip ondrej PPA (use distro packages)"',
      'apt-get update -qq',
      `PKGS=(${pkgLine})`,
      'echo "Installing: ${PKGS[*]}"',
      // Best-effort: install all selected; if a package is missing, retry without it once
      'if ! apt-get install -y "${PKGS[@]}"; then',
      '  echo "full set failed; installing packages one-by-one" >&2',
      '  for p in "${PKGS[@]}"; do apt-get install -y "$p" || echo "skip $p" >&2; done',
      'fi',
      `php${plan.version} -v`,
      `php${plan.version} -m 2>/dev/null | head -60 || true`,
      `systemctl enable --now php${plan.version}-fpm 2>/dev/null || systemctl enable --now php-fpm 2>/dev/null || true`,
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0407', { v0: plan.version }));
    // Package list also returned as result.packages for the panel
    if (packages.length) {
      notes.push(
        tl('notes.php.aptPackages', {
          count: packages.length,
          list: packages.slice(0, 14).join(', ') + (packages.length > 14 ? '…' : ''),
        }),
      );
    }
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
    // Panel version is minor (1.21); go.dev requires full patch (1.21.13) — resolve in script
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Go ${plan.version} (resolves patch from go.dev/dl)`,
      'set -euo pipefail',
      `VER=${JSON.stringify(plan.version)}`,
      `DEST=/usr/local/ysk/go/$VER`,
      'mkdir -p /usr/local/ysk/go /tmp/ysk-go-install',
      'cd /tmp/ysk-go-install',
      'case "$(uname -m)" in aarch64|arm64) GOARCH=linux-arm64 ;; *) GOARCH=linux-amd64 ;; esac',
      '# go.dev only publishes full versions: go1.21.13.linux-amd64.tar.gz — not go1.21.linux-amd64.tar.gz',
      'resolve_go_full() {',
      '  local minor="$1"',
      '  if echo "$minor" | grep -qE "^[0-9]+\\.[0-9]+\\.[0-9]+$"; then',
      '    echo "$minor"',
      '    return',
      '  fi',
      '  local json full',
      '  json=$(curl -fsSL "https://go.dev/dl/?mode=json" 2>/dev/null || true)',
      '  if [ -n "$json" ]; then',
      '    full=$(printf "%s" "$json" | python3 -c \'',
      'import json,sys,re',
      'minor=sys.argv[1]',
      'try:',
      '  data=json.load(sys.stdin)',
      'except Exception:',
      '  sys.exit(0)',
      'cands=[]',
      'for x in data:',
      '  v=str(x.get("version") or "")',
      '  if v.startswith("go"): v=v[2:]',
      '  if v==minor: cands.append(minor+".0")',
      '  elif v.startswith(minor+"."):',
      '    m=re.match(r"^(\\d+\\.\\d+\\.\\d+)", v)',
      '    if m: cands.append(m.group(1))',
      'if not cands: sys.exit(0)',
      'def key(s): return tuple(int(p) for p in s.split("."))',
      'print(sorted(cands, key=key)[-1])',
      `'\' "$minor" 2>/dev/null || true)',
      '  fi',
      '  if [ -n "${full:-}" ]; then',
      '    echo "$full"',
      '    return',
      '  fi',
      '  # go.dev/dl/?mode=json often only lists current stable lines — use last-known patch table',
      '  case "$minor" in',
      goLastKnownPatchShellCase(),
      '    *) echo "${minor}.0" ;;',
      '  esac',
      '}',
      'FULL_VER=$(resolve_go_full "$VER")',
      'echo "YSK_GO_PANEL_VERSION=$VER"',
      'echo "YSK_GO_DOWNLOAD_VERSION=$FULL_VER"',
      'URL="https://go.dev/dl/go${FULL_VER}.${GOARCH}.tar.gz"',
      'echo "YSK_GO_DOWNLOAD_URL=$URL"',
      'if ! curl -fsSL "$URL" -o go.tgz; then',
      '  echo "Go download failed (HTTP error). Panel version=$VER download=$FULL_VER arch=$GOARCH" >&2',
      '  echo "Hint: go.dev requires a full patch version (e.g. 1.21.13), not minor-only (1.21)." >&2',
      '  exit 22',
      'fi',
      'rm -rf "$DEST"',
      'mkdir -p "$DEST"',
      'tar -C "$DEST" --strip-components=1 -xzf go.tgz',
      'ln -sfn "$DEST/bin/go" /usr/local/bin/go || true',
      '# Symlink for tools that look at /usr/local/ysk/go/bin',
      'mkdir -p /usr/local/ysk/go/bin',
      'ln -sfn "$DEST/bin/go" /usr/local/ysk/go/bin/go || true',
      '"$DEST/bin/go" version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0409', { v0: plan.version }));
    notes.push(
      'Go tarball uses full patch from go.dev/dl JSON (minor-only URLs 404)',
    );
  } else if (input.kind === 'rust') {
    const plan = selectRustRuntime(input.version);
    // rustup needs a channel/toolchain id; panel pins like "1.78" are valid.
    // Layout matches runtime-plugins probe: RUSTUP_HOME=…/rustup CARGO_HOME=…/cargo
    // (putting both on the same dir leaves rustup off PATH after partial installs.)
    const tc = plan.version === 'stable' ? 'stable' : plan.version;
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Rust (${plan.version}) via rustup`,
      'set -euo pipefail',
      'export RUSTUP_HOME=/usr/local/ysk/rust/rustup',
      'export CARGO_HOME=/usr/local/ysk/rust/cargo',
      'mkdir -p "$RUSTUP_HOME" "$CARGO_HOME" /usr/local/ysk/rust/bin',
      'export PATH="$CARGO_HOME/bin:$RUSTUP_HOME/bin:/usr/local/ysk/rust/bin:$PATH"',
      'ysk_rustup_bin() {',
      '  if [ -x "$CARGO_HOME/bin/rustup" ]; then echo "$CARGO_HOME/bin/rustup"; return; fi',
      '  if [ -x /usr/local/ysk/rust/bin/rustup ]; then echo /usr/local/ysk/rust/bin/rustup; return; fi',
      '  command -v rustup 2>/dev/null || true',
      '}',
      'RU="$(ysk_rustup_bin)"',
      'if [ -z "$RU" ]; then',
      '  echo "YSK_RUST_INSTALLING_RUSTUP"',
      // Install without default first, then set toolchain explicitly (clearer errors)
      '  curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path --default-toolchain none',
      '  RU="$(ysk_rustup_bin)"',
      'fi',
      'if [ -z "$RU" ] || [ ! -x "$RU" ]; then',
      '  echo "rustup missing after install (RUSTUP_HOME=$RUSTUP_HOME CARGO_HOME=$CARGO_HOME)" >&2',
      '  exit 1',
      'fi',
      'echo "YSK_RUSTUP=$RU"',
      `TC=${JSON.stringify(tc)}`,
      'echo "YSK_RUST_TOOLCHAIN=$TC"',
      // Install pin/channel then make it default so bare cargo works
      '"$RU" toolchain install "$TC"',
      '"$RU" default "$TC"',
      '"$RU" show',
      // Symlinks for panel probe + /usr/local/bin
      'ln -sfn "$CARGO_HOME/bin/rustup" /usr/local/ysk/rust/bin/rustup 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/cargo" /usr/local/ysk/rust/bin/cargo 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/rustc" /usr/local/ysk/rust/bin/rustc 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/cargo" /usr/local/bin/cargo 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/rustc" /usr/local/bin/rustc 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/rustup" /usr/local/bin/rustup 2>/dev/null || true',
      // Prefer explicit toolchain run (does not depend on default alone)
      '"$RU" run "$TC" cargo --version',
      '"$RU" run "$TC" rustc --version',
      'cargo --version',
      'rustc --version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0410', { v0: plan.version }));
    notes.push(
      'Rust install uses rustup under /usr/local/ysk/rust/{rustup,cargo}; sets default toolchain',
    );
  } else if (input.kind === 'java') {
    const plan = selectJavaRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install OpenJDK ${plan.version}`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'apt-get update -qq',
      `if ! apt-get install -y openjdk-${plan.version}-jdk; then`,
      '  apt-get install -y openjdk-17-jdk',
      'fi',
      'java -version',
      'javac -version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0412', { v0: plan.version }));
  } else if (input.kind === 'kotlin') {
    const plan = selectKotlinRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Kotlin ${plan.version} (requires JDK)`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      `if ! ${shellBinExists('java')}; then apt-get update -qq && apt-get install -y openjdk-21-jdk; fi`,
      `VER=${plan.version}`,
      'DEST=/usr/local/ysk/kotlin',
      'TMP=$(mktemp -d)',
      'mkdir -p /usr/local/ysk /usr/local/bin',
      'URL="https://github.com/JetBrains/kotlin/releases/download/v${VER}/kotlin-compiler-${VER}.zip"',
      'curl -fsSL "$URL" -o "$TMP/kotlin.zip" || {',
      '  VER=2.0.21',
      '  URL="https://github.com/JetBrains/kotlin/releases/download/v${VER}/kotlin-compiler-${VER}.zip"',
      '  curl -fsSL "$URL" -o "$TMP/kotlin.zip"',
      '}',
      'rm -rf "$DEST"',
      'mkdir -p "$DEST" "$TMP/out"',
      'if command -v unzip >/dev/null 2>&1; then unzip -q "$TMP/kotlin.zip" -d "$TMP/out";',
      'else python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP/kotlin.zip" "$TMP/out"; fi',
      'if [ -d "$TMP/out/kotlinc" ]; then cp -a "$TMP/out/kotlinc/." "$DEST/"; else cp -a "$TMP/out/." "$DEST/"; fi',
      'ln -sfn "$DEST/bin/kotlin" /usr/local/bin/kotlin || true',
      'ln -sfn "$DEST/bin/kotlinc" /usr/local/bin/kotlinc || true',
      'rm -rf "$TMP"',
      'kotlinc -version || kotlin -version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0413', { v0: plan.version }));
  } else if (input.kind === 'bun') {
    const plan = selectBunRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Bun (${plan.version})`,
      'set -euo pipefail',
      'export BUN_INSTALL=/usr/local/ysk/bun',
      'mkdir -p /usr/local/ysk/bun /usr/local/bin',
      'curl -fsSL https://bun.sh/install | bash',
      'ln -sfn /usr/local/ysk/bun/bin/bun /usr/local/bin/bun || true',
      'export PATH="/usr/local/bin:/usr/local/ysk/bun/bin:$PATH"',
      'bun --version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0414', { v0: plan.version }));
  } else {
    throw new Error(`unsupported runtime kind: ${input.kind}`);
  }

  // Companion plugins (pm2, poetry, maven, …) — all kinds except pure PHP extensions path
  // PHP uses `extensions` for apt modules; other kinds use `plugins`.
  if (input.kind !== 'php') {
    const built = buildRuntimePluginScriptLines(input.kind, input.plugins);
    pluginIds = built.ids;
    if (built.lines.length) {
      script = script.replace(/\n$/, '') + '\n' + built.lines.join('\n') + '\n';
      notes.push(
        tl('notes.runtime.plugins', {
          list: built.labels.join(', ') || built.ids.join(', '),
        }),
      );
    }
  }

  const scriptPath = join(dir, 'install.sh');
  writeFileSync(scriptPath, script, 'utf8');
  written.push(scriptPath);
  notes.push(tl('notes.auto.n0762'));

  const want = Boolean(input.install);
  const execOn = input.host.executeEnabled();
  const rootOn = input.host.isRoot();
  const can = want && execOn && rootOn;
  let blocked = false;
  let blockMessage: string | undefined;

  if (want && !can) {
    blocked = true;
    if (!execOn) {
      blockMessage = tl('ops.blocked.install');
    } else if (!rootOn) {
      blockMessage = tl('notes.auto.n1582');
    } else {
      blockMessage = tl('ops.blocked.panel');
    }
    // Lead with the real reason so panels / 422 first-note fallback stay honest
    notes.unshift(blockMessage);
  }

  if (can) {
    const r = await input.host.runCommand(['bash', scriptPath], { timeoutMs: 600_000 });
    commandResults.push({
      argv: ['bash', scriptPath],
      exitCode: r.exitCode,
      stderr: r.stderr,
    });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`;
    const pluginFailMatch = out.match(/YSK_PLUGIN_FAILED:([^\n]+)/);
    const pluginFailed = pluginFailMatch
      ? pluginFailMatch[1]!
          .trim()
          .split(/\s+/)
          .filter(Boolean)
      : [];
    // exit 3 = runtime ok-ish but plugins failed; other non-zero = hard fail
    if (r.exitCode === 0) {
      notes.push(tl('notes.auto.n0656'));
      if (pluginIds?.length) notes.push(tl('notes.runtime.pluginsOk'));
    } else if (r.exitCode === 3 && pluginFailed.length) {
      notes.push(tl('notes.auto.n0656'));
      notes.unshift(
        tl('notes.runtime.pluginsFailed', { list: pluginFailed.join(', ') }),
      );
    } else {
      const detail = summarizeInstallLog(r.stderr || '', r.stdout || '') || String(r.exitCode);
      const failNote = tl('notes.auto.t0411', { v0: detail });
      notes.unshift(failNote);
      if (pluginFailed.length) {
        notes.push(tl('notes.runtime.pluginsFailed', { list: pluginFailed.join(', ') }));
      }
    }
  }

  const hardFail = commandResults.some((c) => c.exitCode !== 0 && c.exitCode !== 3);
  const pluginPartial = commandResults.some((c) => c.exitCode === 3);
  // Runtime install ok if hard success OR plugin-only partial (exit 3)
  const ranOk =
    commandResults.length === 0 ||
    commandResults.every((c) => c.exitCode === 0) ||
    (pluginPartial && !hardFail);
  return {
    ok: want ? can && ranOk && !pluginPartial : true,
    kind: input.kind,
    version: input.version,
    written,
    notes,
    commandResults,
    requiresExecute: !execOn,
    requiresRoot: !rootOn,
    blocked: want ? blocked : false,
    blockMessage: want ? blockMessage : undefined,
    packages,
    extensionIds,
    pluginIds,
  };
}
