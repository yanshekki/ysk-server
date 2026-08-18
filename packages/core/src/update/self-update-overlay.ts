/**
 * Overlay the official ysk-server npm tarball onto the running install.
 *
 * Panel apply must not depend on YSK_EXECUTE: default systemd units omit it,
 * so HostExecutor refuses `npm install -g`. This path uses Node fetch + tar +
 * copy onto the process's own package dir (authenticated admin, own files).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tl } from 'ysk-server-shared';
import { assertSafeOutboundUrl } from '../net/ssrf.js';

export type OverlayInstall = {
  kind: 'npm-package' | 'monorepo' | 'unknown';
  cliJs: string;
  packageDir: string;
};

/** Classify a cli.js path into the directory we must overlay. */
export function classifyCliPath(cliJsHint?: string): OverlayInstall {
  let cliJs = String(cliJsHint || '').trim();
  try {
    if (cliJs && existsSync(cliJs)) cliJs = realpathSync(cliJs);
  } catch {
    /* keep raw */
  }
  if (!cliJs) return { kind: 'unknown', cliJs: '', packageDir: '' };

  const norm = cliJs.split(sep).join('/');
  if (norm.includes('/apps/server/dist/') && /cli\.(js|cjs|mjs)$/.test(norm)) {
    return { kind: 'monorepo', cliJs, packageDir: dirname(dirname(cliJs)) };
  }
  if (/\/ysk-server\/dist\/cli\.(js|cjs|mjs)$/.test(norm)) {
    return { kind: 'npm-package', cliJs, packageDir: dirname(dirname(cliJs)) };
  }
  const pkgDir = dirname(dirname(cliJs));
  try {
    const name = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
      name?: string;
    };
    if (name.name === 'ysk-server') {
      return { kind: 'npm-package', cliJs, packageDir: pkgDir };
    }
  } catch {
    /* */
  }
  return { kind: 'unknown', cliJs, packageDir: '' };
}

const MAX_TARBALL_BYTES = 80 * 1024 * 1024;
const OFFICIAL_NPM_HOSTS = new Set(['registry.npmjs.org', 'registry.npmjs.com']);

export type OverlayCommandResult = {
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type OverlayResult = {
  applied: boolean;
  destDir: string;
  notes: string[];
  commandResults: OverlayCommandResult[];
};

function isTestEnv(): boolean {
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/** Reject overlay onto system roots that are not a ysk-server package. */
export function isSafeOverlayDest(dir: string): boolean {
  const raw = String(dir || '').trim();
  if (!raw) return false;
  const abs = resolve(raw);
  if (!abs || abs === '/' || abs.length < 6) return false;
  const norm = abs.split(sep).join('/');
  const blocked = ['/etc', '/bin', '/sbin', '/boot', '/proc', '/sys', '/dev', '/run', '/root'];
  for (const b of blocked) {
    if (norm === b || norm.startsWith(`${b}/`)) return false;
  }
  try {
    const pkg = JSON.parse(readFileSync(join(abs, 'package.json'), 'utf8')) as { name?: string };
    if (pkg.name === 'ysk-server') return true;
  } catch {
    /* no package.json */
  }
  if (/\/apps\/server$/.test(norm)) return true;
  if (/\/ysk-server$/.test(norm)) return true;
  return existsSync(join(abs, 'dist', 'cli.js'));
}

function parseExecStartCli(unitText: string): string {
  const m = unitText.match(/^ExecStart=(.+)$/m);
  if (!m?.[1]) return '';
  const parts = m[1].trim().split(/\s+/);
  return parts.find((p) => /cli\.(js|cjs|mjs)$/.test(p)) ?? '';
}

/** Read systemd unit ExecStart cli.js — skipped in unit tests (must not touch the host). */
export function readSystemdExecStartCli(): string {
  if (isTestEnv()) return '';
  const units = [
    '/etc/systemd/system/ysk-server.service',
    '/lib/systemd/system/ysk-server.service',
    '/usr/lib/systemd/system/ysk-server.service',
  ];
  for (const p of units) {
    try {
      if (!existsSync(p)) continue;
      const cli = parseExecStartCli(readFileSync(p, 'utf8'));
      if (cli && existsSync(cli)) return cli;
    } catch {
      /* next */
    }
  }
  return '';
}

export function resolveOverlayDest(cliJsHint?: string): OverlayInstall {
  const fromArgv = classifyCliPath(cliJsHint);
  if (fromArgv.packageDir && isSafeOverlayDest(fromArgv.packageDir)) return fromArgv;
  const cli = readSystemdExecStartCli();
  if (cli) {
    const fromUnit = classifyCliPath(cli);
    if (fromUnit.packageDir && isSafeOverlayDest(fromUnit.packageDir)) return fromUnit;
  }
  if (!isTestEnv()) {
    const wellKnown = [
      '/usr/lib/ysk-server/apps/server',
      '/usr/local/lib/ysk-server/apps/server',
    ];
    for (const dir of wellKnown) {
      if (isSafeOverlayDest(dir)) {
        return {
          kind: 'monorepo',
          cliJs: join(dir, 'dist', 'cli.js'),
          packageDir: dir,
        };
      }
    }
  }
  return fromArgv.packageDir
    ? fromArgv
    : { kind: 'unknown', cliJs: fromArgv.cliJs, packageDir: '' };
}

function destWritable(dir: string): boolean {
  try {
    const probe = join(dir, '.ysk-self-update-write-probe');
    writeFileSync(probe, 'ok', 'utf8');
    rmSync(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

function assertOfficialTarballUrl(raw: string): URL {
  const u = assertSafeOutboundUrl(raw, { field: 'selfUpdate.tarball' });
  const host = u.hostname.toLowerCase();
  if (!OFFICIAL_NPM_HOSTS.has(host)) {
    throw new Error(`tarball host not official npm: ${host}`);
  }
  return u;
}

function officialTarballUrl(packageName: string, latest: string): string {
  const name = packageName.replace(/^@/, '').replace(/\//g, '-');
  const pkg = packageName.startsWith('@') ? packageName : name;
  return `https://registry.npmjs.org/${encodeURIComponent(pkg)}/-/${name.split('/').pop()}-${latest}.tgz`;
}

async function downloadTarball(url: string, destFile: string): Promise<void> {
  const safe = assertOfficialTarballUrl(url);
  const res = await fetch(safe.toString(), {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'ysk-server-self-update' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_TARBALL_BYTES) {
    throw new Error(`tarball too large (${buf.length})`);
  }
  writeFileSync(destFile, buf);
}

function sha1File(path: string): string {
  const h = createHash('sha1');
  h.update(readFileSync(path));
  return h.digest('hex');
}

function extractTarball(tgz: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const r = spawnSync('tar', ['-xzf', tgz, '-C', destDir], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || 'tar failed').slice(0, 300));
  }
}

function copyOverlayTrees(pkgRoot: string, dest: string): void {
  const dist = join(pkgRoot, 'dist');
  if (!existsSync(join(dist, 'cli.js'))) {
    throw new Error('packed package missing dist/cli.js');
  }
  mkdirSync(join(dest, 'dist'), { recursive: true });
  cpSync(dist, join(dest, 'dist'), { recursive: true, dereference: true });
  const pub = join(pkgRoot, 'public');
  if (existsSync(pub)) {
    mkdirSync(join(dest, 'public'), { recursive: true });
    cpSync(pub, join(dest, 'public'), { recursive: true, dereference: true });
  }
  const nm = join(pkgRoot, 'node_modules');
  if (existsSync(nm)) {
    for (const dep of ['ysk-server-core', 'ysk-server-shared']) {
      const src = join(nm, dep);
      if (!existsSync(src)) continue;
      const target = join(dest, 'node_modules', dep);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(src, target, { recursive: true, dereference: true });
    }
  }
}

export function versionFileContains(dest: string, latest: string): boolean {
  const vf = join(dest, 'dist', 'version.js');
  if (!existsSync(vf)) return false;
  try {
    return readFileSync(vf, 'utf8').includes(latest);
  } catch {
    return false;
  }
}

/** True when this process may ask systemd to bounce ysk-server. */
export function canScheduleYskServerRestart(): boolean {
  if (isTestEnv()) return false;
  if (typeof process.getuid === 'function' && process.getuid() !== 0) return false;
  return true;
}

/**
 * Schedule systemd restart after the HTTP/CLI caller has flushed output.
 * Never run in unit tests. Call only after sendJson (panel) or stdout (CLI).
 */
export function scheduleYskServerRestart(delayMs = 2500): boolean {
  if (!canScheduleYskServerRestart()) return false;
  const wait = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 2500;
  setTimeout(() => {
    try {
      spawnSync(
        'systemctl',
        ['try-restart', 'ysk-server'],
        { timeout: 60_000, stdio: 'ignore' },
      );
    } catch {
      /* best-effort */
    }
  }, wait);
  return true;
}

export type OverlayLogFn = (ev: { stream: 'stdout' | 'stderr' | 'status'; line: string }) => void;

export async function applyNpmOverlayToDest(input: {
  spec: string;
  destDir: string;
  latest: string;
  tarballUrl?: string;
  tarballPath?: string;
  unpackedDir?: string;
  shasum?: string;
  onLog?: OverlayLogFn;
}): Promise<OverlayResult> {
  const notes: string[] = [];
  const commandResults: OverlayCommandResult[] = [];
  const latest = input.latest.replace(/^v/, '');
  const dest = String(input.destDir || '').trim();

  if (!dest) {
    notes.push(tl('notes.auto.selfDestMissing'));
    return { applied: false, destDir: '', notes, commandResults };
  }
  if (!existsSync(dest) || !statSync(dest).isDirectory()) {
    notes.push(tl('notes.auto.selfDestMissing'));
    return { applied: false, destDir: dest, notes, commandResults };
  }
  if (!isSafeOverlayDest(dest)) {
    notes.push(tl('notes.auto.selfDestUnwritable', { v0: dest }));
    return { applied: false, destDir: dest, notes, commandResults };
  }
  if (!destWritable(dest)) {
    notes.push(tl('notes.auto.selfDestUnwritable', { v0: dest }));
    return { applied: false, destDir: dest, notes, commandResults };
  }

  const tmp = mkdtempSync(join(tmpdir(), 'ysk-self-upd-'));
  const log = (line: string, stream: 'stdout' | 'stderr' | 'status' = 'status') => {
    try {
      input.onLog?.({ stream, line });
    } catch {
      /* */
    }
  };
  commandResults.push({
    argv: ['npm-overlay', input.spec, dest],
    exitCode: 0,
    stdout: '',
    stderr: '',
  });
  try {
    let pkgRoot = '';
    if (input.unpackedDir && existsSync(join(input.unpackedDir, 'dist', 'cli.js'))) {
      pkgRoot = input.unpackedDir;
    } else {
      let tgz = input.tarballPath?.trim() || '';
      if (tgz && !existsSync(tgz)) tgz = '';
      if (!tgz) {
        const allowFetch =
          Boolean(input.tarballUrl) ||
          (!isTestEnv() && Boolean(latest));
        if (!allowFetch) {
          notes.push(
            tl('notes.auto.selfDownloadFail', {
              v0: input.spec,
              v1: 'no local tarball',
            }),
          );
          return { applied: false, destDir: dest, notes, commandResults };
        }
        const url =
          input.tarballUrl?.trim() ||
          officialTarballUrl(input.spec.split('@')[0] || 'ysk-server', latest);
        tgz = join(tmp, 'pkg.tgz');
        log(`download ${url}`);
        await downloadTarball(url, tgz);
      }
      if (input.shasum && input.shasum.length === 40) {
        log('verify shasum');
        const got = sha1File(tgz);
        if (got !== input.shasum.toLowerCase()) {
          notes.push(
            tl('notes.auto.selfDownloadFail', {
              v0: input.spec,
              v1: 'shasum mismatch',
            }),
          );
          return { applied: false, destDir: dest, notes, commandResults };
        }
      }
      log('extract tarball');
      extractTarball(tgz, tmp);
      pkgRoot = join(tmp, 'package');
    }

    log(`write overlay ${dest}`);
    copyOverlayTrees(pkgRoot, dest);
    if (!versionFileContains(dest, latest)) {
      notes.push(tl('notes.auto.selfVerifyFail', { v0: latest }));
      commandResults[0]!.exitCode = 1;
      return { applied: false, destDir: dest, notes, commandResults };
    }
    log(`applied ${input.spec}`);
    notes.push(tl('notes.auto.selfApplied', { v0: input.spec, v1: dest }));
    commandResults[0]!.stdout = readFileSync(join(dest, 'dist', 'version.js'), 'utf8').slice(
      0,
      400,
    );
    return { applied: true, destDir: dest, notes, commandResults };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notes.push(tl('notes.auto.selfDownloadFail', { v0: input.spec, v1: msg.slice(0, 300) }));
    if (commandResults[0]) commandResults[0].exitCode = 1;
    return { applied: false, destDir: dest, notes, commandResults };
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}
