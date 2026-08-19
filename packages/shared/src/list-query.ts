/**
 * Unified list search / filter query contract for table list APIs.
 * Used by server routes + web clients (buildListQueryString).
 */

export type ListSortOrder = 'asc' | 'desc';

export type ListQuery = {
  /** Free-text search (trimmed; empty = no text filter) */
  q: string;
  /** Named dimension filters (role, runtime, status, …) */
  filters: Record<string, string>;
  sort?: string;
  order: ListSortOrder;
  /** 1-based page; ignored when limit is 0 (return all matched) */
  page: number;
  /**
   * Page size. 0 = return all matched items (capped by maxAll).
   * Default 0 for host-panel sized datasets unless caller sets a page size.
   */
  limit: number;
};

export type ListMeta = {
  total: number;
  page: number;
  limit: number;
  q: string;
  filters: Record<string, string>;
  sort?: string;
  order: ListSortOrder;
  /** Counts per facet key → value, after text filter (before dimension filter on that key optional) */
  facets?: Record<string, Record<string, number>>;
  /** Unfiltered collection size (before q / dimension filters) */
  allTotal?: number;
};

export type ListResponse<T> = {
  items: T[];
  meta: ListMeta;
};

export type ParseListQueryOptions = {
  /** Allowed enum values per filter key; unknown values are dropped */
  enums?: Record<string, readonly string[]>;
  /** Extra free-form filter keys (any non-empty string kept) */
  freeFilters?: readonly string[];
  /** Allowed sort field names */
  sortFields?: readonly string[];
  defaultSort?: string;
  defaultOrder?: ListSortOrder;
  defaultLimit?: number;
  /** Max page size when limit > 0 (default 200) */
  maxLimit?: number;
  /** When limit=0, hard cap on returned rows (default 5000) */
  maxAll?: number;
  /** Query keys reserved (never treated as filters) */
  reserved?: readonly string[];
};

const DEFAULT_RESERVED = [
  'q',
  'sort',
  'order',
  'page',
  'limit',
  'locale',
  'summary',
] as const;

/**
 * Parse URL search params into ListQuery.
 * Accepts URL | URLSearchParams | Record-like get(name) objects.
 */
export function parseListQuery(
  source: URL | URLSearchParams | { searchParams: URLSearchParams },
  opts: ParseListQueryOptions = {},
): ListQuery {
  const sp =
    source instanceof URLSearchParams
      ? source
      : source instanceof URL
        ? source.searchParams
        : source.searchParams;

  const maxLimit = opts.maxLimit ?? 200;
  const defaultLimit = opts.defaultLimit ?? 0;
  const reserved = new Set<string>([...DEFAULT_RESERVED, ...(opts.reserved ?? [])]);

  const q = (sp.get('q') ?? '').trim();
  const pageRaw = Number(sp.get('page') || 1);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;

  let limitRaw = sp.get('limit');
  let limit: number;
  if (limitRaw == null || limitRaw === '') {
    limit = defaultLimit;
  } else {
    const n = Number(limitRaw);
    if (!Number.isFinite(n) || n < 0) limit = defaultLimit;
    else if (n === 0) limit = 0;
    else limit = Math.min(maxLimit, Math.floor(n));
  }

  let order: ListSortOrder =
    (sp.get('order') ?? opts.defaultOrder ?? 'asc').toLowerCase() === 'desc'
      ? 'desc'
      : 'asc';

  let sort = (sp.get('sort') ?? opts.defaultSort ?? '').trim() || undefined;
  if (sort && opts.sortFields && !opts.sortFields.includes(sort)) {
    sort = opts.defaultSort;
  }

  const filters: Record<string, string> = {};
  const enumKeys = opts.enums ? Object.keys(opts.enums) : [];
  const freeKeys = opts.freeFilters ?? [];

  for (const key of enumKeys) {
    const raw = (sp.get(key) ?? '').trim();
    if (!raw) continue;
    const allowed = opts.enums![key];
    if (allowed.includes(raw)) filters[key] = raw;
  }
  for (const key of freeKeys) {
    if (reserved.has(key)) continue;
    const raw = (sp.get(key) ?? '').trim();
    if (raw) filters[key] = raw;
  }

  // Also accept any other non-reserved param as free filter when freeFilters is empty
  // but enums listed — only enum + freeFilters keys; no open world by default.

  return { q, filters, sort, order, page, limit };
}

/**
 * Build query string (without leading ?) from ListQuery-like state.
 */
export function buildListQueryString(input: {
  q?: string;
  filters?: Record<string, string | undefined | null>;
  sort?: string;
  order?: ListSortOrder;
  page?: number;
  limit?: number;
}): string {
  const sp = new URLSearchParams();
  const q = (input.q ?? '').trim();
  if (q) sp.set('q', q);
  if (input.filters) {
    for (const [k, v] of Object.entries(input.filters)) {
      if (v != null && String(v).trim() !== '') sp.set(k, String(v).trim());
    }
  }
  if (input.sort) sp.set('sort', input.sort);
  if (input.order && input.order !== 'asc') sp.set('order', input.order);
  if (input.page != null && input.page > 1) sp.set('page', String(input.page));
  if (input.limit != null && input.limit > 0) sp.set('limit', String(input.limit));
  return sp.toString();
}

export function emptyListMeta(query: ListQuery, total = 0): ListMeta {
  return {
    total,
    page: query.page,
    limit: query.limit,
    q: query.q,
    filters: { ...query.filters },
    sort: query.sort,
    order: query.order,
  };
}
