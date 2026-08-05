import { describe, expect, it } from 'vitest';
import { uninstallPhpExtensions } from './php-extensions.js';

function host(
  run: (argv: string[]) => { exitCode: number; stdout: string; stderr?: string },
  opts?: { execute?: boolean; root?: boolean },
) {
  return {
    executeEnabled: () => opts?.execute !== false,
    isRoot: () => opts?.root !== false,
    runCommand: async (argv: string[]) => {
      const r = run(argv.map(String));
      return { ...r, stderr: r.stderr ?? '', argv, dryRun: false };
    },
  };
}

describe('uninstallPhpExtensions', () => {
  it('refuses empty / required-only', async () => {
    const r = await uninstallPhpExtensions({
      host: host(() => ({ exitCode: 0, stdout: '' })),
      version: '8.2',
      extensions: ['fpm', 'cli'],
    });
    expect(r.ok).toBe(false);
    expect(r.extensionIds).toEqual([]);
  });

  it('removes optional packages via apt', async () => {
    let cmd = '';
    const r = await uninstallPhpExtensions({
      host: host((argv) => {
        cmd = argv.join(' ');
        return { exitCode: 0, stdout: 'ok' };
      }),
      version: '8.2',
      extensions: ['redis', 'gd'],
    });
    expect(r.ok).toBe(true);
    expect(r.extensionIds).toEqual(expect.arrayContaining(['redis', 'gd']));
    expect(cmd).toMatch(/apt-get remove/);
    expect(cmd).toMatch(/php8\.2-redis/);
    expect(cmd).toMatch(/php8\.2-gd/);
  });

  it('blocks without execute', async () => {
    const r = await uninstallPhpExtensions({
      host: host(() => ({ exitCode: 0, stdout: '' }), { execute: false }),
      extensions: ['redis'],
    });
    expect(r.blocked).toBe(true);
    expect(r.ok).toBe(false);
  });
});
