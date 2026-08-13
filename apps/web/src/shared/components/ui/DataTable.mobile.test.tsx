import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataTable } from './DataTable';

type Row = { id: string; name: string; ver: string; extra: string };

const rows: Row[] = [{ id: '1', name: 'nginx', ver: '1.24', extra: 'noise' }];

describe('DataTable mobile roles', () => {
  it('infers check / lead / meta from headers', () => {
    render(
      <DataTable
        columns={[
          {
            key: 'sel',
            header: <input type="checkbox" aria-label="all" readOnly />,
            render: () => <input type="checkbox" aria-label="row" readOnly />,
          },
          { key: 'n', header: 'Name', render: (r) => r.name },
          { key: 'v', header: 'Version', render: (r) => r.ver },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByLabelText('row').closest('td')).toHaveAttribute('data-mobile', 'check');
    expect(screen.getByText('nginx').closest('td')).toHaveAttribute('data-mobile', 'lead');
    const ver = screen.getByText('1.24').closest('td');
    expect(ver).toHaveAttribute('data-mobile', 'meta');
    expect(ver).toHaveAttribute('data-label', 'Version');
  });

  it('honours explicit hide and does not label check cells', () => {
    render(
      <DataTable
        columns={[
          { key: 'n', header: 'Name', mobile: 'lead', render: (r) => r.name },
          { key: 'x', header: 'Extra', mobile: 'hide', render: (r) => r.extra },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByText('noise').closest('td')).toHaveAttribute('data-mobile', 'hide');
    expect(screen.getByText('nginx').closest('td')).not.toHaveAttribute('data-label');
  });
});
