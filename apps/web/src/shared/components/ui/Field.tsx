import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  children: ReactNode;
  flush?: boolean;
  /** Optional technical key chip (e.g. bind_address) shown next to label */
  techKey?: string;
}

/**
 * Standard form field — stacked label + control, readable width.
 * Prefer SettingField for service-console style rows with apply badges.
 */
export function Field({ label, htmlFor, hint, children, flush, techKey }: FieldProps) {
  return (
    <div className={flush ? 'field field--flush' : 'field'}>
      <div className="field__label-row">
        <label htmlFor={htmlFor}>{label}</label>
        {techKey ? <code className="field__key">{techKey}</code> : null}
      </div>
      <div className="field__control">{children}</div>
      {hint ? <span className="field__hint muted u-text-sm">{hint}</span> : null}
    </div>
  );
}

export function FormGrid({ children, dense }: { children: ReactNode; dense?: boolean }) {
  return <div className={dense ? 'form-grid form-grid--dense' : 'form-grid'}>{children}</div>;
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;
export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;
export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
