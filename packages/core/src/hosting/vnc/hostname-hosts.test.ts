import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import {
  applyHostnameToHosts,
  hostsHasShortAlias,
  hostsLineFor,
  probeHostnameResolves,
  sanitizeHostnameToken,
} from './hostname-hosts.js';

describe('hostsLineFor', () => {
  it('uses Debian 127.0.1.1 and optional FQDN', () => {
    expect(hostsLineFor('demo-server')).toBe('127.0.1.1 demo-server');
    expect(hostsLineFor('demo-server', 'demo-server.ysk.hk')).toBe(
      '127.0.1.1 demo-server demo-server.ysk.hk',
    );
    expect(hostsLineFor('demo-server', 'demo-server')).toBe('127.0.1.1 demo-server');
  });
});

describe('sanitizeHostnameToken', () => {
  it('keeps a short hostname and drops hostname -f error text', () => {
    expect(sanitizeHostnameToken('hermes')).toBe('hermes');
    expect(sanitizeHostnameToken('hermes.ysk.hk')).toBe('hermes.ysk.hk');
    expect(sanitizeHostnameToken('hostname: Name or service not known')).toBe('');
    expect(sanitizeHostnameToken('')).toBe('');
  });
});

describe('hostsHasShortAlias', () => {
  it('does not treat FQDN hermes.ysk.hk as short name hermes', () => {
    expect(hostsHasShortAlias('203.0.113.10 hermes.ysk.hk\n', 'hermes')).toBe(false);
    expect(hostsHasShortAlias('127.0.1.1 hermes.ysk.hk\n', 'hermes')).toBe(false);
  });

  it('matches an exact alias only', () => {
    expect(hostsHasShortAlias('127.0.1.1 hermes hermes.ysk.hk\n', 'hermes')).toBe(true);
    expect(hostsHasShortAlias('# 127.0.1.1 hermes\n', 'hermes')).toBe(false);
  });
});

function ok(stdout: string, exitCode = 0): RunResult {
  return { stdout, stderr: '', exitCode, argv: [], dryRun: false };
}

function mockHost(opts: {
  execute?: boolean;
  root?: boolean;
  hostname?: string;
  fqdn?: string;
  hostsFile?: string;
  writeExit?: number;
}): HostExecutor & { hostsFile: string; appends: number } {
  const state = {
    hostsFile: opts.hostsFile ?? '',
    appends: 0,
  };
  const hostname = opts.hostname ?? 'hermes';
  const host: HostExecutor & { hostsFile: string; appends: number } = {
    get hostsFile() {
      return state.hostsFile;
    },
    get appends() {
      return state.appends;
    },
    pathExists: () => true,
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    readFile: async (p: string) => {
      if (p === '/etc/hosts') return state.hostsFile;
      return '';
    },
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    listDir: async () => [],
    sysInfo: async () => ({}),
    serviceStatus: async () => ok(''),
    runCommand: async (argv: string[]) => {
      if (argv[0] === 'hostname' && argv[1] === '-s') return ok(hostname);
      if (argv[0] === 'hostname' && argv[1] === '-f') {
        return ok(opts.fqdn ?? 'hermes.ysk.hk', opts.fqdn ? 0 : 1);
      }
      if (argv[0] === 'getent' && (argv[1] === 'hosts' || argv[1] === 'ahosts')) {
        const name = String(argv[2] ?? '');
        const hit = hostsHasShortAlias(state.hostsFile, name);
        return hit ? ok(`127.0.1.1 ${name}`) : ok('', 2);
      }
      if (argv[0] === 'bash' && argv[1] === '-c') {
        const script = argv[2] ?? '';
        if (script.includes('printf') && script.includes('/etc/hosts')) {
          if ((opts.writeExit ?? 0) !== 0) {
            return ok('permission denied', opts.writeExit);
          }
          state.hostsFile += `\n127.0.1.1 ${hostname} hermes.ysk.hk\n`;
          state.appends += 1;
          return ok('');
        }
        return ok('');
      }
      return ok('');
    },
  };
  return host;
}

describe('probeHostnameResolves', () => {
  it('is false when only the FQDN is listed', async () => {
    const host = mockHost({
      hostsFile: '203.0.113.10 hermes.ysk.hk\n',
    });
    const p = await probeHostnameResolves(host);
    expect(p.hostname).toBe('hermes');
    expect(p.resolves).toBe(false);
    expect(p.line).toBe('127.0.1.1 hermes hermes.ysk.hk');
  });

  it('is true when the short name is an exact alias', async () => {
    const host = mockHost({
      hostsFile: '127.0.1.1 hermes hermes.ysk.hk\n',
    });
    const p = await probeHostnameResolves(host);
    expect(p.resolves).toBe(true);
  });
});

describe('applyHostnameToHosts', () => {
  it('appends a short-name line when grep -w would have skipped on the FQDN', async () => {
    const host = mockHost({
      hostsFile: '203.0.113.10 hermes.ysk.hk\n',
    });
    const r = await applyHostnameToHosts(host);
    expect(r.ok).toBe(true);
    expect(r.resolves).toBe(true);
    expect(r.apply_status).toBe('applied');
    expect(host.appends).toBe(1);
    expect(r.notes.join('\n')).toMatch(/hostnameAppended|Appended to \/etc\/hosts|已附加/);
    expect(r.notes.join('\n')).not.toMatch(
      /hostnameUnresolvable|will fail until|修好 \/etc\/hosts 之前/,
    );
  });

  it('does not rewrite when the name already resolves', async () => {
    const host = mockHost({
      hostsFile: '127.0.1.1 hermes hermes.ysk.hk\n',
    });
    const r = await applyHostnameToHosts(host);
    expect(r.ok).toBe(true);
    expect(host.appends).toBe(0);
    expect(r.notes.join(' ')).toMatch(
      /hostnameAlreadyResolves|already resolves|已可解析/,
    );
  });

  it('blocks without execute', async () => {
    const host = mockHost({
      execute: false,
      hostsFile: '203.0.113.10 hermes.ysk.hk\n',
    });
    const r = await applyHostnameToHosts(host);
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(host.appends).toBe(0);
  });
});
