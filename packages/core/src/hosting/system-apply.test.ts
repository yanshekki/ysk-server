import { describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  panelBlockMessage,
  applyEmailStack,
  applyLetsEncrypt,
  applyPhpHosting,
  applyFtps,
  applyNginxSite,
  writeControlPlaneSystemdUnit,
  installControlPlaneSystemd,
  probeControlPlaneSystemd,
  applyFirewall,
  applyFail2ban,
  probeFirewallStatus,
  probeFail2banStatus,
  fail2banBannedIps,
  fail2banUnban,
  fail2banIgnoreIp,
} from './system-apply.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  paths?: string[];
  run?: (argv: string[]) => Partial<RunResult>;
}): HostExecutor {
  const paths = new Set(opts?.paths ?? []);
  return {
    executeEnabled: () => opts?.execute === true,
    isRoot: () => opts?.root !== false,
    pathExists: (p) => paths.has(p) || paths.has('*'),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({
      ...empty(),
      argv,
      ...(opts?.run?.(argv) ?? {}),
    }),
  };
}

describe('system-level apply writers', () => {
  it('writes email postfix/dovecot/opendkim configs under dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sys-'));
    try {
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await applyEmailStack({
        dataDir: dir,
        domain: 'example.com',
        host,
        installPackages: false,
      });
      expect(r.written.length).toBeGreaterThan(5);
      expect(existsSync(r.written[0])).toBe(true);
      expect(readFileSync(r.written[0], 'utf8')).toContain('myhostname');
      expect(readFileSync(r.written[0], 'utf8')).toContain('smtpd_milters');
      expect(r.written.some((p) => p.endsWith('install-mta.sh'))).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.requiresExecute).toBe(true);

      const installSkip = await applyEmailStack({
        dataDir: dir,
        domain: 'example.com',
        host,
        installPackages: true,
      });
      expect(installSkip.ok).toBe(false);
      expect(installSkip.requiresExecute).toBe(true);
      expect(
        installSkip.blocked ||
          installSkip.notes.some((n) => /YSK_EXECUTE|EXECUTE|系統變更|權限|execute/i.test(n)),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes php vhost and nginx site configs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sys-'));
    try {
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const php = await applyPhpHosting({
        dataDir: dir,
        domain: 'php.example.com',
        docRoot: join(dir, 'www'),
        phpVersion: '8.2',
        poolName: 'demo',
        host,
      });
      expect(existsSync(php.written[0])).toBe(true);
      expect(php.ok).toBe(true);

      const phpEnableBlocked = await applyPhpHosting({
        dataDir: dir,
        domain: 'php.example.com',
        docRoot: join(dir, 'www'),
        phpVersion: '8.2',
        poolName: 'demo2',
        host,
        enableSite: true,
      });
      expect(phpEnableBlocked.ok).toBe(true);
      expect(
        phpEnableBlocked.notes.some((n) => n.length > 0),
      ).toBe(true);

      const ngx = await applyNginxSite({
        dataDir: dir,
        serverName: 'app.example.com',
        upstream: 'http://127.0.0.1:3000',
        host,
      });
      expect(existsSync(ngx.written[0])).toBe(true);

      const ngxReloadBlocked = await applyNginxSite({
        dataDir: dir,
        serverName: 'app2.example.com',
        upstream: 'http://127.0.0.1:3001',
        host,
        reload: true,
      });
      expect(ngxReloadBlocked.ok).toBe(false);
      expect(ngxReloadBlocked.blocked).toBe(true);
      expect(ngxReloadBlocked.blockReason).toBe('no_execute');
      expect(existsSync(ngxReloadBlocked.written[0])).toBe(true);

      const ftps = await applyFtps({ dataDir: dir, domain: 'files.example.com', host });
      expect(existsSync(ftps.written[0])).toBe(true);
      expect(ftps.ok).toBe(true);
      expect(ftps.requiresExecute).toBe(true);

      const ftpsInstall = await applyFtps({
        dataDir: dir,
        domain: 'files.example.com',
        host,
        install: true,
      });
      expect(ftpsInstall.ok).toBe(false);
      expect(ftpsInstall.blocked).toBe(true);
      expect(ftpsInstall.requiresExecute).toBe(true);

      const unit = writeControlPlaneSystemdUnit({
        dataDir: dir,
        cliPath: '/usr/bin/ysk-server',
      });
      expect(existsSync(unit.unitPath)).toBe(true);
      expect(unit.content).toContain('ysk-server');
      expect(unit.content).toContain('Environment=YSK_EXECUTE=1');

      const fw = await applyFirewall({
        host,
        dataDir: dir,
        apply: false,
        allowSmtp: true,
      });
      expect(fw.commands.some((c) => c.includes('25'))).toBe(true);
      expect(fw.written.some((p) => p.endsWith('ufw-apply.sh'))).toBe(true);
      expect(fw.ok).toBe(true);

      const fwApplySkip = await applyFirewall({
        host,
        dataDir: dir,
        apply: true,
        allowSmtp: true,
      });
      expect(fwApplySkip.ok).toBe(false);
      expect(fwApplySkip.blocked).toBe(true);
      expect(fwApplySkip.requiresExecute).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('panelBlockMessage', () => {
  it('returns non-empty messages for all block reasons', () => {
    for (const reason of [
      'no_execute',
      'no_root',
      'missing_binary',
      'network',
      'validation',
      'other',
    ] as const) {
      const msg = panelBlockMessage(reason);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});

describe('applyLetsEncrypt honesty', () => {
  it('blocks when EXECUTE disabled (default LocalHostExecutor)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-le-'));
    try {
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await applyLetsEncrypt({
        domain: 'ssl.example.com',
        email: 'ops@example.com',
        host,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.blockReason).toBe('no_execute');
      expect(r.executed).toBe(false);
      expect(r.commands.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plan-only when run=false is ok dryRun', async () => {
    const host = mockHost({ execute: false, root: true });
    const r = await applyLetsEncrypt({
      domain: 'plan.example.com',
      email: 'ops@example.com',
      host,
      run: false,
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.blocked).toBe(false);
  });

  it('wildcard defaults to dns-01 plan; blocks without root when execute on', async () => {
    const noRoot = mockHost({ execute: true, root: false });
    const blocked = await applyLetsEncrypt({
      domain: '*.wild.example.com',
      email: 'ops@example.com',
      host: noRoot,
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    expect(blocked.blockReason).toBe('no_root');

    const runOk = mockHost({
      execute: true,
      root: true,
      run: () => ({ exitCode: 0, stdout: 'Successfully received certificate' }),
    });
    const issued = await applyLetsEncrypt({
      domain: 'ok.example.com',
      email: 'ops@example.com',
      host: runOk,
      challenge: 'http-01',
    });
    expect(issued.executed).toBe(true);
    expect(issued.ok).toBe(true);

    const failHost = mockHost({
      execute: true,
      root: true,
      run: () => ({ exitCode: 1, stderr: 'certbot failed' }),
    });
    const failed = await applyLetsEncrypt({
      domain: 'fail.example.com',
      email: 'ops@example.com',
      host: failHost,
    });
    expect(failed.executed).toBe(true);
    expect(failed.ok).toBe(false);
  });
});

describe('firewall / fail2ban probes and mutations', () => {
  it('probeFirewallStatus reads ufw when present', async () => {
    const host = mockHost({
      execute: false,
      paths: ['/usr/sbin/ufw'],
      run: (argv) => {
        if (argv[0] === 'ufw' && argv[1] === 'status' && argv[2] === 'numbered') {
          return {
            exitCode: 0,
            stdout: 'Status: active\n[ 1] 22/tcp ALLOW\n',
          };
        }
        if (argv[0] === 'ufw' && argv[1] === 'status') {
          return { exitCode: 0, stdout: 'Status: active\n' };
        }
        return {};
      },
    });
    const st = await probeFirewallStatus(host);
    expect(st.installed).toBe(true);
    expect(st.active).toBe('active');
    expect(st.executeEnabled).toBe(false);
    expect(st.numberedRules.length).toBeGreaterThan(0);
  });

  it('probeFirewallStatus inactive and missing binary paths', async () => {
    const inactive = mockHost({
      execute: false,
      paths: ['/usr/bin/ufw'],
      run: (argv) => {
        if (argv[0] === 'ufw') {
          return { exitCode: 0, stdout: 'Status: inactive\n' };
        }
        return {};
      },
    });
    const st = await probeFirewallStatus(inactive);
    expect(st.active).toBe('inactive');

    const missing = mockHost({
      execute: false,
      paths: [],
      run: (argv) => {
        if (argv[0] === 'bash') {
          return { exitCode: 0, stdout: 'no\n' };
        }
        return {};
      },
    });
    const m = await probeFirewallStatus(missing);
    expect(m.installed).toBe(false);
  });

  it('probeFail2banStatus lists jails and banned counts', async () => {
    const host = mockHost({
      execute: false,
      paths: ['/usr/bin/fail2ban-client'],
      run: (argv) => {
        if (argv[0] === 'systemctl' && argv[1] === 'is-active') {
          return { exitCode: 0, stdout: 'active\n' };
        }
        if (argv[0] === 'systemctl' && argv[1] === 'is-enabled') {
          return { exitCode: 0, stdout: 'enabled\n' };
        }
        if (
          argv[0] === 'fail2ban-client' &&
          argv[1] === 'status' &&
          argv.length === 2
        ) {
          return { exitCode: 0, stdout: 'Jail list:\tsshd, nginx-http-auth\n' };
        }
        if (argv[0] === 'fail2ban-client' && argv[1] === 'status' && argv[2]) {
          return {
            exitCode: 0,
            stdout: `Status for the jail: ${argv[2]}\n|- Currently banned:\t2\n|- Total banned:\t5\n|- Banned IP list:\t1.2.3.4 5.6.7.8\n`,
          };
        }
        return {};
      },
    });
    const st = await probeFail2banStatus(host);
    expect(st.installed).toBe(true);
    expect(st.active).toBe('active');
    expect(st.jails.length).toBeGreaterThanOrEqual(1);
    expect(st.jails[0]?.currentlyBanned).toBe(2);
    expect(st.defaultJails.length).toBeGreaterThan(0);
  });

  it('fail2banBannedIps parses list; unban blocked without EXECUTE', async () => {
    const host = mockHost({
      execute: false,
      paths: ['/usr/bin/fail2ban-client'],
      run: (argv) => {
        if (argv[0] === 'fail2ban-client' && argv[1] === 'status' && argv[2] === 'sshd') {
          return {
            exitCode: 0,
            stdout: 'Banned IP list:\t10.0.0.1 10.0.0.2\n',
          };
        }
        if (argv[0] === 'fail2ban-client' && argv[1] === 'status') {
          return { exitCode: 0, stdout: 'Jail list:\tsshd\n' };
        }
        if (argv[0] === 'systemctl') {
          return { exitCode: 0, stdout: 'active\n' };
        }
        return {};
      },
    });
    const listed = await fail2banBannedIps(host, 'sshd');
    expect(listed.ok).toBe(true);
    expect(listed.items.length).toBe(2);
    expect(listed.requiresExecute).toBe(false);

    const all = await fail2banBannedIps(host);
    expect(all.ok).toBe(true);
    expect(all.items.length).toBeGreaterThanOrEqual(2);

    const unban = await fail2banUnban(host, 'sshd', '10.0.0.1');
    expect(unban.ok).toBe(false);
    expect(unban.blocked).toBe(true);
    expect(unban.requiresExecute).toBe(true);
  });

  it('fail2banUnban runs when EXECUTE enabled', async () => {
    const calls: string[][] = [];
    const host = mockHost({
      execute: true,
      run: (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: 'OK' };
      },
    });
    const r = await fail2banUnban(host, 'sshd;rm', '203.0.113.9');
    expect(r.ok).toBe(true);
    expect(r.requiresExecute).toBe(false);
    expect(calls[0]?.[0]).toBe('fail2ban-client');
    expect(calls[0]?.[2]).toBe('sshdrm');
    expect(calls[0]?.[4]).toBe('203.0.113.9');
  });

  it('fail2banIgnoreIp writes ignore list; blocked live apply without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-f2b-'));
    try {
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const bad = await fail2banIgnoreIp(host, dir, 'not-an-ip');
      expect(bad.ok).toBe(false);
      expect(bad.apply_status).toBe('failed');

      const bogusOctet = await fail2banIgnoreIp(host, dir, '999.999.999.999');
      expect(bogusOctet.ok).toBe(false);
      expect(bogusOctet.apply_status).toBe('failed');

      const add = await fail2banIgnoreIp(host, dir, '203.0.113.50', 'add');
      expect(add.ok).toBe(true);
      expect(add.apply_status).toBe('written');
      expect(add.requiresExecute).toBe(true);
      expect(add.written.some((p) => p.endsWith('ignoreip.txt'))).toBe(true);
      const listPath = join(dir, 'fail2ban', 'ignoreip.txt');
      expect(readFileSync(listPath, 'utf8')).toContain('203.0.113.50');

      const addAgain = await fail2banIgnoreIp(host, dir, '203.0.113.50', 'add');
      expect(addAgain.ok).toBe(true);

      const rem = await fail2banIgnoreIp(host, dir, '203.0.113.50', 'remove');
      expect(rem.ok).toBe(true);
      expect(rem.apply_status).toBe('written');
      expect(readFileSync(listPath, 'utf8')).not.toContain('203.0.113.50');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fail2banIgnoreIp applies via client when EXECUTE on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-f2b-'));
    try {
      const calls: string[][] = [];
      const host = mockHost({
        execute: true,
        run: (argv) => {
          calls.push(argv);
          return { exitCode: 0 };
        },
      });
      const r = await fail2banIgnoreIp(host, dir, '198.51.100.1', 'add');
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('applied');
      expect(calls.some((a) => a.includes('addignoreip'))).toBe(true);

      const fail = await fail2banIgnoreIp(
        mockHost({
          execute: true,
          run: () => ({ exitCode: 1, stderr: 'no jail' }),
        }),
        dir,
        '198.51.100.2',
        'remove',
      );
      expect(fail.ok).toBe(false);
      expect(fail.apply_status).toBe('failed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyFail2ban writes jail; apply without EXECUTE is blocked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-f2ba-'));
    try {
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const written = await applyFail2ban({ dataDir: dir, host, apply: false });
      expect(written.ok).toBe(true);
      expect(written.written[0]).toBeTruthy();
      expect(existsSync(written.written[0]!)).toBe(true);
      expect(written.requiresExecute).toBe(true);

      const blocked = await applyFail2ban({ dataDir: dir, host, apply: true });
      expect(blocked.ok).toBe(false);
      expect(blocked.blocked).toBe(true);
      expect(blocked.requiresExecute).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applyFail2ban with execute probes service and runs commands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-f2bb-'));
    try {
      const host = mockHost({
        execute: true,
        root: true,
        paths: ['/usr/bin/fail2ban-client'],
        run: (argv) => {
          if (argv[0] === 'systemctl' && argv[1] === 'is-active') {
            return { exitCode: 0, stdout: 'active\n' };
          }
          return { exitCode: 0 };
        },
      });
      const r = await applyFail2ban({
        dataDir: dir,
        host,
        apply: true,
        jails: ['sshd'],
      });
      expect(r.ok).toBe(true);
      expect(r.executed).toBe(true);
      expect(r.serviceActive).toBe('active');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('control plane systemd', () => {
  it('installControlPlaneSystemd blocked without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sd-'));
    try {
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await installControlPlaneSystemd({
        dataDir: dir,
        cliPath: '/usr/bin/ysk-server',
        host,
        enable: true,
      });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.executed).toBe(false);
      expect(existsSync(r.written[0]!)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('installControlPlaneSystemd write-only when enable false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sd-'));
    try {
      const host = new LocalHostExecutor({
        allowedWriteRoots: [dir],
        executeEnabled: false,
      });
      const r = await installControlPlaneSystemd({
        dataDir: dir,
        cliPath: '/usr/bin/ysk-server',
        host,
        enable: false,
      });
      expect(r.ok).toBe(true);
      expect(r.executed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('probeControlPlaneSystemd reports active/enabled/show fields', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sdp-'));
    try {
      writeControlPlaneSystemdUnit({
        dataDir: dir,
        cliPath: '/usr/bin/ysk-server',
      });
      const host = mockHost({
        execute: false,
        root: false,
        paths: ['/etc/systemd/system/ysk-server.service', join(dir, 'systemd', 'ysk-server.service')],
        run: (argv) => {
          if (argv[0] === 'systemctl' && argv[1] === 'is-active') {
            return { exitCode: 0, stdout: 'active\n' };
          }
          if (argv[0] === 'systemctl' && argv[1] === 'is-enabled') {
            return { exitCode: 0, stdout: 'enabled\n' };
          }
          if (argv[0] === 'systemctl' && argv[1] === 'show') {
            return {
              exitCode: 0,
              stdout: [
                'MainPID=4242',
                'ActiveEnterTimestamp=Fri 2026-01-01 00:00:00 UTC',
                'FragmentPath=/etc/systemd/system/ysk-server.service',
                'Description=YSK Server control plane',
              ].join('\n'),
            };
          }
          return {};
        },
      });
      const st = await probeControlPlaneSystemd(host, dir);
      expect(st.unit).toBe('ysk-server');
      expect(st.active).toBe('active');
      expect(st.enabled).toBe('enabled');
      expect(st.executeEnabled).toBe(false);
      expect(st.canInstall).toBe(false);
      expect(st.managedUnitExists).toBe(true);
      expect(st.show.mainPid).toBe('4242');
      expect(st.show.description).toMatch(/YSK/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('permission-denied fail2ban banned list', () => {
  it('returns blocked when client needs root and EXECUTE off', async () => {
    const host = mockHost({
      execute: false,
      paths: ['/usr/bin/fail2ban-client'],
      run: () => ({
        exitCode: 1,
        stderr: 'ERROR permission denied: need root',
      }),
    });
    const r = await fail2banBannedIps(host, 'sshd');
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.requiresExecute).toBe(true);
  });
});

describe('applyFirewall apply path with execute', () => {
  it('runs when apply+execute+root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fw-'));
    try {
      const host = mockHost({
        execute: true,
        root: true,
        run: () => ({ exitCode: 0 }),
      });
      const r = await applyFirewall({
        host,
        dataDir: dir,
        apply: true,
        allowSmtp: true,
        extraTcpPorts: [8080],
      });
      expect(r.ok).toBe(true);
      expect(r.executed).toBe(true);
      expect(r.commands.some((c) => c.includes('8080') || c.includes('25'))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks apply when root missing even with execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-fw2-'));
    try {
      const host = mockHost({ execute: true, root: false });
      const r = await applyFirewall({ host, dataDir: dir, apply: true });
      expect(r.ok).toBe(false);
      expect(r.blocked).toBe(true);
      expect(r.requiresRoot).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// silence unused imports if tree-shaken
void mkdirSync;
void writeFileSync;
