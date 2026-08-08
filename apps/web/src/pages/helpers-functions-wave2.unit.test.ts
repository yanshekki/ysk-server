/**
 * Unit tests for pure helpers exported in function-coverage wave2.
 * Nested formatters / mappers / validators lifted from large page files.
 */
import { describe, expect, it } from 'vitest';

import {
  recommendedPresetForThreat,
  presetMeta,
  clampScanIntervalSeconds,
  isActionableSuspect,
  filterActionableSuspects,
} from './features/ProtectionPage';
import {
  pathCrumbs,
  previewKind,
  parseSortValue,
  togglePathInSet,
  selectAllPaths,
} from './FilesPage';
import {
  projectTabIds,
  resolveActiveTab,
  formatLogTailHeader,
} from './ProjectDetailPage';
import {
  parseDnsTtl,
  isZoneTemplateId,
  mapRecordsForValidate,
  formatDnsValidateMessage,
} from './features/DnsPage';
import {
  isJournalSource,
  resolveLogTab,
  initialSourceFromParams,
  filterRailItems,
  groupRailItems,
} from './features/LogsPage';
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

const t = (k: string) => k;

describe('ProtectionPage wave2 helpers', () => {
  it('recommendedPresetForThreat branches', () => {
    expect(recommendedPresetForThreat('low')).toBeNull();
    expect(recommendedPresetForThreat('elevated')).toBe('hardened');
    expect(recommendedPresetForThreat('under_attack')).toBe('under_attack');
    expect(recommendedPresetForThreat('critical')).toBe('under_attack');
  });

  it('presetMeta known + fallback', () => {
    expect(presetMeta('daily')).toEqual({ step: 1, accent: 'calm' });
    expect(presetMeta('emergency')).toEqual({ step: 4, accent: 'critical' });
    expect(presetMeta('unknown-preset', 9)).toEqual({
      step: 9,
      accent: 'calm',
    });
    expect(presetMeta('x')).toEqual({ step: 1, accent: 'calm' });
  });

  it('clampScanIntervalSeconds bounds', () => {
    expect(clampScanIntervalSeconds(120)).toBe(120);
    expect(clampScanIntervalSeconds('60')).toBe(60);
    expect(clampScanIntervalSeconds(10)).toBe(30);
    expect(clampScanIntervalSeconds(9999)).toBe(600);
    expect(clampScanIntervalSeconds('bad')).toBe(120);
    expect(clampScanIntervalSeconds(undefined)).toBe(120);
    expect(clampScanIntervalSeconds(0)).toBe(120);
  });

  it('actionable suspect filter', () => {
    expect(isActionableSuspect({})).toBe(true);
    expect(isActionableSuspect({ alreadyBanned: true })).toBe(false);
    expect(isActionableSuspect({ whitelisted: true })).toBe(false);
    expect(
      isActionableSuspect({ alreadyBanned: false, whitelisted: false }),
    ).toBe(true);
    const list = [
      { ip: '1', alreadyBanned: true },
      { ip: '2', whitelisted: true },
      { ip: '3' },
    ];
    expect(filterActionableSuspects(list).map((s) => s.ip)).toEqual(['3']);
  });
});

describe('FilesPage wave2 helpers', () => {
  it('pathCrumbs', () => {
    expect(pathCrumbs('.')).toEqual([]);
    expect(pathCrumbs('')).toEqual([]);
    expect(pathCrumbs('a/b/c')).toEqual(['a', 'b', 'c']);
    expect(pathCrumbs('/a//b/')).toEqual(['a', 'b']);
  });

  it('previewKind', () => {
    expect(previewKind('image/png')).toBe('image');
    expect(previewKind('application/pdf')).toBe('pdf');
    expect(previewKind('text/plain')).toBe('text');
    expect(previewKind('application/json')).toBe('text');
    expect(previewKind('application/javascript')).toBe('text');
    expect(previewKind('video/mp4')).toBe('video');
    expect(previewKind('audio/mpeg')).toBe('audio');
    expect(previewKind('application/octet-stream')).toBe('other');
    expect(previewKind('application/octet-stream', 'clip.mp4')).toBe('video');
    expect(previewKind('application/octet-stream', 'shot.webp')).toBe('image');
    expect(previewKind(undefined)).toBe('other');
    expect(previewKind(null)).toBe('other');
  });

  it('parseSortValue', () => {
    expect(parseSortValue('name:asc')).toEqual({ sort: 'name', order: 'asc' });
    expect(parseSortValue('size:desc')).toEqual({
      sort: 'size',
      order: 'desc',
    });
    expect(parseSortValue('mtime:asc')).toEqual({
      sort: 'mtime',
      order: 'asc',
    });
  });

  it('togglePathInSet / selectAllPaths', () => {
    const a = togglePathInSet(new Set(), 'p1');
    expect([...a]).toEqual(['p1']);
    const b = togglePathInSet(a, 'p1');
    expect([...b]).toEqual([]);
    const c = togglePathInSet(a, 'p2');
    expect([...c].sort()).toEqual(['p1', 'p2']);

    const items = [{ path: 'a' }, { path: 'b' }];
    expect([...selectAllPaths(items, 0)].sort()).toEqual(['a', 'b']);
    expect([...selectAllPaths(items, 2)]).toEqual([]);
  });
});

describe('ProjectDetailPage wave2 helpers', () => {
  it('projectTabIds from profile flags', () => {
    expect(projectTabIds(null)).toEqual(['overview']);
    expect(
      projectTabIds({
        showDeployTab: true,
        showResourcesTab: true,
        showLogsTab: true,
      }),
    ).toEqual(['overview', 'app', 'network', 'isolation', 'more']);
    expect(
      projectTabIds({
        showDeployTab: false,
        showResourcesTab: false,
        showLogsTab: false,
      }),
    ).toEqual(['overview', 'network', 'more']);
  });

  it('resolveActiveTab', () => {
    const tabs = [{ id: 'overview' }, { id: 'app' }];
    expect(resolveActiveTab(tabs, 'deploy')).toBe('app');
    expect(resolveActiveTab(tabs, 'app')).toBe('app');
    expect(resolveActiveTab(tabs, 'missing')).toBe('overview');
  });

  it('formatLogTailHeader', () => {
    expect(formatLogTailHeader('app.log')).toBe('# app.log\n');
    expect(formatLogTailHeader('app.log', 'note')).toBe('# app.log · note\n');
    expect(formatLogTailHeader('app.log', ['a', 'b'])).toBe(
      '# app.log · a · b\n',
    );
    expect(formatLogTailHeader('app.log', ['', 'b'])).toBe('# app.log · b\n');
    expect(formatLogTailHeader('app.log', null)).toBe('# app.log\n');
  });
});

describe('DnsPage wave2 helpers', () => {
  it('parseDnsTtl', () => {
    expect(parseDnsTtl('300')).toBe(300);
    expect(parseDnsTtl(600)).toBe(600);
    expect(parseDnsTtl('bad')).toBe(300);
    expect(parseDnsTtl(undefined)).toBe(300);
    expect(parseDnsTtl(null, 60)).toBe(60);
    expect(parseDnsTtl(0, 60)).toBe(60);
  });

  it('isZoneTemplateId', () => {
    expect(isZoneTemplateId('full')).toBe(true);
    expect(isZoneTemplateId('cdn')).toBe(true);
    expect(isZoneTemplateId('minimal')).toBe(true);
    expect(isZoneTemplateId('nope')).toBe(false);
  });

  it('mapRecordsForValidate + formatDnsValidateMessage', () => {
    expect(
      mapRecordsForValidate([
        { type: 'A', name: undefined, value: '1.2.3.4', ttl: '60' },
        {},
      ]),
    ).toEqual([
      { type: 'A', name: '@', value: '1.2.3.4', ttl: 60 },
      { type: '', name: '@', value: '', ttl: 300 },
    ]);

    expect(
      formatDnsValidateMessage(
        {
          ok: false,
          issues: [
            { level: 'error', message: 'E1' },
            { level: 'warn', message: 'W' },
            { level: 'error', message: 'E2' },
          ],
        },
        'fallback',
      ),
    ).toBe('E1；E2');
    expect(
      formatDnsValidateMessage(
        { ok: false, notes: ['n1', 'n2'] },
        'fallback',
      ),
    ).toBe('n1；n2');
    expect(formatDnsValidateMessage({ ok: false }, 'fallback')).toBe(
      'fallback',
    );
  });
});

describe('LogsPage wave2 helpers', () => {
  it('isJournalSource / resolveLogTab / initialSourceFromParams', () => {
    expect(isJournalSource('journal:nginx.service')).toBe(true);
    expect(isJournalSource('file:/var/log/x')).toBe(false);

    expect(resolveLogTab('journal')).toBe('explore');
    expect(resolveLogTab('maintain')).toBe('ops');
    expect(resolveLogTab('settings')).toBe('settings');
    expect(resolveLogTab('about')).toBe('about');
    expect(resolveLogTab('nope')).toBeNull();
    expect(resolveLogTab(null)).toBeNull();
    expect(resolveLogTab(undefined)).toBeNull();

    expect(
      initialSourceFromParams((k) => (k === 'source' ? 'file:/a' : null)),
    ).toBe('file:/a');
    expect(
      initialSourceFromParams((k) =>
        k === 'unit' ? 'sshd.service' : null,
      ),
    ).toBe('journal:sshd.service');
    expect(initialSourceFromParams(() => null)).toBe(
      'journal:nginx.service',
    );
  });

  it('filterRailItems', () => {
    const items = [
      {
        id: '1',
        source: 'journal:nginx.service',
        label: 'Nginx',
        group: 'web',
        kind: 'journal' as const,
        available: true,
      },
      {
        id: '2',
        source: 'project:p1:app.log',
        label: 'app.log',
        group: 'proj:p1',
        kind: 'project' as const,
        available: true,
        projectId: 'p1',
        meta: 'PHP app',
      },
      {
        id: '3',
        source: 'project:p2:x.log',
        label: 'x.log',
        group: 'proj:p2',
        kind: 'project' as const,
        available: true,
        projectId: 'p2',
      },
    ];
    expect(filterRailItems(items, { focusProject: 'p1' }).map((i) => i.id)).toEqual(
      ['2'],
    );
    expect(
      filterRailItems(items, { projectsOnly: true }).map((i) => i.id),
    ).toEqual(['2', '3']);
    expect(filterRailItems(items, { q: 'nginx' }).map((i) => i.id)).toEqual([
      '1',
    ]);
    expect(filterRailItems(items, { q: 'PHP' }).map((i) => i.id)).toEqual([
      '2',
    ]);
    expect(filterRailItems(items, { q: '  ' })).toHaveLength(3);
  });

  it('groupRailItems order + projects', () => {
    const items = [
      {
        id: 'j',
        source: 'journal:x',
        label: 'x',
        group: 'journal',
        kind: 'journal' as const,
        available: true,
      },
      {
        id: 'w',
        source: 'file:web',
        label: 'web',
        group: 'web',
        kind: 'file' as const,
        available: true,
      },
      {
        id: 'p',
        source: 'project:a:f',
        label: 'f',
        group: 'proj:alpha',
        kind: 'project' as const,
        available: true,
      },
      {
        id: 'c',
        source: 'file:custom',
        label: 'c',
        group: 'custom-group',
        kind: 'file' as const,
        available: true,
      },
    ];
    const groups = groupRailItems(items);
    expect(groups.map((g) => g.group)).toEqual([
      'journal',
      'web',
      'custom-group',
      'proj:alpha',
    ]);
    expect(groups.find((g) => g.group === 'proj:alpha')?.isProject).toBe(true);
    expect(groups.find((g) => g.group === 'journal')?.isProject).toBe(false);
  });
});

describe('FtpPage wave2 helpers', () => {
  it('countApplyStatus / accountPillTone / buildFtpAccountBody', () => {
    expect(
      countApplyStatus([
        { apply_status: 'applied' },
        { apply_status: 'draft' },
        { apply_status: 'applied' },
      ]),
    ).toEqual({ applied: 2, draft: 1 });
    expect(countApplyStatus([])).toEqual({ applied: 0, draft: 0 });

    expect(accountPillTone(0, 0)).toBe('warn');
    expect(accountPillTone(3, 0)).toBe('ok');
    expect(accountPillTone(3, 1)).toBe('warn');

    expect(
      buildFtpAccountBody({
        username: 'u',
        password: '',
        homePath: '',
        domain: '',
      }),
    ).toEqual({
      username: 'u',
      password_plain: undefined,
      homePath: undefined,
      domain: undefined,
    });
    expect(
      buildFtpAccountBody({
        username: 'u',
        password: 'secret',
        homePath: '/home/u',
        domain: 'x.com',
      }),
    ).toEqual({
      username: 'u',
      password_plain: 'secret',
      homePath: '/home/u',
      domain: 'x.com',
    });
  });
});

describe('SqlEnginePage wave2 helpers', () => {
  it('engineTitle / servicePath / adminer / db map / pill tone', () => {
    expect(engineTitle('mysql')).toBe('MySQL');
    expect(engineTitle('mariadb')).toBe('MariaDB');
    expect(engineServicePath('mysql')).toBe('/databases/mysql/service');
    expect(engineServicePath('mariadb')).toBe('/databases/mariadb/service');
    expect(defaultAdminerDomain('mysql')).toBe('adminer.mysql.local');
    expect(defaultAdminerDomain('mariadb')).toBe('adminer.mariadb.local');

    const map = buildDbNameById([
      { id: '1', name: 'alpha' },
      { id: '2', name: 42 },
    ]);
    expect(map.get('1')).toBe('alpha');
    expect(map.get('2')).toBe('42');
    expect(map.size).toBe(2);

    expect(pillToneFromService('ok')).toBe('ok');
    expect(pillToneFromService('warn')).toBe('warn');
    expect(pillToneFromService('danger')).toBe('danger');
    expect(pillToneFromService('neutral')).toBe('warn');
  });
});

describe('RedisPage wave2 helpers', () => {
  it('clampDbCount / totalKeys / busyKeyspaces / parseOptionalTtl', () => {
    expect(clampDbCount(undefined, undefined)).toBe(16);
    expect(clampDbCount(32)).toBe(32);
    expect(clampDbCount(null, 8)).toBe(8);
    expect(clampDbCount(0, 0)).toBe(16);
    expect(clampDbCount(999)).toBe(256);
    expect(clampDbCount(-5)).toBe(1);

    expect(totalKeysInKeyspace(null)).toBe(0);
    expect(totalKeysInKeyspace([])).toBe(0);
    expect(
      totalKeysInKeyspace([
        { keys: 3 },
        { keys: 7 },
      ]),
    ).toBe(10);

    expect(
      busyKeyspaces(
        [
          { db: 2, keys: 5 },
          { db: 0, keys: 1 },
          { db: 1, keys: 0 },
          { db: 99, keys: 9 },
        ],
        16,
      ),
    ).toEqual([
      { db: 0, keys: 1 },
      { db: 2, keys: 5 },
    ]);
    expect(busyKeyspaces(null, 16)).toEqual([]);

    expect(parseOptionalTtl('')).toBeUndefined();
    expect(parseOptionalTtl('60')).toBe(60);
    expect(parseOptionalTtl('0')).toBe(0);
  });
});

describe('SslPage wave2 helpers', () => {
  it('defaultLeEmail / countFailed / step lines / bindings', () => {
    expect(defaultLeEmail('example.com')).toBe('admin@example.com');

    expect(
      countFailedCerts([
        { status: 'failed' },
        { status: 'FAILED' },
        { status: 'issued' },
        {},
      ]),
    ).toBe(2);

    expect(stepStatusLabel('ok', t)).toBe('ssl.step.ok');
    expect(stepStatusLabel('blocked', t)).toBe('ssl.step.blocked');
    expect(stepStatusLabel('failed', t)).toBe('ssl.step.failed');
    expect(stepStatusLabel('skipped', t)).toBe('ssl.step.skipped');
    expect(stepStatusLabel('other', t)).toBe('ssl.step.skipped');

    expect(formatStepLine({ name: 'issue', status: 'ok' }, t)).toBe(
      'issue: ssl.step.ok',
    );
    expect(
      formatStepLine({ name: 'issue', status: 'failed', detail: 'nx' }, t),
    ).toBe('issue: ssl.step.failed — nx');
  });
});

describe('EmailPage wave2 helpers', () => {
  it('domain counts', () => {
    const items = [
      { apply_status: 'applied', health_score: 90 },
      { apply_status: 'draft', health_score: 50 },
      { apply_status: 'written', health_score: 80 },
      { health_score: 10 },
    ];
    expect(countAppliedDomains(items)).toBe(1);
    expect(countAppliedDomains(items, { status: { applied: 9 } })).toBe(9);
    expect(countHealthyDomains(items)).toBe(2);
    expect(countHealthyDomains(items, 91)).toBe(0);
    expect(countDraftDomains(items)).toBe(3);
    expect(
      countDraftDomains(items, { status: { draft: 2, written: 1 } }),
    ).toBe(3);
    expect(countDraftDomains([], { status: {} })).toBe(0);
  });

  it('create response mappers', () => {
    expect(domainNameFromCreate({ domain: 'a.com' })).toBe('a.com');
    expect(domainNameFromCreate({ domain: { domain: 'b.com' } })).toBe(
      'b.com',
    );
    expect(domainIdFromCreate({ domain: 'a.com' })).toBe('');
    expect(domainIdFromCreate({ domain: { id: 'd1' } })).toBe('d1');
    expect(domainIdFromCreate({ domain: {} })).toBe('');
  });
});
