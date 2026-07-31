import { describe, expect, it } from 'vitest';
import {
  buildListQueryString,
  emptyListMeta,
  parseListQuery,
} from './list-query.js';

describe('parseListQuery', () => {
  it('parses empty defaults', () => {
    const q = parseListQuery(new URL('http://x/api?'), {
      enums: { role: ['admin', 'operator'] },
    });
    expect(q.q).toBe('');
    expect(q.filters).toEqual({});
    expect(q.page).toBe(1);
    expect(q.limit).toBe(0);
    expect(q.order).toBe('asc');
  });

  it('parses q, enums, page, limit, sort', () => {
    const url = new URL(
      'http://x/api?q=alice&role=admin&status=bogus&page=2&limit=25&sort=username&order=desc',
    );
    const q = parseListQuery(url, {
      enums: {
        role: ['admin', 'operator'],
        status: ['active', 'suspended'],
      },
      sortFields: ['username', 'created'],
      maxLimit: 50,
    });
    expect(q.q).toBe('alice');
    expect(q.filters).toEqual({ role: 'admin' }); // bogus status dropped
    expect(q.page).toBe(2);
    expect(q.limit).toBe(25);
    expect(q.sort).toBe('username');
    expect(q.order).toBe('desc');
  });

  it('clamps limit and free filters', () => {
    const url = new URL('http://x/api?limit=999&package=none');
    const q = parseListQuery(url, {
      freeFilters: ['package'],
      maxLimit: 100,
    });
    expect(q.limit).toBe(100);
    expect(q.filters.package).toBe('none');
  });

  it('accepts URLSearchParams', () => {
    const sp = new URLSearchParams('q=hi');
    expect(parseListQuery(sp).q).toBe('hi');
  });
});

describe('buildListQueryString', () => {
  it('omits empty defaults', () => {
    expect(buildListQueryString({})).toBe('');
    expect(buildListQueryString({ q: '  x  ', filters: { role: 'admin' } })).toBe(
      'q=x&role=admin',
    );
  });

  it('includes page/limit when non-default', () => {
    const s = buildListQueryString({ page: 3, limit: 20, order: 'desc' });
    expect(s).toContain('page=3');
    expect(s).toContain('limit=20');
    expect(s).toContain('order=desc');
  });
});

describe('emptyListMeta', () => {
  it('copies query fields', () => {
    const query = parseListQuery(new URL('http://x/?q=a&role=admin'), {
      enums: { role: ['admin'] },
    });
    const m = emptyListMeta(query, 5);
    expect(m.total).toBe(5);
    expect(m.q).toBe('a');
    expect(m.filters).toEqual({ role: 'admin' });
  });
});
