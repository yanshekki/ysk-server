import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileNameConflictDialog } from './FileNameConflictDialog';

describe('FileNameConflictDialog', () => {
  it('offers skip, keep both, and replace for a file', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(
      <FileNameConflictDialog
        open
        prompt={{
          name: 'photo.jpg',
          destType: 'file',
          incomingType: 'file',
          destPath: 'photo.jpg',
          keepBothName: 'photo (1).jpg',
          current: 1,
          total: 2,
          remaining: 2,
        }}
        onDecide={onDecide}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /merge|合併|合并/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /keep both|兩者都保留|保留两者/i }));
    expect(onDecide).toHaveBeenCalledWith({ action: 'keepBoth', applyToAll: false });
  });

  it('offers merge for two folders', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(
      <FileNameConflictDialog
        open
        prompt={{
          name: 'photos',
          destType: 'dir',
          incomingType: 'dir',
          destPath: 'photos',
          keepBothName: 'photos (1)',
          current: 1,
          total: 1,
          remaining: 1,
        }}
        onDecide={onDecide}
      />,
    );
    await user.click(screen.getByRole('button', { name: /merge|合併|合并/i }));
    expect(onDecide).toHaveBeenCalledWith({ action: 'merge', applyToAll: false });
  });
});
