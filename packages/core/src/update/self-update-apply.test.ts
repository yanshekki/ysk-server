import { describe, expect, it } from 'vitest';
import { runSelfUpdate, checkSelfUpdate } from './self-update-apply.js';
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
    expect(r.checked).toBe(true);
    expect(r.updateAvailable).toBe(true);
    expect(r.latestVersion).toBe('0.2.0');
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
    expect(r.notes.some((n) => /YSK_EXECUTE|系統變更|權限/i.test(n))).toBe(true);
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
    expect(r.checked).toBe(true);
    expect(r.notes.some((n) => /up to date|最新版本|已是最新/i.test(n))).toBe(true);
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

describe('checkSelfUpdate', () => {
  it('honors latestOverride without network', async () => {
    const r = await checkSelfUpdate({
      currentVersion: '0.1.0',
      latestOverride: '0.3.0',
    });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(true);
    expect(r.updateAvailable).toBe(true);
    expect(r.latestVersion).toBe('0.3.0');
    expect(r.channel).toBe('env');
  });

  it('does not claim latest when override equals current', async () => {
    const r = await checkSelfUpdate({
      currentVersion: '1.2.3',
      latestOverride: '1.2.3',
    });
    expect(r.ok).toBe(true);
    expect(r.updateAvailable).toBe(false);
    expect(r.notes.some((n) => /已是最新/i.test(n))).toBe(true);
  });
});
