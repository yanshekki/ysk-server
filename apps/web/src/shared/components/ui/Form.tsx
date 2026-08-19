/**
 * System-wide form shell — pair with Field items.
 * Prefer <Form> over bare <form> + FormLayout.
 */
import type { FormEvent, FormHTMLAttributes, ReactNode } from 'react';
import { FormLayout, type FormLayoutProps } from './Field';

export interface FormProps
  extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  children: ReactNode;
  columns?: FormLayoutProps['columns'];
  /** Layout-only (no native form element) — for filters embedded in DataTable */
  layoutOnly?: boolean;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  className?: string;
}

export function Form({
  children,
  columns = 1,
  layoutOnly = false,
  onSubmit,
  className,
  id,
  ...rest
}: FormProps) {
  const body = (
    <FormLayout columns={columns} className={className}>
      {children}
    </FormLayout>
  );

  if (layoutOnly) {
    return body;
  }

  return (
    <form
      id={id}
      className={['form', className].filter(Boolean).join(' ')}
      noValidate
      onSubmit={onSubmit}
      {...rest}
    >
      <FormLayout columns={columns}>{children}</FormLayout>
    </form>
  );
}

export { Field, FormLayout, FormActions, FormHint, CheckboxField, FormGrid } from './Field';
export type {
  FieldProps,
  FormLayoutProps,
  FormActionsProps,
  CheckboxFieldProps } from './Field';
