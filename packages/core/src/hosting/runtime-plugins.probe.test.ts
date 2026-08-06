import { describe, expect, it } from 'vitest';
import {
  buildRuntimePluginScriptLines,
  runtimePluginsCatalogWithProbe,
} from './runtime-plugins.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function mockHost(bins: Record<string, boolean>): HostExecutor {
  return {
    runCommand: async (argv) => {
      const s = argv.join(' ');
      // Batch probe prints INSTALLED:id
      if (s.includes('INSTALLED:')) {
        const lines: string[] = [];
        for (const [bin, ok] of Object.entries(bins)) {
          if (ok && s.includes(bin)) {
            // map common bins to plugin ids in the script body
            if (bin === 'pm2') lines.push('INSTALLED:pm2');
            if (bin === 'cargo-clippy' || bin === 'clippy') lines.push('INSTALLED:clippy');
            if (bin === 'rustfmt') lines.push('INSTALLED:rustfmt');
            if (bin === 'cargo-watch') lines.push('INSTALLED:cargo-watch');
          }
        }
        // rustup component list --installed
        if (bins.clippy && s.includes('component list')) {
          lines.push('clippy-x86_64-unknown-linux-gnu');
        }
        return {
          stdout: lines.join('\n') + '\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        } as RunResult;
      }
      for (const [bin, ok] of Object.entries(bins)) {
        if (s.includes(bin) && s.includes('command -v')) {
          return {
            stdout: ok ? `/usr/bin/${bin}\n` : '',
            stderr: '',
            exitCode: ok ? 0 : 1,
            argv,
            dryRun: false,
          } as RunResult;
        }
      }
      return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false } as RunResult;
    },
  } as unknown as HostExecutor;
}

describe('runtimePluginsCatalogWithProbe', () => {
  it('marks pm2 installed and drops from defaults', async () => {
    const r = await runtimePluginsCatalogWithProbe('node', mockHost({ pm2: true, yarn: false }));
    const pm2 = r.plugins.find((p) => p.id === 'pm2');
    expect(pm2?.installed).toBe(true);
    expect(r.defaults).not.toContain('pm2');
  });

  it('keeps pm2 in defaults when missing', async () => {
    const r = await runtimePluginsCatalogWithProbe('node', mockHost({ pm2: false }));
    expect(r.defaults).toContain('pm2');
  });

  it('detects rust clippy/rustfmt via component list or bins', async () => {
    const r = await runtimePluginsCatalogWithProbe(
      'rust',
      mockHost({ clippy: true, rustfmt: true, 'cargo-watch': true }),
    );
    expect(r.plugins.find((p) => p.id === 'clippy')?.installed).toBe(true);
    expect(r.plugins.find((p) => p.id === 'rustfmt')?.installed).toBe(true);
    expect(r.plugins.find((p) => p.id === 'cargo-watch')?.installed).toBe(true);
  });

  it('cargo install script symlinks into /usr/local/bin', () => {
    const { lines } = buildRuntimePluginScriptLines('rust', ['cargo-watch']);
    const body = lines.join('\n');
    expect(body).toMatch(/install "cargo-watch"/);
    expect(body).toMatch(/\/usr\/local\/bin\/cargo-watch/);
  });

  it('go install script symlinks air into /usr/local/bin', () => {
    const { lines } = buildRuntimePluginScriptLines('go', ['air']);
    const body = lines.join('\n');
    expect(body).toMatch(/go install|install "github.com\/air-verse\/air/);
    expect(body).toMatch(/\/usr\/local\/bin\/air/);
    expect(body).toMatch(/\$HOME\/go\/bin\/air|GOPATH\/bin\/air/);
    // ysk_go must return early (not cmd || {…}; for that concatenates two go paths)
    expect(body).toContain('YSK_PREFERRED_GO');
    expect(body).toMatch(/ysk_go\(\) \{/);
    expect(body).not.toMatch(/command -v go 2>\/dev\/null \|\| \{ \[ -x/);
  });

  it('detects go air when only under \$HOME/go/bin', async () => {
    const host = {
      runCommand: async (argv: string[]) => {
        const s = argv.join(' ');
        if (s.includes('INSTALLED:') && s.includes('$HOME/go/bin/air')) {
          // Simulate path test: script has [ -x "$HOME/go/bin/air" ] — we echo installed for air
          return {
            stdout: 'INSTALLED:air\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false };
      },
    };
    const r = await runtimePluginsCatalogWithProbe('go', host as never);
    expect(r.plugins.find((p) => p.id === 'air')?.installed).toBe(true);
  });
});
