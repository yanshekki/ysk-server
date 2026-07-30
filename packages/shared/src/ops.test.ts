import { describe, expect, it } from 'vitest';
import { assertHonestOps, isApplyStatus } from './ops.js';

describe('assertHonestOps', () => {
  it('flips ok when blocked', () => {
    const r = assertHonestOps({
      ok: true,
      blocked: true,
      notes: ['x'],
      apply_status: 'applied',
    });
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('blocked');
    expect(r.notes.some((n) => n.includes('ops.honesty') || n.includes('誠實校正'))).toBe(
      true,
    );
  });

  it('keeps honest applied', () => {
    const r = assertHonestOps({
      ok: true,
      apply_status: 'applied',
      notes: ['reload ok'],
      written: ['/a'],
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('applied');
    expect(r.written).toEqual(['/a']);
  });

  it('written without blocked stays ok', () => {
    const r = assertHonestOps({
      ok: true,
      apply_status: 'written',
      requiresExecute: false,
      notes: [],
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
  });

  it('requiresExecute alone does not fail written success', () => {
    const r = assertHonestOps({
      ok: true,
      requiresExecute: true,
      apply_status: 'written',
      notes: ['管理檔已寫'],
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
  });

  it('blocked true always fails even with written', () => {
    const r = assertHonestOps({
      ok: true,
      blocked: true,
      apply_status: 'written',
      notes: [],
    });
    expect(r.ok).toBe(false);
  });
});

describe('isApplyStatus', () => {
  it('accepts known statuses', () => {
    expect(isApplyStatus('written')).toBe(true);
    expect(isApplyStatus('applied')).toBe(true);
    expect(isApplyStatus('nope')).toBe(false);
  });
});
