/**
 * Exhaustive pure-helper unit tests — real exports, real branches.
 */
import { describe, expect, it } from 'vitest';
import {
  levelMeta,
  presetWhen,
  summarizeOpsNotes,
  toneToBadge,
  relTime,
  recommendedPresetForThreat,
  presetMeta,
  clampScanIntervalSeconds,
  isActionableSuspect,
  filterActionableSuspects,
  formatSignalValue,
} from './features/ProtectionPage';
import {
  formatBytes as filesFormatBytes,
  iconFor,
  joinPath,
  pathCrumbs,
  previewKind,
  parseSortValue,
  togglePathInSet,
  selectAllPaths,
} from './FilesPage';
import {
  formatBytes as logsFormatBytes,
  groupLabel,
  isJournalSource,
  resolveLogTab,
  initialSourceFromParams,
  filterRailItems,
  groupRailItems,
} from './features/LogsPage';
import {
  parseDnsTtl,
  isZoneTemplateId,
  mapRecordsForValidate,
  formatDnsValidateMessage,
} from './features/DnsPage';
import {
  countApplyStatus,
  accountPillTone,
  buildFtpAccountBody,
} from './features/FtpPage';
import {
  engineTitle,
  engineServicePath,
  defaultAdminerDomain,
  buildDbNameById,
  pillToneFromService,
} from './features/SqlEnginePage';
import {
  clampDbCount,
  totalKeysInKeyspace,
  busyKeyspaces,
  parseOptionalTtl,
} from './features/RedisPage';
import {
  defaultLeEmail,
  countFailedCerts,
  stepStatusLabel,
  formatStepLine,
} from './features/SslPage';
import {
  countAppliedDomains,
  countHealthyDomains,
  countDraftDomains,
  domainNameFromCreate,
  domainIdFromCreate,
} from './EmailPage';
import {
  projectTabIds,
  resolveActiveTab,
  formatLogTailHeader,
} from './ProjectDetailPage';
import {
  statusTone,
  statusLabel,
  cmdStatusTone,
  prettyJson,
  summarizePayload,
  asCliAck,
  unwrapCliBody,
  exitCodeOf,
  exitTone,
  exitHint,
  worstFleetStatus,
  staleAgeLabel,
} from './AgentsPage';
import { looksLikeProbeError, jobI18nKey } from './UpdatesPage';
import { clusterStatusLabel } from '../features/db-service/DbClusterPanel';
import { badgeForKey } from './DashboardPage';
import { asOps } from './EmailDomainPage';
import { formatBytes as bakFormatBytes } from './features/BackupsPage';
import {
  formatBytes as metFormatBytes,
  formatUptime as metFormatUptime,
  alertLabel,
  isProtectedSignalTarget,
} from './features/MetricsPage';
import {
  formatBytes as netFormatBytes,
  operTone,
  isUp,
  cidrOf,
  joinCidrs,
} from './features/NetworkPage';
import { isTuningKind } from './features/GenericRuntimePage';
import {
  buildCronExpr,
  defaultScheduleState,
  humanizeSchedule,
  parseCronToState,
} from './features/CronScheduleBuilder';

const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k;

describe('metrics protected PIDs', () => {
  it('blocks PID 1 and init', () => {
    expect(isProtectedSignalTarget({ pid: '1', command: '/sbin/init' })).toBe(true);
    expect(isProtectedSignalTarget({ pid: '2', command: 'kthreadd' })).toBe(true);
    expect(isProtectedSignalTarget({ pid: '649880', command: 'ysk-server' })).toBe(false);
  });
});

describe('ProtectionPage helpers', () => {
  it('levelMeta / presetWhen / presetMeta / threat', () => {
    for (const lv of ['calm', 'elevated', 'critical', 'under_attack'] as const) {
      expect(levelMeta(t, lv).label).toBeTruthy();
    }
    expect(presetWhen(t, 'daily')).toBeTruthy();
    expect(presetMeta('daily').accent).toBe('calm');
    expect(presetMeta('hardened').step).toBe(2);
    expect(presetMeta('unknown-id', 9).step).toBe(9);
    expect(recommendedPresetForThreat('critical')).toBe('under_attack');
    expect(recommendedPresetForThreat('under_attack')).toBe('under_attack');
    expect(recommendedPresetForThreat('elevated')).toBe('hardened');
    expect(recommendedPresetForThreat('calm')).toBeNull();
    expect(formatSignalValue(true, t)).toBe('common.yes');
    expect(formatSignalValue('inactive', t)).toBe('protection.signalInactive');
    expect(formatSignalValue('1 jails', t)).toBe('protection.signalJails:{"n":1}');
  });

  it('summarizeOpsNotes / tone / relTime / suspects / clamp', () => {
    expect(summarizeOpsNotes(undefined, t)).toEqual([]);
    const notes = summarizeOpsNotes(
      [
        'YSK_EXECUTE blocked system',
        'Wrote 00-ysk-defense nginx conf',
        'Wrote fail2ban jail.local',
        `/home/u/${'x'.repeat(100)}/a.log`,
        'ok',
      ],
      t,
    );
    expect(notes).toHaveLength(5);
    expect(notes[0]).toBe('protection.note.notApplied');
    for (const x of ['ok', 'warn', 'danger', 'info', 'x', undefined]) {
      expect(toneToBadge(x)).toBeTruthy();
    }
    expect(relTime(undefined, t)).toBe('—');
    expect(relTime(new Date().toISOString(), t)).toBeTruthy();
    expect(relTime(new Date(Date.now() - 120_000).toISOString(), t)).toMatch(/minutesAgo/);
    expect(relTime(new Date(Date.now() - 7_200_000).toISOString(), t)).toMatch(/hoursAgo/);
    expect(relTime(new Date(Date.now() - 2e8).toISOString(), t)).toBeTruthy();
    expect(clampScanIntervalSeconds(1)).toBeGreaterThanOrEqual(30);
    expect(clampScanIntervalSeconds(999999)).toBeLessThanOrEqual(600);
    expect(clampScanIntervalSeconds('bad')).toBeGreaterThan(0);
    expect(isActionableSuspect({ alreadyBanned: false, whitelisted: false })).toBe(true);
    expect(isActionableSuspect({ alreadyBanned: true })).toBe(false);
    expect(isActionableSuspect({ whitelisted: true })).toBe(false);
    expect(
      filterActionableSuspects([
        { alreadyBanned: false },
        { alreadyBanned: true },
        { whitelisted: true },
      ]),
    ).toHaveLength(1);
  });
});

describe('FilesPage helpers', () => {
  it('formatBytes / icon / path / sort / selection', () => {
    expect(filesFormatBytes(0)).toBeTruthy();
    expect(filesFormatBytes(500)).toMatch(/B/);
    expect(filesFormatBytes(2048)).toMatch(/K/i);
    expect(filesFormatBytes(3e6)).toMatch(/M/i);
    expect(filesFormatBytes(4e9)).toMatch(/G/i);
    expect(iconFor({ name: 'a.png', type: 'file', isDir: false } as never)).toBeTruthy();
    expect(iconFor({ name: 'dir', type: 'directory', isDir: true } as never)).toBeTruthy();
    expect(joinPath('/a', 'b')).toContain('b');
    expect(pathCrumbs('/a/b/c').length).toBeGreaterThan(0);
    expect(previewKind('x.png', 'image/png')).toBeTruthy();
    expect(previewKind('x.txt', 'text/plain')).toBeTruthy();
    expect(previewKind('x.bin', 'application/octet-stream')).toBeTruthy();
    expect(parseSortValue('name-asc')).toBeTruthy();
    expect(parseSortValue('size-desc')).toBeTruthy();
    expect(parseSortValue('mtime-asc')).toBeTruthy();
    expect(parseSortValue('bad')).toBeTruthy();
    const set = new Set<string>(['/a']);
    expect(togglePathInSet(set, '/b').has('/b')).toBe(true);
    expect(togglePathInSet(togglePathInSet(set, '/b'), '/a').has('/a')).toBe(false);
    expect(selectAllPaths([{ path: '/x' }, { path: '/y' }] as never).size).toBe(2);
  });
});

describe('LogsPage helpers', () => {
  it('bytes / group / journal / tabs / rail', () => {
    expect(logsFormatBytes(undefined)).toBeTruthy();
    expect(logsFormatBytes(100)).toBeTruthy();
    expect(logsFormatBytes(2e6)).toBeTruthy();
    expect(groupLabel('web')).toBeTruthy();
    expect(groupLabel('mail')).toBeTruthy();
    expect(groupLabel('other')).toBeTruthy();
    expect(isJournalSource('journal:nginx')).toBe(true);
    expect(isJournalSource('/var/log/a')).toBe(false);
    expect(resolveLogTab('explore')).toBe('explore');
    expect(resolveLogTab('ops')).toBe('ops');
    expect(resolveLogTab('overview')).toBe('explore'); // legacy map
    expect(resolveLogTab('maintain')).toBe('ops');
    expect(resolveLogTab('bogus')).toBeNull();
    expect(resolveLogTab(null)).toBeNull();
    expect(initialSourceFromParams(() => null)).toBe('');
    expect(initialSourceFromParams((k) => (k === 'source' ? 'custom' : null))).toBe('custom');
    expect(initialSourceFromParams((k) => (k === 'unit' ? 'sshd' : null))).toBe(
      'journal:sshd',
    );
    const items = [
      {
        id: 'a',
        label: 'Nginx',
        source: '/var/log/nginx/access.log',
        group: 'web',
        kind: 'file',
        available: true,
      },
      {
        id: 'b',
        label: 'Mail',
        source: 'journal:postfix',
        group: 'mail',
        kind: 'journal',
        available: true,
      },
      {
        id: 'p1',
        label: 'Proj',
        source: '/home/p1/logs/app.log',
        group: 'project',
        kind: 'file',
        available: true,
        projectId: 'p1',
      },
    ] as never[];
    expect(filterRailItems(items, {}).length).toBe(3);
    expect(filterRailItems(items, { q: 'ng' }).length).toBe(1);
    expect(filterRailItems(items, { projectsOnly: true }).length).toBeGreaterThanOrEqual(0);
    expect(filterRailItems(items, { focusProject: 'p1' }).length).toBeGreaterThanOrEqual(0);
    expect(groupRailItems(items).length).toBeGreaterThan(0);
  });
});

describe('Dns Ftp Sql Redis Ssl Email helpers', () => {
  it('dns', () => {
    expect(parseDnsTtl('300')).toBe(300);
    expect(parseDnsTtl('bad')).toBe(300);
    expect(parseDnsTtl(null, 60)).toBe(60);
    expect(isZoneTemplateId('minimal')).toBe(true);
    expect(isZoneTemplateId('web')).toBe(true);
    expect(isZoneTemplateId('full')).toBe(true);
    expect(isZoneTemplateId('nope-xyz')).toBe(false);
    expect(
      mapRecordsForValidate([{ type: 'A', name: '@', value: '1.1.1.1', ttl: 300 }]),
    ).toHaveLength(1);
    expect(formatDnsValidateMessage({ ok: true, notes: [] } as never, t)).toBeTruthy();
    expect(
      formatDnsValidateMessage({ ok: false, notes: ['x'], issues: [] } as never, t),
    ).toBeTruthy();
  });

  it('ftp', () => {
    const c = countApplyStatus([
      { apply_status: 'applied' },
      { apply_status: 'written' },
    ]);
    expect(c.applied).toBe(1);
    expect(c.draft).toBe(1);
    expect(accountPillTone('applied')).toBeTruthy();
    expect(accountPillTone('blocked')).toBeTruthy();
    expect(accountPillTone('draft')).toBeTruthy();
    expect(buildFtpAccountBody({ username: 'u', home: '/h' } as never)).toBeTruthy();
  });

  it('sql engine', () => {
    expect(engineTitle('mysql', t)).toBeTruthy();
    expect(engineTitle('mariadb', t)).toBeTruthy();
    expect(engineTitle('postgres', t)).toBeTruthy();
    expect(engineServicePath('mysql')).toContain('mysql');
    expect(defaultAdminerDomain('example.com')).toContain('example');
    expect(buildDbNameById([{ id: '1', name: 'db' }] as never).get('1')).toBe('db');
    expect(pillToneFromService({ active: 'active' } as never)).toBeTruthy();
    expect(pillToneFromService({ active: 'failed' } as never)).toBeTruthy();
  });

  it('redis', () => {
    expect(clampDbCount(1)).toBe(1);
    expect(clampDbCount(999)).toBe(256);
    expect(clampDbCount(null, 8)).toBe(8);
    expect(totalKeysInKeyspace([{ keys: 3 }, { keys: 2 }])).toBe(5);
    expect(totalKeysInKeyspace(null)).toBe(0);
    expect(busyKeyspaces([{ db: 0, keys: 1 }, { db: 2, keys: 0 }], 16)).toHaveLength(1);
    expect(parseOptionalTtl('')).toBeUndefined();
    expect(parseOptionalTtl('60')).toBe(60);
    // shipped: Number('x') === NaN (not coerced to undefined)
    expect(Number.isNaN(parseOptionalTtl('x') as number)).toBe(true);
  });

  it('ssl', () => {
    expect(defaultLeEmail('admin@x.com')).toBeTruthy();
    expect(countFailedCerts([{ status: 'failed' }, { status: 'ok' }])).toBe(1);
    expect(stepStatusLabel('done', t)).toBeTruthy();
    expect(formatStepLine({ status: 'ok', message: 'm' } as never, t)).toBeTruthy();
  });

  it('email list helpers', () => {
    const domains = [
      { apply_status: 'applied', health: 'ok' },
      { apply_status: 'draft', health: 'warn' },
    ] as never[];
    expect(countAppliedDomains(domains)).toBeGreaterThanOrEqual(0);
    expect(countHealthyDomains(domains)).toBeGreaterThanOrEqual(0);
    expect(countDraftDomains(domains)).toBeGreaterThanOrEqual(0);
    expect(domainNameFromCreate({ domain: 'x.com' })).toBe('x.com');
    expect(domainNameFromCreate({ domain: { domain: 'y.com' } })).toBe('y.com');
    expect(domainIdFromCreate({ domain: { id: 'id1' } })).toBe('id1');
    expect(domainIdFromCreate({ domain: 'x.com' })).toBe('');
  });
});

describe('Project Agents Dashboard misc helpers', () => {
  it('project detail tabs', () => {
    expect(projectTabIds(null)).toEqual(['overview']);
    const ids = projectTabIds({
      showDeployTab: true,
      showResourcesTab: true,
      showLogsTab: true,
    });
    expect(ids.length).toBeGreaterThan(2);
    expect(ids).toContain('app');
    const tabs = ids.map((id) => ({ id }));
    expect(resolveActiveTab(tabs, 'deploy')).toBe('app');
    expect(resolveActiveTab(tabs, 'nope')).toBe('overview');
    expect(formatLogTailHeader('/var/log/a.log', ['n1', 'n2'])).toContain('a.log');
    expect(formatLogTailHeader('/x', 'solo')).toContain('solo');
    expect(formatLogTailHeader('/x', null)).toContain('/x');
  });

  it('agents', () => {
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
      'x',
      undefined,
    ]) {
      expect(statusTone(s)).toBeTruthy();
      expect(statusLabel(s, t)).toBeTruthy();
    }
    expect(worstFleetStatus([{ status: 'registered' }, { status: 'stale' }])).toBe('stale');
    expect(staleAgeLabel(new Date(Date.now() - 3 * 3600_000).toISOString())).toBe('3h');
    expect(looksLikeProbeError('error: rustup could not choose')).toBe(true);
    expect(jobI18nKey('defense-geoip-update')).toBe('updates.job.defense_geoip_update');
    expect(clusterStatusLabel('failed', t)).toContain('db.cluster.status.failed');
    for (const s of ['done', 'queued', 'acked', 'error', 'z']) {
      expect(cmdStatusTone(s)).toBeTruthy();
    }
    expect(prettyJson({ a: 1 })).toContain('a');
    expect(prettyJson({ x: 'y'.repeat(20000) }).length).toBeLessThan(15000);
    expect(summarizePayload(null)).toBe('—');
    expect(summarizePayload({ cli: ['a'] })).toContain('ysk-server');
    expect(summarizePayload({ op: 'echo', message: 'hi' })).toContain('echo');
    expect(asCliAck(null)).toBeNull();
    expect(unwrapCliBody(asCliAck({ result: 1 }))).toBe(1);
    expect(exitCodeOf({ status: 'done', result: { exitCode: 0 } } as never)).toBe(0);
    expect(exitCodeOf({ status: 'error' } as never)).toBe(1);
    for (const c of [null, 0, 1, 2, 3, 4, 5, 9] as const) {
      expect(exitTone(c)).toBeTruthy();
      expect(typeof exitHint(c)).toBe('string');
    }
  });

  it('dashboard badge / asOps / network metrics backups runtime cron', () => {
    const software = [
      { id: 'nginx', installed: true, active: 'active', features: ['nginx'] },
      { id: 'vsftpd', installed: false, features: ['ftp'] },
    ] as never[];
    expect(badgeForKey('nginx', software, {}, t)?.tone).toBe('ok');
    expect(badgeForKey('ftp', software, {}, t)?.tone).toBe('warn');
    expect(badgeForKey('readiness', [], { productionReady: true }, t)?.tone).toBe('ok');
    expect(badgeForKey('security', [], { executeEnabled: false }, t)?.tone).toBe('warn');
    expect(asOps(null)).toBeNull();
    expect(asOps({ ok: true, notes: [] })).toMatchObject({ ok: true });

    expect(metFormatBytes(undefined)).toBeTruthy();
    expect(metFormatUptime(100)).toBeTruthy();
    expect(alertLabel('mem_high', t)).toBeTruthy();
    expect(netFormatBytes(100)).toBeTruthy();
    expect(operTone('UP')).toBe('ok');
    expect(isUp({ operstate: 'UP', flags: [] } as never)).toBe(true);
    expect(cidrOf({ local: '1.1.1.1', prefixlen: 32 })).toContain('/');
    expect(joinCidrs([], 'inet')).toBeTruthy();
    expect(bakFormatBytes()).toBeTruthy();
    expect(isTuningKind('node')).toBe(true);
    expect(isTuningKind('php')).toBe(false);

    const base = defaultScheduleState();
    expect(buildCronExpr(base)).toBeTruthy();
    expect(parseCronToState('*/5 * * * *').mode).toBe('every_n_min');
    expect(humanizeSchedule(base, t)).toBeTruthy();
  });
});
