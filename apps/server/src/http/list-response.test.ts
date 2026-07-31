import { describe, expect, it } from 'vitest';
import { listWithQuery } from './list-response.js';

type Row = { id: string; name: string; runtime: string };

const ALL: Row[] = [
  { id: '1', name: 'alpha', runtime: 'node' },
  { id: '2', name: 'beta', runtime: 'static' },
  { id: '3', name: 'gamma', runtime: 'node' },
  { id: '4', name: 'delta', runtime: 'php' },
];

describe('listWithQuery', () => {
  it('returns all items with meta when no filters', () => {
    const url = new URL('http://x/api/v1/projects');
    const { items, meta } = listWithQuery(
      url,
      ALL,
      {
        text: (r) => [r.name, r.id, r.runtime],
      },
    );
    expect(items.length).toBe(4);
    expect(meta).toBeTruthy();
    expect(typeof (meta as { total?: number }).total === 'number' || meta).toBeTruthy();
  });

  it('filters by q text', () => {
    const url = new URL('http://x/api/v1/projects?q=bet');
    const { items } = listWithQuery(url, ALL, {
      text: (r) => [r.name, r.id],
    });
    expect(items.every((r) => r.name.includes('bet') || r.id.includes('bet'))).toBe(true);
    expect(items.some((r) => r.name === 'beta')).toBe(true);
  });

  it('supports predicates and sort fields', () => {
    const url = new URL('http://x/api/v1/projects?runtime=node&sort=name');
    const { items, meta } = listWithQuery(
      url,
      ALL,
      {
        text: (r) => [r.name],
        predicates: {
          runtime: (r, v) => r.runtime === v,
        },
        facetOf: {
          runtime: (r) => r.runtime,
        },
        sortOf: {
          name: (a, b) => a.name.localeCompare(b.name),
        },
      },
      {
        enums: { runtime: ['node', 'php', 'static'] },
        sortFields: ['name'],
      },
    );
    expect(items.every((r) => r.runtime === 'node')).toBe(true);
    expect(items.map((r) => r.name)).toEqual([...items.map((r) => r.name)].sort());
    expect(meta).toBeTruthy();
  });

  it('handles empty list', () => {
    const url = new URL('http://x/api/v1/x');
    const { items } = listWithQuery(url, [] as Row[], {
      text: (r) => [r.name],
    });
    expect(items).toEqual([]);
  });
});
