import { describe, expect, it } from 'vitest';
import { runSelfUpdate } from './self-update-apply.js';
import { LocalHostExecutor } from '../host/executor.js';

describe('runSelfUpdate', () => {
  it('plans without apply when offline override', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host,
      apply: false,
      latestOverride: '0.2.0',
    });
    expect(r.plan.status.updateAvailable).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.plan.steps.length).toBeGreaterThan(0);
  });

  it('skips apply without YSK_EXECUTE', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host,
      apply: true,
      latestOverride: '9.9.9',
    });
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.notes.some((n) => /YSK_EXECUTE/i.test(n))).toBe(true);
  });

  it('reports ok when already up to date even with apply', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    const r = await runSelfUpdate({
      currentVersion: '1.0.0',
      host,
      apply: true,
      latestOverride: '1.0.0',
    });
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => /up to date/i.test(n))).toBe(true);
  });

  it('plan-only without apply when update available', async () => {
    const host = new LocalHostExecutor({ executeEnabled: true });
    const r = await runSelfUpdate({
      currentVersion: '0.1.0',
      host,
      apply: false,
      latestOverride: '0.9.0',
    });
    expect(r.plan.status.updateAvailable).toBe(true);
    expect(r.applied).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.commandResults).toHaveLength(0);
  });
});
