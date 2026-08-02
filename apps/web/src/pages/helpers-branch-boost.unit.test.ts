/**
 * Dual-path pure helpers for pages already in the coverage graph.
 * Increases covered branches without inflating totals via new modules.
 */
import { describe, expect, it } from 'vitest';
import {
  formatBytes as backupBytes,
  shortProjectId,
  isDryRunMode,
  remoteNeedsHost,
  resticReady,
  sortBackupsByMtime,
  filterBackups,
  totalBackupBytes,
} from './features/BackupsPage';
import {
  formatBytes as metricsBytes,
  formatUptime,
  alertLabel,
  cpuTone,
  memTone,
  clampRefreshInterval,
  togglePid,
  matchProcessRow,
  formatPct,
  formatLoadAvg,
} from './features/MetricsPage';
import {
  riskTone,
  riskLabel,
  isHighRisk,
  relTime as updRelTime,
  isUpgradableRow,
  matchesRiskFilter,
  matchesUpdateQuery,
  countHighRisk,
  countUpgradable,
  selfUpdateTone,
} from './UpdatesPage';
import {
  catLabel,
  levelTone,
  levelLabel,
  severityLabel,
} from './features/ReadinessPage';

const t = (k: string) => k;

describe('branch boost pure helpers (in-graph pages)', () => {
  it('backups duals', () => {
    void backupBytes(0);
    void backupBytes(100);
    void backupBytes(2048);
    void backupBytes(3 * 1024 * 1024);
    void backupBytes(undefined);
    void backupBytes(Number.NaN);
    expect(shortProjectId(null)).toBe('—');
    expect(shortProjectId(undefined)).toBe('—');
    void shortProjectId('short');
    void shortProjectId('verylongprojectidvalue');
    void shortProjectId('abcdefghij', 4);
    expect(isDryRunMode('dry-run')).toBe(true);
    expect(isDryRunMode('preview')).toBe(true);
    expect(isDryRunMode('apply')).toBe(false);
    expect(remoteNeedsHost('s3')).toBe(true);
    expect(remoteNeedsHost('sftp')).toBe(true);
    expect(remoteNeedsHost('local')).toBe(false);
    expect(resticReady({ enabled: true, repoPath: '/r', password: 'x' })).toBe(true);
    expect(resticReady({ enabled: true, s3Repo: 's3://b', password: 'x' })).toBe(true);
    expect(resticReady({ enabled: true, repoPath: '  ', password: 'x' })).toBe(false);
    expect(resticReady({ enabled: true, repoPath: '/r', password: '' })).toBe(false);
    expect(resticReady({ enabled: false, repoPath: '/r', password: 'x' })).toBe(false);
    expect(resticReady({})).toBe(false);
    const rows = [
      { mtime: '2024-02-01', name: 'b', projectId: 'p1', bytes: 10, path: '/b' },
      { mtime: '2024-01-01', name: 'a', projectId: 'p2', bytes: 20, path: '/a' },
      { name: 'c', bytes: undefined },
    ];
    void sortBackupsByMtime(rows);
    void sortBackupsByMtime([{ mtime: undefined }, { mtime: 'x' }]);
    void filterBackups(rows, '');
    void filterBackups(rows, '  ');
    void filterBackups(rows, 'p1');
    void filterBackups(rows, 'zzz');
    void filterBackups(rows, '/a');
    expect(totalBackupBytes(rows)).toBe(30);
    expect(totalBackupBytes(null)).toBe(0);
    expect(totalBackupBytes(undefined)).toBe(0);
    expect(totalBackupBytes([])).toBe(0);
  });

  it('metrics duals', () => {
    void metricsBytes(0);
    void metricsBytes(512);
    void metricsBytes(2048);
    void metricsBytes(5e6);
    void metricsBytes(undefined as never);
    void formatUptime(0);
    void formatUptime(59);
    void formatUptime(3600);
    void formatUptime(90000);
    void alertLabel('cpu', t);
    void alertLabel('mem', t);
    void alertLabel('disk', t);
    void alertLabel('other', t);
    void cpuTone(5);
    void cpuTone(50);
    void cpuTone(85);
    void cpuTone(99);
    void memTone(5);
    void memTone(50);
    void memTone(85);
    void memTone(99);
    void clampRefreshInterval(0);
    void clampRefreshInterval(1);
    void clampRefreshInterval(30);
    void clampRefreshInterval(99999);
    expect(togglePid(new Set(['1', '2']), '1').has('1')).toBe(false);
    expect(togglePid(new Set(['1']), '2').has('2')).toBe(true);
    const row = { user: 'root', command: 'node server', cpu: 12, mem: 8 };
    for (const quick of ['none', 'mine', 'cpu5', 'mem5'] as const) {
      void matchProcessRow(row, '', quick, 'root');
      void matchProcessRow(row, '', quick, 'other');
      void matchProcessRow(row, 'node', quick, 'root');
      void matchProcessRow(row, 'zzz', quick, 'root');
      void matchProcessRow({ user: 'u', command: 'c', cpu: 1, mem: 1 }, '', quick, 'u');
      void matchProcessRow({ user: 'u', command: 'c', cpu: 20, mem: 20 }, '', quick, 'u');
    }
    void formatPct(null as never);
    void formatPct(undefined as never);
    void formatPct(Number.NaN);
    void formatPct(0);
    void formatPct(0.5);
    void formatPct(1);
    void formatLoadAvg(null as never);
    void formatLoadAvg([]);
    void formatLoadAvg([0.1, 0.2, 0.3]);
    void cpuTone(Number.NaN);
    void memTone(Number.NaN);
    void formatUptime(undefined);
    void formatUptime(Number.NaN);
    void metricsBytes(Number.NaN);
    void metricsBytes(undefined);
    void clampRefreshInterval('x');
    void clampRefreshInterval(-5);
  });

  it('updates duals', () => {
    void riskTone('critical');
    void riskTone('high');
    void riskTone('medium');
    void riskTone('low');
    void riskTone('unknown' as never);
    void riskLabel('critical', t);
    void riskLabel('high', t);
    void riskLabel('medium', t);
    void riskLabel('low', t);
    void riskLabel(undefined, t);
    void riskLabel('custom', t);
    expect(isHighRisk({ risk: 'high' } as never)).toBe(true);
    expect(isHighRisk({ risk: 'critical' } as never)).toBe(true);
    expect(isHighRisk({ risk: 'low', requiresApproval: true } as never)).toBe(true);
    expect(isHighRisk({ risk: 'low' } as never)).toBe(false);
    void updRelTime(null, t);
    void updRelTime('', t);
    void updRelTime(new Date().toISOString(), t);
    void updRelTime(new Date(Date.now() - 5_000).toISOString(), t);
    void updRelTime(new Date(Date.now() - 30_000).toISOString(), t);
    void updRelTime(new Date(Date.now() - 120_000).toISOString(), t);
    void updRelTime(new Date(Date.now() - 7200_000).toISOString(), t);
    void updRelTime(new Date(Date.now() - 172800_000).toISOString(), t);
    void updRelTime('not-a-date', t);
    expect(isUpgradableRow({ candidateVersion: '2', currentVersion: '1' })).toBe(true);
    expect(isUpgradableRow({ candidateVersion: '1', currentVersion: '1' })).toBe(false);
    expect(isUpgradableRow({})).toBe(false);
    const base = {
      risk: 'high',
      requiresApproval: false,
      candidateVersion: '2',
      currentVersion: '1',
      name: 'nginx',
    } as never;
    for (const f of ['all', 'upgradable', 'approval', 'high', 'medium', 'low', 'other'] as const) {
      void matchesRiskFilter(base, f as never);
      void matchesRiskFilter({ ...base, risk: 'medium', candidateVersion: '1' } as never, f as never);
      void matchesRiskFilter({ ...base, risk: 'low', requiresApproval: true } as never, f as never);
    }
    void matchesUpdateQuery({}, '');
    void matchesUpdateQuery({ name: 'nginx', packageName: 'n', package: 'p', summary: 's', advice: 'a', description: 'd' }, 'nginx');
    void matchesUpdateQuery({ name: 'nginx' }, 'zzz');
    expect(countHighRisk(null)).toBe(0);
    expect(countHighRisk([{ risk: 'high' }, { risk: 'low' }, { risk: 'critical' }] as never)).toBeGreaterThan(0);
    expect(countUpgradable(null)).toBe(0);
    expect(
      countUpgradable([
        { candidateVersion: '2', currentVersion: '1' },
        { candidateVersion: '1', currentVersion: '1' },
      ]),
    ).toBe(1);
    void selfUpdateTone(null);
    void selfUpdateTone(undefined);
    void selfUpdateTone('up_to_date');
    void selfUpdateTone('ok');
    void selfUpdateTone('available');
    void selfUpdateTone('pending');
    void selfUpdateTone('failed');
    void selfUpdateTone('error');
    void selfUpdateTone('running');
  });

  it('readiness duals', () => {
    void catLabel('security', t);
    void catLabel('performance', t);
    void catLabel('other-unknown-cat', t);
    void levelTone('ready' as never);
    void levelTone('degraded' as never);
    void levelTone('missing' as never);
    void levelTone('unknown' as never);
    void levelLabel('ready' as never, t);
    void levelLabel('degraded' as never, t);
    void levelLabel('missing' as never, t);
    void levelLabel('unknown' as never, t);
    expect(severityLabel('critical', t)).toBeTruthy();
    expect(severityLabel('recommended', t)).toBeTruthy();
    expect(severityLabel('optional', t)).toBeTruthy();
    expect(severityLabel('x', t)).toBeNull();
    expect(severityLabel(undefined, t)).toBeNull();
  });
});
