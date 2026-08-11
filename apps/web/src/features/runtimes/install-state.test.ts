import { describe, expect, it } from 'vitest';
import {
  compareRuntimeVersions,
  hostSatisfiesTarget,
  resolveRuntimeInstallState,
  versionChipLabel,
  versionLineageMatch,
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

  it('go/rust multi-version: hostDefault does not mark all pins; canSwitch when installed not active', () => {
    const st = resolveRuntimeInstallState({
      selectedVersion: '1.78',
      supportedVersions: ['stable', '1.78', '1.81'],
      multiVersion: true,
      kind: 'rust',
      hostDefault: 'cargo 1.97.1 (c980f4866 2026-06-30)',
      probeItems: [
        { version: 'stable', available: true, active: true, versionOutput: 'cargo 1.97.1' },
        { version: '1.78', available: true, active: false },
        { version: '1.81', available: false },
      ],
    });
    expect(st.installedVersions).toEqual(['stable', '1.78']);
    expect(st.selectedInstalled).toBe(true);
    expect(st.selectedActive).toBe(false);
    expect(st.canSwitch).toBe(true);
    expect(st.installDisabled).toBe(true);
  });

  it('node: can set host default when installed major is not PATH default', () => {
    const st = resolveRuntimeInstallState({
      selectedVersion: '20',
      supportedVersions: ['20', '22', '24'],
      kind: 'node',
      hostDefault: 'v24.19.0',
      availableVersions: ['20', '24'],
      probeItems: [
        { version: '20', available: true, versionOutput: 'v20.18.0' },
        { version: '24', available: true, versionOutput: 'v24.19.0' },
      ],
    });
    expect(st.selectedInstalled).toBe(true);
    expect(st.selectedActive).toBe(false);
    expect(st.canSwitch).toBe(true);
  });

  it('go: full patch target matches probe minor (1.26.5 ↔ 1.26)', () => {
    const st = resolveRuntimeInstallState({
      selectedVersion: '1.26.5',
      supportedVersions: ['1.26.5', '1.25.12'],
      multiVersion: true,
      hostDefault: 'go version go1.26.5 linux/amd64',
      probeItems: [
        { version: '1.26', available: true, active: true, versionOutput: 'go version go1.26.5 linux/amd64' },
        { version: '1.25', available: true, active: false },
      ],
    });
    expect(st.selectedInstalled).toBe(true);
    expect(st.installDisabled).toBe(true);
    expect(st.installedVersions).toContain('1.26.5');
  });

  it('versionLineageMatch: 8.1 vs 8.10 must not collide; 8.1 vs 8.1.12 ok', () => {
    expect(versionLineageMatch('8.1', '8.1.12')).toBe(true);
    expect(versionLineageMatch('8.1', '8.10')).toBe(false);
    expect(versionLineageMatch('1.26', '1.26.5')).toBe(true);
    expect(versionLineageMatch('1.2', '1.26')).toBe(false);
    expect(hostSatisfiesTarget('PHP 8.10.0 (cli)', '8.1')).toBe(false);
    expect(hostSatisfiesTarget('PHP 8.1.12 (cli)', '8.1')).toBe(true);
    expect(hostSatisfiesTarget('v20.18.0', '20')).toBe(true);
  });
});
