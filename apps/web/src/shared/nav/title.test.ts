import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { navTitle } from './title';

describe('navTitle', () => {
  it('prefixes nav. for i18n key', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) => {
      if (key === 'nav.projects') return 'Projects';
      return opts?.defaultValue ?? key;
    }) as TFunction;
    expect(navTitle('projects', t)).toBe('Projects');
  });

  it('falls back to key via defaultValue', () => {
    const t = ((key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key) as TFunction;
    expect(navTitle('unknownThing', t)).toBe('unknownThing');
  });
});
