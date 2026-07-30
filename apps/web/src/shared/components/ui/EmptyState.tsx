import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  /**
   * @deprecated Prefer no actions under list/table empty states.
   * Page header / tabs / DataTable toolbar already carry primary actions.
   * Do not put Create/Add/Go-to/Refresh here — empty copy only.
   */
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty__title">{title}</div>
      {description ? <p>{description}</p> : null}
      {action ? <div className="form-actions">{action}</div> : null}
    </div>
  );
}
