/**
 * Server-side list filter / sort / page helper.
 * Pure functions — used by HTTP list routes.
 */
import type { ListMeta, ListQuery, ListResponse } from '@yanshekki/shared';
import { emptyListMeta } from '@yanshekki/shared';

export type ListMatchers<T> = {
  /** Fields to match against q (case-insensitive substring) */
  text: (item: T) => Array<string | undefined | null>;
  /** Dimension predicates — key matches ListQuery.filters keys */
  predicates?: Record<string, (item: T, value: string) => boolean>;
  /** Facet extractors: key → value(s) for counting after text filter */
  facetOf?: Record<string, (item: T) => string | string[] | undefined | null>;
  /** Sort comparators by sort field name */
  sortOf?: Record<string, (a: T, b: T) => number>;
  /** Max rows when limit=0 (default 5000) */
  maxAll?: number;
};

function matchesText<T>(item: T, q: string, text: ListMatchers<T>['text']): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  for (const part of text(item)) {
    if (part != null && String(part).toLowerCase().includes(needle)) return true;
  }
  return false;
}

function matchesFilters<T>(
  item: T,
  filters: Record<string, string>,
  predicates?: ListMatchers<T>['predicates'],
): boolean {
  if (!predicates) return true;
  for (const [key, value] of Object.entries(filters)) {
    const pred = predicates[key];
    if (!pred) continue;
    if (!pred(item, value)) return false;
  }
  return true;
}

function buildFacets<T>(
  items: T[],
  facetOf: NonNullable<ListMatchers<T>['facetOf']>,
): Record<string, Record<string, number>> {
  const facets: Record<string, Record<string, number>> = {};
  for (const key of Object.keys(facetOf)) {
    facets[key] = {};
  }
  for (const item of items) {
    for (const [key, fn] of Object.entries(facetOf)) {
      const raw = fn(item);
      if (raw == null || raw === '') continue;
      const values = Array.isArray(raw) ? raw : [raw];
      for (const v of values) {
        if (!v) continue;
        facets[key][v] = (facets[key][v] ?? 0) + 1;
      }
    }
  }
  return facets;
}

/**
 * Filter → facet (on text-matched set) → dimension filter → sort → page.
 * Facets are computed after text filter but before dimension filters so chips
 * show counts for the current search, not only the active chip.
 */
export function applyListQuery<T>(
  all: T[],
  query: ListQuery,
  matchers: ListMatchers<T>,
): ListResponse<T> {
  const maxAll = matchers.maxAll ?? 5000;

  // 1. Text filter
  let afterText = all;
  if (query.q) {
    afterText = all.filter((item) => matchesText(item, query.q, matchers.text));
  }

  // 2. Facets from text-matched set
  let facets: Record<string, Record<string, number>> | undefined;
  if (matchers.facetOf && Object.keys(matchers.facetOf).length) {
    facets = buildFacets(afterText, matchers.facetOf);
  }

  // 3. Dimension filters
  let filtered = afterText;
  if (Object.keys(query.filters).length) {
    filtered = afterText.filter((item) =>
      matchesFilters(item, query.filters, matchers.predicates),
    );
  }

  // 4. Sort
  if (query.sort && matchers.sortOf?.[query.sort]) {
    const cmp = matchers.sortOf[query.sort];
    filtered = [...filtered].sort((a, b) => {
      const r = cmp(a, b);
      return query.order === 'desc' ? -r : r;
    });
  }

  const total = filtered.length;

  // 5. Page
  let items: T[];
  if (query.limit <= 0) {
    items = filtered.slice(0, maxAll);
  } else {
    const start = (query.page - 1) * query.limit;
    items = filtered.slice(start, start + query.limit);
  }

  const meta: ListMeta = {
    ...emptyListMeta(query, total),
    facets,
  };

  return { items, meta };
}
