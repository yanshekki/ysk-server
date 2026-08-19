import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TableMore } from './TableMore';

describe('TableMore', () => {
  it('closes on Escape, outside click, and after an item click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside</button>
        <TableMore label="More">
          <button type="button">Inside</button>
        </TableMore>
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'outside' }));
    expect(screen.queryByRole('menu')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Inside' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
