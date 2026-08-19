/**
 * System-wide data table — only allowed table primitive for feature pages.
 *
 * Desktop (≥721px): real <table>.
 * Narrow (≤720px): list cards + ⋯ action menu. One layout for every page.
 * Actions: primary CTAs only in `toolbar` or page header.
 * `empty` EmptyState must be text only — no Create / Go-to / Refresh buttons.
 */
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
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
   * Narrow-viewport role. Default: non-string header → check; first non-empty
   * string header → lead; empty header with action-like key → actions; rest → meta.
   */
  mobile?: DataColumnMobile;
};

function headerLabel(header: ReactNode): string | undefined {
  return typeof header === 'string' && header.trim() ? header.trim() : undefined;
}

function isActionKey(key: string): boolean {
  return key === 'actions' || key === 'act' || key === 'copy';
}

function resolveMobileRole<T>(
  columns: DataColumn<T>[],
  index: number,
): DataColumnMobile {
  const col = columns[index]!;
  if (col.mobile) return col.mobile;
  if (typeof col.header !== 'string') return 'check';
  if (!col.header.trim() && isActionKey(col.key)) return 'actions';
  const firstText = columns.findIndex((c) => typeof c.header === 'string' && c.header.trim());
  return index === firstText ? 'lead' : 'meta';
}

function partitionMobileColumns<T>(columns: DataColumn<T>[]) {
  const checks: DataColumn<T>[] = [];
  const leads: DataColumn<T>[] = [];
  const metas: DataColumn<T>[] = [];
  const extraActions: DataColumn<T>[] = [];
  columns.forEach((c, i) => {
    const role = resolveMobileRole(columns, i);
    if (role === 'check') checks.push(c);
    else if (role === 'lead') leads.push(c);
    else if (role === 'meta') metas.push(c);
    else if (role === 'actions') extraActions.push(c);
  });
  return { checks, leads, metas, extraActions };
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
  /** Activate a row (e.g. open a folder). Ignore clicks on buttons/links. */
  onRowActivate?: (row: T) => void;
  empty?: ReactNode;
  /**
   * When the table is empty because search/filters have no hits — not because
   * the collection itself is empty. Shows listToolbar.noResults instead of `empty`.
   */
  filterActive?: boolean;
  className?: string;
  /** Compact density (default true) */
  dense?: boolean;
}

const COMPACT_MQ = '(max-width: 720px)';

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
  onRowActivate,
  empty,
  filterActive = false,
  className,
  dense = true,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [compact, setCompact] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(COMPACT_MQ).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(COMPACT_MQ);
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    setOpenMenu(null);
  }, [compact]);

  useEffect(() => {
    if (!openMenu) return;
    const onPointer = (ev: PointerEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el?.closest('.data-table__more')) return;
      setOpenMenu(null);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setOpenMenu(null);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenu]);

  const mobileCols = useMemo(() => partitionMobileColumns(columns), [columns]);

  const shellCls = [
    'data-table',
    dense ? 'data-table--dense' : '',
    compact ? 'data-table--compact' : '',
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
            {description ? <p className="data-table__desc">{description}</p> : null}
          </div>
          {toolbar ? <div className="data-table__toolbar">{toolbar}</div> : null}
        </header>
      ) : null}

      {filters ? <div className="data-table__filters">{filters}</div> : null}

      {rows.length === 0 ? (
        <div className="data-table__empty">
          {filterActive ? (
            <EmptyState title={t('listToolbar.noResults')} description={t('listToolbar.noResultsHint')} />
          ) : (
            empty ?? <EmptyState title={t('dataTable.empty')} />
          )}
        </div>
      ) : !compact ? (
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
                  className={[
                    rowClassName?.(row, index),
                    onRowActivate ? 'data-table__row--activate' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={(e: MouseEvent) => {
                    if (!onRowActivate) return;
                    const el = e.target as HTMLElement;
                    if (el.closest('button, a, input, select, textarea, label')) return;
                    onRowActivate(row);
                  }}
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
                      <div className="data-table__actions-inner">{rowActions(row)}</div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ul className="data-table__cards">
          {rows.map((row, index) => {
            const key = rowKey(row, index);
            const extraCls = rowClassName?.(row, index);
            const colMenu = mobileCols.extraActions.length ? (
              <>
                {mobileCols.extraActions.map((c) => (
                  <span key={c.key}>{c.render(row)}</span>
                ))}
              </>
            ) : null;
            const rowMenu = rowActions?.(row) ?? null;
            const menu =
              rowMenu || colMenu ? (
                <>
                  {rowMenu}
                  {colMenu}
                </>
              ) : null;
            return (
              <li
                key={key}
                className={['data-table__card', extraCls ?? ''].filter(Boolean).join(' ')}
              >
                <div className="data-table__card-main">
                  {mobileCols.checks.length ? (
                    <div className="data-table__card-check">
                      {mobileCols.checks.map((c) => (
                        <span key={c.key}>{c.render(row)}</span>
                      ))}
                    </div>
                  ) : null}
                  <div className="data-table__card-body">
                    <div className="data-table__card-lead">
                      {mobileCols.leads.map((c) => (
                        <div key={c.key}>{c.render(row)}</div>
                      ))}
                    </div>
                    {mobileCols.metas.length ? (
                      <div className="data-table__card-meta">
                        {mobileCols.metas.map((c) => {
                          const lab = headerLabel(c.header);
                          return (
                            <span key={c.key} className="data-table__card-fact">
                              {lab ? <span className="data-table__card-lab">{lab}</span> : null}
                              <span className="data-table__card-val">{c.render(row)}</span>
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                  {menu ? (
                    <details
                      className="data-table__more"
                      open={openMenu === key}
                      onToggle={(ev) => {
                        const next = (ev.currentTarget as HTMLDetailsElement).open;
                        setOpenMenu(next ? key : null);
                      }}
                    >
                      <summary
                        className="data-table__more-sum"
                        aria-label={t('dataTable.actions')}
                      >
                        ⋯
                      </summary>
                      <div className="data-table__more-panel">{menu}</div>
                    </details>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
