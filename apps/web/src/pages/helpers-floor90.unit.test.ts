/**
 * Unit tests for pure helpers exported to climb line coverage to ≥90%.
 */
import { describe, expect, it } from 'vitest';
import {
  formatBytes as metFormatBytes,
  formatUptime as metFormatUptime,
  alertLabel,
} from './features/MetricsPage';
import {
  formatBytes as netFormatBytes,
  operTone,
  isUp,
  cidrOf,
  joinCidrs,
} from './features/NetworkPage';
import { statusTone as cdnStatusTone } from './features/CdnPage';
import { formatBytes as bakFormatBytes } from './features/BackupsPage';
import {
  formatUptime as topFormatUptime,
  kibToHuman,
} from '../features/metrics/TopHeaderPanel';
import { isTuningKind } from './features/GenericRuntimePage';

const t = (k: string) => (k === 'metrics.alert.mem_high' ? 'Memory high' : k);
const tUptime = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k;

describe('MetricsPage helpers', () => {
  it('formatBytes branches', () => {
    expect(metFormatBytes(undefined)).toBe('—');
    expect(metFormatBytes(Number.NaN)).toBe('—');
    expect(metFormatBytes(512)).toBe('512 B');
    expect(metFormatBytes(2048)).toMatch(/KB/);
    expect(metFormatBytes(3 * 1024 * 1024)).toMatch(/MB/);
    expect(metFormatBytes(2 * 1024 ** 3)).toMatch(/GB/);
  });

  it('formatUptime branches', () => {
    expect(metFormatUptime(undefined)).toBe('—');
    expect(metFormatUptime(Number.NaN)).toBe('—');
    expect(metFormatUptime(45)).toMatch(/m/);
    expect(metFormatUptime(3700)).toMatch(/h/);
    expect(metFormatUptime(90_000)).toMatch(/d/);
  });

  it('alertLabel known vs unknown', () => {
    expect(alertLabel('mem_high', t)).toBe('Memory high');
    expect(alertLabel('unknown_alert_xyz', t)).toBe('unknown_alert_xyz');
  });
});

describe('NetworkPage helpers', () => {
  it('formatBytes / operTone / isUp / cidr', () => {
    expect(netFormatBytes(undefined)).toBe('—');
    expect(netFormatBytes(100)).toBe('100 B');
    expect(netFormatBytes(2048)).toMatch(/KiB/);
    expect(netFormatBytes(3 * 1024 ** 2)).toMatch(/MiB/);
    expect(netFormatBytes(2 * 1024 ** 3)).toMatch(/GiB/);

    expect(operTone('UP')).toBe('ok');
    expect(operTone('down')).toBe('neutral');
    expect(operTone('UNKNOWN')).toBe('warn');

    expect(
      isUp({
        name: 'eth0',
        operstate: 'UP',
        flags: [],
        mtu: 1500,
        addresses: [],
        stats: { rxBytes: 0, txBytes: 0 },
      } as never),
    ).toBe(true);
    expect(
      isUp({
        name: 'lo',
        operstate: 'UNKNOWN',
        flags: ['LOOPBACK', 'UP'],
        mtu: 65536,
        addresses: [],
        stats: { rxBytes: 0, txBytes: 0 },
      } as never),
    ).toBe(true);
    expect(
      isUp({
        name: 'docker0',
        operstate: 'DOWN',
        flags: ['BROADCAST'],
        mtu: 1500,
        addresses: [],
        stats: { rxBytes: 0, txBytes: 0 },
      } as never),
    ).toBe(false);

    expect(cidrOf({ local: '10.0.0.1', prefixlen: 24 })).toBe('10.0.0.1/24');
    expect(joinCidrs([], 'inet')).toBe('—');
    expect(
      joinCidrs(
        [
          { family: 'inet', local: '1.1.1.1', prefixlen: 32 },
          { family: 'inet6', local: '::1', prefixlen: 128 },
        ] as never,
        'inet',
      ),
    ).toContain('1.1.1.1');
    const many6 = [0, 1, 2, 3].map((i) => ({
      family: 'inet6' as const,
      local: `fe80::${i}`,
      prefixlen: 64,
    }));
    expect(joinCidrs(many6 as never, 'inet6')).toMatch(/\+/);
  });
});

describe('Cdn / Backups / TopHeader / Runtime helpers', () => {
  it('cdn statusTone', () => {
    for (const s of ['online', 'applied', 'written', 'draining', 'planned', 'partial', 'offline', 'failed', 'other']) {
      expect(cdnStatusTone(s)).toBeTruthy();
    }
  });

  it('backups formatBytes', () => {
    expect(bakFormatBytes()).toBe('—');
    expect(bakFormatBytes(10)).toBe('10 B');
    expect(bakFormatBytes(2048)).toMatch(/KB/);
    expect(bakFormatBytes(5 * 1024 * 1024)).toMatch(/MB/);
  });

  it('TopHeader formatUptime / kibToHuman', () => {
    expect(topFormatUptime(-1, tUptime)).toBe('—');
    expect(topFormatUptime(Number.NaN, tUptime)).toBe('—');
    expect(topFormatUptime(100, tUptime)).toMatch(/:/);
    expect(topFormatUptime(100_000, tUptime)).toMatch(/uptimeDays/);
    expect(kibToHuman(0)).toBe('0');
    expect(kibToHuman(-1)).toBe('0');
    expect(kibToHuman(512)).toMatch(/KiB/);
    expect(kibToHuman(2048)).toMatch(/MiB/);
    expect(kibToHuman(3 * 1024 * 1024)).toMatch(/GiB/);
  });

  it('isTuningKind', () => {
    expect(isTuningKind('node')).toBe(true);
    expect(isTuningKind('python')).toBe(true);
    expect(isTuningKind('go')).toBe(true);
    expect(isTuningKind('rust')).toBe(true);
    expect(isTuningKind('php')).toBe(false);
  });
});
