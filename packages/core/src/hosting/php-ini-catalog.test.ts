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
});
