import type { ReactNode } from 'react';

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  flush?: boolean;
  /** Span full width in 2-col form layouts */
  fullWidth?: boolean;
  /** Optional technical key chip (subtle; avoid for primary labels) */
  techKey?: string;
  className?: string;
}

/**
 * Standard form field — label above control, full width inside FormLayout.
 * Selection-first: prefer radio / checkbox / select / MultiCheckSelect / SegRadio
 * for closed option sets; use text only for free-form values (password, domain, IP, PEM…).
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  flush,
  fullWidth,
  techKey,
  className }: FieldProps) {
  const cls = [
    'field',
    flush ? 'field--flush' : '',
    fullWidth ? 'field--full' : '',
    error ? 'field--error' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      <div className="field__label-row">
        <label htmlFor={htmlFor}>
          {label}
          {required ? <span className="field__req" aria-hidden>*</span> : null}
        </label>
        {techKey ? <code className="field__key">{techKey}</code> : null}
      </div>
      <div className="field__control">{children}</div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint muted">{hint}</p>
      ) : null}
    </div>
  );
}

export interface FormLayoutProps {
  children: ReactNode;
  /** 1 = single column (default); 2 = max two equal columns on wide screens */
  columns?: 1 | 2;
  className?: string;
}

/** Preferred form layout — never auto-fills 3+ cramped columns. */
export function FormLayout({ children, columns = 1, className }: FormLayoutProps) {
  const cls = [
    'form-layout',
    columns === 2 ? 'form-layout--2' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <div className={cls}>{children}</div>;
}

/** @deprecated Use FormLayout — kept as alias so existing pages improve automatically */
export function FormGrid({ children, dense }: { children: ReactNode; dense?: boolean }) {
  return (
    <div className={dense ? 'form-grid form-grid--dense' : 'form-grid'}>{children}</div>
  );
}

export interface FormActionsProps {
  children: ReactNode;
  align?: 'start' | 'end' | 'split';
  className?: string;
}

export function FormActions({ children, align = 'start', className }: FormActionsProps) {
  const cls = [
    'form-actions',
    align === 'end' ? 'form-actions--end' : '',
    align === 'split' ? 'form-actions--split' : '',
    align === 'start' ? 'form-actions--start' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
  return <div className={cls}>{children}</div>;
}

export interface CheckboxFieldProps {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function CheckboxField({
  id,
  label,
  description,
  checked,
  onChange,
  disabled }: CheckboxFieldProps) {
  return (
    <label className="checkbox-field" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="checkbox-field__text">
        <span className="checkbox-field__label">{label}</span>
        {description ? <span className="checkbox-field__desc">{description}</span> : null}
      </span>
    </label>
  );
}

export function FormHint({ children }: { children: ReactNode }) {
  return <p className="form-hint">{children}</p>;
}
