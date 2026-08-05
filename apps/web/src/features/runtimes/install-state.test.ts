import { describe, expect, it } from 'vitest';
import {
  compareRuntimeVersions,
  hostSatisfiesTarget,
  resolveRuntimeInstallState,
  versionChipLabel,
} from './install-state';

describe('runtime install-state', () => {
  it('compares majors and minors', () => {
    expect(compareRuntimeVersions('18', '20')).toBeLessThan(0);
    expect(compareRuntimeVersions('8.3', '8.2')).toBeGreaterThan(0);
    expect(compareRuntimeVersions('latest', '1.1.38')).toBeGreaterThan(0);
    expect(compareRuntimeVersions('stable', '1.81')).toBeGreaterThan(0);
  });

  it('matches host report to panel targets', () => {
    expect(hostSatisfiesTarget('v20.18.0', '20')).toBe(true);
    expect(hostSatisfiesTarget('v20.18.0', '22')).toBe(false);
    expect(hostSatisfiesTarget('PHP 8.2.12 (cli)', '8.2')).toBe(true);
    expect(hostSatisfiesTarget('go1.22.5', '1.22')).toBe(true);
  });

  it('disables install when selected version is installed', () => {
    const st = resolveRuntimeInstallState({
      selectedVersion: '20',
      supportedVersions: ['18', '20', '22'],
      availableVersions: ['20'],
      hostDefault: 'v20.18.0',
    });
    expect(st.selectedInstalled).toBe(true);
    expect(st.installDisabled).toBe(true);
    expect(st.newerAvailable).toEqual(['22']);
    expect(st.newestInstalled).toBe('20');
  });

  it('allows install when selected is missing', () => {
    const st = resolveRuntimeInstallState({
      selectedVersion: '22',
      supportedVersions: ['18', '20', '22'],
      probeItems: [
        { version: '20', available: true, versionOutput: 'v20.11.0' },
        { version: '22', available: false },
      ],
      hostDefault: 'v20.11.0',
    });
    expect(st.selectedInstalled).toBe(false);
    expect(st.installDisabled).toBe(false);
    expect(st.installedVersions).toContain('20');
    expect(st.newerAvailable).toContain('22');
  });

  it('chip labels mark installed', () => {
    expect(versionChipLabel('20', ['20'])).toBe('20 ✓');
    expect(versionChipLabel('22', ['20'])).toBe('22');
  });
});
