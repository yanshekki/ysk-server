import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AddTorrentModal } from './AddTorrentModal';

vi.mock('../projects', () => ({
  projectsApi: { list: async () => ({ items: [] }) },
}));

vi.mock('../files/api', () => ({
  filesApi: { mkdir: async () => ({}) },
}));

vi.mock('./api', () => ({
  btTrackerApi: {
    inspect: vi.fn(),
    addLibrary: vi.fn(),
    probeDest: vi.fn(async () => ({
      ok: true,
      destRel: 'downloads/x',
      seedRel: null,
      destKind: 'missing',
      matchCount: 0,
      totalFiles: 1,
      canSeedExisting: false,
    })),
  },
}));

describe('AddTorrentModal', () => {
  it('hides the native file picker and keeps start disabled until inspect', () => {
    render(
      <AddTorrentModal
        open
        onClose={() => undefined}
        extraTrackerCount={0}
        onAdded={() => undefined}
      />,
    );
    const file = document.querySelector('input[type="file"]');
    expect(file).toBeTruthy();
    expect(file?.classList.contains('sr-only')).toBe(true);
    expect(screen.queryByText(/no file chosen/i)).toBeNull();
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();
  });
});
