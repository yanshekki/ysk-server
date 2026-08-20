import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdatesReloadUiDialog } from './UpdatesPage';

describe('UpdatesReloadUiDialog', () => {
  it('asks the operator to confirm a UI reload and exposes data-confirm', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const onClose = vi.fn();
    render(
      <UpdatesReloadUiDialog
        open
        version="1.1.20"
        onClose={onClose}
        onReload={onReload}
      />,
    );
    expect(await screen.findByRole('heading', { name: /reload the panel ui/i })).toBeInTheDocument();
    expect(screen.getByText(/1\.1\.20/)).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: /^reload ui$/i });
    expect(confirm).toHaveAttribute('data-confirm', 'reload-ui');
    await user.click(confirm);
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
