/**
 * Compact settings row — label + key stay beside the control (never flung across the card).
 * Use for service consoles and dense config forms system-wide.
 */
import type { ReactNode } from 'react';
import { Badge, type BadgeTone } from './Badge';

export interface SettingFieldProps {
  label: string;
  /** Technical key shown as a chip next to the label */
  techKey?: string;
  description?: string;
  badge?: string;
  badgeTone?: BadgeTone;
  dirty?: boolean;
  /** htmlFor linking when children is a single control with id */
  htmlFor?: string;
  children: ReactNode;
}

export function SettingField({
  label,
  techKey,
  description,
  badge,
  badgeTone = 'info',
  dirty,
  htmlFor,
  children,
}: SettingFieldProps) {
  return (
    <div className={`setting-field${dirty ? ' is-dirty' : ''}`}>
      <div className="setting-field__head">
        <div className="setting-field__title">
          {htmlFor ? (
            <label className="setting-field__label" htmlFor={htmlFor}>
              {label}
            </label>
          ) : (
            <span className="setting-field__label">{label}</span>
          )}
          {techKey ? <code className="setting-field__key">{techKey}</code> : null}
          {badge ? <Badge tone={badgeTone}>{badge}</Badge> : null}
        </div>
        {description ? <p className="setting-field__desc">{description}</p> : null}
      </div>
      <div className="setting-field__control">{children}</div>
    </div>
  );
}

/** Vertical list of SettingField rows with a readable max width */
export function SettingFieldList({ children }: { children: ReactNode }) {
  return <div className="setting-field-list">{children}</div>;
}
