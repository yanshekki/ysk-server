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
  const [active, setActive] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqSeq = useRef(0);

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
      try {
        const r = await api.requestRaw<{ items: SearchHitDto[] }>(
          `/api/v1/search?q=${encodeURIComponent(trimmed)}`,
        );
        if (seq !== reqSeq.current) return;
        setHits(r.items ?? []);
        setActive(0);
      } catch {
        if (seq !== reqSeq.current) return;
        setHits([]);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [],
  );

  const onChange = (value: string) => {
    setQ(value);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void runSearch(value), 160);
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
      close();
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
          placeholder={t('search.placeholder', {
            defaultValue: t('common.searchGlobal', { defaultValue: 'Search…' }),
          })}
          value={q}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label={t('search.aria', { defaultValue: 'Global search' })}
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
          {loading && hits.length === 0 ? (
            <p className="shell-search__empty muted">{t('search.loading', { defaultValue: '…' })}</p>
          ) : null}
          {!loading && hits.length === 0 ? (
            <p className="shell-search__empty muted">
              {t('search.noResults', { defaultValue: 'No results' })}
            </p>
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
