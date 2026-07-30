import { describe, expect, it } from 'vitest';
import { looksLikeOpsResult, statusFromOpsResult } from './util.js';
import { assertHonestOps } from '@ysk/shared';

describe('statusFromOpsResult', () => {
  it('returns 200 for written success even with requiresExecute soft flag', () => {
    const honest = assertHonestOps({
      ok: true,
      apply_status: 'written',
      requiresExecute: true,
      notes: ['written only'],
    });
    expect(honest.ok).toBe(true);
    expect(statusFromOpsResult(honest)).toBe(200);
  });

  it('returns 403 for hard blocked', () => {
    const honest = assertHonestOps({
      ok: true,
      blocked: true,
      notes: ['need root'],
    });
    expect(honest.ok).toBe(false);
    expect(statusFromOpsResult(honest)).toBe(403);
  });

  it('returns 403 when ok false and requiresExecute', () => {
    expect(
      statusFromOpsResult({
        ok: false,
        requiresExecute: true,
      }),
    ).toBe(403);
  });

  it('returns 422 for generic failure', () => {
    expect(statusFromOpsResult({ ok: false })).toBe(422);
  });

  it('notFound option yields 404', () => {
    expect(statusFromOpsResult({ ok: false }, { notFound: true })).toBe(404);
  });
});

describe('looksLikeOpsResult', () => {
  it('detects notes / blocked shapes', () => {
    expect(looksLikeOpsResult({ ok: true, notes: [] })).toBe(true);
    expect(looksLikeOpsResult({ ok: false, blocked: true })).toBe(true);
    expect(looksLikeOpsResult({ ok: true, id: 'x' })).toBe(false);
    expect(looksLikeOpsResult(null)).toBe(false);
  });
});
