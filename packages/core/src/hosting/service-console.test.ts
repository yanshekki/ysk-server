import { describe, expect, it } from 'vitest';
import { getServiceConsole, lifecycleService } from './service-console.js';
import type { HostExecutor } from '../host/executor.js';

function host(opts: { execute?: boolean; root?: boolean; installed?: boolean }): HostExecutor {
  return {
    executeEnabled: () => opts.execute !== false,
    isRoot: () => opts.root !== false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) => {
      const s = argv.join(' ');
      if (s.includes('command -v')) {
        return {
          stdout: opts.installed === false ? '' : '/usr/bin/x\n',
          stderr: '',
          exitCode: 0,
          argv,
          dryRun: false,
        };
      }
      if (s.includes('is-active')) {
        return { stdout: 'inactive\n', stderr: '', exitCode: 3, argv, dryRun: false };
      }
      if (s.includes('is-enabled')) {
        return { stdout: 'disabled\n', stderr: '', exitCode: 1, argv, dryRun: false };
      }
      // live loaders may call mysql/redis — return empty
      return { stdout: '', stderr: '', exitCode: 1, argv, dryRun: false };
    },
  };
}

describe('service-console', () => {
  it('returns console dto and blocks lifecycle without execute', async () => {
    const h = host({ execute: false, root: false, installed: true });
    const dto = await getServiceConsole(h, 'redis');
    expect(dto.engine).toBe('redis');
    expect(dto.title).toBeTruthy();
    expect(dto.canLifecycle).toBe(false);
    expect(Array.isArray(dto.categories)).toBe(true);

    const life = await lifecycleService(h, 'mysql', 'restart');
    expect(life.blocked).toBe(true);

    const notInst = await getServiceConsole(
      host({ execute: true, root: true, installed: false }),
      'postgres',
    );
    expect(notInst.installed).toBe(false);
    expect(notInst.blockMessage).toMatch(/尚未安裝|權限/);
  });
});
