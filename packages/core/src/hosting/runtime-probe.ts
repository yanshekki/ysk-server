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
import { getCachedRuntimeVersionPins } from './version-discovery.js';
import { withHostMutatingJob } from '../host/host-job.js';

export interface RuntimeProbeItem {
  kind: RuntimeKind;
  version: string;
  binaryPath: string;
  available: boolean;
  /** On PATH / rustup default / go active symlink (only one per kind typically) */
  active?: boolean;
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

/** Managed Go roots: /usr/local/ysk/go/<minor>/bin/go */
async function probeGoVersions(
  host: HostExecutor,
  versions: string[],
  hostDefault?: string,
): Promise<RuntimeProbeItem[]> {
  const out: RuntimeProbeItem[] = [];
  // Resolve active go on PATH
  let activeMinor: string | undefined;
  if (hostDefault) {
    const m = hostDefault.match(/go(\d+\.\d+)/);
    if (m) activeMinor = m[1];
  }
  // Dedup by minor pin (1.26.5 and 1.26 → one slot under /usr/local/ysk/go/1.26)
  const minorPins = [
    ...new Set(
      versions
        .map((v) => v.replace(/^go/i, '').match(/^(\d+\.\d+)/)?.[1] ?? '')
        .filter(Boolean),
    ),
  ];
  for (const minor of minorPins) {
    const plan = selectGoRuntime(minor);
    let available = false;
    let resolvedPath: string | undefined;
    let versionOutput: string | undefined;
    const notes: string[] = [];
    // Prefer managed multi-version path
    if (host.pathExists(plan.binaryPath)) {
      const ver = await host.runCommand([plan.binaryPath, 'version'], { timeoutMs: 8_000 });
      if (ver.exitCode === 0) {
        available = true;
        resolvedPath = plan.binaryPath;
        versionOutput = (ver.stdout || ver.stderr).trim().split('\n')[0];
      }
    }
    // Host default only counts as this minor when version string matches
    if (
      !available &&
      hostDefault &&
      (hostDefault.includes(`go${minor}`) ||
        new RegExp(`\\bgo?${minor.replace('.', '\\.')}(?:\\.|\\s|$)`).test(hostDefault))
    ) {
      available = true;
      versionOutput = hostDefault;
      notes.push(tl('notes.auto.n1302'));
    }
    if (!available) notes.push(tl('notes.auto.t0395', { v0: plan.binaryPath }));
    const active = Boolean(available && activeMinor === minor);
    out.push({
      kind: 'go',
      version: minor,
      binaryPath: plan.binaryPath,
      available,
      active,
      resolvedPath,
      versionOutput,
      notes,
    });
  }
  // If only one available and PATH matches that install, mark active
  const avail = out.filter((i) => i.available);
  if (avail.length === 1 && hostDefault && !out.some((i) => i.active)) {
    avail[0]!.active = true;
  }
  return out;
}

/**
 * Parse `rustup toolchain list` lines into toolchain ids + default.
 * Examples: "stable-x86_64-unknown-linux-gnu (default)", "1.78.0-x86_64-..."
 */
export function parseRustupToolchainList(text: string): {
  ids: string[];
  defaultId?: string;
} {
  const ids: string[] = [];
  let defaultId: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('YSK_') || line.startsWith('#')) continue;
    // skip cargo version lines
    if (/^cargo\s+/i.test(line)) continue;
    const def = /\(default\)/i.test(line);
    const id = line.replace(/\s*\(default\)\s*/i, '').trim().split(/\s+/)[0] ?? '';
    if (!id || !/^[a-zA-Z0-9._-]+$/.test(id)) continue;
    if (!ids.includes(id)) ids.push(id);
    if (def) defaultId = id;
  }
  return { ids, defaultId };
}

/** Whether panel pin (stable | 1.78) is present in rustup toolchain ids. */
export function rustPanelVersionInstalled(
  panelVer: string,
  toolchainIds: string[],
): boolean {
  const v = panelVer.trim().toLowerCase();
  if (!v) return false;
  if (v === 'stable') {
    return toolchainIds.some((id) => id === 'stable' || id.startsWith('stable-'));
  }
  // 1.78 → 1.78, 1.78.0-x86_64-..., 1.78-x86_64-...
  return toolchainIds.some((id) => {
    const base = id.split('-')[0] ?? id;
    return base === v || base.startsWith(`${v}.`);
  });
}

export function rustPanelVersionIsDefault(
  panelVer: string,
  defaultId: string | undefined,
): boolean {
  if (!defaultId) return false;
  const v = panelVer.trim().toLowerCase();
  const d = defaultId.toLowerCase();
  if (v === 'stable') return d === 'stable' || d.startsWith('stable-');
  const base = d.split('-')[0] ?? d;
  return base === v || base.startsWith(`${v}.`);
}

/**
 * Managed rustup: list installed toolchains; stable + minor pins can coexist.
 * Scans new layout, legacy single-dir layout, and verifies with `rustup run`.
 */
async function probeRustVersions(
  host: HostExecutor,
  versions: string[],
  hostDefault?: string,
): Promise<RuntimeProbeItem[]> {
  // Probe both current layout and legacy RUSTUP_HOME=/usr/local/ysk/rust (pre-split)
  const shell = [
    'set +e',
    'export PATH="/usr/local/ysk/rust/cargo/bin:/usr/local/ysk/rust/bin:/usr/local/ysk/rust/rustup/bin:$HOME/.cargo/bin:$PATH"',
    'RU=""',
    'for c in /usr/local/ysk/rust/cargo/bin/rustup /usr/local/ysk/rust/bin/rustup /usr/local/ysk/rust/rustup/bin/rustup; do',
    '  [ -x "$c" ] && RU="$c" && break',
    'done',
    '[ -z "$RU" ] && RU=$(command -v rustup 2>/dev/null || true)',
    'echo "YSK_RUSTUP=${RU:-}"',
    // Collect toolchains from every known RUSTUP_HOME (install may have used either layout)
    'echo "YSK_TOOLCHAIN_LIST_BEGIN"',
    'if [ -n "$RU" ]; then',
    '  for RH in /usr/local/ysk/rust/rustup /usr/local/ysk/rust "$HOME/.rustup"; do',
    '    [ -d "$RH" ] || continue',
    '    export RUSTUP_HOME="$RH"',
    '    # Prefer matching CARGO_HOME next to managed tree',
    '    if [ "$RH" = /usr/local/ysk/rust/rustup ]; then export CARGO_HOME=/usr/local/ysk/rust/cargo',
    '    elif [ "$RH" = /usr/local/ysk/rust ]; then export CARGO_HOME=/usr/local/ysk/rust',
    '    else export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"; fi',
    '    echo "YSK_RH=$RH"',
    '    "$RU" toolchain list 2>/dev/null',
    '    echo -n "YSK_DEFAULT_FOR_RH="',
    '    "$RU" show active-toolchain 2>/dev/null | head -1',
    '    echo',
    '    # Directory scan (authoritative when rustup list is empty/wrong home)',
    '    if [ -d "$RH/toolchains" ]; then',
    '      for d in "$RH/toolchains"/*; do',
    '        [ -d "$d" ] || continue',
    '        echo "YSK_DIR_TC=$(basename "$d")"',
    '      done',
    '    fi',
    '  done',
    'fi',
    'echo "YSK_TOOLCHAIN_LIST_END"',
    // Per-panel-version verify via rustup run (works even if not default)
    'if [ -n "$RU" ]; then',
    `  for TC in ${versions.map((v) => JSON.stringify(v)).join(' ')}; do`,
    '    echo -n "YSK_RUN_${TC}="',
    '    ok=""',
    '    for RH in /usr/local/ysk/rust/rustup /usr/local/ysk/rust "$HOME/.rustup"; do',
    '      [ -d "$RH" ] || continue',
    '      export RUSTUP_HOME="$RH"',
    '      if [ "$RH" = /usr/local/ysk/rust/rustup ]; then export CARGO_HOME=/usr/local/ysk/rust/cargo',
    '      elif [ "$RH" = /usr/local/ysk/rust ]; then export CARGO_HOME=/usr/local/ysk/rust',
    '      else export CARGO_HOME="${CARGO_HOME:-$HOME/.cargo}"; fi',
    '      out=$("$RU" run "$TC" cargo --version 2>/dev/null) && { ok="$out"; break; }',
    '    done',
    '    echo "$ok"',
    '  done',
    'fi',
    'command -v cargo >/dev/null 2>&1 && echo "YSK_PATH_CARGO=$(cargo --version 2>/dev/null)"',
  ].join('\n');

  let listOut = '';
  try {
    const r = await host.runCommand(['bash', '-c', shell], { timeoutMs: 45_000 });
    listOut = `${r.stdout || ''}\n${r.stderr || ''}`;
  } catch {
    listOut = '';
  }

  const listMatch = listOut.match(
    /YSK_TOOLCHAIN_LIST_BEGIN\r?\n([\s\S]*?)\r?\nYSK_TOOLCHAIN_LIST_END/,
  );
  const block = listMatch?.[1] ?? listOut;
  const parsed = parseRustupToolchainList(block);
  // Also fold YSK_DIR_TC= lines
  for (const line of block.split(/\r?\n/)) {
    const m = line.trim().match(/^YSK_DIR_TC=(.+)$/);
    if (m?.[1] && !parsed.ids.includes(m[1])) parsed.ids.push(m[1]);
  }
  // Default from first YSK_DEFAULT_FOR_RH= with content, or (default) in list
  const defaultFromRh = [...block.matchAll(/YSK_DEFAULT_FOR_RH=(.+)/g)]
    .map((m) => m[1]?.trim())
    .find((s) => s && s.length > 0);
  if (defaultFromRh) parsed.defaultId = defaultFromRh.split(/\s+/)[0];

  // rustup run results for panel pins
  const runOk = new Map<string, string>();
  for (const v of versions) {
    const key = v === 'stable' ? 'stable' : v;
    // Match YSK_RUN_1.78=...  (dot in name)
    const re = new RegExp(
      `YSK_RUN_${key.replace(/\./g, '\\.')}=(.+)`,
    );
    const m = listOut.match(re);
    const val = m?.[1]?.trim();
    if (val && /cargo\s+\d/i.test(val)) runOk.set(v, val);
  }

  const out: RuntimeProbeItem[] = [];
  for (const v of versions) {
    const plan = selectRustRuntime(v);
    let available =
      rustPanelVersionInstalled(v, parsed.ids) || runOk.has(v);
    let versionOutput = runOk.get(v);
    const notes: string[] = [];

    // PATH cargo → only attribute to default toolchain (or stable if unknown)
    if (!available && hostDefault && /cargo\s+\d/i.test(hostDefault)) {
      if (rustPanelVersionIsDefault(v, parsed.defaultId) || (v === 'stable' && !parsed.defaultId && parsed.ids.length === 0)) {
        available = true;
        versionOutput = hostDefault;
        notes.push(tl('notes.auto.n1302'));
      }
    }

    if (available && !versionOutput) {
      versionOutput =
        v === 'stable' && hostDefault
          ? hostDefault
          : `toolchain ${v}${parsed.ids.find((id) => rustPanelVersionInstalled(v, [id])) ? ` (${parsed.ids.find((id) => rustPanelVersionInstalled(v, [id]))})` : ''}`;
    }
    if (!available) notes.push(tl('notes.auto.t0395', { v0: plan.binaryPath }));

    out.push({
      kind: 'rust',
      version: v,
      binaryPath: plan.binaryPath,
      available,
      active: available && rustPanelVersionIsDefault(v, parsed.defaultId),
      versionOutput,
      notes,
    });
  }

  // PATH-only cargo (no rustup homes): mark stable only
  if (!out.some((i) => i.available) && hostDefault && /cargo\s+\d/i.test(hostDefault)) {
    const stable = out.find((i) => i.version === 'stable');
    if (stable) {
      stable.available = true;
      stable.active = true;
      stable.versionOutput = hostDefault;
      stable.notes = [tl('notes.auto.n1302')];
    }
  }

  const avail = out.filter((i) => i.available);
  if (avail.length === 1 && !out.some((i) => i.active)) avail[0]!.active = true;
  // Prefer explicit default over heuristic
  if (parsed.defaultId) {
    for (const i of out) {
      i.active = i.available && rustPanelVersionIsDefault(i.version, parsed.defaultId);
    }
  }
  return out;
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
          // Only versioned binary (python3.14). Bare `python3` is often still 3.12 and
          // must not be used to decide whether 3.14 is installed.
          ? [`python${v}`]
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
/** Scan managed install dirs + host version strings (no hardcoded pin tables). */
async function listDirVersions(
  host: HostExecutor,
  dir: string,
  pattern: RegExp,
): Promise<string[]> {
  try {
    const r = await host.runCommand(
      ['bash', '-c', `ls -1 ${JSON.stringify(dir)} 2>/dev/null || true`],
      { timeoutMs: 5_000 },
    );
    return (r.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => pattern.test(s));
  } catch {
    return [];
  }
}

/**
 * Discover multi-version binaries already on the host (e.g. python3.14, php8.3).
 * Expands probe pins so post-install refresh lists the new version.
 *
 * NOTE: deadsnakes / distro name binaries as `python3.14` (major.minor after "python"),
 * NOT `python3.` + extra `x.y`. Wrong sed never finds 3.14 after a successful install.
 */
async function listHostVersionedBins(
  host: HostExecutor,
  kind: 'python' | 'php' | 'node',
): Promise<string[]> {
  let cmd: string;
  if (kind === 'python') {
    // /usr/bin/python3.12 → 3.12 ; /usr/bin/python3.14 → 3.14
    // (binary name is python + major.minor, not python3 + .x.y)
    cmd =
      'ls -1 /usr/bin/python[0-9]* /usr/local/bin/python[0-9]* 2>/dev/null | sed -n "s|.*/python\\([0-9][0-9]*\\.[0-9][0-9]*\\)$|\\1|p"';
  } else if (kind === 'php') {
    cmd =
      'ls -1 /usr/bin/php[0-9]* /usr/local/bin/php[0-9]* 2>/dev/null | sed -n "s|.*/php\\([0-9][0-9]*\\.[0-9][0-9]*\\)$|\\1|p"';
  } else {
    cmd =
      'ls -1 /usr/local/ysk/node 2>/dev/null; ls -1 /usr/bin/node[0-9]* /usr/local/bin/node[0-9]* 2>/dev/null | sed -n "s|.*/node\\([0-9][0-9]*\\)$|\\1|p"';
  }
  try {
    const r = await host.runCommand(['bash', '-c', `${cmd} || true`], { timeoutMs: 5_000 });
    return [
      ...new Set(
        (r.stdout || '')
          .split('\n')
          .map((s) => s.trim())
          .filter((s) =>
            kind === 'node' ? /^\d+$/.test(s) : /^\d+\.\d+$/.test(s),
          ),
      ),
    ];
  } catch {
    return [];
  }
}

function extractPin(kind: string, versionText?: string): string | undefined {
  if (!versionText) return undefined;
  if (kind === 'node') return versionText.replace(/^v/i, '').match(/^(\d+)/)?.[1];
  if (kind === 'go') return versionText.replace(/^go/i, '').match(/(\d+\.\d+)/)?.[1];
  if (kind === 'php' || kind === 'python')
    return versionText.match(/(\d+\.\d+)/)?.[1];
  if (kind === 'java') {
    const m = versionText.match(/version "?(\d+)/) || versionText.match(/(\d+)\.\d+\.\d+/);
    return m?.[1];
  }
  if (kind === 'kotlin') return versionText.match(/(\d+\.\d+\.\d+)/)?.[1];
  if (kind === 'bun') return versionText.match(/(\d+\.\d+[\w.-]*)/)?.[1] || 'latest';
  if (kind === 'rust') return versionText.match(/(\d+\.\d+\.\d+)/)?.[1] || 'stable';
  return undefined;
}

export async function probeRuntimes(
  host: HostExecutor,
  opts?: { dataDir?: string },
): Promise<RuntimeProbeReport> {
  // Installable list from listSupportedRuntimes is empty by design.
  // Merge disk discovery cache + host bins so post-install pins (e.g. 3.14) are probed.
  const supported = listSupportedRuntimes();
  const cachePins = (kind: RuntimeKind): string[] =>
    opts?.dataDir ? getCachedRuntimeVersionPins(opts.dataDir, kind) : [];
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

  const nodePins = [
    ...new Set([
      ...supported.node,
      ...cachePins('node'),
      ...(await listDirVersions(host, '/usr/local/ysk/node', /^\d+$/)),
      ...(await listHostVersionedBins(host, 'node')),
      extractPin('node', hostNode),
    ].filter(Boolean) as string[]),
  ];
  const phpPins = [
    ...new Set([
      ...supported.php,
      ...cachePins('php'),
      ...(await listHostVersionedBins(host, 'php')),
      extractPin('php', hostPhp),
    ].filter(Boolean) as string[]),
  ];
  const pythonPins = [
    ...new Set([
      ...supported.python,
      ...cachePins('python'),
      ...(await listHostVersionedBins(host, 'python')),
      extractPin('python', hostPython),
    ].filter(Boolean) as string[]),
  ];
  const goPins = [
    ...new Set([
      ...supported.go,
      ...cachePins('go'),
      ...(await listDirVersions(host, '/usr/local/ysk/go', /^\d+\.\d+/)),
      extractPin('go', hostGo),
    ].filter(Boolean) as string[]),
  ];
  const rustPins = [
    ...new Set([
      ...supported.rust,
      ...cachePins('rust'),
      'stable',
      extractPin('rust', hostRust),
    ].filter(Boolean) as string[]),
  ];
  const javaPins = [
    ...new Set([
      ...supported.java,
      ...cachePins('java'),
      extractPin('java', hostJava),
    ].filter(Boolean) as string[]),
  ];
  const kotlinPins = [
    ...new Set([
      ...supported.kotlin,
      ...cachePins('kotlin'),
      extractPin('kotlin', hostKotlin),
    ].filter(Boolean) as string[]),
  ];
  const bunPins = [
    ...new Set([
      ...supported.bun,
      ...cachePins('bun'),
      'latest',
      extractPin('bun', hostBun),
    ].filter(Boolean) as string[]),
  ];

  const node = await probeBinaryVersions(
    host,
    'node',
    nodePins,
    selectNodeRuntime,
    (p) => [p, '-v'],
    (out, v) => new RegExp(`v?${v}\\b`).test(out),
    hostNode,
  );

  const php = await probeBinaryVersions(
    host,
    'php',
    phpPins,
    selectPhpRuntime,
    (p) => [p, '-v'],
    (out, v) => out.includes(v),
    hostPhp,
  );

  const python = await probeBinaryVersions(
    host,
    'python',
    pythonPins,
    selectPythonRuntime,
    (p) => [p, '--version'],
    (out, v) => out.includes(v),
    hostPython,
  );

  // Go: multi-version under /usr/local/ysk/go/<minor>/ — probe each path; active = PATH go matches
  const go = await probeGoVersions(host, goPins, hostGo);

  // Rust: multi-toolchain via rustup; pins stay installed even when not default
  const rust = await probeRustVersions(host, rustPins, hostRust);

  const java = await probeBinaryVersions(
    host,
    'java',
    javaPins,
    selectJavaRuntime,
    (p) => [p, '-version'],
    (out, v) => out.includes(`"${v}`) || out.includes(`version ${v}`) || new RegExp(`\\b${v}\\b`).test(out),
    hostJava,
  );

  const kotlin = await probeBinaryVersions(
    host,
    'kotlin',
    kotlinPins,
    selectKotlinRuntime,
    (p) => [p, '-version'],
    (out, v) => out.includes(v) || /kotlinc/i.test(out),
    hostKotlin,
  );

  const bun = await probeBinaryVersions(
    host,
    'bun',
    bunPins,
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
  /** Packages that failed during install (e.g. PHP ext version skew) */
  failedPackages?: string[];
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
  /**
   * Live install log lines (stdout/stderr). When provided, host.runCommand uses spawn stream.
   */
  onLog?: (ev: { stream: 'stdout' | 'stderr'; line: string }) => void;
  /** Abort long install (SSE disconnect). */
  abortSignal?: AbortSignal;
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
      // Verify requested major is what we got (no silent wrong major)
      '  NODE_V="$("$DEST/bin/node" -v 2>/dev/null | sed "s/^v//" || true)"',
      '  case "$NODE_V" in',
      '    ${MAJOR}.*) ;;',
      '    *) echo "node major mismatch: wanted ${MAJOR} got ${NODE_V:-missing}" >&2; exit 32 ;;',
      '  esac',
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
    // packages.sury.org/php is the only supported upstream (ondrej Launchpad PPA archived).
    // Mixed ondrej+sury indexes cause phpX.Y-common version mismatches on extensions
    // (e.g. common from sury, bz2 wants Launchpad gbp build of the same 8.5.9).
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install PHP ${plan.version} + selected extensions (sury.org only)`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'export LC_ALL=C',
      `PHP_VER=${JSON.stringify(plan.version)}`,
      '',
      '# —— Single origin: packages.sury.org/php (purge Launchpad ondrej remnants) ——',
      'rm -f /etc/apt/sources.list.d/ondrej-ubuntu-php*.list 2>/dev/null || true',
      'rm -f /etc/apt/sources.list.d/ondrej-php*.list 2>/dev/null || true',
      'rm -f /etc/apt/sources.list.d/*ondrej*php* 2>/dev/null || true',
      'rm -f /etc/apt/sources.list.d/ondrej-ubuntu-php*.sources 2>/dev/null || true',
      'rm -f /etc/apt/sources.list.d/php-sury.list 2>/dev/null || true',
      'if [ -d /etc/apt/sources.list.d ]; then',
      '  for f in /etc/apt/sources.list.d/*; do',
      '    [ -f "$f" ] || continue',
      '    if grep -qiE "ppa\\.launchpad\\.(net|content\\.com)/ondrej/php|launchpadcontent\\.com/ondrej/php|ondrej/php" "$f" 2>/dev/null; then',
      '      echo "YSK_PHP_DROP_SOURCE $f"',
      '      rm -f "$f"',
      '    fi',
      '  done',
      'fi',
      '',
      'apt-get install -y lsb-release ca-certificates curl gnupg 2>/dev/null || true',
      '',
      'setup_sury_php() {',
      '  curl -fsSLo /tmp/debsuryorg-archive-keyring.deb https://packages.sury.org/debsuryorg-archive-keyring.deb',
      '  dpkg -i /tmp/debsuryorg-archive-keyring.deb',
      '  CODENAME=$(lsb_release -sc 2>/dev/null || true)',
      '  if [ -z "$CODENAME" ]; then',
      '    # shellcheck disable=SC1091',
      '    . /etc/os-release 2>/dev/null || true',
      '    CODENAME="${VERSION_CODENAME:-}"',
      '  fi',
      '  if [ -z "$CODENAME" ]; then',
      '    echo "cannot detect distro codename for sury.org" >&2',
      '    return 1',
      '  fi',
      '  echo "deb [signed-by=/usr/share/keyrings/debsuryorg-archive-keyring.gpg] https://packages.sury.org/php/ ${CODENAME} main" > /etc/apt/sources.list.d/php.list',
      '  # Prefer sury origin; demote any leftover Launchpad PHP indexes',
      '  mkdir -p /etc/apt/preferences.d',
      '  cat > /etc/apt/preferences.d/ysk-php-sury.pref <<\'PREF\'',
      'Package: php* libapache2-mod-php* php-*',
      'Pin: origin packages.sury.org',
      'Pin-Priority: 1001',
      '',
      'Package: php* libapache2-mod-php* php-*',
      'Pin: release o=LP-PPA-ondrej-php',
      'Pin-Priority: -1',
      '',
      'Package: php* libapache2-mod-php* php-*',
      'Pin: release o=LP-PPA-ondrej-php-ubuntu-*',
      'Pin-Priority: -1',
      'PREF',
      '  apt-get update -qq',
      '}',
      '',
      'echo "YSK_PHP_SETUP=packages.sury.org/php"',
      'if ! setup_sury_php; then',
      '  echo "sury.org setup failed" >&2',
      '  exit 31',
      'fi',
      '',
      `PKGS=(${pkgLine})`,
      'echo "Installing: ${PKGS[*]}"',
      // Align entire phpX.Y stack to ONE candidate from sury (fixes common≠ext version)
      'ysk_php_install_set() {',
      '  local cand pinned=() p v',
      '  cand=$(apt-cache policy "php${PHP_VER}-common" 2>/dev/null | awk \'/Candidate:/{print $2; exit}\')',
      '  echo "YSK_PHP_COMMON_CANDIDATE=${cand:-(none)}"',
      '  if [ -n "${cand:-}" ] && [ "$cand" != "(none)" ]; then',
      '    for p in "php${PHP_VER}-common" "php${PHP_VER}-cli" "php${PHP_VER}-fpm"; do',
      '      pinned+=("${p}=${cand}")',
      '    done',
      '    # Reinstall core at candidate first so extensions can match',
      '    apt-get install -y --allow-downgrades --allow-change-held-packages "${pinned[@]}" || true',
      '  fi',
      '  pinned=()',
      '  for p in "${PKGS[@]}"; do',
      '    v=$(apt-cache policy "$p" 2>/dev/null | awk \'/Candidate:/{print $2; exit}\')',
      '    if [ -n "${v:-}" ] && [ "$v" != "(none)" ]; then',
      '      pinned+=("${p}=${v}")',
      '    else',
      '      pinned+=("$p")',
      '    fi',
      '  done',
      '  echo "YSK_PHP_PINNED=${pinned[*]}"',
      '  apt-get install -y --allow-downgrades --allow-change-held-packages "${pinned[@]}"',
      '}',
      '',
      'FAILED=()',
      'if ! ysk_php_install_set; then',
      '  echo "full set failed; installing packages one-by-one with pin" >&2',
      '  for p in "${PKGS[@]}"; do',
      '    v=$(apt-cache policy "$p" 2>/dev/null | awk \'/Candidate:/{print $2; exit}\')',
      '    if [ -n "${v:-}" ] && [ "$v" != "(none)" ]; then',
      '      if ! apt-get install -y --allow-downgrades --allow-change-held-packages "${p}=${v}"; then',
      '        FAILED+=("$p")',
      '        echo "skip $p (wanted $v)" >&2',
      '      fi',
      '    else',
      '      if ! apt-get install -y "$p"; then',
      '        FAILED+=("$p")',
      '        echo "skip $p" >&2',
      '      fi',
      '    fi',
      '  done',
      'fi',
      `if ! php${plan.version} -v; then`,
      '  echo "PHP binary missing after install — sury packages may not support this minor on this distro" >&2',
      '  exit 32',
      'fi',
      `php${plan.version} -m 2>/dev/null | head -60 || true`,
      `systemctl enable --now php${plan.version}-fpm 2>/dev/null || systemctl enable --now php-fpm 2>/dev/null || true`,
      'if [ "${#FAILED[@]}" -gt 0 ]; then',
      '  echo "YSK_PHP_EXT_FAILED: ${FAILED[*]}" >&2',
      '  echo "Some PHP packages could not be installed (version skew / missing). Core CLI may work." >&2',
      '  exit 33',
      'fi',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0407', { v0: plan.version }));
    notes.push('source=packages.sury.org/php only (pin 1001; demote ondrej)');
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
    // deadsnakes for multi-version on Ubuntu; never silently fall back to system python3
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Python ${plan.version} (requested pin only)`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      'export LC_ALL=C',
      `VER=${JSON.stringify(plan.version)}`,
      'apt-get update -qq || true',
      'apt-get install -y software-properties-common ca-certificates 2>/dev/null || true',
      'if ! add-apt-repository -y ppa:deadsnakes/ppa; then',
      '  echo "deadsnakes PPA unavailable — will try distro packages for python${VER} only" >&2',
      'fi',
      'apt-get update -qq',
      'if ! apt-get install -y "python${VER}" "python${VER}-venv" "python${VER}-dev"; then',
      '  echo "failed to install python${VER} (and venv/dev). No fallback to system python3." >&2',
      '  echo "Hint: deadsnakes may not ship this minor on this Ubuntu release; check apt-cache policy python${VER}" >&2',
      '  exit 32',
      'fi',
      'if ! "python${VER}" --version; then',
      '  echo "python${VER} binary missing after apt install" >&2',
      '  exit 32',
      'fi',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0408', { v0: (plan.version) }));
    notes.push('source=deadsnakes/ppa or distro; no silent python3 fallback');
  } else if (input.kind === 'go') {
    const plan = selectGoRuntime(input.version);
    // Panel + DEST always minor (1.26); go.dev download resolves full patch (1.26.5).
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Go ${plan.version} (resolves full patch version)`,
      'set -euo pipefail',
      `VER=${JSON.stringify(plan.version)}`,
      `DEST=${JSON.stringify(plan.binaryPath.replace(/\/bin\/go$/, ''))}`,
      'mkdir -p /usr/local/ysk/go /tmp/ysk-go-install',
      'cd /tmp/ysk-go-install',
      'case "$(uname -m)" in aarch64|arm64) GOARCH=linux-arm64 ;; *) GOARCH=linux-amd64 ;; esac',
      // Resolve full patch from live go.dev JSON — no hardcoded patch table
      'resolve_go_full() {',
      '  local minor="$1"',
      '  if echo "$minor" | grep -qE "^[0-9]+\\.[0-9]+\\.[0-9]+$"; then',
      '    echo "$minor"',
      '    return',
      '  fi',
      '  local json best=""',
      '  json=$(curl -fsSL "https://go.dev/dl/?mode=json" 2>/dev/null || true)',
      '  if [ -n "$json" ]; then',
      '    best=$(printf "%s" "$json" | grep -oE "go${minor}\\.[0-9]+" | sed "s/^go//" | sort -t. -k3 -n | tail -1)',
      '  fi',
      '  if [ -n "$best" ]; then echo "$best"; else echo ""; fi',
      '}',
      'FULL_VER=$(resolve_go_full "$VER")',
      'if [ -z "$FULL_VER" ]; then',
      '  echo "cannot resolve full Go patch version for $VER from go.dev/dl JSON" >&2',
      '  exit 22',
      'fi',
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
      'mkdir -p /usr/local/ysk/go/bin',
      'ln -sfn "$DEST/bin/go" /usr/local/ysk/go/bin/go || true',
      '"$DEST/bin/go" version',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0409', { v0: plan.version }));
    notes.push('Go tarball full patch resolved from go.dev/dl JSON (no hardcoded patch table)');
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
    // Never silently install a different feature version (no openjdk-17 fallback)
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install OpenJDK ${plan.version} (requested pin only)`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      `VER=${JSON.stringify(plan.version)}`,
      'apt-get update -qq',
      'if ! apt-get install -y "openjdk-${VER}-jdk"; then',
      '  echo "openjdk-${VER}-jdk not available from apt; refusing silent downgrade" >&2',
      '  exit 32',
      'fi',
      'java -version',
      'javac -version',
      // Best-effort check that installed major matches request
      'JV=$(java -version 2>&1 | head -1 || true)',
      'echo "YSK_JAVA_VERSION_LINE=$JV"',
      'if ! echo "$JV" | grep -qE "version \\"?${VER}([.\\"_]|$)"; then',
      '  if ! echo "$JV" | grep -qE " ${VER}\\.|openjdk ${VER}|version \\"${VER}"; then',
      '    echo "installed java does not look like feature version ${VER}: $JV" >&2',
      '    exit 32',
      '  fi',
      'fi',
      '',
    ].join('\n');
    notes.push(tl('notes.auto.t0412', { v0: plan.version }));
    notes.push('no silent openjdk-17 fallback');
  } else if (input.kind === 'kotlin') {
    const plan = selectKotlinRuntime(input.version);
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Kotlin ${plan.version} (requires JDK; no version downgrade fallback)`,
      'set -euo pipefail',
      'export DEBIAN_FRONTEND=noninteractive',
      `if ! ${shellBinExists('java')}; then apt-get update -qq && apt-get install -y openjdk-21-jdk; fi`,
      `VER=${JSON.stringify(plan.version)}`,
      'DEST=/usr/local/ysk/kotlin',
      'TMP=$(mktemp -d)',
      'mkdir -p /usr/local/ysk /usr/local/bin',
      'URL="https://github.com/JetBrains/kotlin/releases/download/v${VER}/kotlin-compiler-${VER}.zip"',
      'echo "YSK_KOTLIN_URL=$URL"',
      'if ! curl -fsSL "$URL" -o "$TMP/kotlin.zip"; then',
      '  echo "Kotlin download failed for version ${VER} (no fallback pin)" >&2',
      '  exit 22',
      'fi',
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
    notes.push('no hardcoded kotlin fallback pin');
  } else if (input.kind === 'bun') {
    const plan = selectBunRuntime(input.version);
    // latest / empty → official installer; specific pin → GitHub release tarball
    const pin = plan.version === 'latest' || plan.version === 'stable' ? '' : plan.version;
    script = [
      '#!/usr/bin/env bash',
      `# YSK Server — install Bun (${plan.version})`,
      'set -euo pipefail',
      'export BUN_INSTALL=/usr/local/ysk/bun',
      'mkdir -p /usr/local/ysk/bun /usr/local/bin',
      `WANT=${JSON.stringify(pin)}`,
      'if [ -z "$WANT" ]; then',
      '  curl -fsSL https://bun.sh/install | bash',
      'else',
      '  case "$(uname -m)" in aarch64|arm64) BUN_OS=linux-aarch64 ;; *) BUN_OS=linux-x64 ;; esac',
      '  URL="https://github.com/oven-sh/bun/releases/download/bun-v${WANT}/bun-${BUN_OS}.zip"',
      '  echo "YSK_BUN_URL=$URL"',
      '  TMP=$(mktemp -d)',
      '  if ! curl -fsSL "$URL" -o "$TMP/bun.zip"; then',
      '    echo "Bun download failed for version ${WANT}" >&2',
      '    exit 22',
      '  fi',
      '  mkdir -p "$TMP/out" "$BUN_INSTALL/bin"',
      '  if command -v unzip >/dev/null 2>&1; then unzip -q "$TMP/bun.zip" -d "$TMP/out";',
      '  else python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP/bun.zip" "$TMP/out"; fi',
      '  BIN=$(find "$TMP/out" -type f -name bun | head -1)',
      '  test -n "$BIN"',
      '  install -m 755 "$BIN" "$BUN_INSTALL/bin/bun"',
      '  rm -rf "$TMP"',
      'fi',
      'ln -sfn /usr/local/ysk/bun/bin/bun /usr/local/bin/bun || true',
      'export PATH="/usr/local/bin:/usr/local/ysk/bun/bin:$PATH"',
      'GOT=$(bun --version)',
      'echo "YSK_BUN_VERSION=$GOT"',
      'if [ -n "$WANT" ] && [ "$GOT" != "$WANT" ]; then',
      '  # allow patch drift only if prefix matches (e.g. 1.2 vs 1.2.3)',
      '  case "$GOT" in',
      '    "$WANT"|"$WANT".*) ;;',
      '    *) echo "bun version mismatch: wanted ${WANT} got ${GOT}" >&2; exit 32 ;;',
      '  esac',
      'fi',
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

  let failedPackages: string[] | undefined;

  if (can) {
    // Serialize with apt package updates (shared host mutating job lock)
    await withHostMutatingJob(async () => {
      input.onLog?.({
        stream: 'stdout',
        line: `YSK_INSTALL_START kind=${input.kind} version=${input.version}`,
      });
      input.onLog?.({ stream: 'stdout', line: `YSK_INSTALL_SCRIPT ${scriptPath}` });
      const r = await input.host.runCommand(['bash', scriptPath], {
        timeoutMs: 600_000,
        // Executor already splits on newlines; map chunk.text → line
        onChunk: input.onLog
          ? (c) => input.onLog!({ stream: c.stream, line: c.text })
          : undefined,
        signal: input.abortSignal,
      });
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
      const phpFailMatch = out.match(/YSK_PHP_EXT_FAILED:\s*([^\n]+)/);
      if (phpFailMatch?.[1]) {
        failedPackages = phpFailMatch[1]
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        notes.unshift(
          `部分 PHP 套件安裝失敗：${failedPackages.join(', ')}（核心 CLI 可能仍可用）`,
        );
      }
      // exit 3 = runtime ok-ish but plugins failed; other non-zero = hard fail
      if (r.exitCode === 0) {
        notes.push(tl('notes.auto.n0656'));
        if (pluginIds?.length) notes.push(tl('notes.runtime.pluginsOk'));
      } else if (r.exitCode === 3 && pluginFailed.length) {
        notes.push(tl('notes.auto.n0656'));
        notes.unshift(
          tl('notes.runtime.pluginsFailed', { list: pluginFailed.join(', ') }),
        );
      } else if (r.exitCode === 130) {
        notes.unshift('安裝已中止（客戶端斷線或取消）');
      } else {
        const detail = summarizeInstallLog(r.stderr || '', r.stdout || '') || String(r.exitCode);
        const failNote = tl('notes.auto.t0411', { v0: detail });
        notes.unshift(failNote);
        if (pluginFailed.length) {
          notes.push(tl('notes.runtime.pluginsFailed', { list: pluginFailed.join(', ') }));
        }
      }
    });
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
    failedPackages,
  };
}

export type RuntimeSwitchResult = {
  ok: boolean;
  kind: RuntimeKind;
  version: string;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
  requiresExecute: boolean;
  requiresRoot: boolean;
  blocked?: boolean;
  blockMessage?: string;
};

/**
 * Switch the **active** default for multi-version runtimes without reinstalling.
 * - go: retarget /usr/local/bin/go → /usr/local/ysk/go/<minor>/bin/go
 * - rust: rustup default <toolchain> (+ refresh cargo/rustc symlinks)
 * Other kinds: refused (use install path).
 */
export async function switchRuntimeDefault(input: {
  host: HostExecutor;
  kind: RuntimeKind;
  version: string;
}): Promise<RuntimeSwitchResult> {
  const notes: string[] = [];
  const commandResults: RuntimeSwitchResult['commandResults'] = [];
  const execOn = input.host.executeEnabled();
  const rootOn = input.host.isRoot();
  const can = execOn && rootOn;

  if (input.kind !== 'go' && input.kind !== 'rust') {
    return {
      ok: false,
      kind: input.kind,
      version: input.version,
      notes: [
        'Switch is only supported for Go (multi-dir) and Rust (rustup toolchains). Install other runtimes per version.',
      ],
      commandResults,
      requiresExecute: !execOn,
      requiresRoot: !rootOn,
    };
  }

  if (!can) {
    return {
      ok: false,
      kind: input.kind,
      version: input.version,
      notes: [tl('notes.auto.n1163')],
      commandResults,
      requiresExecute: !execOn,
      requiresRoot: !rootOn,
      blocked: true,
      blockMessage: tl('notes.auto.n1163'),
    };
  }

  let script = '';
  if (input.kind === 'go') {
    const plan = selectGoRuntime(input.version);
    script = [
      'set -euo pipefail',
      `VER=${JSON.stringify(plan.version)}`,
      `DEST=/usr/local/ysk/go/$VER`,
      'if [ ! -x "$DEST/bin/go" ]; then',
      '  echo "Go $VER not installed at $DEST — install first" >&2',
      '  exit 2',
      'fi',
      'mkdir -p /usr/local/ysk/go/bin /usr/local/bin',
      'ln -sfn "$DEST/bin/go" /usr/local/bin/go',
      'ln -sfn "$DEST/bin/go" /usr/local/ysk/go/bin/go',
      'echo "YSK_GO_ACTIVE=$VER"',
      'go version',
      'readlink -f /usr/local/bin/go || true',
      '',
    ].join('\n');
    notes.push(`Switch active Go symlink → ${plan.version}`);
  } else {
    const plan = selectRustRuntime(input.version);
    const tc = plan.version === 'stable' ? 'stable' : plan.version;
    script = [
      'set -euo pipefail',
      'export RUSTUP_HOME=/usr/local/ysk/rust/rustup',
      'export CARGO_HOME=/usr/local/ysk/rust/cargo',
      'export PATH="$CARGO_HOME/bin:$RUSTUP_HOME/bin:/usr/local/ysk/rust/bin:$PATH"',
      'RU=""',
      '[ -x "$CARGO_HOME/bin/rustup" ] && RU="$CARGO_HOME/bin/rustup"',
      '[ -z "$RU" ] && [ -x /usr/local/ysk/rust/bin/rustup ] && RU=/usr/local/ysk/rust/bin/rustup',
      '[ -z "$RU" ] && RU=$(command -v rustup 2>/dev/null || true)',
      'if [ -z "$RU" ] || [ ! -x "$RU" ]; then',
      '  echo "rustup not found — install Rust first" >&2',
      '  exit 2',
      'fi',
      `TC=${JSON.stringify(tc)}`,
      'if ! "$RU" toolchain list 2>/dev/null | grep -qE "^${TC}(\\.|\\s|-|$)"; then',
      '  echo "Toolchain $TC not installed — install first" >&2',
      '  exit 2',
      'fi',
      '"$RU" default "$TC"',
      'mkdir -p /usr/local/ysk/rust/bin /usr/local/bin',
      'ln -sfn "$CARGO_HOME/bin/cargo" /usr/local/bin/cargo 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/rustc" /usr/local/bin/rustc 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/rustup" /usr/local/bin/rustup 2>/dev/null || true',
      'ln -sfn "$CARGO_HOME/bin/cargo" /usr/local/ysk/rust/bin/cargo 2>/dev/null || true',
      'echo "YSK_RUST_ACTIVE=$TC"',
      'cargo --version',
      'rustc --version',
      '',
    ].join('\n');
    notes.push(`Switch rustup default → ${tc}`);
  }

  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 120_000 });
  commandResults.push({
    argv: ['bash', '-c', `switch-${input.kind}-${input.version}`],
    exitCode: r.exitCode,
    stderr: r.stderr,
  });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  notes.push(
    ...out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 12),
  );
  if (r.exitCode !== 0) {
    notes.unshift(summarizeInstallLog(r.stderr || '', r.stdout || '') || `exit ${r.exitCode}`);
  }
  return {
    ok: r.exitCode === 0,
    kind: input.kind,
    version: input.version,
    notes,
    commandResults,
    requiresExecute: false,
    requiresRoot: false,
  };
}
