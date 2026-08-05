import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast, toastStore } from './toast-store';

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.clear();
  });

  afterEach(() => {
    toast.clear();
    vi.useRealTimers();
  });

  it('push ok/error/info/warn with default durations', () => {
    toast.ok('done');
    toast.error('fail');
    toast.info('note');
    toast.warn('careful');
    const items = toastStore.getToasts();
    expect(items).toHaveLength(4);
    expect(items[0]?.variant).toBe('warn'); // newest first
    expect(items.find((t) => t.variant === 'ok')?.durationMs).toBe(toastStore.defaults.ok);
    expect(items.find((t) => t.variant === 'error')?.durationMs).toBe(
      toastStore.defaults.error,
    );
  });

  it('ignores empty messages', () => {
    expect(toast.ok('')).toBe('');
    expect(toast.ok('   ')).toBe('');
    expect(toastStore.getToasts()).toHaveLength(0);
  });

  it('dismiss removes one toast', () => {
    const id = toast.ok('a');
    toast.ok('b');
    expect(toastStore.getToasts()).toHaveLength(2);
    toast.dismiss(id);
    expect(toastStore.getToasts().map((t) => t.message)).toEqual(['b']);
  });

  it('caps stack at maxStack', () => {
    for (let i = 0; i < 10; i += 1) toast.ok(`m${i}`);
    expect(toastStore.getToasts()).toHaveLength(toastStore.maxStack);
    expect(toastStore.getToasts()[0]?.message).toBe('m9');
  });

  it('auto-dismisses after duration', () => {
    toast.ok('temp', { durationMs: 1000 });
    expect(toastStore.getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(999);
    expect(toastStore.getToasts()).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(toastStore.getToasts()).toHaveLength(0);
  });

  it('accepts detail option on toast', () => {
    toast.ok('Done', { detail: 'note line 1\nnote line 2' });
    const item = toastStore.getToasts()[0];
    expect(item?.message).toBe('Done');
    expect(item?.detail).toContain('note line 1');
  });

  it('subscribe notifies on push and dismiss; unsubscribe stops', () => {
    let n = 0;
    const unsub = toastStore.subscribe(() => {
      n += 1;
    });
    const id = toast.ok('x');
    expect(n).toBe(1);
    toast.dismiss(id);
    expect(n).toBe(2);
    unsub();
    const after = n;
    toast.ok('y');
    expect(n).toBe(after);
  });
});

