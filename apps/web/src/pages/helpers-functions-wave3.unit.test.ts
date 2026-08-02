/**
 * Wave3 pure-helper coverage — EmailDomain, CDN, Protection, Network, Users,
 * Metrics, Updates, ServiceConsole, AI, ProjectDetail, Backups, Files.
 * Target: web functions ≥90%.
 */
import { describe, expect, it } from 'vitest';

import {
  asOps,
  normalizeApplyStatus,
  applyStatusTone,
  applyStatusPillKey,
  healthScoreTone,
  isDomainSuspended,
  formatDnsRecordsText,
  formatExternalTodosText,
  parseAliasDestinations,
  mailboxStatusTone,
  probeOkTone,
  mapLiveProbeRows,
  parsePolicyRate,
  isBootstrapPasswordValid,
  defaultWebmailDomain,
  defaultMailSslDomain,
  flagsResultToLog,
  deliverabilityItemTone,
  dnsblSummaryLabel,
  dnsblSummaryTone,
  uniqueIps,
} from './EmailDomainPage';
import {
  statusTone as cdnStatusTone,
  toggleMembership,
  parseGeoMapText,
  canDeleteCdnSite,
  parseCsvList,
  parseNodeWeight,
  emptyToUndefined,
  normalizeNodeRoles,
  joinCsv,
  formatNodeIp,
  defaultEdgeIds,
  filterEdgeOriginNodes,
  countOnlineNodes,
  formatCountMap,
  collectSiteOpNotes,
  siteOpSuccessI18nKey,
  cdnMsgIsError,
  formatHitRatePct,
  formatCdnPillLabel,
  stringifyGeoMap,
  isCdnNodeRole,
  isCdnSiteMode,
  isCdnDnsStrategy,
  buildCdnNodeBody,
  buildCdnSiteBody,
} from './features/CdnPage';
import {
  selectedKeys,
  banCountTone,
  scoreTone,
  isValidBanIpQuery,
  isProtectionTab,
  parseCommaList,
  installedTone,
  activeSignalsCount,
  needsEmergencyConfirm,
  needsPresetConfirm,
  confirmTokenForPreset,
  onOffLabel,
  geoModeNormalize,
  autoUpdateDefault,
  vhostLimitLabel,
  suspectRowClass,
  threatScore,
  threatLevelOrLow,
  joinZones,
  nginxLimitsTone,
  executePathTone,
  toggleInList,
  showRecommendedCta,
  levelMeta,
  recommendedPresetForThreat,
} from './features/ProtectionPage';
import {
  filterStubDns,
  parseMtu,
  isValidCidr,
  ifaceCountByState,
  routeLabel,
  parseDnsSearch,
  preferUplinkDns,
  matchesDownConfirm,
  operTone,
  joinCidrs,
} from './features/NetworkPage';
import {
  usageBar,
  usagePct,
  isUserSuspended,
  primaryRole,
  packageDiskLabel,
  userStatusTone,
  packageQuotaTone,
  filterUsersByQuery,
} from './UsersPage';
import {
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
  isUpgradableRow,
  matchesRiskFilter,
  matchesUpdateQuery,
  countHighRisk,
  countUpgradable,
  selfUpdateTone,
} from './UpdatesPage';
import {
  applyModeLabel,
  displayValue,
  collectDirtyKeys,
  seedDraftFromConsole,
  lifecycleActionKey,
  isNumberSetting,
  applyNumberPreset,
  isEnumSelected,
} from './features/ServiceConsolePage';
import {
  taskTone,
  statusLabel as aiStatusLabel,
  isTerminal,
  canApprove,
  canCancel,
  pipelinePhase,
  stepCount,
  stepProgress,
  canRerun,
  taskSortRank,
  truncateGoal,
  filterTasksByQuery,
  countActiveTasks,
} from './AiPage';
import {
  projectStatusTone,
  shortProjectId,
  matchesStopConfirm,
  filterLogLines,
  joinLogDirs,
  parseLogDirs,
  defaultResourceBody,
  hasDeployTab,
} from './ProjectDetailPage';
import {
  shortProjectId as bakShortId,
  isDryRunMode,
  remoteNeedsHost,
  resticReady,
  sortBackupsByMtime,
  filterBackups,
  totalBackupBytes,
} from './features/BackupsPage';
import {
  formatMtimeCell,
  isDirEntry,
  parentPath,
  filterEntriesByName,
  sortEntries,
  selectionLabel,
  isAbsolutePath,
} from './FilesPage';
import { shortFingerprint } from '../features/security/ssh/labels';

const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k;

describe('EmailDomain pure helpers (wave3)', () => {
  it('apply status / health / suspended', () => {
    expect(normalizeApplyStatus('APPLIED')).toBe('applied');
    expect(normalizeApplyStatus('written')).toBe('written');
    expect(normalizeApplyStatus(null)).toBe('draft');
    expect(normalizeApplyStatus('x')).toBe('draft');
    expect(applyStatusTone('applied')).toBe('ok');
    expect(applyStatusTone('draft')).toBe('warn');
    expect(applyStatusPillKey('applied')).toBe('email.pillApplied');
    expect(applyStatusPillKey('written')).toBe('email.pillManaged');
    expect(applyStatusPillKey('draft')).toBe('email.pillDraft');
    expect(healthScoreTone(90)).toBe('ok');
    expect(healthScoreTone(10)).toBe('warn');
    expect(healthScoreTone(null, 50)).toBe('warn');
    expect(isDomainSuspended({ suspended: true })).toBe(true);
    expect(isDomainSuspended({ status: 'suspended' })).toBe(true);
    expect(isDomainSuspended({})).toBe(false);
  });

  it('dns / todos / alias / mailbox / probe', () => {
    expect(
      formatDnsRecordsText([{ type: 'A', name: '@', value: '1.1.1.1' }]),
    ).toContain('A');
    expect(
      formatExternalTodosText([
        { completed: true, title: 't', description: 'd' },
        { completed: false, title: 'u' },
      ]),
    ).toMatch(/\[x\]/);
    expect(parseAliasDestinations('a@x.com, b@y.com;c')).toEqual([
      'a@x.com',
      'b@y.com',
      'c',
    ]);
    expect(mailboxStatusTone('active')).toBe('ok');
    expect(mailboxStatusTone('suspended')).toBe('neutral');
    expect(probeOkTone(true)).toBe('ok');
    expect(probeOkTone(false)).toBe('danger');
    expect(probeOkTone(null)).toBe('warn');
    const rows = mapLiveProbeRows(
      {
        mx: { ok: true, detail: 'ok' },
        spf: { ok: false },
        dkim: {},
      },
      'port25',
    );
    expect(rows.length).toBe(7);
    expect(rows[0].ok).toBe(true);
    expect(rows[1].ok).toBe(false);
  });

  it('policy / bootstrap / flags / deliverability / dnsbl / ips', () => {
    expect(parsePolicyRate(50)).toBe(50);
    expect(parsePolicyRate('x', 200)).toBe(200);
    expect(parsePolicyRate(0, 10)).toBe(10);
    expect(isBootstrapPasswordValid('12345678')).toBe(true);
    expect(isBootstrapPasswordValid('short')).toBe(false);
    expect(defaultWebmailDomain('ex.com')).toBe('webmail.ex.com');
    expect(defaultMailSslDomain('ex.com')).toBe('mail.ex.com');
    expect(
      flagsResultToLog({
        ok: true,
        apply_status: 'applied',
        notes: ['n'],
        blocked: false,
      }),
    ).toMatchObject({ ok: true, notes: ['n'] });
    expect(deliverabilityItemTone({ ok: true })).toBe('ok');
    expect(deliverabilityItemTone({ level: 'external' })).toBe('warn');
    expect(deliverabilityItemTone({ ok: false })).toBe('danger');
    expect(deliverabilityItemTone({})).toBe('neutral');
    expect(dnsblSummaryLabel(null, null, 'nt')).toBe('nt');
    expect(dnsblSummaryLabel({ ok: true }, null, 'nt')).toBe('Clean');
    expect(dnsblSummaryLabel({ ok: false }, null, 'nt')).toBe('Listed');
    expect(dnsblSummaryTone(null, { ok: true })).toBe('ok');
    expect(dnsblSummaryTone({ ok: false }, null)).toBe('danger');
    expect(dnsblSummaryTone(null, null)).toBe('default');
    expect(uniqueIps('1.1.1.1', ['1.1.1.1', '2.2.2.2', ''])).toEqual([
      '1.1.1.1',
      '2.2.2.2',
    ]);
    expect(asOps(null)).toBeNull();
    expect(asOps({ ok: true })).toMatchObject({ ok: true });
  });
});

describe('CDN pure helpers (wave3)', () => {
  it('membership / geo / delete / csv / weight / empty', () => {
    expect(cdnStatusTone('online')).toBe('ok');
    expect(toggleMembership(['a'], 'a')).toEqual([]);
    expect(toggleMembership(['a'], 'b')).toEqual(['a', 'b']);
    expect(parseGeoMapText('{"a":1}')).toEqual({ a: 1 });
    expect(parseGeoMapText('')).toBeNull();
    expect(canDeleteCdnSite({ apply_status: 'applying' })).toBe(false);
    expect(canDeleteCdnSite({ apply_status: 'applied' })).toBe(true);
    expect(parseCsvList('a, b  c')).toEqual(['a', 'b', 'c']);
    expect(parseNodeWeight('50')).toBe(50);
    expect(parseNodeWeight('x', 7)).toBe(7);
    expect(emptyToUndefined('  ')).toBeUndefined();
    expect(emptyToUndefined('x')).toBe('x');
    expect(normalizeNodeRoles([])).toEqual(['edge']);
    expect(normalizeNodeRoles(['origin'])).toEqual(['origin']);
    expect(joinCsv(['a', 'b'])).toBe('a, b');
  });

  it('node/site formatters and builders', () => {
    expect(formatNodeIp({ publicIpv4: ['1.1.1.1'] })).toBe('1.1.1.1');
    expect(formatNodeIp({ publicIpv6: ['::1'] })).toBe('::1');
    expect(formatNodeIp({})).toBe('—');
    expect(
      defaultEdgeIds([
        { id: 'o', roles: ['origin'] },
        { id: 'e', roles: ['edge'] },
      ]),
    ).toEqual(['e']);
    expect(
      filterEdgeOriginNodes([
        { roles: ['edge'] },
        { roles: ['shield'] },
        { roles: ['origin'] },
      ]),
    ).toHaveLength(2);
    expect(countOnlineNodes([{ status: 'online' }, { status: 'down' }])).toBe(1);
    expect(formatCountMap({ a: 1, b: 2 })).toMatch(/a=1/);
    expect(formatCountMap(null)).toBe('');
    expect(
      collectSiteOpNotes({
        notes: ['top'],
        edges: [{ name: 'e1', notes: ['n'] }, { notes: ['x'] }],
      }),
    ).toEqual(['top', 'e1: n', '?: x']);
    for (const a of [
      'apply',
      'purge',
      'dns-sync',
      'health-loop',
      'ssl/issue',
      'render',
    ] as const) {
      expect(siteOpSuccessI18nKey(a)).toBeTruthy();
    }
    expect(cdnMsgIsError('node offline')).toBe(true);
    expect(cdnMsgIsError('ok')).toBe(false);
    expect(formatHitRatePct(12)).toBe('12%');
    expect(formatHitRatePct(null)).toBe('—');
    expect(formatCdnPillLabel(2, 3)).toBe('2n / 3s');
    expect(stringifyGeoMap({ US: ['n1'] })).toContain('US');
    expect(stringifyGeoMap(null)).toBe('');
    expect(isCdnNodeRole('edge')).toBe(true);
    expect(isCdnNodeRole('nope')).toBe(false);
    expect(isCdnSiteMode('origin_pull')).toBe(true);
    expect(isCdnSiteMode('x')).toBe(false);
    expect(isCdnDnsStrategy('multi_a')).toBe(true);
    expect(isCdnDnsStrategy('x')).toBe(false);
    const nodeBody = buildCdnNodeBody({
      name: ' n ',
      region: '',
      roles: [],
      ipv4: '1.1.1.1,2.2.2.2',
      ipv6: '',
      healthUrl: '',
      baseUrl: ' http://x ',
      weight: 'bad',
      sshIdentityId: '',
      sshHost: 'h',
      sshUsername: 'root',
      fleetAgentId: '',
    });
    expect(nodeBody.region).toBe('default');
    expect(nodeBody.roles).toEqual(['edge']);
    expect(nodeBody.publicIpv4).toEqual(['1.1.1.1', '2.2.2.2']);
    expect(nodeBody.weight).toBe(100);
    const siteBody = buildCdnSiteBody({
      name: 's',
      domains: 'a.com,b.com',
      mode: 'origin_pull',
      originUrl: 'https://o',
      edgeNodeIds: ['e1'],
      shieldId: '',
      cacheEnabled: true,
      maxAge: '',
      dnsStrategy: 'multi_a',
      dnsZoneId: '',
      geoSubdomains: false,
      sslMode: 'off',
    });
    expect(siteBody.domains).toEqual(['a.com', 'b.com']);
    expect((siteBody.cache as { maxAge: string }).maxAge).toBe('10m');
  });
});

describe('Protection pure helpers (wave3)', () => {
  it('selection / tones / query / lists / confirm', () => {
    expect(selectedKeys({ a: true, b: false, c: true })).toEqual(['a', 'c']);
    expect(banCountTone(11)).toBe('warn');
    expect(banCountTone(2)).toBe('neutral');
    expect(scoreTone(50)).toBe('warn');
    expect(scoreTone(25)).toBe('info');
    expect(scoreTone(5)).toBe('ok');
    expect(isValidBanIpQuery('1.2.3.4')).toBe(true);
    expect(isValidBanIpQuery(null)).toBe(false);
    expect(isProtectionTab('command')).toBe(true);
    expect(isProtectionTab('nope')).toBe(false);
    expect(parseCommaList('a, b;c')).toEqual(['a', 'b', 'c']);
    expect(installedTone(true)).toBe('ok');
    expect(installedTone(false)).toBe('warn');
    expect(activeSignalsCount([{ points: 1 }, { points: 0 }])).toBe(1);
    expect(activeSignalsCount(null)).toBe(0);
    expect(needsEmergencyConfirm('emergency', true)).toBe(true);
    expect(needsEmergencyConfirm('emergency', true, 'EMERGENCY')).toBe(false);
    expect(needsPresetConfirm('hardened', true, false)).toBe(true);
    expect(needsPresetConfirm('emergency', true, false)).toBe(false);
    expect(confirmTokenForPreset('emergency')).toBe('EMERGENCY');
    expect(confirmTokenForPreset('daily')).toBeUndefined();
    expect(onOffLabel(true, 'ON', 'OFF')).toBe('ON');
    expect(geoModeNormalize('allow_list')).toBe('allow_list');
    expect(geoModeNormalize('x')).toBe('deny_list');
    expect(autoUpdateDefault(undefined)).toBe(true);
    expect(autoUpdateDefault(false)).toBe(false);
    expect(vhostLimitLabel(2, 5)).toBe('2/5');
    expect(suspectRowClass({ alreadyBanned: true })).toBe('banned');
    expect(suspectRowClass({ whitelisted: true })).toBe('whitelist');
    expect(suspectRowClass({})).toBe('actionable');
    expect(threatScore(null)).toBe(0);
    expect(threatLevelOrLow(undefined)).toBe('low');
    expect(joinZones(['a', 'b'])).toBe('a, b');
    expect(nginxLimitsTone(true)).toBe('ok');
    expect(executePathTone(true, true)).toBe('ok');
    expect(executePathTone(true, false)).toBe('warn');
    expect(toggleInList(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleInList(['a'], 'a')).toEqual([]);
    expect(showRecommendedCta('daily', 'hardened')).toBe(true);
    expect(showRecommendedCta('hardened', 'hardened')).toBe(false);
    expect(levelMeta(t, 'low').tone).toBe('ok');
    expect(recommendedPresetForThreat('elevated')).toBe('hardened');
  });
});

describe('Network / Users / Metrics helpers (wave3)', () => {
  it('network', () => {
    expect(filterStubDns(['1.1.1.1', '127.0.0.53', '8.8.8.8'])).toEqual([
      '1.1.1.1',
      '8.8.8.8',
    ]);
    expect(parseMtu('1500')).toBe(1500);
    expect(parseMtu('100')).toBeNull();
    expect(isValidCidr('10.0.0.1/24')).toBe(true);
    expect(isValidCidr('bad')).toBe(false);
    expect(
      ifaceCountByState([
        { operstate: 'UP', flags: [] },
        { operstate: 'DOWN', flags: [] },
      ]),
    ).toEqual({ up: 1, down: 1 });
    expect(routeLabel({ dst: 'default', gateway: '1.1.1.1', dev: 'eth0' })).toMatch(
      /default/,
    );
    expect(parseDnsSearch('a.com b.com')).toEqual(['a.com', 'b.com']);
    expect(
      preferUplinkDns({ uplinkServers: ['127.0.0.53', '8.8.8.8'] }),
    ).toEqual(['8.8.8.8']);
    expect(matchesDownConfirm('eth0', 'eth0')).toBe(true);
    expect(matchesDownConfirm('eth0', 'x')).toBe(false);
    expect(operTone('UP')).toBe('ok');
    expect(joinCidrs([], 'inet')).toBe('—');
  });

  it('users', () => {
    expect(usageBar(5, 10)).toMatch(/50%/);
    expect(usageBar(1, 0)).toMatch(/∞/);
    expect(usagePct(5, 10)).toBe(50);
    expect(usagePct(1, 0)).toBe(0);
    expect(isUserSuspended({ suspended: true })).toBe(true);
    expect(primaryRole(['admin', 'user'])).toBe('admin');
    expect(primaryRole([])).toBe('—');
    expect(packageDiskLabel(2048)).toMatch(/GB/);
    expect(packageDiskLabel(512)).toMatch(/MB/);
    expect(userStatusTone({ suspended: true })).toBe('danger');
    expect(userStatusTone({ totpEnabled: true })).toBe('ok');
    expect(userStatusTone({})).toBe('warn');
    expect(packageQuotaTone(95, 100)).toBe('danger');
    expect(packageQuotaTone(75, 100)).toBe('warn');
    expect(packageQuotaTone(10, 100)).toBe('ok');
    expect(
      filterUsersByQuery(
        [
          { username: 'alice', roles: ['admin'] },
          { username: 'bob', roles: ['user'] },
        ],
        'adm',
      ),
    ).toHaveLength(1);
  });

  it('metrics', () => {
    expect(cpuTone(95)).toBe('danger');
    expect(cpuTone(75)).toBe('warn');
    expect(cpuTone(10)).toBe('ok');
    expect(memTone(NaN)).toBe('neutral');
    expect(clampRefreshInterval(0)).toBe(1);
    expect(clampRefreshInterval(100)).toBe(60);
    expect(clampRefreshInterval('x')).toBe(2);
    const s = togglePid(new Set(['1']), '2');
    expect(s.has('2')).toBe(true);
    expect(togglePid(s, '2').has('2')).toBe(false);
    expect(
      matchProcessRow({ user: 'root', command: 'nginx', cpu: 10 }, 'ngin', 'none'),
    ).toBe(true);
    expect(
      matchProcessRow({ user: 'a', command: 'x', cpu: 1 }, '', 'cpu5'),
    ).toBe(false);
    expect(
      matchProcessRow({ user: 'me', command: 'x', mem: 10 }, '', 'mine', 'me'),
    ).toBe(true);
    expect(formatPct(12.34, 1)).toBe('12.3%');
    expect(formatPct(null)).toBe('—');
    expect(formatLoadAvg([0.1, 0.2, 0.3])).toMatch(/0\.10/);
    expect(formatLoadAvg(null)).toBe('—');
  });
});

describe('Updates / ServiceConsole / AI / Project / Backups / Files (wave3)', () => {
  it('updates', () => {
    expect(riskTone('high')).toBe('danger');
    expect(riskLabel('medium', t)).toBeTruthy();
    expect(
      isHighRisk({ risk: 'low', requiresApproval: true } as never),
    ).toBe(true);
    expect(
      isUpgradableRow({ candidateVersion: '2', currentVersion: '1' }),
    ).toBe(true);
    expect(
      matchesRiskFilter(
        { risk: 'high', candidateVersion: '2', currentVersion: '1' } as never,
        'high',
      ),
    ).toBe(true);
    expect(
      matchesRiskFilter(
        { risk: 'low', candidateVersion: '2', currentVersion: '1' } as never,
        'upgradable',
      ),
    ).toBe(true);
    expect(
      matchesUpdateQuery({ packageName: 'nginx', summary: 'web' }, 'ngin'),
    ).toBe(true);
    expect(
      countHighRisk([
        { risk: 'high' } as never,
        { risk: 'low' } as never,
      ]),
    ).toBe(1);
    expect(
      countUpgradable([
        { candidateVersion: '2', currentVersion: '1' },
        { candidateVersion: '1', currentVersion: '1' },
      ]),
    ).toBe(1);
    expect(selfUpdateTone('up_to_date')).toBe('ok');
    expect(selfUpdateTone('available')).toBe('warn');
    expect(selfUpdateTone('failed')).toBe('danger');
    expect(selfUpdateTone(null)).toBe('neutral');
  });

  it('service console', () => {
    expect(applyModeLabel('runtime')).toBeTruthy();
    expect(displayValue(undefined)).toBe('');
    expect(displayValue('x')).toBe('x');
    const cats = [
      {
        settings: [
          { key: 'a', liveValue: '1' },
          { key: 'b', liveValue: '2' },
        ],
      },
    ];
    expect(collectDirtyKeys(cats, { a: '9', b: '2' })).toEqual(['a']);
    expect(seedDraftFromConsole(cats)).toEqual({ a: '1', b: '2' });
    expect(lifecycleActionKey('restart')).toBeTruthy();
    expect(isNumberSetting({ type: 'number' })).toBe(true);
    expect(applyNumberPreset('5', 'min', { min: 1, max: 10 })).toBe('1');
    expect(applyNumberPreset('5', 'max', { min: 1, max: 10 })).toBe('10');
    expect(applyNumberPreset('5', 'mid', { min: 0, max: 10 })).toBe('5');
    expect(isEnumSelected('a', 'a')).toBe(true);
  });

  it('ai', () => {
    expect(taskTone('completed')).toBe('ok');
    expect(taskTone('failed')).toBe('danger');
    expect(taskTone('running')).toBe('warn');
    expect(aiStatusLabel('running', t as never)).toBeTruthy();
    expect(isTerminal('done')).toBe(true);
    expect(canApprove('planned')).toBe(true);
    expect(canCancel('running')).toBe(true);
    expect(pipelinePhase('completed')).toBe(3);
    expect(pipelinePhase('running')).toBe(2);
    const sc = stepCount({
      steps: [{ status: 'done' }, { status: 'pending' }],
    } as never);
    expect(sc.done).toBe(1);
    expect(sc.total).toBe(2);
    expect(stepProgress({ steps: [] } as never)).toBe(0);
    expect(canRerun('failed')).toBe(true);
    expect(taskSortRank('running')).toBe(0);
    expect(truncateGoal('hello world', 5)).toMatch(/…/);
    expect(truncateGoal('')).toBe('—');
    expect(
      filterTasksByQuery([{ goal: 'fix nginx' }, { goal: 'mail' }], 'ngin'),
    ).toHaveLength(1);
    expect(countActiveTasks([{ status: 'running' }, { status: 'done' }])).toBe(
      1,
    );
  });

  it('project detail', () => {
    expect(projectStatusTone('running')).toBe('ok');
    expect(projectStatusTone('failed')).toBe('danger');
    expect(shortProjectId('abcdefghij', 4)).toMatch(/…/);
    expect(matchesStopConfirm('p1', 'p1')).toBe(true);
    expect(filterLogLines(['A', 'bX'], 'x')).toEqual(['bX']);
    expect(joinLogDirs(['/a', '/b'])).toBe('/a\n/b');
    expect(parseLogDirs('/a\n/b\n')).toEqual(['/a', '/b']);
    expect(defaultResourceBody('db', 'main').kind).toBe('db');
    expect(hasDeployTab({ showDeployTab: true })).toBe(true);
  });

  it('backups', () => {
    expect(bakShortId('abcdefghijklmnop', 5)).toMatch(/…/);
    expect(isDryRunMode('preview')).toBe(true);
    expect(remoteNeedsHost('sftp')).toBe(true);
    expect(remoteNeedsHost('local')).toBe(false);
    expect(
      resticReady({ enabled: true, repoPath: '/r', password: 'secret' }),
    ).toBe(true);
    expect(resticReady({ enabled: false })).toBe(false);
    const sorted = sortBackupsByMtime([
      { mtime: '2020-01-01' },
      { mtime: '2024-01-01' },
    ]);
    expect(sorted[0].mtime).toBe('2024-01-01');
    expect(
      filterBackups([{ name: 'a', projectId: 'p1' }, { name: 'b' }], 'p1'),
    ).toHaveLength(1);
    expect(totalBackupBytes([{ bytes: 10 }, { bytes: 5 }])).toBe(15);
  });

  it('files + ssh label', () => {
    expect(formatMtimeCell('2024-01-01T12:00:00Z')).toMatch(/2024/);
    expect(formatMtimeCell(null)).toBe('—');
    expect(isDirEntry({ type: 'dir' })).toBe(true);
    expect(isDirEntry({ isDir: true })).toBe(true);
    expect(parentPath('/a/b/c')).toBe('/a/b');
    expect(parentPath('/')).toBe('/');
    expect(filterEntriesByName([{ name: 'a.txt' }, { name: 'b' }], 'txt')).toHaveLength(
      1,
    );
    const sorted = sortEntries(
      [
        { name: 'b', size: 1, isDir: false },
        { name: 'a', size: 2, isDir: true },
      ],
      { field: 'name', dir: 'asc' },
    );
    expect(sorted[0].isDir).toBe(true);
    expect(selectionLabel(3)).toBe('3');
    expect(isAbsolutePath('/x')).toBe(true);
    expect(isAbsolutePath('x')).toBe(false);
    expect(shortFingerprint(null)).toBe('—');
    expect(shortFingerprint('SHA256:abcdefghijklmnopqrstuvwxyz')).toMatch(/…/);
  });
});
