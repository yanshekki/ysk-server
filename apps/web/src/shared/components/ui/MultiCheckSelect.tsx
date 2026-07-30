/**
 * Searchable multi-select with checkboxes + selected chips.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonClassName } from './Button';

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

  function toggle(v: string) {
    if (disabled) return;
    if (selected.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  }

  function addCustom() {
    const raw = custom.trim().toUpperCase();
    if (!raw) return;
    const v = raw.startsWith('AS') || /^[A-Z]{2}$/.test(raw) ? raw : raw;
    if (!selected.has(v)) onChange([...value, v]);
    setCustom('');
  }

  // Few options → show all; only cap when over maxVisible (default 100)
  const shouldCap = filtered.length > maxVisible;
  const shown = shouldCap ? filtered.slice(0, maxVisible) : filtered;

  return (
    <div className="mcs" id={id}>
      {value.length > 0 ? (
        <div className="mcs__chips" role="list">
          {value.map((v) => (
            <button
              key={v}
              type="button"
              className="mcs__chip"
              role="listitem"
              disabled={disabled}
              onClick={() => toggle(v)}
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

      <input
        type="search"
        className="mcs__search"
        value={q}
        disabled={disabled}
        placeholder={resolvedSearch}
        onChange={(e) => setQ(e.target.value)}
        aria-label={resolvedSearch}
      />

      <div className="mcs__list" role="group" aria-label={t('multiCheck.optionsAria')}>
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
