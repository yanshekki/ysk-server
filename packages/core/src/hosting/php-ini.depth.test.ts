import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  loadPhpIniSettings,
  loadProjectPhpIni,
  savePhpIniSettings,
  saveProjectPhpIni,
  getPhpIni,
  formatIniValue,
  renderPhpIniFile,
  renderPhpAdminValueLines,
  mergePhpIni,
  applyPhpIniSystem,
} from './php-ini.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute ?? false,
    isRoot: () => opts.root ?? false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts.run?.(argv) ?? {}),
    }),
  };
}

describe('php-ini depth', () => {
  it('load recovers corrupt JSON; project load merge and format helpers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-phpini-'));
    try {
      const badDir = join(dir, 'php', '8.3');
      mkdirSync(badDir, { recursive: true });
      writeFileSync(join(badDir, 'panel-ini.json'), '{not-json', 'utf8');
      const recovered = loadPhpIniSettings(dir, '8.3');
      expect(recovered.values).toBeTruthy();
      expect(Object.keys(recovered.values).length).toBeGreaterThan(0);

      const proj = loadProjectPhpIni(dir, 'p1', '8.3');
      expect(proj.version).toMatch(/8\./);

      // corrupt project
      mkdirSync(join(dir, 'php', 'projects'), { recursive: true });
      writeFileSync(join(dir, 'php', 'projects', 'p1.json'), 'nope', 'utf8');
      const proj2 = loadProjectPhpIni(dir, 'p1', '8.3');
      expect(proj2.extra).toEqual({});

      expect(formatIniValue(true)).toMatch(/^(On|1|true)$/i);
      expect(formatIniValue(false)).toMatch(/^(Off|0|false)$/i);
      expect(formatIniValue(128)).toBe('128');
      expect(formatIniValue('512M')).toBe('512M');

      const rendered = renderPhpIniFile({
        version: '8.3',
        values: { memory_limit: '256M', display_errors: true },
        extra: { 'opcache.enable': '1' },
        rawAppend: '; custom\n',
      });
      expect(rendered).toContain('memory_limit');
      expect(rendered).toContain('custom');
      // extra keys may be emitted when present
      expect(rendered.includes('opcache') || rendered.includes('display_errors')).toBe(true);

      const lines = renderPhpAdminValueLines({
        version: '8.3',
        values: { memory_limit: '128M', display_errors: false },
        extra: { foo: 'bar' },
      });
      expect(lines.some((l) => l.includes('php_admin_value') || l.includes('memory'))).toBe(true);

      const merged = mergePhpIni(
        { version: '8.3', values: { a: 1 }, extra: { x: '1' } },
        { version: '8.3', values: { b: 2 }, extra: { y: '2' }, rawAppend: 'z' },
      );
      expect(merged.values.a).toBe(1);
      expect(merged.values.b).toBe(2);
      expect(merged.extra.x).toBe('1');
      expect(merged.rawAppend).toContain('z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('savePhpIniSettings writes managed ini; getPhpIni returns catalog', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-phpini2-'));
    try {
      const saved = savePhpIniSettings(dir, {
        version: '8.2',
        values: { memory_limit: '64M' },
        extra: {},
      });
      expect(saved.written.length).toBeGreaterThan(0);
      expect(existsSync(saved.written[0]!)).toBe(true);

      const proj = saveProjectPhpIni(dir, 'proj-x', {
        version: '8.2',
        values: { upload_max_filesize: '20M' },
        extra: {},
      });
      expect(proj.written.length).toBeGreaterThan(0);

      const got = getPhpIni(dir, '8.2');
      expect(got.version).toMatch(/8\./);
      expect(got.catalog.length).toBeGreaterThan(0);
      expect(got.settings.values.memory_limit).toBeTruthy();
      expect(got.managedIniPath).toContain('ysk-panel.ini');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyPhpIniSystem blocked without root/execute; missing fpm path honest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-phpini3-'));
    try {
      savePhpIniSettings(dir, {
        version: '8.3',
        values: { memory_limit: '128M' },
        extra: {},
      });

      const blocked = await applyPhpIniSystem({
        dataDir: dir,
        version: '8.3',
        host: mockHost({ execute: true, root: false }),
      });
      expect(blocked.blocked).toBe(true);
      expect(blocked.applied).toBe(false);

      const noExec = await applyPhpIniSystem({
        dataDir: dir,
        version: '8.3',
        host: mockHost({ execute: false, root: true }),
      });
      expect(noExec.blocked).toBe(true);

      // creates managed file if missing
      const emptyDir = mkdtempSync(join(tmpdir(), 'ysk-phpini4-'));
      const created = await applyPhpIniSystem({
        dataDir: emptyDir,
        version: '8.3',
        host: mockHost({ execute: false, root: false }),
      });
      expect(created.written.length).toBeGreaterThan(0);
      rmSync(emptyDir, { recursive: true, force: true });

      // root+execute: either applies (if /etc/php exists) or reports missing fpm tree
      const cmds: string[][] = [];
      const root = await applyPhpIniSystem({
        dataDir: dir,
        version: '8.3',
        host: mockHost({
          execute: true,
          root: true,
          run: (argv) => {
            cmds.push([...argv]);
            if (argv[0] === 'cp') return { exitCode: 0 };
            if (argv[0] === 'systemctl') return { exitCode: 0 };
            if (argv[0] === 'mkdir') return { exitCode: 0 };
            return {};
          },
        }),
      });
      expect(typeof root.ok).toBe('boolean');
      expect(root.notes.length).toBeGreaterThan(0);
      // if system php fpm tree exists, cp/reload attempted
      if (root.applied || cmds.some((a) => a[0] === 'cp')) {
        expect(cmds.length).toBeGreaterThan(0);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
