/**
 * Searchable multi-select with checkboxes + selected chips.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClassName } from './Button';
import { bindCall1 } from '../../../pages/bind-handlers';

export type MultiCheckOption = {
  value: string;
  label: string;
  hint?: string;
};

export type MultiCheckSelectProps = {
  id: string;
  options: MultiCheckOption[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Extra values not in options (e.g. custom ASN) still shown as selected */
  allowCustom?: boolean;
  customPlaceholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  maxVisible?: number;
  disabled?: boolean;
  /** How to normalize free-typed custom values (default upper for ASN/geo legacy). */
  customCase?: 'upper' | 'lower' | 'as-is';
  /** Show select-all / clear toolbar (default true) */
  showSelectAll?: boolean;
  /**
   * Max height of the scrollable option list (CSS length).
   * Default taller than legacy 12.5rem so long catalogs (PHP ext) are usable.
   */
  listMaxHeight?: string;
  /** Optional size preset */
  listSize?: 'sm' | 'md' | 'lg';
};

const LIST_SIZE_CLASS: Record<NonNullable<MultiCheckSelectProps['listSize']>, string> = {
  sm: 'mcs__list--sm',
  md: 'mcs__list--md',
  lg: 'mcs__list--lg',
};

export function MultiCheckSelect({
  id,
  options,
  value,
  onChange,
  allowCustom = false,
  customPlaceholder,
  searchPlaceholder,
  emptyText,
  /** Only truncate when option count exceeds this (default 100). */
  maxVisible = 100,
  disabled = false,
  customCase = 'upper',
  showSelectAll = true,
  listMaxHeight,
  listSize = 'lg',
}: MultiCheckSelectProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState('');
  const selected = useMemo(() => new Set(value), [value]);

  const resolvedSearch = searchPlaceholder ?? t('multiCheck.searchPlaceholder');
  const resolvedEmpty = emptyText ?? t('multiCheck.emptyText');
  const resolvedCustom = customPlaceholder ?? t('multiCheck.customPlaceholder');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (o) =>
        o.value.toLowerCase().includes(needle) ||
        o.label.toLowerCase().includes(needle) ||
        (o.hint ?? '').toLowerCase().includes(needle),
    );
  }, [options, q]);

  const labelByValue = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of options) m.set(o.value, o.label);
    return m;
  }, [options]);

  const optionValues = useMemo(() => options.map((o) => o.value), [options]);
  const filteredValues = useMemo(() => filtered.map((o) => o.value), [filtered]);

  const allFilteredSelected =
    filteredValues.length > 0 && filteredValues.every((v) => selected.has(v));
  const someFilteredSelected = filteredValues.some((v) => selected.has(v));

  function toggle(v: string) {
    if (disabled) return;
    if (selected.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  function selectAllFiltered() {
    if (disabled) return;
    const next = new Set(value);
    for (const v of filteredValues) next.add(v);
    onChange([...next]);
  }

  function clearFiltered() {
    if (disabled) return;
    const drop = new Set(filteredValues);
    onChange(value.filter((v) => !drop.has(v)));
  }

  function selectAllOptions() {
    if (disabled) return;
    const next = new Set(value);
    for (const v of optionValues) next.add(v);
    onChange([...next]);
  }

  function clearAllOptions() {
    if (disabled) return;
    // Keep custom values that are not in the options catalog
    const catalog = new Set(optionValues);
    onChange(value.filter((v) => !catalog.has(v)));
  }

  function addCustom() {
    const trimmed = custom.trim();
    if (!trimmed) return;
    const raw =
      customCase === 'upper'
        ? trimmed.toUpperCase()
        : customCase === 'lower'
          ? trimmed.toLowerCase()
          : trimmed;
    if (!raw) return;
    const v = raw;
    if (!selected.has(v)) onChange([...value, v]);
    setCustom('');
  }

  // Few options → show all; only cap when over maxVisible (default 100)
  const shouldCap = filtered.length > maxVisible;
  const shown = shouldCap ? filtered.slice(0, maxVisible) : filtered;
  const searching = Boolean(q.trim());

  return (
    <div className={`mcs mcs--${listSize}`} id={id}>
      {value.length > 0 ? (
        <div className="mcs__chips" role="list">
          {value.map((v) => (
            <button
              key={v}
              type="button"
              className="mcs__chip"
              role="listitem"
              disabled={disabled}
              onClick={bindCall1(toggle, v)}
              title={t('multiCheck.removeTitle')}
            >
              <span className="mcs__chip-lab">
                {labelByValue.get(v) ?? v}
                {labelByValue.has(v) ? (
                  <span className="mcs__chip-code"> {v}</span>
                ) : null}
              </span>
              <span className="mcs__chip-x" aria-hidden>
                ×
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="mcs__empty muted u-text-sm">{t('multiCheck.noneSelected')}</p>
      )}

      <div className="mcs__toolbar">
        <input
          id={`${id}-search`}
          name={`${id}-search`}
          type="search"
          className="mcs__search"
          value={q}
          disabled={disabled}
          placeholder={resolvedSearch}
          onChange={(e) => setQ(e.target.value)}
          aria-label={resolvedSearch}
          autoComplete="off"
        />
        {showSelectAll && options.length > 0 ? (
          <div className="mcs__bulk" role="group" aria-label={t('multiCheck.bulkAria')}>
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              disabled={disabled || filteredValues.length === 0 || allFilteredSelected}
              onClick={searching ? selectAllFiltered : selectAllOptions}
              title={
                searching
                  ? t('multiCheck.selectFilteredTitle', { n: filteredValues.length })
                  : t('multiCheck.selectAllTitle', { n: optionValues.length })
              }
            >
              {searching
                ? t('multiCheck.selectFiltered', { n: filteredValues.length })
                : t('multiCheck.selectAll')}
            </button>
            <button
              type="button"
              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
              disabled={
                disabled ||
                (searching ? !someFilteredSelected : value.filter((v) => optionValues.includes(v)).length === 0)
              }
              onClick={searching ? clearFiltered : clearAllOptions}
            >
              {searching ? t('multiCheck.clearFiltered') : t('multiCheck.clearAll')}
            </button>
            <span className="mcs__count muted u-text-sm">
              {t('multiCheck.selectedCount', {
                n: value.filter((v) => optionValues.includes(v)).length,
                total: optionValues.length,
              })}
            </span>
          </div>
        ) : null}
      </div>

      <div
        className={`mcs__list ${LIST_SIZE_CLASS[listSize]}`}
        role="group"
        aria-label={t('multiCheck.optionsAria')}
        style={listMaxHeight ? { maxHeight: listMaxHeight } : undefined}
      >
        {shown.length === 0 ? (
          <p className="mcs__empty muted u-text-sm">{resolvedEmpty}</p>
        ) : (
          shown.map((o) => {
            const on = selected.has(o.value);
            return (
              <label
                key={o.value}
                className={`mcs__opt${on ? ' is-on' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={disabled}
                  onChange={() => toggle(o.value)}
                />
                <span className="mcs__opt-main">
                  <span className="mcs__opt-lab">{o.label}</span>
                  <code className="mcs__opt-code">{o.hint ?? o.value}</code>
                </span>
              </label>
            );
          })
        )}
        {shouldCap ? (
          <p className="mcs__more muted u-text-sm">
            {t('multiCheck.showingCapped', {
              shown: maxVisible,
              total: filtered.length,
            })}
          </p>
        ) : null}
      </div>

      {allowCustom ? (
        <div className="mcs__custom">
          <input
            value={custom}
            disabled={disabled}
            placeholder={resolvedCustom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            spellCheck={false}
          />
          <button
            type="button"
            className={buttonClassName({ variant: 'secondary', size: 'sm' })}
            disabled={disabled || !custom.trim()}
            onClick={addCustom}
          >
            {t('multiCheck.add')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
