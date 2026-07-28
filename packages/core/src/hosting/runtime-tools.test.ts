import { describe, expect, it } from 'vitest';
import { probeRuntimeTools } from './runtime-tools.js';
import type { HostExecutor } from '../host/executor.js';

describe('runtime-tools', () => {
  it('probes php composer wp-cli', async () => {
    const host: HostExecutor = {
      executeEnabled: () => false,
      isRoot: () => false,
      pathExists: () => false,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => undefined,
      deletePath: async () => undefined,
      mkdirp: async () => undefined,
      sysInfo: async () => ({}),
      serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      runCommand: async (argv) => {
        const s = argv.join(' ');
        if (s.includes('php -v')) {
          return {
            stdout: 'PHP 8.3.0\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('php -m')) {
          return {
            stdout: '[PHP Modules]\nmysqli\ncurl\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('composer')) {
          return {
            stdout: 'Composer version 2.0\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (s.includes('wp --info')) {
          return { stdout: 'OS:\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false };
      },
    };
    const r = await probeRuntimeTools(host);
    expect(r.php?.version).toMatch(/PHP/);
    expect(r.php?.modules).toContain('mysqli');
    expect(r.composer?.available).toBe(true);
    expect(r.wpCli?.available).toBe(true);
  });
});
