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

/** Known index.html locations (same spirit as resolveWebRoot). */
export function webUiIndexCandidates(dataDir: string, cwd = process.cwd()): string[] {
  const envRoot = process.env.YSK_WEB_ROOT?.trim();
  const list = [
    envRoot ? join(envRoot, 'index.html') : '',
    join(cwd, 'apps/web/dist/index.html'),
    join(dataDir, 'web/index.html'),
    join(cwd, 'apps/server/public/web/index.html'),
    join(cwd, 'web/dist/index.html'),
    join(cwd, 'public/web/index.html'),
  ].filter(Boolean);
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
  for (let i = 0; i < 10; i++) {
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

function copyDirContents(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  // wipe dest files for clean install
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

/**
 * Ensure SPA assets exist under dataDir/web (and/or monorepo dist).
 * Tries: already present → copy from existing dist → pnpm/npm build → copy.
 */
export async function ensureWebUiBuilt(input: {
  dataDir: string;
  cwd?: string;
}): Promise<{
  ok: boolean;
  path?: string;
  notes: string[];
}> {
  const notes: string[] = [];
  const cwd = input.cwd ?? process.cwd();
  const dataDir = input.dataDir;

  const existing = findWebUiIndex(dataDir, cwd);
  if (existing) {
    // Prefer durable copy under dataDir so restarts/cwd shifts stay ready
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

  const mono = findMonorepoRoot(cwd);
  if (!mono) {
    notes.push(
      'no monorepo (apps/web) found from cwd — run: pnpm --filter @ysk/web build',
    );
    notes.push(`cwd=${cwd}`);
    return { ok: false, notes };
  }
  notes.push(`monorepo: ${mono}`);

  const distDir = join(mono, 'apps/web/dist');
  const distIndex = join(distDir, 'index.html');

  if (!existsSync(distIndex)) {
    const pnpm = await whichBin('pnpm');
    const npm = await whichBin('npm');
    if (!pnpm && !npm) {
      notes.push('neither pnpm nor npm found on PATH');
      return { ok: false, notes };
    }
    try {
      if (pnpm) {
        notes.push('running: pnpm --filter @ysk/web build');
        const r = await execFileAsync(
          pnpm,
          ['--filter', '@ysk/web', 'build'],
          { cwd: mono, timeout: 600_000, maxBuffer: 12 * 1024 * 1024 },
        );
        if (String(r.stderr || '').trim()) {
          notes.push(String(r.stderr).slice(-800));
        }
      } else {
        notes.push('running: npm run build -w @ysk/web');
        await execFileAsync(npm!, ['run', 'build', '-w', '@ysk/web'], {
          cwd: mono,
          timeout: 600_000,
          maxBuffer: 12 * 1024 * 1024,
        });
      }
    } catch (e) {
      const err = e as { stderr?: string; message?: string };
      notes.push(String(err.stderr || err.message || e).slice(-1200));
      notes.push('web build failed');
      return { ok: false, notes };
    }
  } else {
    notes.push('apps/web/dist already built');
  }

  if (!existsSync(distIndex)) {
    notes.push(`missing ${distIndex} after build`);
    return { ok: false, notes };
  }

  const dest = join(dataDir, 'web');
  try {
    copyDirContents(distDir, dest);
    notes.push(`installed → ${dest}`);
  } catch (e) {
    notes.push(e instanceof Error ? e.message : String(e));
    // still ok if monorepo dist is enough for cwd-based serve
    if (existsSync(distIndex)) {
      notes.push(`serve may use monorepo dist: ${distIndex}`);
      return { ok: true, path: distIndex, notes };
    }
    return { ok: false, notes };
  }

  return { ok: true, path: join(dest, 'index.html'), notes };
}
