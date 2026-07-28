import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from './executor.js';
import { hostPowerAction, DEFAULT_POWER_DELAY } from './host-power.js';

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  onRun?: (argv: string[]) => RunResult;
}): HostExecutor & { runs: string[][] } {
  const runs: string[][] = [];
  return {
    runs,
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
      runs.push(argv);
      if (opts.onRun) return opts.onRun(argv);
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
    pathExists: () => false,
    isRoot: () => opts.isRoot !== false,
    executeEnabled: () => opts.executeEnabled !== false,
  };
}

describe('hostPowerAction', () => {
  it('blocks without execute or root', async () => {
    const r = await hostPowerAction({
      host: mockHost({ executeEnabled: false, isRoot: true }),
      action: 'reboot',
      confirm: 'REBOOT',
    });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.notes.join(' ')).toMatch(/YSK_EXECUTE|權限|root/i);
  });

  it('requires typed confirm for reboot', async () => {
    const r = await hostPowerAction({
      host: mockHost({}),
      action: 'reboot',
      confirm: 'wrong',
    });
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/REBOOT/);
  });

  it('requires POWEROFF confirm', async () => {
    const r = await hostPowerAction({
      host: mockHost({}),
      action: 'poweroff',
      confirm: 'REBOOT',
    });
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/POWEROFF/);
  });

  it('schedules reboot with correct argv on confirm', async () => {
    const host = mockHost({});
    const r = await hostPowerAction({
      host,
      action: 'reboot',
      confirm: 'REBOOT',
      delaySec: 10,
    });
    expect(r.ok).toBe(true);
    expect(r.action).toBe('reboot');
    expect(host.runs.some((a) => a[0] === 'shutdown' && a[1] === '-r')).toBe(true);
  });

  it('cancel does not need confirm', async () => {
    const r = await hostPowerAction({
      host: mockHost({}),
      action: 'cancel',
    });
    expect(r.ok).toBe(true);
    expect(r.notes.join(' ')).toMatch(/取消/);
  });

  it('exposes default delays', () => {
    expect(DEFAULT_POWER_DELAY.reboot).toBe(10);
    expect(DEFAULT_POWER_DELAY.poweroff).toBe(60);
  });
});
