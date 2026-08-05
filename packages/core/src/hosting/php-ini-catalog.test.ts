import { describe, expect, it } from 'vitest';
import {
  PHP_INI_GROUPS,
  listPhpIniCatalog,
  defaultPhpIniValues,
  allPhpIniKeys,
} from './php-ini-catalog.js';

describe('php-ini-catalog', () => {
  it('has groups with unique field keys', () => {
    expect(PHP_INI_GROUPS.length).toBeGreaterThan(2);
    const keys = allPhpIniKeys();
    expect(keys.length).toBeGreaterThan(10);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('listPhpIniCatalog returns deep-copied fields', () => {
    const a = listPhpIniCatalog();
    a[0]!.fields[0]!.key = 'mutated';
    const b = listPhpIniCatalog();
    expect(b[0]!.fields[0]!.key).not.toBe('mutated');
  });

  it('defaultPhpIniValues covers every catalog key', () => {
    const defaults = defaultPhpIniValues();
    for (const k of allPhpIniKeys()) {
      expect(defaults[k]).toBeDefined();
    }
    expect(defaults.memory_limit).toBeTruthy();
  });

  it('timezone and charset are select fields with options containing defaults', () => {
    const fields = listPhpIniCatalog().flatMap((g) => g.fields);
    const tz = fields.find((f) => f.key === 'date.timezone');
    const cs = fields.find((f) => f.key === 'default_charset');
    expect(tz?.type).toBe('select');
    expect(cs?.type).toBe('select');
    expect((tz?.options?.length ?? 0) > 5).toBe(true);
    expect((cs?.options?.length ?? 0) > 3).toBe(true);
    expect(tz?.options?.some((o) => o.value === String(tz.default))).toBe(true);
    expect(cs?.options?.some((o) => o.value === String(cs.default))).toBe(true);
    expect(tz?.options?.some((o) => o.value === 'Asia/Hong_Kong')).toBe(true);
    expect(cs?.options?.some((o) => o.value === 'UTF-8')).toBe(true);
  });

  it('labels are localized (not raw keys or empty English stubs)', () => {
    const groups = listPhpIniCatalog();
    for (const grp of groups) {
      expect(grp.title.length).toBeGreaterThan(1);
      expect(grp.title).not.toMatch(/^notes\.|^runtime\.|^catalog\./);
      for (const f of grp.fields) {
        expect(f.label.length).toBeGreaterThan(1);
        expect(f.label).not.toBe(f.key);
        expect(f.label).not.toMatch(/^notes\.|^runtime\./);
      }
    }
    const misc = groups.find((g) => g.id === 'misc')!;
    const cgi = misc.fields.find((f) => f.key === 'cgi.fix_redirect')!;
    expect(cgi.label).not.toBe('cgi.fix_redirect');
  });
});
