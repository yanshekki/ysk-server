import { describe, expect, it } from 'vitest';
import { assertHonestOps, isApplyStatus, normalizeOpsHonesty } from './ops.js';

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
    expect(r.notes.some((n) => n.includes('ops.honesty'))).toBe(true);
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
      notes: [] as string[],
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
  });

  it('requiresExecute alone does not fail written success', () => {
    const r = assertHonestOps({
      ok: true,
      requiresExecute: true,
      apply_status: 'written',
      notes: ['control-plane file written'],
    });
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
  });

  it('blocked true always fails even with written', () => {
    const r = assertHonestOps({
      ok: true,
      blocked: true,
      apply_status: 'written',
      notes: [] as string[],
    });
    expect(r.ok).toBe(false);
  });

  it('defaults ok from blocked when ok omitted', () => {
    const open = assertHonestOps({ notes: ['n'] });
    expect(open.ok).toBe(true);
    const blocked = assertHonestOps({ blocked: true, notes: [] as string[] });
    expect(blocked.ok).toBe(false);
  });

  it('demotes applied + ok:false to failed (not hard-blocked)', () => {
    const r = assertHonestOps({
      ok: false,
      apply_status: 'applied',
      notes: [] as string[],
    });
    expect(r.apply_status).toBe('failed');
    expect(r.notes.some((n) => n.includes('ops.honesty'))).toBe(true);
  });

  it('demotes applied + blocked with blockedNotApplied key path', () => {
    const r = assertHonestOps({
      ok: false,
      blocked: true,
      apply_status: 'applied',
      notes: [] as string[],
    });
    expect(r.apply_status).toBe('blocked');
    expect(r.ok).toBe(false);
  });

  it('does not duplicate honesty notes when already present', () => {
    const r = assertHonestOps({
      ok: true,
      blocked: true,
      apply_status: 'applied',
      notes: ['ops.honesty.blockedNotOk'],
    });
    expect(r.notes.filter((n) => n === 'ops.honesty.blockedNotOk').length).toBe(1);
  });

  it('normalizeOpsHonesty alias works', () => {
    expect(normalizeOpsHonesty).toBe(assertHonestOps);
  });

  it('copies written array', () => {
    const written = ['/a'];
    const r = assertHonestOps({ ok: true, notes: [] as string[], written });
    expect(r.written).toEqual(['/a']);
    expect(r.written).not.toBe(written);
  });

  it('defaults missing notes to [] and coerces non-array notes', () => {
    const noNotes = assertHonestOps({ ok: true, apply_status: 'written' });
    expect(noNotes.notes).toEqual([]);
    // non-array notes → empty (asNotes defensive branch)
    const weird = assertHonestOps({
      ok: true,
      notes: 'not-an-array' as unknown as string[],
    });
    expect(weird.notes).toEqual([]);
  });

  it('demotes applied+ok:false+blocked via blocked branch first', () => {
    // hardBlocked path already rewrites applied → blocked before okFalse demotion
    const r = assertHonestOps({
      ok: false,
      blocked: true,
      apply_status: 'applied',
      notes: ['ops.honesty.already'],
    });
    expect(r.apply_status).toBe('blocked');
    expect(r.ok).toBe(false);
  });

  it('adds blockedNotApplied note when applied+blocked without prior honesty note', () => {
    const r = assertHonestOps({
      ok: false,
      blocked: true,
      apply_status: 'applied',
      notes: ['plain note only'],
    });
    expect(r.apply_status).toBe('blocked');
    expect(r.notes.some((n) => n.includes('ops.honesty'))).toBe(true);
  });
});

describe('isApplyStatus', () => {
  it('accepts all known statuses', () => {
    for (const s of [
      'draft',
      'written',
      'planned',
      'pending_execute',
      'applied',
      'blocked',
      'failed',
      'partial',
    ] as const) {
      expect(isApplyStatus(s)).toBe(true);
    }
    expect(isApplyStatus('nope')).toBe(false);
    expect(isApplyStatus(1)).toBe(false);
    expect(isApplyStatus(null)).toBe(false);
  });
});
