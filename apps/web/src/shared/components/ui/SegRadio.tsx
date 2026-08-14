/**
 * Segmented radio group — selection-first single choice (2–12 options).
 * Buttons (not hidden <input type="radio">) so a real click always selects
 * and never submits a parent form or dismisses a modal.
 */
import { type KeyboardEvent } from 'react';

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
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled || options.length === 0) return;
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = options[(i + dir + options.length) % options.length];
    if (next) onChange(next.value);
  }

  return (
    <div
      className={`seg-radios${size === 'sm' ? ' seg-radios--sm' : ''}`}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {options.map((o) => {
        const id = `${name}-${o.value}`;
        const on = value === o.value;
        return (
          <button
            key={o.value}
            id={id}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            className={`seg-radios__opt${on ? ' seg-radios__opt--on' : ''}`}
            title={o.hint}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (disabled || on) return;
              onChange(o.value);
            }}
            onMouseDown={(e) => {
              // Keep focus + click on the chip; do not leak to modal backdrop.
              e.stopPropagation();
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
