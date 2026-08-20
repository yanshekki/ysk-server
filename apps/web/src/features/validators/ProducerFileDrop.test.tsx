import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProducerFileDrop } from './ProducerFileDrop';

describe('ProducerFileDrop', () => {
  it('accepts a dropped file and a browse pick, without a cold field', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    const onClear = vi.fn();
    render(
      <ProducerFileDrop
        id="ada-kes"
        label="KES"
        fileHint="kes.skey"
        queuedName="kes.skey"
        onFile={onFile}
        onClear={onClear}
      />,
    );
    const zone = screen.getByTestId('ada-kes-drop');
    const file = new File(['{"type":"KesSigningKey_ed25519_kes_2^6"}'], 'kes.skey', {
      type: 'application/json',
    });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0]).toBe(file);
    expect(document.getElementById('ada-kes')).toHaveAttribute('type', 'file');
    expect(document.getElementById('ada-cold')).toBeNull();
    await user.upload(document.getElementById('ada-kes') as HTMLInputElement, file);
    expect(onFile).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: /^remove$/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('shows on-host fingerprint when attached and nothing is queued', () => {
    render(
      <ProducerFileDrop
        id="ada-vrf"
        label="VRF"
        fileHint="vrf.skey"
        present
        fingerprint="abcd1234ef567890"
        onFile={() => undefined}
      />,
    );
    expect(screen.getByText(/attached abcd1234ef567890/i)).toBeInTheDocument();
    expect(screen.getByText(/on host/i)).toBeInTheDocument();
  });
});
