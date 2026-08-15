export type BadgeTone = 'ok' | 'warn' | 'danger' | 'neutral' | 'info';

export interface BadgeProps {
  children: React.ReactNode;
  tone?: BadgeTone;
  className?: string;
  title?: string;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  ok: 'badge badge--ok',
  warn: 'badge badge--warn',
  danger: 'badge badge--danger',
  neutral: 'badge badge--neutral',
  info: 'badge' };

export function Badge({ children, tone = 'info', className, title }: BadgeProps) {
  const cls = [TONE_CLASS[tone], className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={cls} title={title}>
      {children}
    </span>
  );
}
