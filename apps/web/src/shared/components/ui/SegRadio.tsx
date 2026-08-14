/**
 * Segmented radio group — selection-first single choice (2–12 options).
 */
export type SegRadioOption<T extends string = string> = {
  value: T;
  label: string;
  hint?: string;
};

export type SegRadioProps<T extends string = string> = {
  name: string;
  value: T;
  options: SegRadioOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Accessible label for the group */
  'aria-label'?: string;
  size?: 'sm' | 'md';
};

export function SegRadio<T extends string = string>({
  name,
  value,
  options,
  onChange,
  disabled = false,
  'aria-label': ariaLabel,
  size = 'md' }: SegRadioProps<T>) {
  return (
    <div
      className={`seg-radios${size === 'sm' ? ' seg-radios--sm' : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const id = `${name}-${o.value}`;
        const on = value === o.value;
        return (
          <label
            key={o.value}
            htmlFor={id}
            className={`seg-radios__opt${on ? ' seg-radios__opt--on' : ''}`}
            title={o.hint}
            onClick={(e) => {
              if (disabled || on) return;
              e.preventDefault();
              onChange(o.value);
            }}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              disabled={disabled}
              onChange={() => onChange(o.value)}
            />
            <span>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}
