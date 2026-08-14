import { describe, expect, it } from 'vitest';
import { localPageHits } from './GlobalSearch';

describe('localPageHits', () => {
  const t = (k: string) => {
    if (k === 'nav.ssl') return 'SSL 憑證';
    if (k === 'nav.projects') return '專案';
    if (k === 'search.alias.ssl') return '證書 cert certificate 憑證 certs';
    if (k === 'search.alias.projects') return '項目 專案 project sites';
    if (k.startsWith('nav.sections.')) return k.slice('nav.sections.'.length);
    return k.replace(/^nav\./, '');
  };

  it('matches ssl / 憑證 / cert', () => {
    for (const q of ['ssl', '憑證', 'cert', '證書']) {
      const hits = localPageHits(q, t);
      expect(hits.some((h) => h.href === '/ssl'), q).toBe(true);
    }
  });

  it('matches 專案', () => {
    const hits = localPageHits('專案', t);
    expect(hits.some((h) => h.href === '/projects')).toBe(true);
  });
});
