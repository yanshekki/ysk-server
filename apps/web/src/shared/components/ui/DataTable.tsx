/**
 * System-wide data table — only allowed table primitive for feature pages.
 * Replaces ResourceTable and raw <table className="data">.
 *
 * **Create buttons:** only place primary “+ 建立/新增 …” in `toolbar`
 * (top-right of this table). Never put create in FeaturePageLayout.actions.
 */
import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

export type DataColumn<T> = {
  key: string;
  /** Header cell content (string or e.g. select-all checkbox) */
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** Prefer nowrap for actions / status */
  nowrap?: boolean;
};

export interface DataTableProps<T> {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Optional table card title */
  title?: string;
  description?: string;
  /** Right side of header (e.g. ActionBar primary CTA) */
  toolbar?: ReactNode;
  /** Below header — search / filters (prefer Form + Field) */
  filters?: ReactNode;
  rowActions?: (row: T) => ReactNode;
  /** Optional row class (e.g. is-selected / is-control-plane) */
  rowClassName?: (row: T, index: number) => string | undefined;
  empty?: ReactNode;
  className?: string;
  /** Compact density (default true) */
  dense?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  title,
  description,
  toolbar,
  filters,
  rowActions,
  rowClassName,
  empty,
  className,
  dense = true,
}: DataTableProps<T>) {
  const shellCls = [
    'data-table',
    dense ? 'data-table--dense' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={shellCls}>
      {title || toolbar || description ? (
        <header className="data-table__head">
          <div className="data-table__head-text">
            {title ? <h3 className="data-table__title">{title}</h3> : null}
            {description ? (
              <p className="data-table__desc">{description}</p>
            ) : null}
          </div>
          {toolbar ? <div className="data-table__toolbar">{toolbar}</div> : null}
        </header>
      ) : null}

      {filters ? <div className="data-table__filters">{filters}</div> : null}

      {rows.length === 0 ? (
        <div className="data-table__empty">
          {empty ?? <EmptyState title="沒有資料" />}
        </div>
      ) : (
        <div className="data-table__wrap table-wrap">
          <table className="data data-table__table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={[c.className, c.nowrap ? 'u-nowrap' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {c.header}
                  </th>
                ))}
                {rowActions ? (
                  <th className="u-nowrap data-table__actions-col">操作</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className={rowClassName?.(row, index)}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[c.className, c.nowrap ? 'u-nowrap' : '']
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className="u-nowrap data-table__actions-cell">
                      {rowActions(row)}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
