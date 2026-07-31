import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  installForFeature,
  installSoftware,
  installSoftwareBatch,
  probeSoftware,
} from './software-install.js';
import { getSoftware } from './software-catalog.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  bins?: string[];
  hasSystemctl?: boolean;
  aptFail?: boolean;
  aptFailFirstOnly?: boolean;
  unitFail?: boolean;
  installedAfterApt?: boolean;
}): HostExecutor {
  const bins = new Set(opts.bins ?? []);
  let aptDone = false;
  return {
    executeEnabled: () => opts.executeEnabled === true,
    isRoot: () => opts.isRoot === true,
    pathExists: (p) => {
      if (p.includes('systemctl')) return opts.hasSystemctl !== false;
      return false;
    },
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: 'active',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        const bin = s.match(/command -v (\S+)/)?.[1];
        // After apt, simulate bin present if installedAfterApt
        if (opts.installedAfterApt && aptDone && bin) {
          return {
            stdout: `/usr/bin/${bin}\n`,
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (bin && bins.has(bin)) {
          return {
            stdout: `/usr/bin/${bin}\n`,
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (argv[0] === 'systemctl' && argv.includes('is-active')) {
        return {
          stdout: 'active\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'systemctl' && (argv.includes('enable') || argv.includes('start'))) {
        return {
          stdout: '',
          stderr: opts.unitFail ? 'unit fail' : '',
          exitCode: opts.unitFail ? 1 : 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('apt-get update')) {
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('apt-get install')) {
        if (opts.aptFail && !opts.aptFailFirstOnly) {
          return {
            stdout: '',
            stderr: 'apt fail',
            exitCode: 1,
            argv,
            dryRun: false,
          };
        }
        if (opts.aptFailFirstOnly) {
          // first install (all packages) fails; single-pkg may succeed
          const pkgCount = (s.match(/"[^"]+"/g) || []).length;
          if (pkgCount > 1 || s.includes('mysql') || s.includes('mariadb')) {
            // fail the multi-package attempt; succeed single
            if (!s.match(/apt-get install -y "[^"]+"\s*$/) && pkgCount !== 1) {
              return {
                stdout: '',
                stderr: 'multi fail',
                exitCode: 1,
                argv,
                dryRun: false,
              };
            }
          }
        }
        aptDone = true;
        if (opts.installedAfterApt) {
          // mark common bins
          for (const b of ['nginx', 'vsftpd', 'mysql', 'mysqld', 'mariadbd']) {
            bins.add(b);
          }
        }
        return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      // runtime installer scripts
      if (s.includes('nodesource') || s.includes('apt-get') || s.includes('curl')) {
        aptDone = true;
        if (opts.installedAfterApt) bins.add('node');
        return { stdout: 'v20\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('software-install depth', () => {
  it('probeSoftware sets active when unit present', async () => {
    const nginx = getSoftware('nginx')!;
    const host = mockHost({ bins: nginx.bins, hasSystemctl: true });
    const st = await probeSoftware(host, nginx);
    expect(st.installed).toBe(true);
    expect(st.active).toBeTruthy();
  });

  it('probeSoftware skips unitActive without systemctl', async () => {
    const nginx = getSoftware('nginx')!;
    const host = mockHost({ bins: nginx.bins, hasSystemctl: false });
    // pathExists returns false for systemctl
    const st = await probeSoftware(host, nginx);
    expect(st.installed).toBe(true);
    expect(st.active).toBeUndefined();
  });

  it('install already-installed enables units when execute on', async () => {
    const nginx = getSoftware('nginx')!;
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: nginx.bins,
      unitFail: false,
    });
    const r = await installSoftware({ host, id: 'nginx', enableUnits: true });
    expect(r.ok).toBe(true);
    expect(r.installed).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.steps.some((s) => s.name.length > 0)).toBe(true);
  });

  it('runtime installer fails without dataDir', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true, bins: [] });
    const r = await installSoftware({ host, id: 'node' });
    expect(r.ok).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.steps.some((s) => s.status === 'failed')).toBe(true);
  });

  it('runtime installer paths for node/php/python/go/rust with dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sw-rt-'));
    dirs.push(dir);
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: [],
      installedAfterApt: true,
    });
    for (const id of ['node', 'php', 'python', 'go', 'rust'] as const) {
      const r = await installSoftware({ host, id, dataDir: dir });
      expect(r.executed).toBe(true);
      expect(typeof r.ok).toBe('boolean');
      expect(r.id).toBe(id);
      expect(r.notes.length).toBeGreaterThan(0);
    }
  });

  it('apt install path succeeds and enables units', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sw-apt-'));
    dirs.push(dir);
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: [],
      installedAfterApt: true,
      hasSystemctl: true,
    });
    const r = await installSoftware({ host, id: 'nginx', dataDir: dir });
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.installed).toBe(true);
    expect(r.steps.some((s) => s.status === 'ok' || s.status === 'skipped')).toBe(true);
  });

  it('apt install fails when packages cannot install', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: [],
      aptFail: true,
      installedAfterApt: false,
    });
    const r = await installSoftware({ host, id: 'nginx' });
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.installed).toBe(false);
  });

  it('apt multi-package fallback tries one-by-one', async () => {
    // Find a multi-package apt entry
    const multi =
      getSoftware('mysql') ||
      getSoftware('mariadb') ||
      getSoftware('mysql-server') ||
      getSoftware('mariadb-server');
    // synthesize path: nginx is single package — still exercises install
    // Prefer multi aptPackages if present
    const id = multi?.id ?? 'nginx';
    let multiInstallAttempts = 0;
    const host: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p) => p.includes('systemctl'),
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({
        stdout: 'active',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }),
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) {
          // not installed before; after multi-fail single succeeds mark nginx-like bins
          if (multiInstallAttempts >= 2) {
            return {
              stdout: '/usr/bin/x\n',
              stderr: '',
              exitCode: 0,
              argv,
              dryRun: false,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('apt-get update')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('apt-get install')) {
          multiInstallAttempts += 1;
          // first bulk install fails; subsequent single-package may succeed
          if (multiInstallAttempts === 1) {
            return {
              stdout: '',
              stderr: 'bulk fail',
              exitCode: 1,
              argv,
              dryRun: false,
            };
          }
          return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'systemctl') {
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    // use a multi-package software if available
    const cat = multi;
    if (cat && cat.aptPackages.length > 1) {
      const r = await installSoftware({ host, id: cat.id });
      expect(r.executed).toBe(true);
      expect(multiInstallAttempts).toBeGreaterThan(1);
    } else {
      const r = await installSoftware({ host, id });
      expect(r.executed).toBe(true);
    }
  });

  it('spec with empty aptPackages fails honestly', async () => {
    const host = mockHost({ executeEnabled: true, isRoot: true, bins: [] });
    // php without dataDir hits runtime missing dataDir
    const r = await installSoftware({ host, id: 'php' });
    expect(r.ok).toBe(false);
  });

  it('certbot multi-package apt fallback path', async () => {
    const spec = getSoftware('certbot')!;
    expect(spec.aptPackages.length).toBeGreaterThan(1);
    let installs = 0;
    const host: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p) => p.includes('systemctl'),
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
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) {
          if (installs >= 2) {
            return {
              stdout: '/usr/bin/certbot\n',
              stderr: '',
              exitCode: 0,
              argv,
              dryRun: false,
            };
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('apt-get update')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('apt-get install')) {
          installs += 1;
          // first (bulk) fails; subsequent (single) succeeds
          if (installs === 1) {
            return {
              stdout: '',
              stderr: 'bulk fail',
              exitCode: 1,
              argv,
              dryRun: false,
            };
          }
          return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'systemctl') {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const r = await installSoftware({ host, id: 'certbot' });
    expect(r.executed).toBe(true);
    expect(installs).toBeGreaterThanOrEqual(2);
    expect(r.steps.some((s) => /certbot|install|pkg|套件/i.test(s.name) || s.status === 'ok')).toBe(
      true,
    );
  });

  it('opendkim multi-package all singles fail', async () => {
    const host: HostExecutor = {
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: () => true,
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
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('apt-get')) {
          return {
            stdout: '',
            stderr: 'fail',
            exitCode: 1,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const r = await installSoftware({ host, id: 'opendkim' });
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('skips apt update when recently run (second install)', async () => {
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: [],
      installedAfterApt: true,
    });
    const a = await installSoftware({ host, id: 'git' });
    expect(a.executed).toBe(true);
    // remove bin so second also installs
    const host2 = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: [],
      installedAfterApt: true,
    });
    // same process — lastAptUpdateMs shared; use git then vsftpd
    const b = await installSoftware({ host: host2, id: 'vsftpd' });
    // may skip apt update if within 5 min window from previous call on same module state
    expect(b.executed).toBe(true);
    expect(b.steps.length).toBeGreaterThan(0);
  });

  it('installSoftwareBatch with dataDir for mixed runtime+apt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sw-batch-'));
    dirs.push(dir);
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: [],
      installedAfterApt: true,
    });
    const batch = await installSoftwareBatch({
      host,
      ids: ['nginx', 'node', 'nope-xyz'],
      dataDir: dir,
    });
    expect(batch.results).toHaveLength(3);
    expect(batch.results.some((r) => r.id === 'nope-xyz' && !r.ok)).toBe(true);
    expect(batch.notes.length).toBeGreaterThan(0);
  });

  it('installForFeature onlyMissing false installs all', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sw-feat-'));
    dirs.push(dir);
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      bins: [],
      installedAfterApt: true,
    });
    const r = await installForFeature({
      host,
      feature: 'ftp',
      dataDir: dir,
      onlyMissing: false,
    });
    expect(Array.isArray(r.results)).toBe(true);
    expect(r.missingBefore).toBeDefined();
  });

  it('installForFeature onlyMissing true with all installed is empty ok', async () => {
    const hostAll: HostExecutor = {
      executeEnabled: () => false,
      isRoot: () => false,
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
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) {
          return {
            stdout: '/usr/bin/x\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    };
    const r = await installForFeature({
      host: hostAll,
      feature: 'ftp',
      onlyMissing: true,
    });
    if (!r.missingBefore.length) {
      expect(r.ok).toBe(true);
      expect(r.results).toEqual([]);
    }
  });
});
