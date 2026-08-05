import { describe, expect, it } from 'vitest';
import { runtimePluginsCatalogWithProbe } from './runtime-plugins.js';
import type { HostExecutor, RunResult } from '../host/executor.js';

function mockHost(bins: Record<string, boolean>): HostExecutor {
  return {
    runCommand: async (argv) => {
      const s = argv.join(' ');
      // command -v "pm2"
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
});
