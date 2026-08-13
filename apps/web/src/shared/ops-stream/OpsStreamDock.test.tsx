import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { OpsStreamProvider, useOpsStream } from './OpsStreamContext';
import { OpsStreamDock } from './OpsStreamDock';
import { toast, toastStore } from '../stores/toast-store';

function Starter() {
  const { begin, appendLog, finish } = useOpsStream();
  return (
    <button
      type="button"
      onClick={() => {
        const { id } = begin({ kind: 'apply', title: 'ysk-server' });
        appendLog(id, { stream: 'stdout', line: 'copy dest' });
        finish(id, { ok: true });
      }}
    >
      start
    </button>
  );
}

describe('OpsStreamDock', () => {
  it('shows a dock job and toasts on finish', async () => {
    toast.clear();
    render(
      <OpsStreamProvider>
        <OpsStreamDock />
        <Starter />
      </OpsStreamProvider>,
    );
    await act(async () => {
      screen.getByText('start').click();
    });
    expect(screen.getByText('ysk-server')).toBeInTheDocument();
    expect(toastStore.getToasts().some((x) => /Finished|完成/.test(x.message))).toBe(true);
    expect(document.body.textContent).toMatch(/copy dest|即時日誌|Live log/);
  });
});
