import { describe, expect, it } from 'vitest';
import type { HostExecutor } from '../../host/executor.js';
import { HostSoftwareProbe } from './HostSoftwareProbe.js';

function mockHost(opts: {
  bins?: Record<string, string>;
  pathExists?: string[];
  dpkg?: string;
  policy?: string;
  versionOut?: string;
}): HostExecutor {
  const bins = opts.bins ?? {};
  const paths = new Set(opts.pathExists ?? []);
  return {
    executeEnabled: () => false,
    isRoot: () => false,
    pathExists: (p) => paths.has(p) || p.includes('systemctl'),
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
        const m = s.match(/command -v (\S+)/);
        const bin = m?.[1]?.replace(/2.*/, '').trim();
        const path = bin ? bins[bin] : undefined;
        return {
          stdout: path ? `${path}\n` : '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('dpkg -l')) {
        return {
          stdout: opts.dpkg ?? '',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('dpkg-query -W -f')) {
        if (s.includes('Status')) {
          return {
            stdout: opts.dpkg?.includes('mariadb') || opts.dpkg?.includes('mysql')
              ? 'install ok installed'
              : '',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return {
          stdout: opts.versionOut ?? '1:10.11.14-0ubuntu0.24.04.1',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('apt-cache policy')) {
        return {
          stdout:
            opts.policy ??
            'mariadb-server:\n  Installed: 1:10.11.14\n  Candidate: 1:10.11.14\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (
        s.includes('--version') ||
        s.includes(' -v') ||
        s.includes(' -V') ||
        s.includes('"-v"') ||
        s.includes("'-v'")
      ) {
        return {
          stdout: opts.versionOut ?? 'mysql  Ver 15.1 Distrib 10.11.14-MariaDB\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      // Do not answer dpkg-query Version with CLI versionOut by default in version tests
      if (s.includes('dpkg-query') && s.includes('Version') && opts.versionOut) {
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('is-active')) {
        return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      if (s.includes('is-enabled')) {
        return { stdout: 'enabled\n', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('HostSoftwareProbe presence (unified)', () => {
  it('MariaDB host: mariadb-server installed, mysql-server not', async () => {
    const host = mockHost({
      bins: {
        mariadbd: '/usr/sbin/mariadbd',
        mysql: '/usr/bin/mysql',
        mysqld: '/usr/sbin/mysqld',
      },
      dpkg: 'ii  mariadb-server 1:10.11 amd64',
    });
    const probe = new HostSoftwareProbe(host);
    const maria = await probe.presence('mariadb-server');
    const mysql = await probe.presence('mysql-server');
    expect(maria.installed).toBe(true);
    expect(mysql.installed).toBe(false);
    expect(mysql.blockedByExclusive).toBe('mariadb-server');
    expect(await probe.isInstalled('mysql-server')).toBe(false);
    expect(await probe.isInstalled('mariadb-server')).toBe(true);
  });

  it('Oracle MySQL host: mysql-server installed, mariadb not', async () => {
    const host = mockHost({
      bins: { mysqld: '/usr/sbin/mysqld', mysql: '/usr/bin/mysql' },
      dpkg: 'ii  mysql-server 8.0 amd64',
      versionOut: 'mysql  Ver 8.0.36 for Linux on x86_64 (MySQL Community Server)',
    });
    const probe = new HostSoftwareProbe(host);
    expect((await probe.presence('mysql-server')).installed).toBe(true);
    expect((await probe.presence('mariadb-server')).installed).toBe(false);
    expect((await probe.presence('mariadb-server')).blockedByExclusive).toBe('mysql-server');
  });

  it('nginx presence via bin', async () => {
    const host = mockHost({ bins: { nginx: '/usr/sbin/nginx' } });
    const probe = new HostSoftwareProbe(host);
    const p = await probe.presence('nginx');
    expect(p.installed).toBe(true);
    expect(p.resolvedBins[0]).toContain('nginx');
  });

  it('mysql-client installed when mysql CLI exists (shared with MariaDB)', async () => {
    const host = mockHost({ bins: { mysql: '/usr/bin/mysql' } });
    const probe = new HostSoftwareProbe(host);
    expect((await probe.presence('mysql-client')).installed).toBe(true);
  });

  it('presenceForEngine maps mysql → mysql-server exclusive', async () => {
    const host = mockHost({
      bins: { mariadbd: '/usr/sbin/mariadbd', mysql: '/usr/bin/mysql' },
      dpkg: 'ii  mariadb-server',
    });
    const probe = new HostSoftwareProbe(host);
    const { server, client } = await probe.presenceForEngine('mysql');
    expect(server.installed).toBe(false);
    expect(client?.installed).toBe(true);
  });
});

describe('HostSoftwareProbe version + upgrade', () => {
  it('version from CLI', async () => {
    const host = mockHost({
      bins: { nginx: '/usr/sbin/nginx' },
      versionOut: 'nginx version: nginx/1.24.0\n',
    });
    // Prefer CLI: mock returns version for any -v / version argv
    const probe = new HostSoftwareProbe(host);
    const v = await probe.version('nginx');
    expect(v.installed).toBe(true);
    expect(v.version).toBeTruthy();
    expect(['cli', 'dpkg']).toContain(v.source);
  });

  it('upgrade upgradable when candidate differs', async () => {
    const host = mockHost({
      bins: { nginx: '/usr/sbin/nginx' },
      policy: 'nginx:\n  Installed: 1.24.0-1\n  Candidate: 1.24.0-2\n',
    });
    const probe = new HostSoftwareProbe(host);
    const u = await probe.upgrade('nginx');
    expect(u.upgradable).toBe(true);
    expect(u.currentVersion).toBe('1.24.0-1');
    expect(u.candidateVersion).toBe('1.24.0-2');
  });

  it('upgrade not upgradable when same version', async () => {
    const host = mockHost({
      bins: { nginx: '/usr/sbin/nginx' },
      policy: 'nginx:\n  Installed: 1.24.0\n  Candidate: 1.24.0\n',
    });
    const probe = new HostSoftwareProbe(host);
    const u = await probe.upgrade('nginx');
    expect(u.upgradable).toBe(false);
  });
});
