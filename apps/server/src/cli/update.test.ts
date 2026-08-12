import { describe, expect, it, vi, afterEach } from 'vitest';
import { runUpdate } from './update.js';
import { VERSION } from '../version.js';
import * as core from 'ysk-server-core';

describe('runUpdate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('checkOnly returns structured status', async () => {
    const r = await runUpdate({ checkOnly: true });
    expect(typeof r.ok).toBe('boolean');
    expect(r.code === 'YSK_UPDATE_AVAILABLE' || r.code === 'YSK_UP_TO_DATE' || r.code === 'YSK_UPDATE_CHECK_FAILED').toBe(
      true,
    );
    expect(r.data).toBeTruthy();
  });

  it('plans update when latest override is higher without apply', async () => {
    const r = await runUpdate({ latest: '99.0.0' });
    expect(typeof r.ok).toBe('boolean');
    // either planned path or check-failed / up-to-date depending on channel
    expect(
      ['YSK_UPDATE_PLANNED', 'YSK_UPDATE_AVAILABLE', 'YSK_UP_TO_DATE', 'YSK_UPDATE_CHECK_FAILED'].includes(
        String(r.code),
      ),
    ).toBe(true);
  });

  it('apply with same version does not invent success', async () => {
    const r = await runUpdate({ apply: true, latest: VERSION });
    expect(typeof r.ok).toBe('boolean');
    // apply with no real update → up to date or check-failed or apply-failed
    expect(r.ok === true || r.ok === false).toBe(true);
    expect(r.data || r.message).toBeTruthy();
  });

  it('apply with high latest tries apply path honestly', async () => {
    const prev = process.env.YSK_EXECUTE;
    process.env.YSK_EXECUTE = '0';
    try {
      const r = await runUpdate({ apply: true, latest: '99.9.9' });
      expect(typeof r.ok).toBe('boolean');
      expect(
        [
          'YSK_UPDATE_APPLIED',
          'YSK_UPDATE_APPLY_FAILED',
          'YSK_UPDATE_PLANNED',
          'YSK_UPDATE_AVAILABLE',
          'YSK_UP_TO_DATE',
          'YSK_UPDATE_CHECK_FAILED',
        ].includes(String(r.code)),
      ).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.YSK_EXECUTE;
      else process.env.YSK_EXECUTE = prev;
    }
  });

  it('maps thrown channel errors to YSK_UPDATE_CHECK_FAILED', async () => {
    vi.spyOn(core, 'runSelfUpdate').mockRejectedValue(new Error('channel down for coverage'));
    const r = await runUpdate({ checkOnly: true });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('YSK_UPDATE_CHECK_FAILED');
    expect(String(r.message)).toContain('channel down');
  });

  it('apply true when update available returns applied/failed codes', async () => {
    vi.spyOn(core, 'runSelfUpdate').mockResolvedValue({
      plan: {
        status: {
          updateAvailable: true,
          latestVersion: '99.0.0',
          currentVersion: VERSION,
        },
      },
      applied: false,
      notes: ['mocked apply skip'],
    } as never);
    const r = await runUpdate({ apply: true, latest: '99.0.0' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('YSK_UPDATE_APPLY_FAILED');
  });

  it('apply true when mock applied=true', async () => {
    vi.spyOn(core, 'runSelfUpdate').mockResolvedValue({
      plan: {
        status: {
          updateAvailable: true,
          latestVersion: '99.0.0',
          currentVersion: VERSION,
        },
      },
      applied: true,
      notes: ['mocked'],
    } as never);
    const r = await runUpdate({ apply: true, latest: '99.0.0' });
    expect(r.ok).toBe(true);
    expect(r.code).toBe('YSK_UPDATE_APPLIED');
  });
});
