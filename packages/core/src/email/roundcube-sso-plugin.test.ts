import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeRoundcubeSsoPlugin,
  enableRoundcubeSsoPlugin,
  ROUNDCUBE_PLUGIN_CANDIDATES,
} from './roundcube-sso-plugin.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => execute,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async () => ({ stdout: '', stderr: '', exitCode: 1, argv: [], dryRun: false }),
  };
}

describe('roundcube-sso-plugin', () => {
  it('writes plugin skeleton and blocks system enable without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rc-sso-'));
    try {
      const w = writeRoundcubeSsoPlugin({
        dataDir: dir,
        panelBaseUrl: 'https://panel.example.com/',
      });
      expect(w.ok).toBe(true);
      expect(existsSync(join(w.pluginDir, 'ysk_sso.php'))).toBe(true);
      expect(ROUNDCUBE_PLUGIN_CANDIDATES.length).toBeGreaterThan(2);

      const en = await enableRoundcubeSsoPlugin({
        dataDir: dir,
        host: host(false),
        panelBaseUrl: 'https://panel.example.com',
      });
      // without execute should not claim full system apply success
      expect(en.ok === false || (en.notes ?? []).some((n) => /權限|EXECUTE|written|symlink/i.test(n))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
