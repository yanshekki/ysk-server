import { describe, expect, it } from 'vitest';
import {
  PHP_DISABLE_FUNCTIONS_DEFAULT,
  PHP_DISABLE_FUNCTIONS_OPTIONS,
  parseDisableFunctions,
  recommendedDisableFunctions,
  serializeDisableFunctions,
} from './php-disable-functions.js';

describe('php-disable-functions', () => {
  it('has researched options with unique values', () => {
    const vals = PHP_DISABLE_FUNCTIONS_OPTIONS.map((o) => o.value);
    expect(vals.length).toBeGreaterThan(15);
    expect(new Set(vals).size).toBe(vals.length);
    expect(vals).toContain('exec');
    expect(vals).toContain('shell_exec');
  });

  it('recommended set matches historical default membership', () => {
    const rec = new Set(recommendedDisableFunctions());
    for (const n of parseDisableFunctions(PHP_DISABLE_FUNCTIONS_DEFAULT)) {
      expect(rec.has(n) || PHP_DISABLE_FUNCTIONS_OPTIONS.some((o) => o.value === n)).toBe(
        true,
      );
    }
    expect(rec.has('exec')).toBe(true);
    expect(rec.has('system')).toBe(true);
  });

  it('parse/serialize round-trip and dedupe', () => {
    const parsed = parseDisableFunctions('exec, system, exec, shell_exec');
    expect(parsed).toEqual(['exec', 'system', 'shell_exec']);
    expect(serializeDisableFunctions(parsed)).toBe('exec,system,shell_exec');
    expect(parseDisableFunctions('')).toEqual([]);
    expect(serializeDisableFunctions([])).toBe('');
  });
});
