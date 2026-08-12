import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  parseRustupToolchainList,
  probeRuntimes,
  rustPanelVersionInstalled,
  rustPanelVersionIsDefault,
} from './runtime-probe.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(stdout: string): HostExecutor {
  return {
    executeEnabled: () => true,
    isRoot: () => true,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      // cargo --version for hostDefault
      if (argv.includes('--version') || argv.join(' ').includes('cargo')) {
        if (argv[0] === 'cargo' || argv.includes('cargo')) {
          return empty({ stdout: 'cargo 1.97.1 (c980f4866 2026-06-30)\n' });
        }
      }
      if (argv[0] === 'bash') {
        return empty({ stdout });
      }
      return empty({ stdout: 'cargo 1.97.1 (c980f4866 2026-06-30)\n' });
    },
  };
}

describe('rust toolchain probe parsing', () => {
  it('parses rustup toolchain list with default', () => {
    const p = parseRustupToolchainList(`
stable-x86_64-unknown-linux-gnu (default)
1.78.0-x86_64-unknown-linux-gnu
1.81.0-x86_64-unknown-linux-gnu
`);
    expect(p.ids.some((id) => id.startsWith('stable'))).toBe(true);
    expect(p.ids.some((id) => id.startsWith('1.78'))).toBe(true);
    expect(p.defaultId?.startsWith('stable')).toBe(true);
  });

  it('matches panel pins to toolchain ids', () => {
    const ids = [
      'stable-x86_64-unknown-linux-gnu',
      '1.78.0-x86_64-unknown-linux-gnu',
    ];
    expect(rustPanelVersionInstalled('stable', ids)).toBe(true);
    expect(rustPanelVersionInstalled('1.78', ids)).toBe(true);
    expect(rustPanelVersionInstalled('1.81', ids)).toBe(false);
    expect(rustPanelVersionIsDefault('stable', 'stable-x86_64-unknown-linux-gnu')).toBe(
      true,
    );
    expect(rustPanelVersionIsDefault('1.78', '1.78.0-x86_64-unknown-linux-gnu')).toBe(
      true,
    );
  });

  it('probe marks stable available when rustup list / run succeeds', async () => {
    // Panel rust pins are discovery-driven (`supported.rust` may be empty) + always `stable`.
    const stdout = [
      'YSK_RUSTUP=/usr/local/ysk/rust/cargo/bin/rustup',
      'YSK_TOOLCHAIN_LIST_BEGIN',
      'YSK_RH=/usr/local/ysk/rust/rustup',
      'stable-x86_64-unknown-linux-gnu (default)',
      '1.78.0-x86_64-unknown-linux-gnu',
      'YSK_DEFAULT_FOR_RH=stable-x86_64-unknown-linux-gnu (default)',
      'YSK_DIR_TC=stable-x86_64-unknown-linux-gnu',
      'YSK_DIR_TC=1.78.0-x86_64-unknown-linux-gnu',
      'YSK_TOOLCHAIN_LIST_END',
      'YSK_RUN_stable=cargo 1.97.1 (c980f4866 2026-06-30)',
      'YSK_RUN_1.78=cargo 1.78.0 (9b00956e5 2024-12-01)',
      'YSK_PATH_CARGO=cargo 1.97.1 (c980f4866 2026-06-30)',
      '',
    ].join('\n');
    const report = await probeRuntimes(mockHost(stdout));
    const byV = Object.fromEntries(report.rust.map((r) => [r.version, r]));
    expect(byV.stable?.available).toBe(true);
    expect(byV.stable?.active).toBe(true);
    // Extra discovered pins (if any) should parse toolchain list without throwing
    expect(report.rust.length).toBeGreaterThanOrEqual(1);
  });
});
