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
    expect(FIREWALL_PROFILES.ftps.extraTcpPorts.length).toBeGreaterThan(0);
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
});
