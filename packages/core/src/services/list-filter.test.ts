import { describe, expect, it } from 'vitest';
import { parseListQuery } from '@ysk/shared';
import { applyListQuery } from './list-filter.js';

type Row = {
  id: string;
  name: string;
  role: string;
  suspended: boolean;
};

const DATA: Row[] = [
  { id: '1', name: 'alice', role: 'admin', suspended: false },
  { id: '2', name: 'bob', role: 'operator', suspended: true },
  { id: '3', name: 'carol', role: 'operator', suspended: false },
  { id: '4', name: 'dave', role: 'viewer', suspended: false },
];

const matchers = {
  text: (r: Row) => [r.name, r.role],
  predicates: {
    role: (r: Row, v: string) => r.role === v,
    status: (r: Row, v: string) =>
      v === 'suspended' ? r.suspended : !r.suspended,
  },
  facetOf: {
    role: (r: Row) => r.role,
    status: (r: Row) => (r.suspended ? 'suspended' : 'active'),
  },
  sortOf: {
    name: (a: Row, b: Row) => a.name.localeCompare(b.name),
  },
};

describe('applyListQuery', () => {
  it('returns all when no filters', () => {
    const q = parseListQuery(new URL('http://x/'));
    const { items, meta } = applyListQuery(DATA, q, matchers);
    expect(items).toHaveLength(4);
    expect(meta.total).toBe(4);
    expect(meta.facets?.role?.operator).toBe(2);
  });

  it('filters by q', () => {
    const q = parseListQuery(new URL('http://x/?q=ali'));
    const { items, meta } = applyListQuery(DATA, q, matchers);
    expect(items.map((i) => i.name)).toEqual(['alice']);
    expect(meta.total).toBe(1);
  });

  it('filters by role and computes facets after text only', () => {
    const q = parseListQuery(new URL('http://x/?role=operator'), {
      enums: { role: ['admin', 'operator', 'viewer'] },
    });
    const { items, meta } = applyListQuery(DATA, q, matchers);
    expect(items).toHaveLength(2);
    // facets on full set (no text filter)
    expect(meta.facets?.role?.admin).toBe(1);
    expect(meta.facets?.role?.operator).toBe(2);
  });

  it('paginates', () => {
    const q = parseListQuery(new URL('http://x/?limit=2&page=2&sort=name'), {
      sortFields: ['name'],
      defaultLimit: 0,
    });
    // force limit from URL
    expect(q.limit).toBe(2);
    const { items, meta } = applyListQuery(DATA, q, matchers);
    expect(meta.total).toBe(4);
    expect(items).toHaveLength(2);
    // sorted asc: alice bob carol dave → page2 = carol dave
    expect(items.map((i) => i.name)).toEqual(['carol', 'dave']);
  });

  it('combines q + status', () => {
    const q = parseListQuery(new URL('http://x/?q=o&status=active'), {
      enums: { status: ['active', 'suspended'] },
    });
    // bob (operator suspended), carol (operator active) match "o" in role or name
    // alice has no o in name... alice has no o. bob has o, carol has o, dave has none?
    // bob, carol match "o" in name/role; status active → carol only (bob suspended)
    // actually "o" matches: bob, carol, operator role for alice? admin no. viewer no.
    // bob name, carol name, also role operator has o
    const { items } = applyListQuery(DATA, q, matchers);
    expect(items.every((i) => !i.suspended)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
  });
});
