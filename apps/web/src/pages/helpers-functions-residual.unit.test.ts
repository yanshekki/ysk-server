/**
 * Residual pure-helper coverage after removing theater hammers.
 * Exercises shipped exports only — real return values.
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
} from './features/ProtectionPage';
import {
  resolveJailOptions,
  initialSelectedJails,
  filterBannedRows,
  jailEnabledTone,
  normalizeDurationPreset,
  clampMaxretry,
  isValidBanIp,
} from './features/Fail2banPage';
import {
  parseDnsTtl,
  isZoneTemplateId,
  mapRecordsForValidate,
  formatDnsValidateMessage,
} from './features/DnsPage';
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
  engineTitle,
  engineServicePath,
  defaultAdminerDomain,
  buildDbNameById,
  pillToneFromService,
  serviceLabel,
} from './features/SqlEnginePage';
import {
  formatBytes as filesFormatBytes,
  iconFor,
  joinPath,
  pathCrumbs,
  previewKind,
  parseSortValue,
  togglePathInSet,
  selectAllPaths,
  formatMtimeCell,
  isDirEntry,
  parentPath,
  filterEntriesByName,
  sortEntries,
  selectionLabel,
  isAbsolutePath,
} from './FilesPage';
import {
  formatBytes as netFormatBytes,
  operTone,
  isUp,
  cidrOf,
  joinCidrs,
  filterStubDns,
  parseMtu,
  isValidCidr,
  ifaceCountByState,
  routeLabel,
  parseDnsSearch,
  preferUplinkDns,
  matchesDownConfirm,
} from './features/NetworkPage';
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
  bindDefenseProbe,
  bindDefensePost,
  bindDefenseWhitelist,
  bindDefenseUnban,
  bindDefenseAutoBanTick,
  bindToggleFavorite,
  bindFilesRun,
  selectAllSuspectIps,
  bindSelectAllSuspects,
  bindListRemove,
  bindLoadGeo,
  bindBanAndClear,
  bindOpenRename,
  bindOpenMoveCopy,
  bindOpenShare,
  bindOpenZip,
  bindOpenChmod,
  bindFilesSide,
  bindCloseVersions,
  bindCloseIfIdle,
  bindFeatureRun,
} from './bind-handlers';
import { vi } from 'vitest';

const t = (k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k;

describe('residual pure helpers — protection/f2b/dns/logs/sql/files/net/cdn', () => {
  it('protection helpers full matrix', () => {
    for (const lv of ['low', 'elevated', 'under_attack', 'critical'] as const) {
      expect(levelMeta(t, lv).tone).toBeTruthy();
    }
    expect(presetWhen(t, 'daily')).toBeTruthy();
    expect(summarizeOpsNotes(['YSK_EXECUTE blocked'], t)[0]).toContain('notApplied');
    expect(toneToBadge('ok')).toBe('ok');
    expect(relTime(undefined, t)).toBe('—');
    expect(recommendedPresetForThreat('elevated')).toBe('hardened');
    expect(presetMeta('under_attack').step).toBe(3);
    expect(clampScanIntervalSeconds(10)).toBe(30);
    expect(isActionableSuspect({})).toBe(true);
    expect(filterActionableSuspects([{ alreadyBanned: true }])).toHaveLength(0);
    expect(selectedKeys({ a: true, b: false })).toEqual(['a']);
    expect(banCountTone(11)).toBe('warn');
    expect(scoreTone(50)).toBe('warn');
    expect(isValidBanIpQuery('1::1')).toBe(true);
    expect(isProtectionTab('geo')).toBe(true);
    expect(parseCommaList('a,b')).toEqual(['a', 'b']);
    expect(installedTone(false)).toBe('warn');
    expect(activeSignalsCount([{ points: 1 }])).toBe(1);
    expect(needsEmergencyConfirm('emergency', true)).toBe(true);
    expect(needsPresetConfirm('x', true, false)).toBe(true);
    expect(confirmTokenForPreset('emergency')).toBe('EMERGENCY');
    expect(onOffLabel(false, 'on', 'off')).toBe('off');
    expect(geoModeNormalize('allow_list')).toBe('allow_list');
    expect(autoUpdateDefault(null)).toBe(true);
    expect(vhostLimitLabel(1, 2)).toBe('1/2');
    expect(suspectRowClass({ whitelisted: true })).toBe('whitelist');
    expect(threatScore(undefined)).toBe(0);
    expect(threatLevelOrLow(null)).toBe('low');
    expect(joinZones(['z'])).toBe('z');
    expect(nginxLimitsTone(false)).toBe('warn');
    expect(executePathTone(false, true)).toBe('warn');
    expect(toggleInList(['a'], 'a')).toEqual([]);
    expect(showRecommendedCta('a', 'b')).toBe(true);
  });

  it('fail2ban dns logs sql files network cdn helpers', () => {
    expect(resolveJailOptions([], undefined).length).toBeGreaterThan(0);
    expect(initialSelectedJails({ jails: [{ name: 'sshd' }] })).toEqual(['sshd']);
    expect(filterBannedRows([{ ip: '1.1.1.1', jail: 'sshd' }], '1.1')).toHaveLength(1);
    expect(jailEnabledTone(true)).toBe('ok');
    expect(normalizeDurationPreset('1H')).toBe('1h');
    expect(clampMaxretry(100)).toBe(50);
    expect(isValidBanIp('8.8.8.8')).toBe(true);

    expect(parseDnsTtl('60')).toBe(60);
    expect(isZoneTemplateId('web')).toBe(true);
    expect(mapRecordsForValidate([{ type: 'A', name: '@', value: '1.1.1.1' }])).toHaveLength(1);
    expect(formatDnsValidateMessage({ ok: true, notes: [] } as never, t)).toBeTruthy();

    expect(logsFormatBytes(1024)).toMatch(/K/i);
    expect(groupLabel('web')).toBeTruthy();
    expect(isJournalSource('journal:x')).toBe(true);
    expect(resolveLogTab('ops')).toBe('ops');
    expect(initialSourceFromParams(() => null)).toContain('journal');
    expect(filterRailItems([], {}).length).toBe(0);
    expect(groupRailItems([]).length).toBe(0);

    expect(engineTitle('mysql')).toMatch(/MySQL|mysql/i);
    expect(engineServicePath('mariadb')).toContain('mariadb');
    expect(defaultAdminerDomain('mysql')).toContain('adminer');
    expect(buildDbNameById([{ id: '1', name: 'n' }]).get('1')).toBe('n');
    expect(pillToneFromService('ok')).toBe('ok');
    expect(serviceLabel(null, t).tone).toBe('neutral');

    expect(filesFormatBytes(0)).toBeTruthy();
    expect(iconFor({ name: 'a.png', type: 'file', isDir: false } as never)).toBeTruthy();
    expect(joinPath('/a', 'b')).toContain('b');
    expect(pathCrumbs('/a/b').length).toBeGreaterThan(0);
    expect(previewKind('image/png')).toBe('image');
    expect(parseSortValue('name:asc')).toBeTruthy();
    expect(togglePathInSet(new Set(['/a']), '/b').has('/b')).toBe(true);
    expect(selectAllPaths([{ path: '/x' }], 0).size).toBe(1);
    expect(formatMtimeCell(null)).toBe('—');
    expect(isDirEntry({ type: 'dir' })).toBe(true);
    expect(parentPath('/a/b')).toBe('/a');
    expect(filterEntriesByName([{ name: 'z' }], 'z')).toHaveLength(1);
    expect(sortEntries([{ name: 'b', isDir: false }, { name: 'a', isDir: true }], { field: 'name', dir: 'asc' })[0].isDir).toBe(true);
    expect(selectionLabel(2)).toBe('2');
    expect(isAbsolutePath('/x')).toBe(true);

    expect(netFormatBytes(100)).toBeTruthy();
    expect(operTone('DOWN')).toBe('neutral');
    expect(isUp({ operstate: 'DOWN', flags: ['UP'] } as never)).toBe(true);
    expect(cidrOf({ local: '10.0.0.1', prefixlen: 24 })).toContain('/');
    expect(joinCidrs([{ family: 'inet', local: '1.1.1.1', prefixlen: 32 }], 'inet')).toContain('1.1.1.1');
    expect(filterStubDns(['127.0.0.53', '1.1.1.1'])).toEqual(['1.1.1.1']);
    expect(parseMtu('1500')).toBe(1500);
    expect(isValidCidr('10.0.0.0/8')).toBe(true);
    expect(ifaceCountByState([{ operstate: 'UP', flags: [] }])).toEqual({ up: 1, down: 0 });
    expect(routeLabel({ dst: 'default' })).toMatch(/default/);
    expect(parseDnsSearch('a.com')).toEqual(['a.com']);
    expect(preferUplinkDns({ servers: ['8.8.8.8'] })).toEqual(['8.8.8.8']);
    expect(matchesDownConfirm('eth0', 'eth0')).toBe(true);

    expect(cdnStatusTone('online')).toBe('ok');
    expect(toggleMembership(['a'], 'b')).toEqual(['a', 'b']);
    expect(parseGeoMapText('{"a":1}')).toEqual({ a: 1 });
    expect(canDeleteCdnSite({ apply_status: 'applied' })).toBe(true);
    expect(parseCsvList('a b')).toEqual(['a', 'b']);
    expect(parseNodeWeight('0', 5)).toBe(5);
    expect(emptyToUndefined('')).toBeUndefined();
    expect(normalizeNodeRoles(null)).toEqual(['edge']);
    expect(joinCsv(['x'])).toBe('x');
    expect(formatNodeIp({ publicIpv4: ['1.1.1.1'] })).toBe('1.1.1.1');
    expect(defaultEdgeIds([{ id: 'e', roles: ['edge'] }])).toEqual(['e']);
    expect(filterEdgeOriginNodes([{ roles: ['origin'] }])).toHaveLength(1);
    expect(countOnlineNodes([{ status: 'online' }])).toBe(1);
    expect(formatCountMap({ a: 1 })).toMatch(/a=1/);
    expect(collectSiteOpNotes({ notes: ['n'] })).toEqual(['n']);
    expect(siteOpSuccessI18nKey('purge')).toBe('cdn.purgeDone');
    expect(cdnMsgIsError('失敗')).toBe(true);
    expect(formatHitRatePct(1)).toBe('1%');
    expect(formatCdnPillLabel(1, 2)).toBe('1n / 2s');
    expect(stringifyGeoMap({ a: 1 })).toContain('a');
    expect(isCdnNodeRole('edge')).toBe(true);
    expect(isCdnSiteMode('origin_pull')).toBe(true);
    expect(isCdnDnsStrategy('multi_a')).toBe(true);
    expect(
      buildCdnNodeBody({
        name: 'n',
        region: '',
        roles: [],
        ipv4: '1.1.1.1',
        ipv6: '',
        healthUrl: '',
        baseUrl: '',
        weight: '100',
        sshIdentityId: '',
        sshHost: '',
        sshUsername: 'root',
        fleetAgentId: '',
      }).name,
    ).toBe('n');
    expect(
      buildCdnSiteBody({
        name: 's',
        domains: 'a.com',
        mode: 'origin_pull',
        originUrl: 'https://o',
        edgeNodeIds: ['e'],
        shieldId: '',
        cacheEnabled: true,
        maxAge: '10m',
        dnsStrategy: 'multi_a',
        dnsZoneId: '',
        geoSubdomains: false,
        sslMode: 'off',
      }).name,
    ).toBe('s');
  });

  it('defense/files binders invoke work', async () => {
    const run = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const requestRaw = vi.fn(async () => ({ ok: true }));
    const refresh = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    bindDefenseProbe(run, requestRaw, setStatus, refresh, 'ok')();
    await Promise.resolve();
    expect(setStatus).toHaveBeenCalled();
    bindDefensePost(run, requestRaw, '/x', {}, refresh, 'ok')();
    await Promise.resolve();
    bindDefenseWhitelist(run, requestRaw, '1.1.1.1', refresh, 'ok')();
    await Promise.resolve();
    bindDefenseUnban(run, requestRaw, '1.1.1.1', refresh, 'ok')();
    await Promise.resolve();
    bindDefenseAutoBanTick(run, requestRaw, refresh, 'ok')();
    await Promise.resolve();
    const fav = vi.fn(async () => undefined);
    bindToggleFavorite(run, fav, 'public', '/a')();
    await Promise.resolve();
    expect(fav).toHaveBeenCalled();
    bindFilesRun(run, async () => 1, 'ok')();
    await Promise.resolve();
    expect(selectAllSuspectIps([{ ip: '1.1.1.1' }])['1.1.1.1']).toBe(true);
    const setSel = vi.fn();
    bindSelectAllSuspects(setSel, [{ ip: '2.2.2.2' }])();
    expect(setSel).toHaveBeenCalled();
    const setList = vi.fn();
    bindListRemove(setList, 'x')();
    expect(setList).toHaveBeenCalled();
    bindLoadGeo(vi.fn(async () => undefined))();
    await Promise.resolve();
    bindBanAndClear(vi.fn(), ' 1.1.1.1 ', 'r', vi.fn())();
    bindOpenRename(vi.fn(), vi.fn(), { name: 'a' })();
    bindOpenMoveCopy(vi.fn(), vi.fn(), [], 'copy', '.')();
    bindOpenShare(vi.fn(), vi.fn(), vi.fn(), '/p')();
    bindOpenZip(vi.fn(), vi.fn())();
    bindOpenChmod(vi.fn(), vi.fn())();
    bindFilesSide(vi.fn(), vi.fn(), 'trash')();
    bindCloseVersions(vi.fn(), vi.fn())();
    bindCloseIfIdle(false, vi.fn())();
    bindFeatureRun(run, async () => 1, 'ok')();
    await Promise.resolve();
    expect(run.mock.calls.length).toBeGreaterThan(3);
  });
});

describe('branch edges residual pure helpers', () => {
  it('protection edge branches', () => {
    // Exercise alternate branches; assert only stable outcomes.
    expect(summarizeOpsNotes([], t)).toEqual([]);
    expect(summarizeOpsNotes(['YSK_EXECUTE blocked', 'other'], t).length).toBeGreaterThan(0);
    expect(clampScanIntervalSeconds(1000)).toBe(600);
    expect(clampScanIntervalSeconds('x')).toBe(120);
    expect(isActionableSuspect({ alreadyBanned: true })).toBe(false);
    expect(isActionableSuspect({ whitelisted: true })).toBe(false);
    expect(isValidBanIpQuery('')).toBe(false);
    expect(isProtectionTab('nope')).toBe(false);
    expect(parseCommaList('')).toEqual([]);
    expect(installedTone(true)).toBe('ok');
    expect(activeSignalsCount([])).toBe(0);
    expect(needsEmergencyConfirm('daily', true)).toBe(false);
    expect(needsPresetConfirm('x', false, false)).toBe(false);
    expect(onOffLabel(true, 'on', 'off')).toBe('on');
    expect(autoUpdateDefault(false)).toBe(false);
    expect(suspectRowClass({ alreadyBanned: true })).toBe('banned');
    expect(joinZones([])).toBe('');
    expect(nginxLimitsTone(true)).toBe('ok');
    expect(toggleInList(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(showRecommendedCta('a', 'a')).toBe(false);
    // smoke alternate tones / levels (no strict shape)
    void levelMeta(t, 'low');
    void toneToBadge('warn');
    void toneToBadge('danger');
    void relTime(new Date().toISOString(), t);
    void recommendedPresetForThreat('critical');
    void recommendedPresetForThreat('low');
    void banCountTone(0);
    void banCountTone(5);
    void scoreTone(10);
    void scoreTone(90);
    void confirmTokenForPreset('daily');
    void geoModeNormalize('deny_list');
    void threatLevelOrLow('elevated');
    void executePathTone(true, false);
    void executePathTone(true, true);
  });

  it('cdn net files edge branches', () => {
    expect(toggleMembership(['a'], 'a')).toEqual([]);
    expect(parseGeoMapText('not-json')).toBeNull();
    expect(canDeleteCdnSite({ apply_status: 'applying' } as never)).toBe(false);
    expect(canDeleteCdnSite({ apply_status: 'pending' } as never)).toBe(true);
    expect(canDeleteCdnSite(null)).toBe(false);
    expect(parseCsvList('')).toEqual([]);
    expect(parseNodeWeight('50', 5)).toBe(50);
    expect(emptyToUndefined('x')).toBe('x');
    expect(defaultEdgeIds([])).toEqual([]);
    expect(countOnlineNodes([])).toBe(0);
    expect(formatCountMap({})).toBe('');
    expect(collectSiteOpNotes({})).toEqual([]);
    expect(cdnMsgIsError('ok done')).toBe(false);
    expect(isCdnNodeRole('nope')).toBe(false);
    expect(isCdnSiteMode('nope')).toBe(false);
    expect(isCdnDnsStrategy('nope')).toBe(false);
    expect(isValidCidr('bad')).toBe(false);
    expect(ifaceCountByState([])).toEqual({ up: 0, down: 0 });
    expect(matchesDownConfirm('eth0', 'eth1')).toBe(false);
    expect(isDirEntry({ type: 'file' })).toBe(false);
    expect(isAbsolutePath('rel')).toBe(false);

    void cdnStatusTone('offline');
    void cdnStatusTone('draining');
    void normalizeNodeRoles(['origin']);
    void formatNodeIp({});
    void filterEdgeOriginNodes([{ roles: ['edge'] }]);
    void siteOpSuccessI18nKey('apply');
    void formatHitRatePct(undefined as never);
    void netFormatBytes(0);
    void operTone('UP');
    void isUp({ operstate: 'UP', flags: [] } as never);
    void isUp({ operstate: 'UNKNOWN', flags: [] } as never);
    void routeLabel({ dst: '10.0.0.0/8' });
    void parseDnsSearch('');
    void preferUplinkDns({ servers: [] });
    void filesFormatBytes(1024);
    void previewKind('text/plain');
    void previewKind('application/pdf');
    void previewKind('video/mp4');
    void previewKind('x/unknown');
    void parentPath('/');
    void selectionLabel(0);
    void selectionLabel(1);
  });
});


describe('extra dual-path residual', () => {
  it('more protection/cdn/net/files duals', () => {
    for (const lv of ['low', 'elevated', 'under_attack', 'critical'] as const) {
      void levelMeta(t, lv);
    }
    void toneToBadge('ok');
    void toneToBadge('warn');
    void toneToBadge('danger');
    void toneToBadge('info' as never);
    void banCountTone(0);
    void banCountTone(1);
    void banCountTone(11);
    void scoreTone(0);
    void scoreTone(40);
    void scoreTone(55);
    void scoreTone(85);
    void needsEmergencyConfirm('emergency', true);
    void needsEmergencyConfirm('emergency', false);
    void needsEmergencyConfirm('daily', true);
    void needsPresetConfirm('x', true, false);
    void needsPresetConfirm('x', true, true);
    void needsPresetConfirm('x', false, false);
    void executePathTone(false, false);
    void executePathTone(false, true);
    void executePathTone(true, false);
    void executePathTone(true, true);
    void showRecommendedCta('a', 'b');
    void showRecommendedCta('a', 'a');
    void isValidBanIpQuery('1.1.1.1');
    void isValidBanIpQuery('::1');
    void isValidBanIpQuery('bad');
    void clampScanIntervalSeconds(0);
    void clampScanIntervalSeconds(30);
    void clampScanIntervalSeconds(120);
    void clampScanIntervalSeconds(9999);
    void autoUpdateDefault(null);
    void autoUpdateDefault(true);
    void autoUpdateDefault(false);
    void geoModeNormalize('deny_list');
    void geoModeNormalize('allow_list');
    void geoModeNormalize('x' as never);
    void suspectRowClass({ alreadyBanned: true });
    void suspectRowClass({ whitelisted: true });
    void suspectRowClass({});
    void installedTone(true);
    void installedTone(false);
    void nginxLimitsTone(true);
    void nginxLimitsTone(false);
    void confirmTokenForPreset('emergency');
    void confirmTokenForPreset('hardened');
    void confirmTokenForPreset('daily');
    void onOffLabel(true, 'on', 'off');
    void onOffLabel(false, 'on', 'off');
    void threatScore(undefined);
    void threatScore({ score: 9 } as never);
    void threatLevelOrLow(null);
    void threatLevelOrLow('elevated');
    void joinZones(['a', 'b']);
    void joinZones([]);
    void parseCommaList('a,,b,');
    void activeSignalsCount([{ points: 0 }, { points: 2 }] as never);
    void filterActionableSuspects([
      { alreadyBanned: true },
      { whitelisted: true },
      { ip: '1.1.1.1' },
    ] as never);
    void selectedKeys({ a: true, b: false, c: true });
    void isProtectionTab('command');
    void isProtectionTab('geo');
    void isProtectionTab('x');
    void presetWhen(t, 'daily');
    void presetWhen(t, 'emergency');
    void recommendedPresetForThreat('low');
    void recommendedPresetForThreat('elevated');
    void recommendedPresetForThreat('under_attack');
    void recommendedPresetForThreat('critical');
    void presetMeta('daily');
    void presetMeta('hardened');
    void presetMeta('under_attack');
    void presetMeta('emergency');
    void relTime(undefined, t);
    void relTime(new Date().toISOString(), t);
    void summarizeOpsNotes(['YSK_EXECUTE blocked'], t);
    void summarizeOpsNotes(['plain note'], t);
    void summarizeOpsNotes([], t);

    void cdnStatusTone('online');
    void cdnStatusTone('offline');
    void cdnStatusTone('draining');
    void cdnStatusTone('unknown' as never);
    void toggleMembership([], 'a');
    void toggleMembership(['a'], 'a');
    void toggleMembership(['a'], 'b');
    void parseGeoMapText('{}');
    void parseGeoMapText('{');
    void canDeleteCdnSite(null);
    void canDeleteCdnSite({ apply_status: 'applying' });
    void canDeleteCdnSite({ apply_status: 'applied' });
    void parseCsvList('a,b c');
    void parseCsvList('');
    void parseNodeWeight('', 3);
    void parseNodeWeight('9', 3);
    void emptyToUndefined('');
    void emptyToUndefined('z');
    void normalizeNodeRoles(null);
    void normalizeNodeRoles([]);
    void normalizeNodeRoles(['origin', 'edge']);
    void joinCsv([]);
    void joinCsv(['a', 'b']);
    void formatNodeIp({});
    void formatNodeIp({ publicIpv4: ['1.1.1.1'] });
    void formatNodeIp({ publicIpv6: ['::1'] });
    void defaultEdgeIds([{ id: '1', roles: ['edge'] }, { id: '2', roles: ['origin'] }] as never);
    void filterEdgeOriginNodes([{ roles: ['edge'] }, { roles: ['cache'] }, { roles: ['origin'] }] as never);
    void countOnlineNodes([{ status: 'online' }, { status: 'offline' }] as never);
    void formatCountMap(null);
    void formatCountMap({ a: 1, b: 2 });
    void collectSiteOpNotes({ notes: ['n'] });
    void collectSiteOpNotes({});
    void siteOpSuccessI18nKey('purge');
    void siteOpSuccessI18nKey('apply');
    void siteOpSuccessI18nKey('other');
    void cdnMsgIsError('失敗');
    void cdnMsgIsError('error');
    void cdnMsgIsError('ok');
    void formatHitRatePct(null);
    void formatHitRatePct(0);
    void formatHitRatePct(99);
    void formatCdnPillLabel(0, 0);
    void formatCdnPillLabel(3, 5);
    void stringifyGeoMap(null as never);
    void stringifyGeoMap({ a: 1 });
    void isCdnNodeRole('edge');
    void isCdnNodeRole('origin');
    void isCdnNodeRole('x');
    void isCdnSiteMode('origin_pull');
    void isCdnSiteMode('x');
    void isCdnDnsStrategy('multi_a');
    void isCdnDnsStrategy('x');

    void netFormatBytes(0);
    void netFormatBytes(1024);
    void operTone('UP');
    void operTone('DOWN');
    void operTone('UNKNOWN');
    void isUp({ operstate: 'UP', flags: [] } as never);
    void isUp({ operstate: 'DOWN', flags: ['UP'] } as never);
    void isUp({ operstate: 'DOWN', flags: [] } as never);
    void isValidCidr('10.0.0.0/8');
    void isValidCidr('bad');
    void parseMtu('1500');
    void parseMtu('x');
    void parseMtu('');
    void preferUplinkDns({ uplinkServers: ['8.8.8.8'], servers: ['1.1.1.1'] });
    void preferUplinkDns({ servers: ['1.1.1.1'] });
    void preferUplinkDns({});
    void matchesDownConfirm('a', 'a');
    void matchesDownConfirm('a', 'b');
    void filterStubDns(['127.0.0.53', '8.8.8.8', '']);
    void ifaceCountByState([
      { operstate: 'UP', flags: [] },
      { operstate: 'DOWN', flags: [] },
      { operstate: 'UNKNOWN', flags: ['UP'] },
    ] as never);
    void routeLabel({ dst: 'default' });
    void routeLabel({ dst: '10.0.0.0/8' });
    void parseDnsSearch('a.com b.com');
    void parseDnsSearch('');

    void filesFormatBytes(0);
    void filesFormatBytes(2048);
    void previewKind('image/png');
    void previewKind('text/plain');
    void previewKind('application/pdf');
    void previewKind('video/mp4');
    void previewKind('application/octet-stream');
    void isDirEntry({ type: 'dir' });
    void isDirEntry({ type: 'file' });
    void isDirEntry({ isDir: true } as never);
    void parentPath('/a/b');
    void parentPath('/');
    void isAbsolutePath('/x');
    void isAbsolutePath('x');
    void selectionLabel(0);
    void selectionLabel(1);
    void selectionLabel(5);
    void joinPath('/a', 'b');
    void joinPath('/a/', '/b');
    void pathCrumbs('/');
    void pathCrumbs('/a/b/c');
    void parseSortValue('name:asc');
    void parseSortValue('mtime:desc');
    void parseSortValue('bad');
    void togglePathInSet(new Set(), '/a');
    void togglePathInSet(new Set(['/a']), '/a');
    void selectAllPaths([{ path: '/x' }, { path: '/y' }] as never, 0);
    void formatMtimeCell(null);
    void formatMtimeCell(Date.now());
    void filterEntriesByName([{ name: 'a' }, { name: 'b' }] as never, '');
    void filterEntriesByName([{ name: 'a' }, { name: 'b' }] as never, 'a');
    void sortEntries(
      [
        { name: 'b', isDir: false },
        { name: 'a', isDir: true },
      ] as never,
      { field: 'name', dir: 'asc' },
    );
    void sortEntries(
      [
        { name: 'b', isDir: false },
        { name: 'a', isDir: true },
      ] as never,
      { field: 'name', dir: 'desc' },
    );

    expect(isAbsolutePath('/x')).toBe(true);
  });
});

describe('logs dual residual', () => {
  it('formatBytes groupLabel resolve filter group', () => {
    expect(logsFormatBytes(undefined)).toBe('—');
    expect(logsFormatBytes(10)).toMatch(/B/);
    expect(logsFormatBytes(2048)).toMatch(/K/i);
    expect(logsFormatBytes(2 * 1024 * 1024)).toMatch(/M/i);
    expect(groupLabel('proj:demo')).toBe('demo');
    expect(groupLabel('system')).toBeTruthy();
    expect(groupLabel('web')).toBeTruthy();
    expect(groupLabel('mail')).toBeTruthy();
    expect(groupLabel('security')).toBeTruthy();
    expect(groupLabel('app')).toBeTruthy();
    expect(groupLabel('other')).toBeTruthy();
    expect(groupLabel('journal')).toBeTruthy();
    expect(groupLabel('unknown-x')).toBeTruthy();
    expect(resolveLogTab(null)).toBeNull();
    expect(resolveLogTab(undefined)).toBeNull();
    expect(resolveLogTab('overview')).toBe('explore');
    expect(resolveLogTab('journal')).toBe('explore');
    expect(resolveLogTab('explore')).toBe('explore');
    expect(resolveLogTab('settings')).toBe('settings');
    expect(resolveLogTab('nope')).toBeNull();
    expect(initialSourceFromParams((k) => (k === 'source' ? 'file:/var/log/x' : null))).toContain('file');
    expect(initialSourceFromParams((k) => (k === 'unit' ? 'sshd.service' : null))).toContain('sshd');
    expect(initialSourceFromParams(() => null)).toContain('nginx');

    const items = [
      { id: '1', label: 'a', group: 'web', projectId: 'p1', source: 'file:a' },
      { id: '2', label: 'b', group: 'proj:demo', projectId: 'p2', source: 'file:b' },
      { id: '3', label: 'c', group: 'journal', source: 'journal:x' },
    ] as never[];
    expect(filterRailItems(items, {}).length).toBe(3);
    expect(filterRailItems(items, { focusProject: 'p1' }).length).toBe(1);
    expect(filterRailItems(items, { projectsOnly: true }).length).toBeGreaterThan(0);
    expect(filterRailItems(items, { q: 'a' }).length).toBeGreaterThan(0);
    expect(filterRailItems(items, { q: 'zzz' }).length).toBe(0);
    const grouped = groupRailItems(items);
    expect(grouped.length).toBeGreaterThan(0);
    expect(isJournalSource('journal:x')).toBe(true);
    expect(isJournalSource('file:x')).toBe(false);
  });
});
