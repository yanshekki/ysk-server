import { describe, expect, it } from 'vitest';
import { isPanelRestartDisconnect, waitForPanelAfterRestart } from './self-apply';

describe('isPanelRestartDisconnect', () => {
  it('treats browser fetch drops as expected restart', () => {
    expect(isPanelRestartDisconnect(new TypeError('Failed to fetch'))).toBe(true);
    expect(isPanelRestartDisconnect(new Error('NetworkError when attempting to fetch resource.'))).toBe(
      true,
    );
    expect(isPanelRestartDisconnect(new Error('ERR_CONNECTION_REFUSED'))).toBe(true);
    expect(isPanelRestartDisconnect(new Error('ECONNRESET'))).toBe(true);
  });

  it('does not swallow real apply errors', () => {
    expect(isPanelRestartDisconnect(new Error('Host execute is off'))).toBe(false);
    expect(isPanelRestartDisconnect(new Error('YSK_EXECUTE'))).toBe(false);
    expect(isPanelRestartDisconnect('')).toBe(false);
  });
});

describe('waitForPanelAfterRestart', () => {
  it('returns when currentVersion matches', async () => {
    let n = 0;
    const r = await waitForPanelAfterRestart({
      expectVersion: '1.1.2',
      timeoutMs: 5_000,
      now: () => (n < 3 ? n++ : 10_000),
      sleep: async () => undefined,
      probe: async () => {
        if (n < 2) throw new TypeError('Failed to fetch');
        return { currentVersion: '1.1.2', ok: true };
      },
    });
    expect(r?.currentVersion).toBe('1.1.2');
  });

  it('returns null on timeout', async () => {
    const r = await waitForPanelAfterRestart({
      timeoutMs: 1,
      now: (() => {
        let t = 0;
        return () => (t += 10);
      })(),
      sleep: async () => undefined,
      probe: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(r).toBeNull();
  });
});
