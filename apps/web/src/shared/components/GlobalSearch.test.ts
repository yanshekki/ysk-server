import { describe, expect, it } from 'vitest';
import { localPageHits, projectHitsFromRows, searchEmptyState } from './GlobalSearch';

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

  it('matches an existing project name hello', () => {
    const hits = projectHitsFromRows('hello', [
      { id: 'p-hello', name: 'hello', domain: 'hello.demo-server.ysk.hk' },
      { id: 'p-other', name: 'qa36tmp', domain: '' },
    ]);
    expect(hits.some((h) => h.kind === 'project' && h.title === 'hello')).toBe(true);
    expect(hits[0]?.href).toBe('/projects/p-hello');
  });
});

describe('searchEmptyState', () => {
  it('does not flash empty while the query is still in flight', () => {
    expect(
      searchEmptyState({
        loading: false,
        searchError: null,
        hitCount: 0,
        query: 'hello',
        completedQuery: '',
      }),
    ).toBe('loading');
    expect(
      searchEmptyState({
        loading: true,
        searchError: null,
        hitCount: 0,
        query: 'hello',
        completedQuery: '',
      }),
    ).toBe('loading');
    expect(
      searchEmptyState({
        loading: false,
        searchError: null,
        hitCount: 0,
        query: 'hello',
        completedQuery: 'hello',
      }),
    ).toBe('empty');
    expect(
      searchEmptyState({
        loading: false,
        searchError: null,
        hitCount: 2,
        query: 'hello',
        completedQuery: '',
      }),
    ).toBeNull();
  });
});

