/**
 * System-wide button.
 * One visual size only (md / 40px). `size` prop is accepted for API stability
 * but always maps to the same CSS — never mix sm/md/lg looks in the product.
 * Prefer this over raw className="btn …".
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
/** @deprecated All sizes render identically — prefer omitting size (defaults to md). */
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Ignored for geometry — all sizes are the same system height. */
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
  link: 'btn btn--link' };

/** Single system size class — sm/md/lg aliases kept so call sites need no rewrite. */
const SIZE_CLASS = 'btn--md';

/** Build class string for Link / anchor that should look like Button */
export function buttonClassName(opts: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  const v = opts.variant ?? 'secondary';
  return [
    VARIANT[v],
    SIZE_CLASS,
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
  title,
  ...rest
}: ButtonProps) {
  const { t } = useTranslation();
  const resolvedTitle =
    title ??
    (loading
      ? t('common.processing')
      : disabled
        ? t('common.unavailable')
        : undefined);
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      title={resolvedTitle}
      {...rest}
    >
      {loading ? t('common.processing') : children}
    </button>
  );
}
