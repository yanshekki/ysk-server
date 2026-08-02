/**
 * One-click preset chips for common values; optional free custom beside.
 */
import { useTranslation } from 'react-i18next';
import { bindCall1 } from '../../../pages/bind-handlers';

export type PresetChipOption = {
  value: string;
  label: string;
};

export type PresetChipsProps = {
  options: PresetChipOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** When true, show text input for values not in list */
  allowCustom?: boolean;
  customPlaceholder?: string;
  /** Compare loosely (case-insensitive trim) */
  looseMatch?: boolean;
};

function norm(s: string, loose: boolean) {
  const t = s.trim();
  return loose ? t.toLowerCase() : t;
}

export function PresetChips({
  options,
  value,
  onChange,
  disabled = false,
  allowCustom = false,
  customPlaceholder,
  looseMatch = true,
}: PresetChipsProps) {
  const { t } = useTranslation();
  const current = norm(value, looseMatch);
  const isPreset = options.some((o) => norm(o.value, looseMatch) === current);
  const resolvedPlaceholder =
    customPlaceholder ?? t('presetChips.customPlaceholder');

  return (
    <div className="preset-chips">
      <div className="preset-chips__row" role="group">
        {options.map((o) => {
          const on = norm(o.value, looseMatch) === current;
          return (
            <button
              key={o.value}
              type="button"
              className={`preset-chips__chip${on ? ' is-on' : ''}`}
              disabled={disabled}
              onClick={bindCall1(onChange, o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {allowCustom ? (
        <input
          className="preset-chips__custom"
          value={isPreset ? '' : value}
          disabled={disabled}
          placeholder={resolvedPlaceholder}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}
