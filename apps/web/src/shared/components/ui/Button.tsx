/**
 * System-wide button — only three sizes: sm | md | lg.
 * Prefer this over raw className="btn …".
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Show busy state (disables + optional label) */
  loading?: boolean;
  children?: ReactNode;
  /** Render as span-styled control when used inside Link via className export */
  fullWidth?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn btn--primary',
  secondary: 'btn btn--secondary',
  ghost: 'btn btn--ghost',
  danger: 'btn btn--danger',
  link: 'btn btn--link',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'btn--sm',
  md: 'btn--md',
  lg: 'btn--lg',
};

/** Build class string for Link / anchor that should look like Button */
export function buttonClassName(opts: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  const v = opts.variant ?? 'secondary';
  const s = opts.size ?? 'md';
  return [
    VARIANT[v],
    SIZE[s],
    opts.fullWidth ? 'btn--block' : '',
    opts.className ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  disabled,
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? '處理中…' : children}
    </button>
  );
}
