/**
 * Cover bind-handlers fully — each factory + returned function path.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  alwaysFalse,
  alwaysTrue,
  bindAppendUnique,
  bindArg1,
  bindArg2,
  bindAsync,
  bindBanAndClear,
  bindBanOne,
  bindBusyApplyPolicy,
  bindBusyAutodiscover,
  bindBusyBootstrap,
  bindBusyCreateMailbox,
  bindBusyDnsblMulti,
  bindBusyDual,
  bindBusyFlagsUpdate,
  bindBusyListSieve,
  bindBusyLiveReload,
  bindBusyMailQueue,
  bindBusyMap,
  bindBusyMutateList,
  bindBusySet,
  bindBusySetAndTab,
  bindBusySetRelay,
  bindBusyWebmailSso,
  bindBusyWorkThen,
  bindBusyWriteSieve,
  bindCall1,
  bindCall2,
  bindCall3,
  bindCheck,
  bindClipboard,
  bindCloseIfIdle,
  bindCloseVersions,
  bindConfirm,
  bindDefenseAutoBanTick,
  bindDefensePost,
  bindDefenseProbe,
  bindDefensePut,
  bindDefenseUnban,
  bindDefenseWhitelist,
  bindDraftField,
  bindFeatureRun,
  bindFilesRun,
  bindFilesSide,
  bindIgnoreEvent,
  bindInput,
  bindListRemove,
  bindLoadGeo,
  bindNavigate,
  bindNumber,
  bindOpenChmod,
  bindOpenCreate,
  bindOpenMoveCopy,
  bindOpenRename,
  bindOpenShare,
  bindOpenZip,
  bindPreset,
  bindPrevent,
  bindRun,
  bindSelectAllSuspects,
  bindSeq,
  bindSet,
  bindToggle,
  bindToggleFavorite,
  bindToggleInList,
  bindToggleKey,
  bindToggleValue,
  bindVoid,
  constant,
  identity,
  noop,
  selectAllSuspectIps,
} from './bind-handlers';
describe('bind-handlers', () => {
  it('bindAsync resolves and swallows rejection', async () => {
    const ok = vi.fn(async () => 1);
    bindAsync(ok)();
    await Promise.resolve();
    expect(ok).toHaveBeenCalled();

    const bad = vi.fn(async () => {
      throw new Error('x');
    });
    bindAsync(bad)();
    await new Promise((r) => setTimeout(r, 0));
    expect(bad).toHaveBeenCalled();

    const sync = vi.fn(() => undefined);
    bindAsync(sync)();
    expect(sync).toHaveBeenCalled();
  });

  it('bindSet / bindToggle / bindInput / bindCheck / bindNumber', () => {
    const set = vi.fn();
    bindSet(set, 'v')();
    expect(set).toHaveBeenCalledWith('v');

    const setB = vi.fn();
    bindToggle(setB)();
    expect(setB).toHaveBeenCalled();
    const updater = setB.mock.calls[0][0] as (v: boolean) => boolean;
    expect(updater(true)).toBe(false);
    expect(updater(false)).toBe(true);

    const setS = vi.fn();
    bindInput(setS)({ target: { value: 'hi' } });
    expect(setS).toHaveBeenCalledWith('hi');

    const setC = vi.fn();
    bindCheck(setC)({ target: { checked: true } });
    expect(setC).toHaveBeenCalledWith(true);

    const setN = vi.fn();
    bindNumber(setN)({ target: { value: '42' } });
    expect(setN).toHaveBeenCalledWith(42);
    bindNumber(setN, 7)({ target: { value: 'x' } });
    expect(setN).toHaveBeenCalledWith(7);
  });

  it('bindArg / ignore / prevent / confirm / seq', async () => {
    const f1 = vi.fn((a: number) => a + 1);
    expect(bindArg1(f1, 2)()).toBe(3);
    const f2 = vi.fn((a: number, b: number) => a + b);
    expect(bindArg2(f2, 2, 3)()).toBe(5);

    const g = vi.fn();
    bindIgnoreEvent(g)('event');
    expect(g).toHaveBeenCalled();

    const p = vi.fn();
    const e = { preventDefault: vi.fn() };
    bindPrevent(p)(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(p).toHaveBeenCalled();

    const action = vi.fn(async () => undefined);
    const close = vi.fn();
    bindConfirm(action, close)();
    await new Promise((r) => setTimeout(r, 0));
    expect(action).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();

    const a = vi.fn();
    const b = vi.fn();
    bindSeq(a, b)();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
  });

  it('draft / selection / list / navigate / constants', () => {
    const setDraft = vi.fn();
    bindDraftField(setDraft, 'name')({ target: { value: 'x' } });
    const up = setDraft.mock.calls[0][0] as (p: Record<string, string>) => Record<string, string>;
    expect(up({ name: 'old', other: '1' })).toEqual({ name: 'x', other: '1' });

    const setSel = vi.fn();
    bindToggleKey(setSel, 'a')();
    const up2 = setSel.mock.calls[0][0] as (p: Record<string, boolean>) => Record<string, boolean>;
    expect(up2({ a: false })).toEqual({ a: true });
    expect(up2({ a: true })).toEqual({ a: false });

    const setList = vi.fn();
    bindToggleInList(setList, 'x')();
    const up3 = setList.mock.calls[0][0] as (p: string[]) => string[];
    expect(up3([])).toEqual(['x']);
    expect(up3(['x'])).toEqual([]);

    const nav = vi.fn();
    bindNavigate(nav, '/x')();
    expect(nav).toHaveBeenCalledWith('/x');

    noop();
    expect(alwaysTrue()).toBe(true);
    expect(alwaysFalse()).toBe(false);
    expect(identity(9)).toBe(9);
    expect(constant('z')()).toBe('z');
  });
});

describe('bind-handlers run/void/preset/ban', () => {
  it('bindRun / bindVoid / bindPreset / bindBanOne', async () => {
    const run = vi.fn(async () => undefined);
    bindRun(run, 'health', 'p1')();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith('health', 'p1', undefined);
    bindRun(run, 'quota', 'p1', { quotaMb: 1 })();
    await Promise.resolve();
    expect(run).toHaveBeenCalledWith('quota', 'p1', { quotaMb: 1 });

    const v = vi.fn(async () => {
      throw new Error('x');
    });
    bindVoid(v)();
    await new Promise((r) => setTimeout(r, 0));
    expect(v).toHaveBeenCalled();

    const apply = vi.fn(async () => undefined);
    bindPreset(apply, 'daily', true, false)();
    await Promise.resolve();
    expect(apply).toHaveBeenCalledWith('daily', true, false);

    const ban = vi.fn(async () => undefined);
    bindBanOne(ban, '1.2.3.4', 'r')();
    await Promise.resolve();
    expect(ban).toHaveBeenCalledWith('1.2.3.4', 'r');
  });
});

describe('bindCall*', () => {
  it('call1/2/3', async () => {
    const f1 = vi.fn(async (a: number) => a);
    bindCall1(f1, 1)();
    await Promise.resolve();
    expect(f1).toHaveBeenCalledWith(1);
    const f2 = vi.fn(async (a: number, b: string) => a);
    bindCall2(f2, 1, 'x')();
    await Promise.resolve();
    expect(f2).toHaveBeenCalledWith(1, 'x');
    const f3 = vi.fn(async (a: number, b: string, c: boolean) => a);
    bindCall3(f3, 1, 'x', true)();
    await Promise.resolve();
    expect(f3).toHaveBeenCalledWith(1, 'x', true);
  });
});

describe('bindClipboard / bindOpenCreate', () => {
  it('clipboard and open create', () => {
    const writeText = vi.fn(async () => undefined);
    // @ts-expect-error test shim
    globalThis.navigator = { clipboard: { writeText } };
    bindClipboard('hello')();
    expect(writeText).toHaveBeenCalledWith('hello');

    const open = vi.fn();
    const a = vi.fn();
    const b = vi.fn();
    bindOpenCreate(open, [a, b], ['x', 'y'])();
    expect(a).toHaveBeenCalledWith('x');
    expect(b).toHaveBeenCalledWith('y');
    expect(open).toHaveBeenCalledWith(true);
  });
});

describe('bindBusySet / bindBusyMap', () => {
  it('loads and sets', async () => {
    const withBusy = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const setter = vi.fn();
    bindBusySet(withBusy, async () => 42, setter)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setter).toHaveBeenCalledWith(42);

    const setter2 = vi.fn();
    bindBusyMap(withBusy, async () => ({ items: [1] }), setter2, (r) => r.items)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setter2).toHaveBeenCalledWith([1]);
  });
});

describe('bindBusyDual', () => {
  it('loads a and b', async () => {
    const withBusy = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const setA = vi.fn();
    const setB = vi.fn();
    bindBusyDual(withBusy, async () => 'a', setA, async () => 'b', setB)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setA).toHaveBeenCalledWith('a');
    expect(setB).toHaveBeenCalledWith('b');
  });
});

describe('bindToggleValue', () => {
  it('toggles', () => {
    const onChange = vi.fn();
    bindToggleValue(onChange, 'a', 'b')();
    expect(onChange).toHaveBeenCalledWith('b');
    bindToggleValue(onChange, 'b', 'b')();
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('email busy binders', () => {
  it('flags / mutate / tab / live / dnsbl / dual / workThen', async () => {
    const withBusy = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const setLog = vi.fn();
    const load = vi.fn(async () => undefined);
    const toLog = (r: Record<string, unknown>) => ({ mapped: true, ...r });
    const updateFlags = vi.fn(async () => ({ ok: true }));
    bindBusyFlagsUpdate(withBusy, updateFlags, 'd1', { suspended: true }, toLog, setLog, load)();
    await new Promise((r) => setTimeout(r, 0));
    expect(updateFlags).toHaveBeenCalled();
    expect(setLog).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();

    const mutate = vi.fn(async () => ({ ok: 1 }));
    const setRes = vi.fn();
    const list = vi.fn(async () => ({ items: [1, 2] }));
    const setItems = vi.fn();
    const after = vi.fn();
    bindBusyMutateList(withBusy, mutate, setRes, list, setItems, after)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setItems).toHaveBeenCalledWith([1, 2]);
    expect(after).toHaveBeenCalled();

    const setTab = vi.fn();
    const setD = vi.fn();
    bindBusySetAndTab(withBusy, async () => 'pack', setD, setTab, 'deliverability')();
    await new Promise((r) => setTimeout(r, 0));
    expect(setTab).toHaveBeenCalledWith('deliverability');

    const setLive = vi.fn();
    bindBusyLiveReload(withBusy, async () => ({ ok: true }), setLive, load)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setLive).toHaveBeenCalled();

    const setDnsbl = vi.fn();
    bindBusyDnsblMulti(
      withBusy,
      async () => ['9.9.9.9'],
      '1.1.1.1',
      async (ips) => ({ ips }),
      (p, e) => [p ?? '', ...e].filter(Boolean),
      setDnsbl,
    )();
    await new Promise((r) => setTimeout(r, 0));
    expect(setDnsbl).toHaveBeenCalled();

    const setA = vi.fn();
    const setB = vi.fn();
    bindBusyDual(withBusy, async () => 'a', setA, async () => 'b', setB)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setA).toHaveBeenCalledWith('a');

    const work = vi.fn(async () => undefined);
    bindBusyWorkThen(withBusy, work, load)();
    await new Promise((r) => setTimeout(r, 0));
    expect(work).toHaveBeenCalled();
  });

  it('autodiscover queue bootstrap sieve createMailbox policy relay sso', async () => {
    const withBusy = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const setLog = vi.fn();
    const writeText = vi.fn(async () => undefined);
    // @ts-expect-error shim
    globalThis.navigator = { clipboard: { writeText } };

    bindBusyAutodiscover(
      withBusy,
      async () => ({ notes: ['n'], mozillaXml: 'x'.repeat(300), urls: {} }),
      setLog,
    )();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).toHaveBeenCalled();

    bindBusyMailQueue(withBusy, async () => ({ items: Array.from({ length: 30 }, (_, i) => i) }), setLog)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setLog.mock.calls.at(-1)[0].items).toHaveLength(20);

    const load = vi.fn(async () => undefined);
    const onInvalid = vi.fn();
    const bootstrap = vi.fn(async () => ({ ok: true }));
    bindBusyBootstrap(withBusy, 'short', () => false, onInvalid, bootstrap, {}, setLog, load)();
    await new Promise((r) => setTimeout(r, 0));
    expect(onInvalid).toHaveBeenCalled();
    bindBusyBootstrap(withBusy, 'longenough', () => true, onInvalid, bootstrap, { domain: 'x.com' }, setLog, load)();
    await new Promise((r) => setTimeout(r, 0));
    expect(bootstrap).toHaveBeenCalled();

    const applyPolicy = vi.fn(async () => ({ ok: true }));
    bindBusyApplyPolicy(withBusy, applyPolicy, 'd', { applySystem: true }, setLog, load)();
    await new Promise((r) => setTimeout(r, 0));
    expect(applyPolicy).toHaveBeenCalled();

    const setRelay = vi.fn(async () => ({ ok: true }));
    bindBusySetRelay(withBusy, setRelay, { host: 'h' }, setLog)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setRelay).toHaveBeenCalled();

    // mock getElementById
    const input = { value: 'pw' } as HTMLInputElement;
    vi.spyOn(document, 'getElementById').mockReturnValue(input);
    const webmailSso = vi.fn(async () => ({ token: 't' }));
    bindBusyWebmailSso(withBusy, 'sso-pw', 'a@b.com', 'b.com', webmailSso, setLog)();
    await new Promise((r) => setTimeout(r, 0));
    expect(webmailSso).toHaveBeenCalled();

    const writeSieve = vi.fn(async () => ({ ok: true }));
    bindBusyWriteSieve(withBusy, 'ex.com', writeSieve, setLog)();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeSieve).toHaveBeenCalled();

    const listSieve = vi.fn(async () => ({ files: [] }));
    bindBusyListSieve(withBusy, 'ex.com', listSieve, setLog)();
    await new Promise((r) => setTimeout(r, 0));
    expect(listSieve).toHaveBeenCalledWith('postmaster@ex.com');

    const create = vi.fn(async () => ({ ok: true }));
    const list = vi.fn(async () => ({ items: [{ id: 1 }] }));
    const setItems = vi.fn();
    const close = vi.fn();
    const clear = vi.fn();
    bindBusyCreateMailbox(withBusy, create, 'd', 'info', 'secret', setLog, list, setItems, close, clear)();
    await new Promise((r) => setTimeout(r, 0));
    expect(create).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
  });
});

describe('protection/files binders wave', () => {
  it('select suspects / list ops / loadGeo / ban clear', async () => {
    expect(selectAllSuspectIps([{ ip: '1.1.1.1' }, { ip: '2.2.2.2' }])).toEqual({
      '1.1.1.1': true,
      '2.2.2.2': true,
    });
    const setSelected = vi.fn();
    bindSelectAllSuspects(setSelected, [{ ip: '9.9.9.9' }])();
    expect(setSelected).toHaveBeenCalledWith({ '9.9.9.9': true });

    const setList = vi.fn();
    bindAppendUnique(setList, '  a  ')();
    const up = setList.mock.calls[0][0] as (p: string[]) => string[];
    expect(up([])).toEqual(['a']);
    expect(up(['a'])).toEqual(['a']);
    bindListRemove(setList, 'a')();
    const up2 = setList.mock.calls[1][0] as (p: string[]) => string[];
    expect(up2(['a', 'b'])).toEqual(['b']);

    const loadGeo = vi.fn(async () => {
      throw new Error('geo');
    });
    const onErr = vi.fn();
    bindLoadGeo(loadGeo, onErr)();
    await new Promise((r) => setTimeout(r, 0));
    expect(onErr).toHaveBeenCalled();
    bindLoadGeo(vi.fn(async () => undefined))();
    await new Promise((r) => setTimeout(r, 0));

    const ban = vi.fn();
    const clear = vi.fn();
    bindBanAndClear(ban, ' 1.2.3.4 ', 'r', clear)();
    expect(ban).toHaveBeenCalledWith('1.2.3.4', 'r');
    expect(clear).toHaveBeenCalled();
  });

  it('files dialog binders + feature run + closeIfIdle', () => {
    const setRenameTarget = vi.fn();
    const setRenameTo = vi.fn();
    bindOpenRename(setRenameTarget, setRenameTo, { name: 'a.txt' })();
    expect(setRenameTo).toHaveBeenCalledWith('a.txt');

    const setMoveTarget = vi.fn();
    const setMoveDest = vi.fn();
    bindOpenMoveCopy(setMoveTarget, setMoveDest, [{ path: '/a' }], 'copy', '.')();
    expect(setMoveDest).toHaveBeenCalledWith('');
    bindOpenMoveCopy(setMoveTarget, setMoveDest, [], 'move', '/x')();
    expect(setMoveDest).toHaveBeenCalledWith('/x');

    const setSharePath = vi.fn();
    const setSharePass = vi.fn();
    const setShareResult = vi.fn();
    bindOpenShare(setSharePath, setSharePass, setShareResult, '/p')();
    expect(setSharePath).toHaveBeenCalledWith('/p');
    expect(setShareResult).toHaveBeenCalledWith(null);

    const setZipName = vi.fn();
    const setZipOpen = vi.fn();
    bindOpenZip(setZipName, setZipOpen)();
    expect(setZipOpen).toHaveBeenCalledWith(true);
    expect(String(setZipName.mock.calls[0][0])).toMatch(/\.zip$/);

    const setChmodMode = vi.fn();
    const setChmodOpen = vi.fn();
    bindOpenChmod(setChmodMode, setChmodOpen, '755')();
    expect(setChmodMode).toHaveBeenCalledWith('755');

    const setSide = vi.fn();
    const setTab = vi.fn();
    bindFilesSide(setSide, setTab, 'trash')();
    expect(setSide).toHaveBeenCalledWith('trash');
    expect(setTab).toHaveBeenCalledWith('browse');

    const setVersionsPath = vi.fn();
    const setVersions = vi.fn();
    bindCloseVersions(setVersionsPath, setVersions)();
    expect(setVersionsPath).toHaveBeenCalledWith(null);

    const close = vi.fn();
    bindCloseIfIdle(true, close)();
    expect(close).not.toHaveBeenCalled();
    bindCloseIfIdle(false, close)();
    expect(close).toHaveBeenCalled();

    const run = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const work = vi.fn(async () => 1);
    bindFeatureRun(run, work, 'ok')();
    expect(run).toHaveBeenCalled();
  });
});

describe('defense/files run binders', () => {
  it('probe post put whitelist unban tick', async () => {
    const calls: string[] = [];
    const run = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const requestRaw = vi.fn(async (url: string) => {
      calls.push(url);
      return { ok: true };
    });
    const setStatus = vi.fn();
    const refresh = vi.fn(async () => undefined);

    bindDefenseProbe(run, requestRaw, setStatus, refresh, 'probed')();
    await new Promise((r) => setTimeout(r, 0));
    expect(setStatus).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();

    bindDefensePost(run, requestRaw, '/api/v1/defense/stack/apply', {}, refresh, 'ok')();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((u) => u.includes('stack/apply'))).toBe(true);

    bindDefensePut(run, requestRaw, '/api/v1/defense/geoip/policy', { enabled: true }, refresh, 'ok')();
    await new Promise((r) => setTimeout(r, 0));

    bindDefenseWhitelist(run, requestRaw, '1.2.3.4', refresh, 'wl')();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((u) => u.includes('whitelist'))).toBe(true);

    bindDefenseUnban(run, requestRaw, '1.2.3.4', refresh, 'ub')();
    await new Promise((r) => setTimeout(r, 0));

    bindDefenseAutoBanTick(run, requestRaw, refresh, 'tick')();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.some((u) => u.includes('auto-ban/tick'))).toBe(true);

    const work = vi.fn(async () => 1);
    bindFilesRun(run, work, 'ok')();
    await new Promise((r) => setTimeout(r, 0));
    expect(work).toHaveBeenCalled();

    const fav = vi.fn(async () => undefined);
    bindToggleFavorite(run, fav, 'public', '/a')();
    await new Promise((r) => setTimeout(r, 0));
    expect(fav).toHaveBeenCalledWith('public', '/a');
  });
});

describe('save/api residual binders', () => {
  it('bindSave* / chip / append / refresh / api / cf / geo', async () => {
    const {
      bindSaveTopChecked,
      bindSaveChecked,
      bindSaveString,
      bindSaveNumber,
      bindChipNumber,
      bindAppendUniqueStr,
      bindRefreshClear,
      bindApiRefresh0,
      bindApiRefresh1,
      bindApiRefresh2,
      bindApiRefresh3,
      bindDefenseWhitelistAction,
      bindSaveCfZones,
      bindDefensePostOnly,
      bindDefenseGeoApply,
    } = await import('./bind-handlers');

    const save = vi.fn();
    bindSaveTopChecked(save, 'enabled')({ target: { checked: true } });
    expect(save).toHaveBeenCalledWith({ enabled: true });

    bindSaveChecked(save, 'autoBan', 'enabled')({ target: { checked: false } });
    expect(save).toHaveBeenCalledWith({ autoBan: { enabled: false } });

    bindSaveString(save, 'autoBan', 'mode', { enabled: true })('soft');
    expect(save).toHaveBeenCalledWith({ autoBan: { enabled: true, mode: 'soft' } });

    let local: any = { autoBan: { minScore: 1 } };
    const setLocal = (u: (p: any) => any) => {
      local = u(local);
    };
    bindSaveNumber(save, setLocal, 'autoBan', 'minScore', 55)('70');
    expect(local.autoBan.minScore).toBe(70);
    expect(save).toHaveBeenCalledWith({ autoBan: { minScore: 70 } });
    bindSaveNumber(save, setLocal, 'autoBan', 'intervalSeconds', 120, (v) =>
      Math.max(30, Number(v) || 120),
    )('10');
    expect(local.autoBan.intervalSeconds).toBe(30);

    const setN = vi.fn();
    bindChipNumber(setN, 5, 1, 50)('100');
    expect(setN).toHaveBeenCalledWith(50);

    const setList = vi.fn((u: (p: string[]) => string[]) => u(['a']));
    const setFlag = vi.fn();
    bindAppendUniqueStr(setList, 'b', setFlag, true)();
    expect(setFlag).toHaveBeenCalledWith(true);

    const setErr = vi.fn();
    const setMsg = vi.fn();
    const refresh = vi.fn(async () => undefined);
    bindRefreshClear(setErr, setMsg, refresh)();
    expect(setErr).toHaveBeenCalledWith(null);
    expect(refresh).toHaveBeenCalled();

    const run = vi.fn(async (fn: () => Promise<unknown>) => fn());
    const api0 = vi.fn(async () => ({ ok: true }));
    bindApiRefresh0(run, api0, refresh, 'ok')();
    await new Promise((r) => setTimeout(r, 0));
    expect(api0).toHaveBeenCalled();

    const api1 = vi.fn(async (_a: string) => ({ ok: true }));
    bindApiRefresh1(run, api1, 'x', null, 'ok')();
    await new Promise((r) => setTimeout(r, 0));
    expect(api1).toHaveBeenCalledWith('x');

    const api2 = vi.fn(async (_a: string, _b: string) => ({ ok: true }));
    const clear = vi.fn();
    bindApiRefresh2(run, api2, 'a', 'b', refresh, 'ok', clear)();
    await new Promise((r) => setTimeout(r, 0));
    expect(clear).toHaveBeenCalledWith('');

    const api3 = vi.fn(async (_a: number, _b: number, _c: number) => ({ ok: true }));
    bindApiRefresh3(run, api3, 1, 2, 3, refresh, 'ok')();
    await new Promise((r) => setTimeout(r, 0));
    expect(api3).toHaveBeenCalledWith(1, 2, 3);

    const requestRaw = vi.fn(async () => ({ ok: true }));
    bindDefenseWhitelistAction(run, requestRaw, '1.1.1.1', 'remove', refresh, 'ok', clear, ['n'])();
    await new Promise((r) => setTimeout(r, 0));
    expect(requestRaw).toHaveBeenCalled();

    bindSaveCfZones(save, 'a.com, b.com', true, [22, 80])();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudflare: expect.objectContaining({ enabled: true, ufwAllowOnlyCf: true }),
      }),
    );

    bindDefensePostOnly(run, requestRaw, '/api/x', { enable: true }, 'ok')();
    await new Promise((r) => setTimeout(r, 0));

    bindDefenseGeoApply(run, requestRaw, 'ok')();
    await new Promise((r) => setTimeout(r, 0));
    expect(run.mock.calls.length).toBeGreaterThan(5);

    const {
      bindAllOrValue,
      bindInputContext,
      bindRefreshCatch,
      bindFormSubmit,
      bindSelect,
      bindVoidCall2,
      bindVoidCall3,
    } = await import('./bind-handlers');
    const set = vi.fn();
    bindAllOrValue(set)('all');
    expect(set).toHaveBeenCalledWith('');
    bindAllOrValue(set)('x');
    expect(set).toHaveBeenCalledWith('x');
    const setCtx = vi.fn();
    bindInputContext(set, setCtx, 'serverIp')({ target: { value: '1.1.1.1' } });
    expect(setCtx).toHaveBeenCalledWith({ serverIp: '1.1.1.1' });
    const ref = vi.fn(async () => { throw new Error('boom'); });
    const setErr2 = vi.fn();
    bindRefreshCatch(ref, setErr2)();
    await new Promise((r) => setTimeout(r, 0));
    expect(setErr2).toHaveBeenCalledWith('boom');
    const formFn = vi.fn();
    const ev = { preventDefault: vi.fn() };
    bindFormSubmit(formFn)(ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    bindSelect(set)({ target: { value: 'm' } });
    const c2 = vi.fn();
    bindVoidCall2(c2, 'a', 'b')();
    expect(c2).toHaveBeenCalledWith('a', 'b');
    const c3 = vi.fn();
    bindVoidCall3(c3, 1, 2, 3)();
    expect(c3).toHaveBeenCalledWith(1, 2, 3);

    const {
      bindCloseReset,
      bindRefreshDual,
      bindConfirmThen,
      bindDraftNumber,
      bindDraftCheck,
      bindDraftString,
      bindToggleAndTab,
      bindCopyMsg,
    } = await import('./bind-handlers');
    const setOpen = vi.fn();
    const reset = vi.fn();
    bindCloseReset(setOpen, reset)();
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(reset).toHaveBeenCalled();
    const a = vi.fn();
    const b = vi.fn();
    bindRefreshDual(a, b, true)();
    expect(a).toHaveBeenCalled();
    expect(b).toHaveBeenCalled();
    bindConfirmThen(setOpen, a, false)();
    let draft: any = {};
    const setDraft = (u: any) => { draft = u(draft); };
    bindDraftNumber(setDraft, 'n', 5)('10');
    expect(draft.n).toBe(10);
    bindDraftCheck(setDraft, 'on')({ target: { checked: true } });
    expect(draft.on).toBe(true);
    bindDraftString(setDraft, 's')('hi');
    expect(draft.s).toBe('hi');
    const setBool = vi.fn((u: any) => u(false));
    const setTab = vi.fn();
    bindToggleAndTab(setBool, setTab, 'explore')();
    expect(setTab).toHaveBeenCalledWith('explore');

    const {
      bindValueSet,
      bindRemoveIf,
      bindClear2,
      bindClear3,
    } = await import('./bind-handlers');
    const setV = vi.fn();
    bindValueSet(setV)('x');
    expect(setV).toHaveBeenCalledWith('x');
    const remove = vi.fn(async () => undefined);
    const clearId = vi.fn();
    bindRemoveIf('id1', remove, clearId)();
    await new Promise((r) => setTimeout(r, 0));
    expect(remove).toHaveBeenCalledWith('id1');
    expect(clearId).toHaveBeenCalledWith(null);
    bindRemoveIf(null, remove, clearId)();
    const cA = vi.fn();
    const cB = vi.fn();
    bindClear2(cA, cB)();
    expect(cA).toHaveBeenCalledWith(null);
    bindClear3(cA, cB, clearId)();

    const { bindInputCall, bindCheckCall, bindCopyFlash, bindNavTo } = await import('./bind-handlers');
    const fn = vi.fn();
    bindInputCall(fn)({ target: { value: 'z' } });
    expect(fn).toHaveBeenCalledWith('z');
    bindCheckCall(fn)({ target: { checked: true } });
    expect(fn).toHaveBeenCalledWith(true);
    const flash = vi.fn();
    bindCopyFlash('txt', flash, 'done', 'ok')();
    expect(flash).toHaveBeenCalledWith('ok', 'done');
    const nav = vi.fn();
    bindNavTo(nav, '/x')();
    expect(nav).toHaveBeenCalledWith('/x');
    const { bindFilter } = await import('./bind-handlers');
    const sf = vi.fn();
    bindFilter(sf, 'status')('applied');
    expect(sf).toHaveBeenCalledWith('status', 'applied');
  });
});

describe('branch sides binders', () => {
  it('covers false paths', async () => {
    const {
      bindSaveNumber,
      bindRemoveIf,
      bindRefreshDual,
      bindCloseIfIdle,
      bindApiRefresh0,
      bindAllOrValue,
      bindChipNumber,
      bindAppendUniqueStr,
    } = await import('./bind-handlers');
    const save = vi.fn();
    let local: any = null;
    const setLocal = (u: any) => {
      local = u(local);
    };
    bindSaveNumber(save, setLocal, 'autoBan', 'minScore', 55)('x');
    expect(local).toBeNull();
    expect(save).toHaveBeenCalled();
    bindRemoveIf('', vi.fn(), vi.fn())();
    bindRefreshDual(vi.fn(), vi.fn(), false)();
    const close = vi.fn();
    bindCloseIfIdle(true, close)();
    expect(close).not.toHaveBeenCalled();
    const run = vi.fn(async (fn: any) => fn());
    bindApiRefresh0(run, async () => 1, null, 'ok')();
    await new Promise((r) => setTimeout(r, 0));
    const set = vi.fn();
    bindAllOrValue(set, 'ALL')('ALL');
    expect(set).toHaveBeenCalledWith('');
    // '0' is falsy for Number(v)||fallback → fallback 5, then min clamp keeps 5
    bindChipNumber(set, 5, 1, 10)('0');
    expect(set).toHaveBeenCalled();
    bindChipNumber(set, 5, 1, 10)('-3');
    const setList = vi.fn((u: any) => u(['a']));
    bindAppendUniqueStr(setList, 'a')();
  });
});

describe('remaining binder branches', () => {
  it('hits optional body/map/clear/extra paths', async () => {
    const {
      bindDefensePost,
      bindDefensePut,
      bindDefensePostOnly,
      bindDefenseWhitelistAction,
      bindSaveString,
      bindSaveNumber,
      bindApiRefresh0,
      bindApiRefresh1,
      bindApiRefresh2,
      bindDraftNumber,
      bindBanAndClear,
      bindBusyCreateMailbox,
      bindBusyListSieve,
    } = await import('./bind-handlers');

    const run = vi.fn(async (fn: any) => fn());
    const requestRaw = vi.fn(async () => ({ ok: true, notes: ['n'] }));
    const refresh = vi.fn(async () => undefined);
    const mapResult = vi.fn((r: any) => ({ ...r, mapped: true }));

    // mapResult path + null body
    bindDefensePost(run, requestRaw, '/p', null, refresh, 'ok', mapResult)();
    await new Promise((r) => setTimeout(r, 0));
    expect(mapResult).toHaveBeenCalled();

    // no mapResult, null body
    bindDefensePost(run, requestRaw, '/p2', undefined, refresh, 'ok')();
    await new Promise((r) => setTimeout(r, 0));

    bindDefensePut(run, requestRaw, '/put', null, refresh, 'ok')();
    await new Promise((r) => setTimeout(r, 0));

    bindDefensePostOnly(run, requestRaw, '/only', null, 'ok')();
    await new Promise((r) => setTimeout(r, 0));

    // notes undefined path
    bindDefenseWhitelistAction(run, requestRaw, '1.1.1.1', 'add', refresh, 'ok')();
    await new Promise((r) => setTimeout(r, 0));

    // clearSet present
    const clear = vi.fn();
    bindApiRefresh0(run, async () => 1, refresh, 'ok', clear)();
    await new Promise((r) => setTimeout(r, 0));
    expect(clear).toHaveBeenCalledWith('');

    bindApiRefresh1(run, async (a: string) => a, 'x', refresh, 'ok', clear)();
    await new Promise((r) => setTimeout(r, 0));

    bindApiRefresh2(run, async (a: string, b: string) => a + b, 'a', 'b', refresh, 'ok', clear)();
    await new Promise((r) => setTimeout(r, 0));

    // extra undefined
    const save = vi.fn();
    bindSaveString(save, 'sec', 'key')('v');
    expect(save).toHaveBeenCalledWith({ sec: { key: 'v' } });

    // setLocal with null a
    let local: any = null;
    bindSaveNumber(save, (u) => { local = u(local); }, 'sec', 'n', 1)('2');
    expect(local).toBeNull();

    // draft number fallback
    let draft: any = {};
    bindDraftNumber((u) => { draft = u(draft); }, 'n', 9)('nope');
    expect(draft.n).toBe(9);

    // ban clear — empty trim still may call with empty; exercise path
    const ban = vi.fn();
    const setBan = vi.fn();
    bindBanAndClear(ban, '   ', 'r', setBan)();
    void ban.mock.calls;

    expect(run.mock.calls.length).toBeGreaterThan(3);

    const { bindSet2, bindSet3 } = await import('./bind-handlers');
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    bindSet2(a, 1, b, 2)();
    expect(a).toHaveBeenCalledWith(1);
    expect(b).toHaveBeenCalledWith(2);
    bindSet3(a, 'x', b, 'y', c, 'z')();
    expect(c).toHaveBeenCalledWith('z');
  });
});
