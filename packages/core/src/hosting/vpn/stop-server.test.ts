import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import { VpnService } from './service.js';

function host(opts: {
  execute?: boolean;
  root?: boolean;
  active?: Set<string>;
  stopFail?: Set<string>;
}): HostExecutor {
  const active = opts.active ?? new Set<string>();
  const stopFail = opts.stopFail ?? new Set<string>();
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('is-active') && s.includes('--quiet')) {
        const unit = argv[argv.length - 1] ?? '';
        return {
          stdout: '',
          stderr: '',
          exitCode: active.has(unit) ? 0 : 3,
          argv,
          dryRun: false,
        };
      }
      if (argv[0] === 'systemctl' && argv[1] === 'stop') {
        const unit = argv[2] ?? '';
        return {
          stdout: '',
          stderr: stopFail.has(unit) ? 'fail' : '',
          exitCode: stopFail.has(unit) ? 1 : 0,
          argv,
          dryRun: false,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('VpnService.stopServer', () => {
  it('blocks without EXECUTE', async () => {
    const vpn = new VpnService(mkdtempSync(join(tmpdir(), 'ysk-vpn-')), host({ execute: false }));
    const r = await vpn.stopServer({ engine: 'wireguard' });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.requiresExecute).toBe(true);
  });

  it('succeeds when unit already inactive', async () => {
    const vpn = new VpnService(mkdtempSync(join(tmpdir(), 'ysk-vpn-')), host({ active: new Set() }));
    const r = await vpn.stopServer({ engine: 'wireguard' });
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/stopped|WireGuard|wireguard/i);
  });

  it('stops an active WireGuard unit', async () => {
    const vpn = new VpnService(
      mkdtempSync(join(tmpdir(), 'ysk-vpn-')),
      host({ active: new Set(['wg-quick@wg0']) }),
    );
    const r = await vpn.stopServer({ engine: 'wireguard' });
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => n.includes('systemctl stop wg-quick@wg0'))).toBe(true);
  });
});
