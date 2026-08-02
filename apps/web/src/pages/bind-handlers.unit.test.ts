/**
 * Cover bind-handlers fully — each factory + returned function path.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  alwaysFalse,
  alwaysTrue,
  bindArg1,
  bindArg2,
  bindAsync,
  bindBanOne,
  bindBusyDual,
  bindBusyMap,
  bindBusySet,
  bindCall1,
  bindCall2,
  bindCall3,
  bindCheck,
  bindClipboard,
  bindConfirm,
  bindDraftField,
  bindIgnoreEvent,
  bindInput,
  bindNavigate,
  bindNumber,
  bindOpenCreate,
  bindPreset,
  bindPrevent,
  bindRun,
  bindSeq,
  bindSet,
  bindToggle,
  bindToggleInList,
  bindToggleKey,
  bindToggleValue,
  bindVoid,
  constant,
  identity,
  noop,
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
