/**
 * Locate / build / install packaged Web UI for control-plane SPA serve (§3.9).
 */

import { execFile } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function pushUnique(list: string[], path: string | undefined | null): void {
  if (!path) return;
  const p = resolve(path);
  if (!list.includes(p)) list.push(p);
}

/**
 * index.html candidates: env, dataDir, monorepo dist, packaged server public/web.
 * Aligns with apps/server resolveWebRoot spirit + production install layouts.
 */
export function webUiIndexCandidates(dataDir: string, cwd = process.cwd()): string[] {
  const envRoot = process.env.YSK_WEB_ROOT?.trim();
  const list: string[] = [];

  if (envRoot) {
    pushUnique(list, join(envRoot, 'index.html'));
    // allow YSK_WEB_ROOT to point at index.html itself
    if (envRoot.endsWith('index.html')) pushUnique(list, envRoot);
  }

  pushUnique(list, join(dataDir, 'web/index.html'));
  pushUnique(list, join(cwd, 'apps/web/dist/index.html'));
  pushUnique(list, join(cwd, 'apps/server/public/web/index.html'));
  pushUnique(list, join(cwd, 'web/dist/index.html'));
  pushUnique(list, join(cwd, 'public/web/index.html'));

  // Running node …/dist/cli.js or …/cli.js — packaged next to server
  try {
    const argv1 = process.argv[1] ? resolve(process.argv[1]) : '';
    if (argv1) {
      const d = dirname(argv1);
      pushUnique(list, join(d, '../public/web/index.html'));
      pushUnique(list, join(d, 'public/web/index.html'));
      pushUnique(list, join(d, '../../public/web/index.html'));
      pushUnique(list, join(d, '../../../apps/web/dist/index.html'));
    }
  } catch {
    /* */
  }

  // Common global npm layouts for ysk-server
  for (const base of [
    '/usr/lib/node_modules/ysk-server/public/web/index.html',
    '/usr/local/lib/node_modules/ysk-server/public/web/index.html',
    '/usr/lib/node_modules/ysk-server/public/web/index.html',
    '/usr/local/lib/node_modules/ysk-server/public/web/index.html',
  ]) {
    pushUnique(list, base);
  }

  return list;
}

export function findWebUiIndex(
  dataDir: string,
  cwd = process.cwd(),
): { path: string; root: string } | null {
  for (const index of webUiIndexCandidates(dataDir, cwd)) {
    try {
      if (existsSync(index) && statSync(index).isFile()) {
        return { path: index, root: dirname(index) };
      }
    } catch {
      /* */
    }
  }
  return null;
}

/** Walk up for monorepo with apps/web. */
export function findMonorepoRoot(start = process.cwd()): string | null {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    const hasWs =
      existsSync(join(dir, 'pnpm-workspace.yaml')) ||
      existsSync(join(dir, 'pnpm-workspace.yml'));
    const hasWeb = existsSync(join(dir, 'apps/web/package.json'));
    if (hasWs && hasWeb) return dir;
    // also accept package.json workspaces + apps/web
    if (hasWeb && existsSync(join(dir, 'package.json'))) {
      try {
        const pkg = JSON.parse(
          readFileSync(join(dir, 'package.json'), 'utf8'),
        ) as { workspaces?: unknown; name?: string };
        if (pkg.workspaces || pkg.name === 'ysk-server') return dir;
      } catch {
        /* */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Sync assess: can one-click fix succeed without user building elsewhere?
 * - monorepo present → can build
 * - SPA already somewhere findable → can copy into dataDir/web
 */
export function assessWebUiFix(
  dataDir: string,
  cwd = process.cwd(),
): {
  ready: boolean;
  path?: string;
  root?: string;
  monorepo: string | null;
  /** True when POST readiness/fix build-web-ui can reasonably succeed */
  canAutoFix: boolean;
  /** Why canAutoFix is false (operator-facing English notes; UI uses i18n) */
  reasonCodes: string[];
} {
  const existing = findWebUiIndex(dataDir, cwd);
  const monorepo = findMonorepoRoot(cwd);
  if (existing) {
    return {
      ready: true,
      path: existing.path,
      root: existing.root,
      monorepo,
      canAutoFix: false,
      reasonCodes: [],
    };
  }
  if (monorepo) {
    return {
      ready: false,
      monorepo,
      canAutoFix: true,
      reasonCodes: [],
    };
  }
  return {
    ready: false,
    monorepo: null,
    canAutoFix: false,
    reasonCodes: ['NO_MONOREPO', 'NO_PACKAGED_UI'],
  };
}

function copyDirContents(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  try {
    for (const name of readdirSync(dest)) {
      rmSync(join(dest, name), { recursive: true, force: true });
    }
  } catch {
    /* */
  }
  cpSync(src, dest, { recursive: true });
}

async function whichBin(bin: string): Promise<string | null> {
  try {
    const r = await execFileAsync('sh', ['-c', `command -v ${bin}`], {
      timeout: 5_000,
    });
    const p = String(r.stdout || '').trim();
    return p || null;
  } catch {
    return null;
  }
}

/** npm root -g /ysk-server/public/web when global package embeds SPA */
async function findGlobalNpmPackagedWeb(): Promise<string | null> {
  const npm = await whichBin('npm');
  if (!npm) return null;
  try {
    const r = await execFileAsync(npm, ['root', '-g'], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
    });
    const root = String(r.stdout || '').trim();
    if (!root) return null;
    for (const rel of [
      'ysk-server/public/web/index.html',
      'ysk-server/public/web/index.html',
    ]) {
      const idx = join(root, rel);
      if (existsSync(idx) && statSync(idx).isFile()) return idx;
    }
  } catch {
    /* */
  }
  return null;
}

function installIntoDataDir(
  sourceRoot: string,
  dataDir: string,
  notes: string[],
): { ok: boolean; path?: string } {
  const dest = join(dataDir, 'web');
  try {
    copyDirContents(sourceRoot, dest);
    notes.push(`installed → ${dest}`);
    return { ok: true, path: join(dest, 'index.html') };
  } catch (e) {
    notes.push(e instanceof Error ? e.message : String(e));
    const fallback = join(sourceRoot, 'index.html');
    if (existsSync(fallback)) {
      notes.push(`serve may use source: ${fallback}`);
      return { ok: true, path: fallback };
    }
    return { ok: false };
  }
}

/**
 * Ensure SPA assets exist under dataDir/web (and/or monorepo dist).
 * Tries: already present → packaged copy → monorepo build → global npm package.
 */
export async function ensureWebUiBuilt(input: {
  dataDir: string;
  cwd?: string;
}): Promise<{
  ok: boolean;
  path?: string;
  notes: string[];
  /** Machine codes for UI (e.g. NO_MONOREPO) */
  codes?: string[];
}> {
  const notes: string[] = [];
  const codes: string[] = [];
  const cwd = input.cwd ?? process.cwd();
  const dataDir = input.dataDir;

  const existing = findWebUiIndex(dataDir, cwd);
  if (existing) {
    const dest = join(dataDir, 'web');
    if (!existsSync(join(dest, 'index.html'))) {
      try {
        copyDirContents(existing.root, dest);
        notes.push(`copied existing UI → ${dest}`);
      } catch (e) {
        notes.push(
          `UI already at ${existing.path} (copy to dataDir failed: ${
            e instanceof Error ? e.message : String(e)
          })`,
        );
        return { ok: true, path: existing.path, notes };
      }
    } else {
      notes.push(`web UI present: ${join(dest, 'index.html')}`);
    }
    return { ok: true, path: join(dest, 'index.html'), notes };
  }

  // Async: global npm package embed (production without monorepo)
  const globalIdx = await findGlobalNpmPackagedWeb();
  if (globalIdx) {
    notes.push(`found global package UI: ${globalIdx}`);
    const inst = installIntoDataDir(dirname(globalIdx), dataDir, notes);
    if (inst.ok) return { ok: true, path: inst.path, notes };
  }

  const mono = findMonorepoRoot(cwd);
  if (!mono) {
    codes.push('NO_MONOREPO', 'NO_PACKAGED_UI');
    notes.push(
      'No monorepo (apps/web) and no packaged SPA found — one-click build cannot run here.',
    );
    notes.push(`cwd=${cwd}`);
    notes.push(`dataDir=${dataDir}`);
    notes.push(
      'Manual: on a machine with source, run: pnpm --filter @ysk-server/web build',
    );
    notes.push(
      `then: mkdir -p ${join(dataDir, 'web')} && cp -a apps/web/dist/. ${join(dataDir, 'web')}/`,
    );
    notes.push(
      'Or set YSK_WEB_ROOT to a directory containing index.html and restart the panel.',
    );
    return { ok: false, notes, codes };
  }
  notes.push(`monorepo: ${mono}`);

  const distDir = join(mono, 'apps/web/dist');
  const distIndex = join(distDir, 'index.html');

  if (!existsSync(distIndex)) {
    const pnpm = await whichBin('pnpm');
    const npm = await whichBin('npm');
    if (!pnpm && !npm) {
      codes.push('NO_PACKAGE_MANAGER');
      notes.push('neither pnpm nor npm found on PATH');
      return { ok: false, notes, codes };
    }
    try {
      if (pnpm) {
        notes.push('running: pnpm --filter @ysk-server/web build');
        const r = await execFileAsync(
          pnpm,
          ['--filter', '@ysk-server/web', 'build'],
          { cwd: mono, timeout: 600_000, maxBuffer: 12 * 1024 * 1024 },
        );
        if (String(r.stderr || '').trim()) {
          notes.push(String(r.stderr).slice(-800));
        }
      } else {
        notes.push('running: npm run build -w @ysk-server/web');
        await execFileAsync(npm!, ['run', 'build', '-w', '@ysk-server/web'], {
          cwd: mono,
          timeout: 600_000,
          maxBuffer: 12 * 1024 * 1024,
        });
      }
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      notes.push(String(err.stderr || err.message || e).slice(-1200));
      notes.push('web build failed');
      codes.push('BUILD_FAILED');
      return { ok: false, notes, codes };
    }
  } else {
    notes.push('apps/web/dist already built');
  }

  if (!existsSync(distIndex)) {
    codes.push('DIST_MISSING');
    notes.push(`missing ${distIndex} after build`);
    return { ok: false, notes, codes };
  }

  const inst = installIntoDataDir(distDir, dataDir, notes);
  if (!inst.ok) {
    codes.push('INSTALL_FAILED');
    return { ok: false, notes, codes };
  }
  return { ok: true, path: inst.path, notes };
}
