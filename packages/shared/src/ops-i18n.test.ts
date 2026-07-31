import { describe, expect, it, beforeEach } from 'vitest';
import {
  looksLikeI18nKey,
  translateNote,
  translateNotes,
  opsBlockedNeedExecute,
  opsBlockedNeedRoot,
  opsBlockedNeedExecuteRoot,
  localizeOpsResult,
} from './ops-i18n.js';
import { clearLocaleCache, runWithLocale } from './i18n/index.js';

describe('looksLikeI18nKey', () => {
  it('accepts owned prefixes', () => {
    expect(looksLikeI18nKey('ops.blocked.needExecute')).toBe(true);
    expect(looksLikeI18nKey('errors.auth.badCredentials')).toBe(true);
    expect(looksLikeI18nKey('common.save')).toBe(true);
    expect(looksLikeI18nKey('auth.login')).toBe(true);
  });

  it('rejects free text and other namespaces', () => {
    expect(looksLikeI18nKey('pm2 missing')).toBe(false);
    expect(looksLikeI18nKey('notes.auto.n0380')).toBe(false);
    expect(looksLikeI18nKey('')).toBe(false);
  });
});

describe('translateNote / translateNotes', () => {
  beforeEach(() => clearLocaleCache());

  it('passes through free text', () => {
    expect(translateNote('already localized note')).toBe('already localized note');
  });

  it('returns empty/whitespace notes as-is', () => {
    expect(translateNote('')).toBe('');
    expect(translateNote('   ')).toBe('   ');
  });

  it('translates known keys in en', () => {
    const out = translateNote('ops.blocked.needExecute', 'en');
    expect(out).not.toBe('ops.blocked.needExecute');
    expect(out.length).toBeGreaterThan(3);
  });

  it('translateNotes maps arrays and empty', () => {
    expect(translateNotes(undefined)).toEqual([]);
    expect(translateNotes([])).toEqual([]);
    const notes = translateNotes(['ops.blocked.needRoot', 'plain'], 'en');
    expect(notes).toHaveLength(2);
    expect(notes[1]).toBe('plain');
    expect(notes[0]).not.toBe('ops.blocked.needRoot');
  });
});

describe('opsBlocked*', () => {
  beforeEach(() => clearLocaleCache());

  it('opsBlockedNeedExecute is hard-blocked honesty shape', () => {
    const r = runWithLocale('en', () => opsBlockedNeedExecute());
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.requiresExecute).toBe(true);
    expect(r.apply_status).toBe('blocked');
    expect(r.notes.length).toBeGreaterThan(0);
    expect(r.blockMessage).toBeTruthy();
  });

  it('opsBlockedNeedRoot sets requiresRoot', () => {
    const r = runWithLocale('en', () => opsBlockedNeedRoot({ written: ['/x'] }));
    expect(r.ok).toBe(false);
    expect(r.requiresRoot).toBe(true);
    expect(r.blocked).toBe(true);
  });

  it('opsBlockedNeedExecuteRoot sets both gates', () => {
    const r = runWithLocale('en', () => opsBlockedNeedExecuteRoot());
    expect(r.requiresExecute).toBe(true);
    expect(r.requiresRoot).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('opsBlockedNeedExecute merges extra notes', () => {
    const r = runWithLocale('en', () =>
      opsBlockedNeedExecute({ notes: ['custom free text'] }),
    );
    expect(r.notes.some((n) => n.includes('custom') || n === 'custom free text')).toBe(
      true,
    );
  });
});

describe('localizeOpsResult', () => {
  beforeEach(() => clearLocaleCache());

  it('localizes honesty keys and keeps free text', () => {
    const r = localizeOpsResult(
      {
        ok: true,
        apply_status: 'written',
        requiresExecute: true,
        notes: ['ops.honesty.blockedNotOk', 'leave me'],
      },
      'en',
    );
    expect(r.ok).toBe(true);
    expect(r.apply_status).toBe('written');
    expect(r.notes).toContain('leave me');
  });

  it('flips blocked+ok via assertHonestOps before localize', () => {
    const r = localizeOpsResult(
      {
        ok: true,
        blocked: true,
        apply_status: 'applied',
        notes: [],
      },
      'en',
    );
    expect(r.ok).toBe(false);
    expect(r.apply_status).toBe('blocked');
  });
});
