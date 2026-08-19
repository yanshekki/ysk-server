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
import {
  isTuningKind,
  isRustupDefaultMissingText,
  looksLikeBinaryPath,
  looksLikeVersionBanner,
} from './features/GenericRuntimePage';
import {
  statusTone as agentStatusTone,
  statusLabel as agentStatusLabel,
  cmdStatusTone,
  prettyJson,
  summarizePayload,
  asCliAck,
  unwrapCliBody,
  exitCodeOf,
  exitTone,
  exitHint,
} from './AgentsPage';
import {
  summarizeOpsNotes,
  toneToBadge,
  relTime,
} from './features/ProtectionPage';
import { badgeForKey } from './DashboardPage';
import { asOps } from './EmailDomainPage';

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

describe('AgentsPage pure helpers', () => {
  const tr = (k: string) => k;

  it('statusTone / statusLabel / cmdStatusTone cover all branches', () => {
    for (const s of [
      'running',
      'connected',
      'not_installed',
      'registered',
      'stale',
      'failed',
      'error',
      'disconnected',
      'unknown',
      'other',
      undefined,
    ]) {
      expect(agentStatusTone(s)).toBeTruthy();
      expect(agentStatusLabel(s, tr)).toBeTruthy();
    }
    for (const s of ['done', 'queued', 'acked', 'error', 'other']) {
      expect(cmdStatusTone(s)).toBeTruthy();
    }
  });

  it('prettyJson / summarizePayload / cli ack unwrap', () => {
    expect(prettyJson({ a: 1 })).toContain('a');
    expect(prettyJson({ x: 'y'.repeat(20_000) }).length).toBeLessThan(13_000);
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expect(prettyJson(circ)).toBeTruthy();

    expect(summarizePayload(null)).toBe('—');
    expect(summarizePayload('raw')).toBe('raw');
    expect(summarizePayload({ cli: ['nginx', 'status'] })).toContain('ysk-server');
    expect(summarizePayload({ op: 'echo', message: 'hi' })).toContain('echo');
    expect(summarizePayload({ op: 'restart' })).toContain('restart');
    expect(summarizePayload({ deep: { nest: true } })).toMatch(/\{|…/);
    expect(summarizePayload({ long: 'x'.repeat(200) })).toMatch(/…/);

    expect(asCliAck(null)).toBeNull();
    expect(asCliAck('x')).toBeNull();
    const ack = asCliAck({ ok: true, exitCode: 0, result: { nested: 1 } })!;
    expect(unwrapCliBody(null)).toBeNull();
    expect(unwrapCliBody(ack)).toEqual({ nested: 1 });
    expect(unwrapCliBody({ ok: false })).toEqual({ ok: false });
  });

  it('exitCodeOf / exitTone / exitHint', () => {
    expect(exitCodeOf({ status: 'done', result: { exitCode: 0 } } as never)).toBe(0);
    expect(exitCodeOf({ status: 'error', result: null } as never)).toBe(1);
    expect(exitCodeOf({ status: 'queued', result: null } as never)).toBeNull();
    expect(exitTone(null)).toBe('neutral');
    expect(exitTone(0)).toBe('ok');
    expect(exitTone(2)).toBe('warn');
    expect(exitTone(3)).toBe('warn');
    expect(exitTone(4)).toBe('warn');
    expect(exitTone(1)).toBe('danger');
    expect(exitTone(99)).toBe('danger');
    for (const c of [0, 1, 2, 3, 4, 5, 9, null]) {
      expect(typeof exitHint(c)).toBe('string');
    }
  });
});

describe('ProtectionPage pure helpers', () => {
  const t = (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k);

  it('summarizeOpsNotes maps honesty / nginx / f2b / long paths', () => {
    expect(summarizeOpsNotes(undefined, t)).toEqual([]);
    expect(summarizeOpsNotes([], t)).toEqual([]);
    const notes = summarizeOpsNotes(
      [
        'need YSK_EXECUTE blocked system',
        'Wrote /etc/nginx/conf.d/00-ysk-defense.conf',
        'Wrote /etc/fail2ban/jail.local',
        `/home/user/very/long/path/${'x'.repeat(80)}/file.log`,
        'plain note',
      ],
      t,
    );
    expect(notes[0]).toBe('protection.note.notApplied');
    expect(notes[1]).toBe('protection.note.nginxWritten');
    expect(notes[2]).toBe('protection.note.f2bWritten');
    expect(notes[3]).toBeTruthy();
    expect(notes[4]).toBe('plain note');
  });

  it('toneToBadge / relTime', () => {
    for (const x of ['ok', 'warn', 'danger', 'info', 'other', undefined]) {
      expect(toneToBadge(x)).toBeTruthy();
    }
    expect(relTime(undefined, t)).toBe('—');
    expect(relTime(new Date().toISOString(), t)).toBe('protection.rel.justNow');
    expect(relTime(new Date(Date.now() - 120_000).toISOString(), t)).toMatch(/minutesAgo/);
    expect(relTime(new Date(Date.now() - 7200_000).toISOString(), t)).toMatch(/hoursAgo/);
    expect(relTime(new Date(Date.now() - 200_000_000).toISOString(), t)).toBeTruthy();
  });
});

describe('Dashboard badgeForKey / Email asOps', () => {
  const t = (k: string) => k;

  it('badgeForKey software and control-plane branches', () => {
    const software = [
      { id: 'nginx', installed: true, active: 'active', features: ['nginx'] },
      { id: 'vsftpd', installed: false, active: 'inactive', features: ['ftp'] },
    ] as never[];
    expect(badgeForKey('nginx', software, {}, t)?.tone).toBe('ok');
    expect(badgeForKey('ftp', software, {}, t)?.tone).toBe('warn');
    expect(badgeForKey('unknownFeatureKey', software, {}, t)?.label).toMatch(/panel/);
    expect(badgeForKey('readiness', [], { productionReady: true }, t)?.tone).toBe('ok');
    expect(badgeForKey('readiness', [], { productionReady: false }, t)?.tone).toBe('warn');
    expect(badgeForKey('security', [], { executeEnabled: false }, t)?.tone).toBe('warn');
    expect(badgeForKey('projects', [], { executeEnabled: true }, t)?.tone).toBe('ok');
    expect(badgeForKey('totallyUnknown', [], {}, t)?.tone).toBe('neutral');
  });

  it('runtime path vs version banner helpers', () => {
    expect(looksLikeBinaryPath('/usr/local/ysk/node/22/bin/node')).toBe(true);
    expect(looksLikeBinaryPath('v22.14.0')).toBe(false);
    expect(looksLikeVersionBanner('v22.14.0')).toBe(true);
    expect(looksLikeVersionBanner('/usr/bin/node')).toBe(false);
    expect(isRustupDefaultMissingText('error: rustup could not choose a version')).toBe(true);
    expect(isTuningKind('python')).toBe(true);
  });

  it('asOps honesty shape', () => {
    expect(asOps(null)).toBeNull();
    expect(asOps({ ok: true, notes: [] })).toMatchObject({ ok: true });
    // Defaults ok when shape is loose object
    expect(asOps({ foo: 1 })).toMatchObject({ ok: true, notes: [] });
    expect(asOps({ ok: false, blocked: true, requiresExecute: true, notes: ['x'] })).toMatchObject({
      ok: false,
      blocked: true,
    });
  });
});
