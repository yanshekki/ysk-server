import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { resolveBin, binPresent } from './resolve-bin.js';

function host(opts: {
  pathExists?: (p: string) => boolean;
  run?: (argv: string[]) => RunResult | Promise<RunResult>;
}): HostExecutor {
  return {
    executeEnabled: () => false,
    isRoot: () => false,
    pathExists: opts.pathExists ?? (() => false),
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
    runCommand: async (argv) =>
      (await opts.run?.(argv)) ?? {
        stdout: '',
        stderr: '',
        exitCode: 1,
        argv,
        dryRun: false,
      },
  };
}

const empty = (argv: string[]): RunResult => ({
  stdout: '',
  stderr: '',
  exitCode: 1,
  argv,
  dryRun: false,
});

describe('resolveBin', () => {
  it('returns PATH hit first', async () => {
    const h = host({
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v nginx')) {
          return {
            stdout: '/usr/sbin/nginx\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return empty(argv);
      },
    });
    expect(await resolveBin(h, 'nginx')).toBe('/usr/sbin/nginx');
  });

  it('rejects invalid bin names', async () => {
    const h = host({});
    expect(await resolveBin(h, 'foo;rm')).toBe('');
    expect(await resolveBin(h, '')).toBe('');
  });

  it('resolves Debian/Ubuntu versioned postgres under /usr/lib/postgresql', async () => {
    const versioned = '/usr/lib/postgresql/16/bin/postgres';
    const h = host({
      pathExists: (p) => p === versioned,
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) return empty(argv);
        if (s.includes('/usr/lib/postgresql') && s.includes('postgres')) {
          return {
            stdout: `${versioned}\n`,
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return empty(argv);
      },
    });
    expect(await resolveBin(h, 'postgres')).toBe(versioned);
    expect(await binPresent(h, 'postgres')).toBe(true);
  });

  it('does not invent versioned path when ls is empty', async () => {
    const h = host({
      pathExists: () => false,
      run: () => empty([]),
    });
    expect(await resolveBin(h, 'postgres')).toBe('');
  });

  it('prefers absolute candidate over versioned when both exist', async () => {
    const h = host({
      pathExists: (p) => p === '/usr/bin/pg_dump' || p.includes('/usr/lib/postgresql'),
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('command -v')) return empty(argv);
        if (s.includes('/usr/lib/postgresql')) {
          return {
            stdout: '/usr/lib/postgresql/16/bin/pg_dump\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return empty(argv);
      },
    });
    expect(await resolveBin(h, 'pg_dump')).toBe('/usr/bin/pg_dump');
  });
});
