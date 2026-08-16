/**
 * Global command-palette search (top bar).
 * Groups: Pages · Projects · Email · … with keyboard nav.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { FEATURE_SECTIONS } from '../nav/features';

export type SearchHitDto = {
  kind: string;
  id?: string;
  title: string;
  subtitle?: string;
  href: string;
};

const KIND_ORDER = [
  'page',
  'project',
  'email',
  'mailbox',
  'ssl',
  'dns',
  'nginx',
  'share',
  'ftp',
  'mysql',
  'postgres',
  'redis',
  'cron',
  'user',
] as const;

function kindLabel(kind: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  return t(`search.kinds.${kind}`, { defaultValue: kind });
}

/** Match project rows locally when the search API returns no resource hits. */
/** Short queries match token prefixes only so "ai" does not hit "email" / "mail". */
export function searchTextMatches(hay: string, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return false;
  const text = hay.toLowerCase();
  const tokens = text.split(/[\s./:_-]+/).filter(Boolean);
  if (tokens.some((tok) => tok.startsWith(query))) return true;
  if (query.length <= 2) return false;
  return text.includes(query);
}

export function projectHitsFromRows(
  query: string,
  projects: Array<{ id?: string; name?: string; domain?: string }>,
): SearchHitDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHitDto[] = [];
  for (const p of projects) {
    const name = String(p.name ?? '');
    const domain = String(p.domain ?? '');
    const id = String(p.id ?? '');
    const hay = [name, domain, id].join('\n').toLowerCase();
    if (searchTextMatches(hay, q)) {
      hits.push({
        kind: 'project',
        id,
        title: name || id,
        subtitle: domain || undefined,
        href: id ? `/projects/${encodeURIComponent(id)}` : '/projects',
      });
    }
  }
  return hits;
}

export function localPageHits(
  query: string,
  t: (k: string, o?: Record<string, unknown>) => string,
): SearchHitDto[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: SearchHitDto[] = [];
  for (const section of FEATURE_SECTIONS) {
    const sectionLabel = t(`nav.sections.${section.sectionKey}`, {
      defaultValue: section.sectionKey,
    });
    for (const item of section.items) {
      const title = t(`nav.${item.key}`, { defaultValue: item.key });
      const aliasBlob = t(`search.alias.${item.key}`, { defaultValue: '' });
      const hay = [item.key, item.to, title, sectionLabel, section.sectionKey, aliasBlob]
        .map((s) => String(s).toLowerCase())
        .join('\n');
      if (searchTextMatches(hay, q)) {
        hits.push({
          kind: 'page',
          id: item.key,
          title,
          subtitle: sectionLabel,
          href: item.to,
        });
      }
    }
  }
  return hits;
}

function mergeHits(primary: SearchHitDto[], extra: SearchHitDto[]): SearchHitDto[] {
  const seen = new Set(primary.map((h) => `${h.kind}:${h.href}:${h.title}`));
  const out = [...primary];
  for (const h of extra) {
    const k = `${h.kind}:${h.href}:${h.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

/** Empty menu: never flash "no results" before the in-flight search finishes. */
export function searchEmptyState(opts: {
  loading: boolean;
  searchError: string | null;
  hitCount: number;
  query: string;
  completedQuery: string;
}): 'loading' | 'error' | 'empty' | null {
  if (opts.hitCount > 0) return null;
  const q = opts.query.trim();
  if (!q) return null;
  const pending = opts.completedQuery !== q;
  if (opts.loading || pending) return 'loading';
  if (opts.searchError) return 'error';
  return 'empty';
}

function groupHits(hits: SearchHitDto[]): Array<{ kind: string; items: SearchHitDto[] }> {
  const map = new Map<string, SearchHitDto[]>();
  for (const h of hits) {
    const k = h.kind || 'other';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(h);
  }
  const ordered: Array<{ kind: string; items: SearchHitDto[] }> = [];
  for (const k of KIND_ORDER) {
    const items = map.get(k);
    if (items?.length) ordered.push({ kind: k, items });
    map.delete(k);
  }
  for (const [k, items] of map) {
    if (items.length) ordered.push({ kind: k, items });
  }
  return ordered;
}

export function GlobalSearch() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHitDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);
  const lastCompletedQ = useRef('');

  const groups = useMemo(() => groupHits(hits), [hits]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const runSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < 1) {
        setHits([]);
        setLoading(false);
        return;
      }
      const seq = ++reqSeq.current;
      setLoading(true);
      setSearchError(null);
      const local = localPageHits(trimmed, t);
      try {
        const r = await api.requestRaw<{ items: SearchHitDto[] }>(
          `/api/v1/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (seq !== reqSeq.current) return;
        lastCompletedQ.current = trimmed;
        let items = r.items ?? [];
        if (!items.some((h) => h.kind === 'project')) {
          try {
            const pr = await api.requestRaw<{
              items?: Array<{ id?: string; name?: string; domain?: string }>;
            }>('/api/v1/projects?limit=200');
            items = mergeHits(items, projectHitsFromRows(trimmed, pr.items ?? []));
          } catch {
            /* keep API + local pages */
          }
        }
        setHits(mergeHits(items, local));
        setActive(0);
      } catch (e) {
        if (seq !== reqSeq.current) return;
        lastCompletedQ.current = trimmed;
        let fallback = local;
        try {
          const pr = await api.requestRaw<{
            items?: Array<{ id?: string; name?: string; domain?: string }>;
          }>('/api/v1/projects?limit=200');
          fallback = mergeHits(projectHitsFromRows(trimmed, pr.items ?? []), local);
        } catch {
          /* local pages only */
        }
        setHits(fallback);
        setSearchError(e instanceof Error ? e.message : t('search.failed', { defaultValue: 'Search failed' }));
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [t],
  );

  const onChange = (value: string) => {
    setQ(value);
    setOpen(true);
    setSearchError(null);
    const local = localPageHits(value, t);
    setHits(local);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (!trimmed) {
      setLoading(false);
      lastCompletedQ.current = '';
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => void runSearch(value), 280);
  };

  const close = useCallback(() => {
    setOpen(false);
    setActive(0);
  }, []);

  const go = useCallback(
    (hit: SearchHitDto) => {
      close();
      setQ('');
      setHits([]);
      navigate(hit.href);
    },
    [close, navigate],
  );

  // Click outside
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, close]);

  // ⌘K / Ctrl+K focus
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setQ('');
      setHits([]);
      if (open) {
        close();
        return;
      }
      inputRef.current?.blur();
      return;
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter') && q.trim()) {
      setOpen(true);
    }
    if (!flat.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[active];
      if (hit) go(hit);
    }
  };

  const showMenu = open && q.trim().length > 0;
  const emptyKind = searchEmptyState({
    loading,
    searchError,
    hitCount: hits.length,
    query: q,
    completedQuery: lastCompletedQ.current,
  });
  let flatIndex = -1;

  return (
    <div className="shell-search" ref={rootRef}>
      <div className="shell-search__field">
        <input
          ref={inputRef}
          id={inputId}
          name="global-search"
          type="search"
          className="shell-search__input input"
          placeholder={t('common.searchGlobal')}
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label={t('common.searchGlobal')}
          aria-expanded={showMenu}
          aria-controls={showMenu ? `${inputId}-menu` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="shell-search__kbd" aria-hidden>
          ⌘K
        </kbd>
      </div>

      {showMenu ? (
        <div
          id={`${inputId}-menu`}
          className="shell-search__menu"
          role="listbox"
          aria-label={t('search.results', { defaultValue: 'Search results' })}
        >
          {emptyKind === 'loading' ? (
            <p className="shell-search__empty muted">{t('search.loading')}</p>
          ) : null}
          {emptyKind === 'error' ? (
            <p className="shell-search__empty muted">{searchError}</p>
          ) : null}
          {emptyKind === 'empty' ? (
            <p className="shell-search__empty muted">{t('search.noResults')}</p>
          ) : null}
          {groups.map((g) => (
            <div key={g.kind} className="shell-search__group">
              <div className="shell-search__group-label">{kindLabel(g.kind, t)}</div>
              <ul className="shell-search__list">
                {g.items.map((h) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  const isActive = idx === active;
                  return (
                    <li key={`${h.kind}-${h.href}-${h.title}-${idx}`}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={`shell-search__item${isActive ? ' is-active' : ''}`}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => go(h)}
                      >
                        <span className="shell-search__item-title">{h.title}</span>
                        {h.subtitle ? (
                          <span className="shell-search__item-sub muted">{h.subtitle}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
