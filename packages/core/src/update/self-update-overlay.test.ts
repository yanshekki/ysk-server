import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyNpmOverlayToDest,
  classifyCliPath,
  isSafeOverlayDest,
} from './self-update-overlay.js';
import { runSelfUpdate } from './self-update-apply.js';
import { LocalHostExecutor } from '../host/executor.js';

function makePack(version: string): { root: string; dest: string; unpacked: string } {
  const root = mkdtempSync(join(tmpdir(), 'ysk-ovl-'));
  const unpacked = join(root, 'package');
  mkdirSync(join(unpacked, 'dist'), { recursive: true });
  writeFileSync(join(unpacked, 'dist', 'cli.js'), 'export const cli = true;\n');
  writeFileSync(
    join(unpacked, 'dist', 'version.js'),
    `export const VERSION = '${version}';\n`,
  );
  writeFileSync(
    join(unpacked, 'package.json'),
    JSON.stringify({ name: 'ysk-server', version }) + '\n',
  );
  const dest = join(root, 'dest');
  mkdirSync(join(dest, 'dist'), { recursive: true });
  writeFileSync(join(dest, 'dist', 'cli.js'), 'export const VERSION = "0.0.1";\n');
  writeFileSync(
    join(dest, 'package.json'),
    JSON.stringify({ name: 'ysk-server', version: '0.0.1' }) + '\n',
  );
  return { root, dest, unpacked };
}

describe('self-update overlay', () => {
  it('classifies monorepo and npm layouts', () => {
    expect(classifyCliPath('/usr/lib/ysk-server/apps/server/dist/cli.js').kind).toBe('monorepo');
    expect(classifyCliPath('/usr/lib/node_modules/ysk-server/dist/cli.js').kind).toBe(
      'npm-package',
    );
  });

  it('rejects unsafe dest roots', () => {
    expect(isSafeOverlayDest('/etc/ysk')).toBe(false);
    expect(isSafeOverlayDest('/')).toBe(false);
  });

  it('overlays unpacked package onto dest without EXECUTE', async () => {
    const { root, dest, unpacked } = makePack('0.2.0');
    try {
      const r = await applyNpmOverlayToDest({
        spec: 'ysk-server@0.2.0',
        destDir: dest,
        latest: '0.2.0',
        unpackedDir: unpacked,
      });
      expect(r.applied).toBe(true);
      expect(readFileSync(join(dest, 'dist', 'version.js'), 'utf8')).toContain('0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses dest without ysk-server identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ysk-ovl-bad-'));
    try {
      const dest = join(root, 'random');
      mkdirSync(dest);
      writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: 'other' }));
      const r = await applyNpmOverlayToDest({
        spec: 'ysk-server@0.2.0',
        destDir: dest,
        latest: '0.2.0',
        unpackedDir: dest,
      });
      expect(r.applied).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runSelfUpdate apply works without YSK_EXECUTE when dest+unpacked given', async () => {
    const { root, dest, unpacked } = makePack('0.2.0');
    try {
      const host = new LocalHostExecutor({ executeEnabled: false });
      const r = await runSelfUpdate({
        currentVersion: '0.1.0',
        host,
        apply: true,
        latestOverride: '0.2.0',
        cliJsHint: join(dest, 'dist', 'cli.js'),
        unpackedDir: unpacked,
      });
      expect(r.applied).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.blockMessage).toBeUndefined();
      expect(readFileSync(join(dest, 'dist', 'version.js'), 'utf8')).toContain('0.2.0');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('can overlay from a real tarball file', async () => {
    const { root, dest, unpacked } = makePack('1.2.3');
    const tgz = join(root, 'ysk-server-1.2.3.tgz');
    try {
      execFileSync('tar', ['-czf', tgz, '-C', root, 'package']);
      void unpacked;
      const r = await applyNpmOverlayToDest({
        spec: 'ysk-server@1.2.3',
        destDir: dest,
        latest: '1.2.3',
        tarballPath: tgz,
      });
      expect(r.applied).toBe(true);
      expect(readFileSync(join(dest, 'dist', 'version.js'), 'utf8')).toContain('1.2.3');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
