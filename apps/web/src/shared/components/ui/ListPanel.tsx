/**
 * List shell matching DataTable chrome (title + top-right toolbar).
 * Use for card/list rows when DataTable is not a fit.
 * Create buttons go only in `toolbar` (never FeaturePageLayout.actions).
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState';

export interface ListPanelProps {
  title?: string;
  description?: string;
  /** Top-right — only place for create actions */
  toolbar?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function ListPanel({
  title,
  description,
  toolbar,
  filters,
  children,
  empty,
  emptyTitle,
  emptyDescription,
  className,
}: ListPanelProps) {
  const { t } = useTranslation();
  const cls = ['data-table', 'list-panel-shell', className ?? ''].filter(Boolean).join(' ');
  return (
    <section className={cls}>
      {title || toolbar || description ? (
        <header className="data-table__head">
          <div className="data-table__head-text">
            {title ? <h3 className="data-table__title">{title}</h3> : null}
            {description ? <p className="data-table__desc">{description}</p> : null}
          </div>
          {toolbar ? <div className="data-table__toolbar">{toolbar}</div> : null}
        </header>
      ) : null}
      {filters ? <div className="data-table__filters">{filters}</div> : null}
      {empty ? (
        <div className="data-table__empty">
          <EmptyState
            title={emptyTitle ?? t('dataTable.empty')}
            description={emptyDescription}
          />
        </div>
      ) : (
        <div className="list-panel-shell__body">{children}</div>
      )}
    </section>
  );
}
