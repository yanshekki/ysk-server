/**
 * @deprecated Import DataTable from `shared/components/ui` instead.
 * Kept as a thin adapter so old imports do not break mid-migration.
 */
import type { ReactNode } from 'react';
import { DataTable, type DataColumn } from '../ui/DataTable';

export type ResourceColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
};

/** @deprecated use DataTable */
export function ResourceTable<T extends { id?: string }>({
  columns,
  rows,
  empty,
  rowActions,
  title,
  description,
  toolbar,
}: {
  columns: ResourceColumn<T>[];
  rows: T[];
  empty?: ReactNode;
  rowActions?: (row: T) => ReactNode;
  title?: string;
  description?: string;
  toolbar?: ReactNode;
}) {
  const cols: DataColumn<T>[] = columns.map((c) => ({
    key: c.key,
    header: c.header,
    render: c.render,
    className: c.className,
  }));

  return (
    <DataTable
      title={title}
      description={description}
      toolbar={toolbar}
      columns={cols}
      rows={rows}
      rowKey={(row, i) => String(row.id ?? i)}
      rowActions={rowActions}
      empty={empty}
      dense
    />
  );
}
