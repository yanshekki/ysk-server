import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from './executor.js';
import {
  FALLBACK_TIMEZONES,
  isValidTimezoneId,
  listHostTimezones,
  mergeTimezoneOptions,
} from './timezones.js';

function host(run: (argv: string[]) => RunResult): HostExecutor {
  return {
    executeEnabled: () => false,
    isRoot: () => false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => run(argv),
  };
}

describe('timezones', () => {
  it('validates IANA-like ids', () => {
    expect(isValidTimezoneId('Asia/Hong_Kong')).toBe(true);
    expect(isValidTimezoneId('UTC')).toBe(true);
    expect(isValidTimezoneId('Europe/Vilnius')).toBe(true);
    expect(isValidTimezoneId('foo;rm -rf')).toBe(false);
    expect(isValidTimezoneId('../etc')).toBe(false);
    expect(isValidTimezoneId('')).toBe(false);
  });

  it('lists from timedatectl', async () => {
    const h = host((argv) => {
      if (argv.includes('list-timezones')) {
        return {
          stdout: 'UTC\nAsia/Hong_Kong\nEurope/Vilnius\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      return { stdout: '', stderr: 'no', exitCode: 1, argv, dryRun: false };
    });
    const r = await listHostTimezones(h);
    expect(r.source).toBe('timedatectl');
    expect(r.timezones).toEqual(['UTC', 'Asia/Hong_Kong', 'Europe/Vilnius']);
  });

  it('falls back when timedatectl fails', async () => {
    const h = host(() => ({
      stdout: '',
      stderr: 'missing',
      exitCode: 1,
      argv: [],
      dryRun: false,
    }));
    const r = await listHostTimezones(h);
    expect(r.source).toBe('fallback');
    expect(r.timezones).toContain('Asia/Hong_Kong');
    expect(r.timezones.length).toBe(FALLBACK_TIMEZONES.length);
  });

  it('merges current into options', () => {
    const m = mergeTimezoneOptions(['UTC', 'Asia/Tokyo'], 'Europe/Vilnius');
    expect(m).toContain('Europe/Vilnius');
    expect(m).toContain('UTC');
  });
});
