import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import {
  writeRoundcubeSsoPlugin,
  enableRoundcubeSsoPlugin,
  ensureRoundcubePluginInConfig,
  ROUNDCUBE_PLUGIN_CANDIDATES,
} from './roundcube-sso-plugin.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => execute,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async () => ({ stdout: '', stderr: '', exitCode: 1, argv: [], dryRun: false }),
  };
}

describe('roundcube-sso-plugin', () => {
  it('writes plugin skeleton and blocks system enable without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rc-sso-'));
    try {
      const w = writeRoundcubeSsoPlugin({
        dataDir: dir,
        panelBaseUrl: 'https://panel.example.com/',
      });
      expect(w.ok).toBe(true);
      expect(existsSync(join(w.pluginDir, 'ysk_sso.php'))).toBe(true);
      expect(ROUNDCUBE_PLUGIN_CANDIDATES.length).toBeGreaterThan(2);

      const en = await enableRoundcubeSsoPlugin({
        dataDir: dir,
        host: host(false),
        panelBaseUrl: 'https://panel.example.com',
      });
      // without execute should not claim full system apply success
      expect(en.ok === false || (en.notes ?? []).some((n) => /權限|EXECUTE|written|symlink/i.test(n))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('roundcube-sso-plugin enable + config', () => {
  it('enable with explicit plugins dir symlinks and patches config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rc-en-'));
    try {
      const pluginsDir = join(dir, 'roundcube', 'plugins');
      mkdirSync(pluginsDir, { recursive: true });
      const confDir = join(dir, 'roundcube', 'config');
      mkdirSync(confDir, { recursive: true });
      const confPath = join(confDir, 'config.inc.php');
      writeFileSync(
        confPath,
        "<?php\n$config['plugins'] = array('archive');\n",
        'utf8',
      );

      const h: HostExecutor = {
        executeEnabled: () => true,
        isRoot: () => true,
        pathExists: (p) => existsSync(p),
        readFile: async (p) => (existsSync(p) ? readFileSync(p, 'utf8') : ''),
        listDir: async () => [],
        writeFile: async () => undefined,
        deletePath: async () => undefined,
        mkdirp: async () => undefined,
        sysInfo: async () => ({}),
        serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
        runCommand: async (argv) => {
          if (argv[0] === 'bash' && argv[1] === '-c') {
            try {
              const stdout = execSync(argv[2], { encoding: 'utf8' });
              return { stdout, stderr: '', exitCode: 0, argv, dryRun: false };
            } catch (e: unknown) {
              const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number; message?: string };
              return {
                stdout: err.stdout?.toString?.() ?? '',
                stderr: err.stderr?.toString?.() ?? String(err.message ?? e),
                exitCode: err.status ?? 1,
                argv,
                dryRun: false,
              };
            }
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      };

      const r = await enableRoundcubeSsoPlugin({
        dataDir: dir,
        host: h,
        panelBaseUrl: 'https://panel.test',
        roundcubePluginsDir: pluginsDir,
      });
      expect(r.symlink).toBe(join(pluginsDir, 'ysk_sso'));
      expect(existsSync(join(pluginsDir, 'ysk_sso', 'ysk_sso.php')) || existsSync(r.symlink!)).toBe(
        true,
      );
      expect(['applied', 'written']).toContain(r.apply_status);
      expect(r.notes.length).toBeGreaterThan(0);

      // second enable → ALREADY path in config
      const r2 = await enableRoundcubeSsoPlugin({
        dataDir: dir,
        host: h,
        panelBaseUrl: 'https://panel.test/',
        roundcubePluginsDir: pluginsDir,
      });
      expect(r2.ok === true || r2.apply_status === 'applied' || r2.apply_status === 'written').toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enable without plugins dir returns written-only; symlink fail honest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rc-npl-'));
    try {
      const h: HostExecutor = {
        executeEnabled: () => true,
        isRoot: () => true,
        pathExists: () => false,
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => undefined,
        deletePath: async () => undefined,
        mkdirp: async () => undefined,
        sysInfo: async () => ({}),
        serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
        runCommand: async (argv) => ({
          stdout: '',
          stderr: 'ln failed',
          exitCode: 1,
          argv,
          dryRun: false,
        }),
      };
      const r = await enableRoundcubeSsoPlugin({
        dataDir: dir,
        host: h,
        panelBaseUrl: 'https://p.example',
      });
      expect(r.apply_status).toBe('written');
      expect(r.ok).toBe(true); // skeleton written, no plugins found

      // with plugins dir but ln fails
      const pd = join(dir, 'plugins');
      mkdirSync(pd, { recursive: true });
      const r2 = await enableRoundcubeSsoPlugin({
        dataDir: dir,
        host: h,
        panelBaseUrl: 'https://p.example',
        roundcubePluginsDir: pd,
      });
      expect(r2.ok).toBe(false);
      expect(r2.apply_status).toBe('written');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto-detects managed webmail plugins under dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rc-mng-'));
    try {
      const pluginsDir = join(dir, 'email', 'webmail', 'mail.example', 'public', 'plugins');
      mkdirSync(pluginsDir, { recursive: true });
      const conf = join(dir, 'email', 'webmail', 'mail.example', 'config', 'config.inc.php');
      mkdirSync(join(dir, 'email', 'webmail', 'mail.example', 'config'), { recursive: true });
      writeFileSync(conf, "<?php\n// empty\n", 'utf8');

      const h: HostExecutor = {
        executeEnabled: () => true,
        isRoot: () => true,
        pathExists: (p) => existsSync(p),
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => undefined,
        deletePath: async () => undefined,
        mkdirp: async () => undefined,
        sysInfo: async () => ({}),
        serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
        runCommand: async (argv) => {
          if (argv[0] === 'bash' && argv[1] === '-c') {
            try {
              const stdout = execSync(argv[2], { encoding: 'utf8' });
              return { stdout, stderr: '', exitCode: 0, argv, dryRun: false };
            } catch (e: unknown) {
              const err = e as { stdout?: Buffer; message?: string };
              return {
                stdout: err.stdout?.toString?.() ?? '',
                stderr: String(err.message ?? e),
                exitCode: 1,
                argv,
                dryRun: false,
              };
            }
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      };
      const r = await enableRoundcubeSsoPlugin({
        dataDir: dir,
        host: h,
        panelBaseUrl: 'https://panel',
      });
      expect(r.symlink).toBeDefined();
      expect(r.written.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ensureRoundcubePluginInConfig: missing config → ok false; append without plugins key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rc-cfg-'));
    try {
      const pluginsDir = join(dir, 'plugins');
      mkdirSync(pluginsDir, { recursive: true });
      const hFail: HostExecutor = {
        executeEnabled: () => true,
        isRoot: () => true,
        pathExists: () => false,
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => undefined,
        deletePath: async () => undefined,
        mkdirp: async () => undefined,
        sysInfo: async () => ({}),
        serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
        runCommand: async (argv) => ({ stdout: '', stderr: '', exitCode: 0, argv, dryRun: false }),
      };
      const miss = await ensureRoundcubePluginInConfig({
        host: hFail,
        pluginsDir,
        pluginName: 'ysk_sso',
      });
      expect(miss.ok).toBe(false);

      const confPath = join(dir, 'config.inc.php');
      writeFileSync(confPath, "<?php\n$config['foo'] = 1;\n", 'utf8');
      const h: HostExecutor = {
        ...hFail,
        pathExists: (p) => existsSync(p),
        runCommand: async (argv) => {
          if (argv[0] === 'bash') {
            try {
              const stdout = execSync(argv[2], { encoding: 'utf8' });
              return { stdout, stderr: '', exitCode: 0, argv, dryRun: false };
            } catch (e: unknown) {
              return { stdout: '', stderr: String(e), exitCode: 1, argv, dryRun: false };
            }
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      };
      const ok = await ensureRoundcubePluginInConfig({
        host: h,
        pluginsDir,
        pluginName: 'ysk_sso!!!',
      });
      expect(ok.ok).toBe(true);
      expect(readFileSync(confPath, 'utf8')).toMatch(/ysk_sso/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
