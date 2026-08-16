/**
 * Professional server-backed list search + filter toolbar.
 * Use inside DataTable.filters / ListPanel.filters only.
 */
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';
import { bindCall1, bindToggleValue } from '../../../pages/bind-handlers';

export type ListToolbarChip = {
  id: string;
  label: string;
  /** Facet count when available */
  count?: number;
  tone?: 'default' | 'danger' | 'warn' | 'ok';
};

export type ListToolbarChipGroup = {
  /** Filter key (e.g. role, runtime) */
  key: string;
  ariaLabel?: string;
  /** Include an "all" chip that clears this key */
  allLabel?: string;
  chips: ListToolbarChip[];
  value: string;
  onChange: (value: string) => void;
};

export type ListToolbarProps = {
  /** Controlled search text (immediate UI value) */
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  /** Debounced search still loading */
  searching?: boolean;
  /** List fetch in flight */
  loading?: boolean;
  chipGroups?: ListToolbarChipGroup[];
  /** Extra controls (sort select, etc.) */
  extra?: ReactNode;
  /** meta.total after filter */
  total?: number;
  /** items currently shown (optional; defaults to total) */
  shown?: number;
  /** Number of active filters including non-empty q */
  activeFilterCount?: number;
  onClear?: () => void;
  className?: string;
};

function chipClass(active: boolean, tone?: ListToolbarChip['tone']): string {
  const parts = ['list-toolbar__chip'];
  if (active) parts.push('list-toolbar__chip--active');
  if (tone === 'danger') parts.push('list-toolbar__chip--danger');
  if (tone === 'warn') parts.push('list-toolbar__chip--warn');
  if (tone === 'ok') parts.push('list-toolbar__chip--ok');
  return parts.join(' ');
}

export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  searchAriaLabel,
  searching,
  loading,
  chipGroups,
  extra,
  total,
  shown,
  activeFilterCount = 0,
  onClear,
  className }: ListToolbarProps) {
  const { t } = useTranslation();
  const searchId = useId();
  const ph = searchPlaceholder ?? t('listToolbar.searchPlaceholder');
  const aria = searchAriaLabel ?? t('listToolbar.searchAria');
  const hasSearch = search.trim().length > 0;
  const showSummary = total != null || activeFilterCount > 0;

  return (
    <div
      className={['list-toolbar', className ?? '', loading ? 'list-toolbar--loading' : '']
        .filter(Boolean)
        .join(' ')}
      role="search"
    >
      <div className="list-toolbar__row">
        <div className="list-toolbar__search">
          <span className="list-toolbar__search-icon" aria-hidden>
            ⌕
          </span>
          <input
            id={searchId}
            name="list-search"
            type="search"
            className="list-toolbar__search-input"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && search) {
                e.preventDefault();
                onSearchChange('');
              }
            }}
            placeholder={ph}
            aria-label={aria}
            autoComplete="off"
            spellCheck={false}
          />
          {hasSearch ? (
            <button
              type="button"
              className="list-toolbar__search-clear"
              onClick={bindCall1(onSearchChange, '')}
              aria-label={t('listToolbar.clearSearch')}
            >
              ×
            </button>
          ) : null}
          {searching || loading ? (
            <span className="list-toolbar__spinner" aria-hidden />
          ) : null}
        </div>

        {extra ? <div className="list-toolbar__extra">{extra}</div> : null}

        {onClear && activeFilterCount > 0 ? (
          <Button variant="ghost" size="sm" onClick={onClear} className="list-toolbar__clear-btn">
            {t('listToolbar.clearAll')}
          </Button>
        ) : null}
      </div>

      {chipGroups?.length
        ? chipGroups.map((group) => (
            <div
              key={group.key}
              className="list-toolbar__chips"
              role="group"
              aria-label={group.ariaLabel ?? group.key}
            >
              {group.allLabel != null ? (
                <button
                  type="button"
                  className={chipClass(group.value === '' || group.value === 'all')}
                  aria-pressed={group.value === '' || group.value === 'all'}
                  onClick={bindCall1(group.onChange, '')}
                >
                  {group.allLabel}
                </button>
              ) : null}
              {group.chips.map((c) => {
                const empty = c.count === 0 && group.value !== c.id;
                return (
                <button
                  key={c.id}
                  type="button"
                  className={chipClass(group.value === c.id, c.tone)}
                  aria-pressed={group.value === c.id}
                  disabled={empty}
                  title={empty ? t('listToolbar.emptyChip') : undefined}
                  onClick={bindToggleValue(group.onChange, group.value, c.id)}
                >
                  <span>{c.label}</span>
                  {c.count != null ? (
                    <span className="list-toolbar__chip-count">{c.count}</span>
                  ) : null}
                </button>
                );
              })}
            </div>
          ))
        : null}

      {showSummary ? (
        <div className="list-toolbar__summary" aria-live="polite">
          {total != null ? (
            <span>
              {shown != null && shown !== total
                ? t('listToolbar.showingOf', { shown, total })
                : t('listToolbar.resultCount', { count: total })}
            </span>
          ) : null}
          {activeFilterCount > 0 ? (
            <span className="list-toolbar__summary-filters">
              {t('listToolbar.activeFilters', { count: activeFilterCount })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
