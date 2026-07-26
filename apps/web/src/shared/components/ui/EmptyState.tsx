import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
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
