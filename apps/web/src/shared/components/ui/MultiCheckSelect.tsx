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
  /** Not selectable (e.g. already installed) */
  disabled?: boolean;
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
  /**
   * When selected chips exceed this count, collapse to “N selected” toggle.
   * Default 8; set 0 to never collapse.
   */
  chipCollapseAt?: number;
};

const LIST_SIZE_CLASS: Record<NonNullable<MultiCheckSelectProps['listSize']>, string> = {
  sm: 'mcs__list--sm',
  md: 'mcs__list--md',
  lg: 'mcs__list--lg' };

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
  chipCollapseAt = 8 }: MultiCheckSelectProps) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [custom, setCustom] = useState('');
  const [chipsExpanded, setChipsExpanded] = useState(false);
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

  const disabledSet = useMemo(
    () => new Set(options.filter((o) => o.disabled).map((o) => o.value)),
    [options],
  );
  const selectableFiltered = useMemo(
    () => filteredValues.filter((v) => !disabledSet.has(v)),
    [filteredValues, disabledSet],
  );
  const selectableOptions = useMemo(
    () => optionValues.filter((v) => !disabledSet.has(v)),
    [optionValues, disabledSet],
  );

  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((v) => selected.has(v));
  const someFilteredSelected = selectableFiltered.some((v) => selected.has(v));

  function toggle(v: string) {
    if (disabled || disabledSet.has(v)) return;
    if (selected.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  function selectAllFiltered() {
    if (disabled) return;
    const next = new Set(value);
    for (const v of selectableFiltered) next.add(v);
    onChange([...next]);
  }

  function clearFiltered() {
    if (disabled) return;
    const drop = new Set(selectableFiltered);
    onChange(value.filter((v) => !drop.has(v)));
  }

  function selectAllOptions() {
    if (disabled) return;
    const next = new Set(value);
    for (const v of selectableOptions) next.add(v);
    onChange([...next]);
  }

  function clearAllOptions() {
    if (disabled) return;
    // Keep custom values that are not in the options catalog; keep disabled locked selections out
    const catalog = new Set(selectableOptions);
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

  const collapseChips =
    chipCollapseAt > 0 && value.length > chipCollapseAt && !chipsExpanded;

  return (
    <div className={`mcs mcs--${listSize}`} id={id}>
      {value.length > 0 ? (
        collapseChips ? (
          <div className="mcs__chips-collapsed">
            <button
              type="button"
              className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              disabled={disabled}
              onClick={() => setChipsExpanded(true)}
            >
              {t('multiCheck.chipsCollapsed', { n: value.length })}
            </button>
            <button
              type="button"
              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
              disabled={disabled}
              onClick={clearAllOptions}
            >
              {t('multiCheck.clearAll')}
            </button>
          </div>
        ) : (
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
            {chipCollapseAt > 0 && value.length > chipCollapseAt ? (
              <button
                type="button"
                className="mcs__chip mcs__chip--meta"
                onClick={() => setChipsExpanded(false)}
              >
                {t('multiCheck.chipsCollapse')}
              </button>
            ) : null}
          </div>
        )
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
                total: optionValues.length })}
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
            const rowDisabled = disabled || Boolean(o.disabled);
            return (
              <label
                key={o.value}
                className={`mcs__opt${on ? ' is-on' : ''}${o.disabled ? ' is-disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={on && !o.disabled}
                  disabled={rowDisabled}
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
              total: filtered.length })}
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
