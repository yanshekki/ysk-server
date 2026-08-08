import type { ReactNode } from 'react';

export type AlertVariant = 'error' | 'ok' | 'info' | 'warn';

export interface AlertProps {
  children: ReactNode;
  variant?: AlertVariant;
  className?: string;
}

const VARIANT_CLASS: Record<AlertVariant, string> = {
  error: 'alert alert--error',
  ok: 'alert alert--ok',
  info: 'alert alert--info',
  warn: 'alert alert--warn' };

export function Alert({ children, variant = 'info', className }: AlertProps) {
  const cls = [VARIANT_CLASS[variant], className ?? ''].filter(Boolean).join(' ');
  return <div className={cls} role={variant === 'error' ? 'alert' : 'status'}>{children}</div>;
}
