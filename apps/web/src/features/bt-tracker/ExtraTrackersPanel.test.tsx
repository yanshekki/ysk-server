import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExtraTrackersPanel } from './ExtraTrackersPanel';
import { DEFAULT_BT_TRACKER_SETTINGS } from 'ysk-server-shared';

describe('ExtraTrackersPanel', () => {
  it('refuses javascript: and adds an http announce URL', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn(async () => undefined);
    render(
      <ExtraTrackersPanel
        settings={{ ...DEFAULT_BT_TRACKER_SETTINGS, extraTrackers: [] }}
        busy={false}
        onSave={onSave}
        onApplied={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Announce URL');
    await user.type(input, 'javascript:alert(1)');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByText(/URL must start with http:\/\/, https:\/\/, udp:\/\/, ws:\/\/, or wss:\/\//),
    ).toBeTruthy();

    await user.clear(input);
    await user.type(input, 'http://tracker.example/announce');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(onSave).toHaveBeenCalledWith([
      { url: 'http://tracker.example/announce', enabled: true },
    ]);
  });
});
