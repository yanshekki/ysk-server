import type { ReactNode } from 'react';

export type ResourceColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
};

export function ResourceTable<T extends { id?: string }>({
  columns,
  rows,
  empty,
  rowActions,
}: {
  columns: ResourceColumn<T>[];
  rows: T[];
  empty?: ReactNode;
  rowActions?: (row: T) => ReactNode;
}) {
  if (rows.length === 0) {
    return <>{empty}</>;
  }
  return (
    <div className="table-wrap">
      <table className="data">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.className}>
                {c.header}
              </th>
            ))}
            {rowActions ? <th className="u-nowrap">操作</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={String(row.id ?? i)}>
              {columns.map((c) => (
                <td key={c.key} className={c.className}>
                  {c.render(row)}
                </td>
              ))}
              {rowActions ? <td className="u-nowrap">{rowActions(row)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
