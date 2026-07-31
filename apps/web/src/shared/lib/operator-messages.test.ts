import { describe, expect, it } from 'vitest';
import {
  humanizeOperatorMessage,
  humanizeOperatorNote,
  isOperatorNoise,
  looksLikeBlockedMessage,
  sanitizeOperatorNotes,
} from './operator-messages';

describe('isOperatorNoise', () => {
  it('flags empty and shell/env homework', () => {
    expect(isOperatorNoise('')).toBe(true);
    expect(isOperatorNoise('  ')).toBe(true);
    expect(isOperatorNoise('Set YSK_EXECUTE=1')).toBe(true);
    expect(isOperatorNoise('sudo systemctl restart nginx')).toBe(true);
    expect(isOperatorNoise('apt-get install foo')).toBe(true);
    expect(isOperatorNoise('CREATE USER foo')).toBe(true);
  });

  it('allows clean operator notes', () => {
    expect(isOperatorNoise('Certificate issued for example.com')).toBe(false);
    expect(isOperatorNoise('Project deployed')).toBe(false);
  });
});

describe('looksLikeBlockedMessage', () => {
  it('detects execute / root / permission signals', () => {
    expect(looksLikeBlockedMessage('YSK_NEED_EXECUTE')).toBe(true);
    expect(looksLikeBlockedMessage('requiresExecute is true')).toBe(true);
    expect(looksLikeBlockedMessage('Host execute is off')).toBe(true);
    expect(looksLikeBlockedMessage('permission denied')).toBe(true);
    expect(looksLikeBlockedMessage('need root')).toBe(true);
    expect(looksLikeBlockedMessage('requires root')).toBe(true);
    expect(looksLikeBlockedMessage('權限不足')).toBe(true);
    expect(looksLikeBlockedMessage('all good')).toBe(false);
  });
});

describe('humanizeOperatorNote', () => {
  it('returns null for empty', () => {
    expect(humanizeOperatorNote('')).toBeNull();
    expect(humanizeOperatorNote('   ')).toBeNull();
  });

  it('maps execute / root blocks to localized ops keys', () => {
    const exec = humanizeOperatorNote('YSK_NEED_EXECUTE required');
    expect(exec).toBeTruthy();
    expect(exec).not.toMatch(/YSK_NEED_EXECUTE/);
    expect(exec!.toLowerCase()).toMatch(/execute|host|panel|off|enable/);

    const root = humanizeOperatorNote('need root privileges');
    expect(root).toBeTruthy();
    expect(root!.toLowerCase()).toMatch(/root/);
  });

  it('maps written ≠ applied honesty', () => {
    const n = humanizeOperatorNote('written ≠ applied on host');
    expect(n).toBeTruthy();
    expect(n).toMatch(/written|panel|host|applied/i);
  });

  it('maps bare success/failed tokens', () => {
    expect(humanizeOperatorNote('ok')).toBeTruthy();
    expect(humanizeOperatorNote('failed')).toBeTruthy();
  });

  it('maps YSK_EXECUTE shell slogans to blocked message (not raw shell)', () => {
    const n = humanizeOperatorNote('export YSK_EXECUTE=1 && bash install.sh');
    // Prefer localized block over leaking shell homework
    expect(n).toBeTruthy();
    expect(n).not.toMatch(/bash install|export /i);
  });

  it('drops pure SQL noise as null', () => {
    expect(humanizeOperatorNote('CREATE USER foo WITH PASSWORD')).toBeNull();
  });

  it('passes through already-localized free text', () => {
    expect(humanizeOperatorNote('Certificate renewed')).toBe('Certificate renewed');
  });
});

describe('sanitizeOperatorNotes', () => {
  it('filters noise, humanizes, and dedupes', () => {
    const out = sanitizeOperatorNotes([
      'YSK_NEED_EXECUTE',
      'export YSK_EXECUTE=1',
      'YSK_NEED_EXECUTE',
      'Certificate issued',
    ]);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out.some((n) => /certificate/i.test(n))).toBe(true);
    expect(out.every((n) => !/export YSK_EXECUTE/.test(n))).toBe(true);
  });

  it('handles null/empty', () => {
    expect(sanitizeOperatorNotes(null)).toEqual([]);
    expect(sanitizeOperatorNotes(undefined)).toEqual([]);
    expect(sanitizeOperatorNotes([])).toEqual([]);
  });
});

describe('humanizeOperatorMessage', () => {
  it('falls back when empty', () => {
    const m = humanizeOperatorMessage(null);
    expect(m.length).toBeGreaterThan(0);
    expect(humanizeOperatorMessage('')).toBe(m);
  });

  it('humanizes known phrases', () => {
    const m = humanizeOperatorMessage('Host execute is off');
    expect(m).not.toBe('Host execute is off');
    expect(m.length).toBeGreaterThan(0);
  });
});
