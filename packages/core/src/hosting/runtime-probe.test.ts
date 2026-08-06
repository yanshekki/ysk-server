import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { planOrInstallRuntime, probeRuntimes } from './runtime-probe.js';

describe('runtime-probe', () => {
  it('probes host for installed runtime pins (discovery SSOT for install list)', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await probeRuntimes(host);
    // Installable pins come from version-discovery API; probe only reports host-found pins
    expect(r.node.length).toBeGreaterThanOrEqual(0);
    expect(r.php.length).toBeGreaterThanOrEqual(0);
    expect(r.python.length).toBeGreaterThanOrEqual(0);
    expect(r.go.length).toBeGreaterThanOrEqual(0);
    expect(r.rust.length).toBeGreaterThanOrEqual(1); // always includes stable channel pin
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.node.every((n) => typeof n.available === 'boolean')).toBe(true);
  });

  it('writes install helper and refuses without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rt-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const plan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'node',
      version: '20',
      install: false,
    });
    expect(plan.ok).toBe(true);
    expect(existsSync(plan.written[0])).toBe(true);
    // Node script prefers official tarball + reuse PATH node
    const script = (await import('node:fs')).readFileSync(plan.written[0], 'utf8');
    expect(script).toMatch(/nodejs\.org\/dist\/latest-v/);
    expect(script).toMatch(/MAJOR=/);

    const refused = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'php',
      version: '8.2',
      install: true,
    });
    expect(refused.ok).toBe(false);
    expect(refused.blocked).toBe(true);
    expect(refused.blockMessage).toBeTruthy();
    expect(refused.notes[0]).toBe(refused.blockMessage);
    expect(refused.notes.some((n) => /系統變更|YSK_EXECUTE|權限|安装|安裝/i.test(n))).toBe(true);

    const goPlan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'go',
      version: '1.22',
      install: false,
    });
    expect(goPlan.written[0]).toMatch(/install\.sh$/);

    const phpPlan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'php',
      version: '8.2',
      install: false,
      extensions: ['mysql', 'gd', 'redis'],
    });
    expect(phpPlan.packages).toEqual(
      expect.arrayContaining(['php8.2-fpm', 'php8.2-mysql', 'php8.2-gd', 'php8.2-redis']),
    );
    expect(phpPlan.extensionIds).toEqual(expect.arrayContaining(['mysql', 'gd', 'redis']));
    const phpScript = (await import('node:fs')).readFileSync(phpPlan.written[0], 'utf8');
    expect(phpScript).toContain('php8.2-mysql');
    expect(phpScript).toContain('php8.2-gd');
    // Must not use archived ondrej Launchpad PPA; use packages.sury.org/php
    expect(phpScript).not.toMatch(/ppa:ondrej\/php/);
    expect(phpScript).not.toMatch(/add-apt-repository.*ondrej/);
    expect(phpScript).toContain('packages.sury.org/php');
    expect(phpScript).toContain('debsuryorg-archive-keyring');
    expect(phpScript).toContain('/etc/apt/sources.list.d/php.list');
    // Single-origin pin avoids common vs extension version skew (ondrej gbp vs sury)
    expect(phpScript).toContain('ysk-php-sury.pref');
    expect(phpScript).toContain('Pin: origin packages.sury.org');
    expect(phpScript).toContain('--allow-downgrades');
    expect(phpScript).toMatch(/YSK_PHP_EXT_FAILED|exit 33/);
    expect(phpScript).toContain('ysk_php_pick_ver');
    expect(phpScript).toContain('YSK_PHP_SKIP_MISSING');
    // Must not hard-request phpX.Y-opcache (does not exist on sury)
    expect(phpScript).not.toMatch(/php8\.2-opcache/);

    const nodeWithPm2 = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'node',
      version: '20',
      install: false,
      plugins: ['pm2', 'pnpm'],
    });
    expect(nodeWithPm2.pluginIds).toEqual(expect.arrayContaining(['pm2', 'pnpm']));
    const nodeScript = (await import('node:fs')).readFileSync(nodeWithPm2.written[0], 'utf8');
    expect(nodeScript).toMatch(/npm install -g/);
    expect(nodeScript).toContain('pm2');
    expect(nodeScript).not.toMatch(/exit 0\nfi\n$/);

    const pyPlan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'python',
      version: '3.14',
      install: false,
    });
    const pyScript = (await import('node:fs')).readFileSync(pyPlan.written[0], 'utf8');
    expect(pyScript).toContain('deadsnakes');
    expect(pyScript).toContain('python${VER}');
    expect(pyScript).not.toMatch(/apt-get install -y python3 python3-venv/);
    expect(pyScript).toMatch(/No fallback to system python3|no silent python3 fallback|exit 32/);

    const javaPlan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'java',
      version: '21',
      install: false,
    });
    const javaScript = (await import('node:fs')).readFileSync(javaPlan.written[0], 'utf8');
    expect(javaScript).toContain('openjdk-${VER}-jdk');
    expect(javaScript).not.toContain('openjdk-17-jdk');

    const ktPlan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'kotlin',
      version: '2.1.0',
      install: false,
    });
    const ktScript = (await import('node:fs')).readFileSync(ktPlan.written[0], 'utf8');
    expect(ktScript).not.toContain('VER=2.0.21');
    expect(ktScript).toMatch(/no fallback pin|exit 22/);

    const bunPlan = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'bun',
      version: '1.2.0',
      install: false,
    });
    const bunScript = (await import('node:fs')).readFileSync(bunPlan.written[0], 'utf8');
    expect(bunScript).toContain('oven-sh/bun/releases');
    expect(bunScript).toContain('WANT=');

    // onLog is only used when install runs; plan-only still accepts the option
    const withLog = await planOrInstallRuntime({
      dataDir: dir,
      host,
      kind: 'go',
      version: '1.22',
      install: false,
      onLog: () => {
        throw new Error('plan-only must not invoke onLog for bash install');
      },
    });
    expect(withLog.ok).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});
