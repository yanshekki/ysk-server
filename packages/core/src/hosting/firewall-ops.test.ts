import { describe, expect, it } from 'vitest';
import {
  parseUfwNumbered,
  extractDenyFromIps,
  probeFirewallDeep,
  firewallSetEnabled,
  firewallDenyIp,
  firewallDeleteDenyIp,
  firewallDeleteRuleNumber,
  firewallAllowPort,
  FIREWALL_PROFILES,
} from './firewall-ops.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function host(opts: {
  execute?: boolean;
  root?: boolean;
  paths?: string[];
  run?: (argv: string[]) => RunResult;
}): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: (p) => (opts.paths ?? []).some((x) => p.includes(x) || p.endsWith(x)),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) =>
      opts.run?.(argv) ?? {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
      },
  };
}

describe('firewall-ops', () => {
  it('parses numbered rules and deny IPs', () => {
    const rules = parseUfwNumbered([
      '[ 1] 22/tcp                     ALLOW IN    Anywhere',
      '[ 3] Anywhere                   DENY IN     203.0.113.10',
      'Status: active',
    ]);
    expect(rules.some((r) => r.action === 'ALLOW' && r.num === 1)).toBe(true);
    expect(extractDenyFromIps(rules)).toContain('203.0.113.10');
    expect(FIREWALL_PROFILES.web.extraTcpPorts).toEqual([]);
    expect(FIREWALL_PROFILES.ftps.extraPortSpecs).toContain('30000:30100');
    expect(FIREWALL_PROFILES.ftps.extraPortSpecs).toContain('21');
  });

  it('probes and mutates with honest blocks', async () => {
    const h = host({
      execute: true,
      root: true,
      paths: ['/usr/sbin/ufw'],
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status verbose')) {
          return {
            stdout: 'Status: active\nDefault: deny (incoming), allow (outgoing)\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('status numbered')) {
          return {
            stdout: '[ 1] 22/tcp ALLOW IN Anywhere\n[ 2] Anywhere DENY IN 1.2.3.4\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const st = await probeFirewallDeep(h);
    expect(st.installed).toBe(true);
    expect(st.active).toBe('active');
    expect(st.denyFromIps).toContain('1.2.3.4');

    const blocked = host({ execute: false });
    expect((await firewallSetEnabled(blocked, true)).blocked).toBe(true);
    expect((await firewallDenyIp(h, 'bad')).ok).toBe(false);
    expect((await firewallDenyIp(h, '9.9.9.9')).ok).toBe(true);
    expect((await firewallDeleteDenyIp(h, '9.9.9.9')).ok).toBe(true);
    expect((await firewallDeleteRuleNumber(h, 0)).ok).toBe(false);
    expect((await firewallDeleteRuleNumber(h, 2)).ok).toBe(true);
    expect((await firewallAllowPort(h, 8080)).ok).toBe(true);
    expect((await firewallAllowPort(h, 99999)).ok).toBe(false);
  });

  it('parses fallback lines and extracts deny v6 labels', () => {
    const rules = parseUfwNumbered([
      '  Anywhere DENY IN 10.0.0.1',
      '[ 9] 443/tcp REJECT OUT Somewhere',
      '[ 2] Anywhere                   DENY IN     Anywhere (v6)',
      '[ 4] Anywhere                   DENY IN     10.0.0.1',
      'garbage line without action',
    ]);
    expect(rules.some((r) => r.action === '?' )).toBe(true);
    expect(rules.some((r) => r.action === 'REJECT' && r.direction === 'OUT')).toBe(true);
    // Anywhere (v6) is not a valid IP; numbered deny IP is extracted
    expect(extractDenyFromIps(rules)).toContain('10.0.0.1');
    expect(extractDenyFromIps(rules)).not.toContain('Anywhere');
  });

  it('probe branch table: not installed / inactive / root error / catch paths', async () => {
    const notInstalled = host({
      paths: [],
      run: (argv) => {
        // HostSoftwareProbe.resolveBin: empty stdout = missing
        if (argv.join(' ').includes('command -v')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false };
      },
    });
    const ni = await probeFirewallDeep(notInstalled);
    expect(ni.installed).toBe(false);
    expect(ni.notes.length).toBeGreaterThan(0);
    expect(ni.activeLabel).toBeTruthy();

    const inactive = host({
      paths: ['/usr/bin/ufw'],
      root: false,
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status verbose')) {
          return {
            stdout: 'Status: inactive\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('status numbered')) {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const ina = await probeFirewallDeep(inactive);
    expect(ina.active).toBe('inactive');
    expect(ina.activeLabel).toBeTruthy();

    const needRoot = host({
      paths: ['/usr/sbin/ufw'],
      root: false,
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status verbose')) {
          return {
            stdout: 'ERROR: You need to be root to run this script\n',
            stderr: '',
            exitCode: 1,
            argv,
            dryRun: false,
          };
        }
        throw new Error('numbered fail');
      },
    });
    const nr = await probeFirewallDeep(needRoot);
    expect(nr.active.toLowerCase()).toMatch(/root|error/i);
    expect(nr.notes.some((n) => n.length > 0)).toBe(true);

    const rootReadFail = host({
      paths: ['/usr/sbin/ufw'],
      root: true,
      run: (argv) => {
        if (argv.join(' ').includes('status verbose')) {
          return {
            stdout: 'need to be root somehow\n',
            stderr: '',
            exitCode: 1,
            argv,
            dryRun: false,
          };
        }
        return { stdout: 'ALLOW IN Anywhere', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const rrf = await probeFirewallDeep(rootReadFail);
    expect(rrf.activeLabel).toBeTruthy();

    let verboseCalls = 0;
    const verboseThrows = host({
      paths: ['/usr/sbin/ufw'],
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('status verbose')) {
          verboseCalls += 1;
          throw new Error('ufw crash');
        }
        if (s.includes('status numbered')) {
          return {
            stdout: '[1] 80 ALLOW IN Anywhere\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const vt = await probeFirewallDeep(verboseThrows);
    expect(verboseCalls).toBe(1);
    expect(vt.active).toBe('unknown');
  });

  it('mutation failure and success notes for enable/disable/deny/delete/allow', async () => {
    const failHost = host({
      execute: true,
      run: () => ({ stdout: '', stderr: 'boom', exitCode: 1, argv: [], dryRun: false }),
    });
    expect((await firewallSetEnabled(failHost, true)).ok).toBe(false);
    expect((await firewallSetEnabled(failHost, false)).ok).toBe(false);
    expect((await firewallDenyIp(failHost, '8.8.8.8')).ok).toBe(false);
    expect((await firewallDeleteDenyIp(failHost, '8.8.8.8')).ok).toBe(false);
    expect((await firewallDeleteRuleNumber(failHost, 3)).ok).toBe(false);
    expect((await firewallAllowPort(failHost, 53, 'udp')).ok).toBe(false);

    const okHost = host({
      execute: true,
      run: () => ({ stdout: 'ok', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    });
    expect((await firewallSetEnabled(okHost, false)).ok).toBe(true);
    expect((await firewallAllowPort(okHost, 443)).ok).toBe(true);
    const bothCalls: string[][] = [];
    const bothHost = host({
      execute: true,
      run: (argv) => {
        bothCalls.push(argv.map(String));
        return { stdout: 'ok', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    expect((await firewallAllowPort(bothHost, 53, 'both')).ok).toBe(true);
    expect(bothCalls.some((a) => a.includes('53/tcp'))).toBe(true);
    expect(bothCalls.some((a) => a.includes('53/udp'))).toBe(true);

    const blocked = host({ execute: false });
    expect((await firewallDenyIp(blocked, '1.1.1.1')).blocked).toBe(true);
    expect((await firewallDeleteDenyIp(blocked, '1.1.1.1')).blocked).toBe(true);
    expect((await firewallDeleteRuleNumber(blocked, 1)).blocked).toBe(true);
    expect((await firewallAllowPort(blocked, 80)).blocked).toBe(true);
    expect((await firewallDenyIp(okHost, '')).ok).toBe(false);
    expect((await firewallDeleteDenyIp(okHost, 'not-an-ip')).ok).toBe(false);
    expect((await firewallDeleteRuleNumber(okHost, 1000)).ok).toBe(false);
    expect((await firewallDeleteRuleNumber(okHost, 1.5 as unknown as number)).ok).toBe(false);

    expect(FIREWALL_PROFILES.mail.allowSmtp).toBe(true);
    expect(FIREWALL_PROFILES.web.short).toContain('SSH');
  });
});
