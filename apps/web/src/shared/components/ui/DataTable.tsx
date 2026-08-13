/**
 * System-wide data table — only allowed table primitive for feature pages.
 * Only table primitive for feature pages (no raw <table className="data">).
 *
 * **Actions:** primary CTAs only in `toolbar` or page header.
 * `empty` EmptyState must be text only — no Create / Go-to / Refresh buttons.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from './EmptyState';

export type DataColumnMobile = 'lead' | 'meta' | 'hide' | 'check' | 'actions';

export type DataColumn<T> = {
  key: string;
  /** Header cell content (string or e.g. select-all checkbox) */
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  /** Prefer nowrap for actions / status */
  nowrap?: boolean;
  /**
   * Narrow-viewport role. Default: non-string header → check; first string
   * header → lead; rest → meta.
   */
  mobile?: DataColumnMobile;
};

function headerLabel(header: ReactNode): string | undefined {
  return typeof header === 'string' && header.trim() ? header.trim() : undefined;
}

function resolveMobileRole<T>(
  columns: DataColumn<T>[],
  index: number,
): DataColumnMobile {
  const col = columns[index]!;
  if (col.mobile) return col.mobile;
  if (typeof col.header !== 'string') return 'check';
  const firstText = columns.findIndex((c) => typeof c.header === 'string');
  return index === firstText ? 'lead' : 'meta';
}

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
  dense = true }: DataTableProps<T>) {
  const { t } = useTranslation();
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
          {empty ?? <EmptyState title={t('dataTable.empty')} />}
        </div>
      ) : (
        <div className="data-table__wrap table-wrap">
          <table className="data data-table__table">
            <thead>
              <tr>
                {columns.map((c, ci) => (
                  <th
                    key={c.key}
                    className={[c.className, c.nowrap ? 'u-nowrap' : '']
                      .filter(Boolean)
                      .join(' ')}
                    data-mobile={resolveMobileRole(columns, ci)}
                  >
                    {c.header}
                  </th>
                ))}
                {rowActions ? (
                  <th className="u-nowrap data-table__actions-col" data-mobile="actions">
                    {t('dataTable.actions')}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className={rowClassName?.(row, index)}
                >
                  {columns.map((c, ci) => {
                    const role = resolveMobileRole(columns, ci);
                    const label = headerLabel(c.header);
                    return (
                      <td
                        key={c.key}
                        className={[
                          c.className,
                          c.nowrap ? 'u-nowrap' : '',
                          role === 'actions' ? 'data-table__actions-cell' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        data-mobile={role}
                        {...(label && role === 'meta' ? { 'data-label': label } : {})}
                      >
                        {c.render(row)}
                      </td>
                    );
                  })}
                  {rowActions ? (
                    <td className="u-nowrap data-table__actions-cell" data-mobile="actions">
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
