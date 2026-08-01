import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { applyPublicFileServer } from './public-files.js';
import { publicFilesRoot } from '../files/manager.js';

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  onRun?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv,
      dryRun: false,
      ...(opts.onRun?.(argv) ?? {}),
    }),
  };
}

describe('applyPublicFileServer', () => {
  it('creates public root and nginx conf without root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pub-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyPublicFileServer({
      dataDir: dir,
      host,
      serverName: 'files.example.com',
      quotaMb: 256,
    });
    expect(r.ok).toBe(true);
    expect(existsSync(r.publicRoot)).toBe(true);
    expect(existsSync(r.nginxPath)).toBe(true);
    expect(readFileSync(r.nginxPath, 'utf8')).toContain('autoindex on');
    expect(r.nginxReloaded).toBe(false);
    expect(r.requiresExecute).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('validates serverName and reload blocked / success branches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pub2-'));
    try {
      await expect(
        applyPublicFileServer({
          dataDir: dir,
          host: mockHost({ execute: false, root: false }),
          serverName: '  ',
        }),
      ).rejects.toThrow();
      await expect(
        applyPublicFileServer({
          dataDir: dir,
          host: mockHost({ execute: false, root: false }),
          serverName: 'bad..name',
        }),
      ).rejects.toThrow();

      // existing index.html skip write
      const root = publicFilesRoot(dir);
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'index.html'), '<html>exist</html>\n');

      const blocked = await applyPublicFileServer({
        dataDir: dir,
        host: mockHost({ execute: false, root: true }),
        serverName: '  FILES.Example.COM ',
        reload: true,
      });
      expect(blocked.nginxReloaded).toBe(false);
      expect(blocked.notes.some((n) => n.length > 0)).toBe(true);
      expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('exist');

      // execute+root but reload:false → skip system install
      const noReload = await applyPublicFileServer({
        dataDir: dir,
        host: mockHost({ execute: true, root: true }),
        serverName: 'files2.example.com',
        reload: false,
      });
      expect(noReload.ok).toBe(true);
      expect(noReload.nginxReloaded).toBe(false);
      expect(noReload.requiresExecute).toBe(false);
      expect(noReload.requiresRoot).toBe(false);

      // reload requested without root → blocked note path
      const wantButNoRoot = await applyPublicFileServer({
        dataDir: dir,
        host: mockHost({ execute: true, root: false }),
        serverName: 'files3.example.com',
        reload: true,
      });
      expect(wantButNoRoot.ok).toBe(true);
      expect(wantButNoRoot.requiresRoot).toBe(true);
      expect(wantButNoRoot.notes.some((n) => n.length > 0)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
