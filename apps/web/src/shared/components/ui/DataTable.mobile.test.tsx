import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from './DataTable';

type Row = { id: string; name: string; ver: string; extra: string };

const rows: Row[] = [{ id: '1', name: 'nginx', ver: '1.24', extra: 'noise' }];

function stubViewport(compact: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: compact && String(query).includes('max-width: 720px'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
        onchange: null,
      }) as MediaQueryList,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DataTable mobile roles', () => {
  it('infers check / lead / meta from headers', () => {
    stubViewport(false);
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
    expect(document.querySelector('.data-table__cards')).toBeNull();
  });

  it('honours explicit hide and does not label check cells', () => {
    stubViewport(false);
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

  it('treats empty-string action columns as actions, not lead', () => {
    stubViewport(false);
    render(
      <DataTable
        columns={[
          { key: 'n', header: 'Name', render: (r) => r.name },
          {
            key: 'actions',
            header: '',
            render: () => <button type="button">Probe</button>,
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(screen.getByRole('button', { name: 'Probe' }).closest('td')).toHaveAttribute(
      'data-mobile',
      'actions',
    );
    expect(screen.getByText('nginx').closest('td')).toHaveAttribute('data-mobile', 'lead');
  });
});

describe('DataTable compact cards', () => {
  it('renders list cards + overflow menu instead of a table', async () => {
    stubViewport(true);
    const user = userEvent.setup();
    render(
      <DataTable
        columns={[
          { key: 'n', header: 'Name', mobile: 'lead', render: (r) => r.name },
          { key: 'v', header: 'Version', mobile: 'meta', render: (r) => r.ver },
          { key: 'x', header: 'Extra', mobile: 'hide', render: (r) => r.extra },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        rowActions={() => <button type="button">Copy link</button>}
      />,
    );

    expect(document.querySelector('table.data')).toBeNull();
    expect(document.querySelector('.data-table__cards')).toBeTruthy();
    expect(screen.getByText('nginx')).toBeInTheDocument();
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('1.24')).toBeInTheDocument();
    expect(screen.queryByText('noise')).toBeNull();
    expect(screen.queryByText('Extra')).toBeNull();

    const more = screen.getByLabelText('Actions');
    await user.click(more);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' }).closest('.data-table__more-panel')).toBeTruthy();
  });

  it('puts inferred action columns into the overflow menu', () => {
    stubViewport(true);
    render(
      <DataTable
        columns={[
          { key: 'n', header: 'Name', render: (r) => r.name },
          {
            key: 'actions',
            header: '',
            render: () => <button type="button">Unshare</button>,
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
      />,
    );
    expect(document.querySelector('table.data')).toBeNull();
    expect(screen.getByRole('button', { name: 'Unshare' }).closest('.data-table__more-panel')).toBeTruthy();
    expect(screen.getByText('nginx').closest('.data-table__card-lead')).toBeTruthy();
  });
});
