import { describe, expect, it } from 'vitest';
import {
  applyLimit,
  cliLocale,
  cliPositionals,
  getOpt,
  hasFlag,
  parseCliArgv,
  resolveCliDataDir,
} from './cli-argv.js';

describe('getOpt', () => {
  it('reads space and equals forms', () => {
    expect(getOpt(['--data-dir', '/var/lib/ysk-server', 'projects'], '--data-dir')).toBe(
      '/var/lib/ysk-server',
    );
    expect(getOpt(['--data-dir=/var/lib/ysk-server', 'projects'], '--data-dir')).toBe(
      '/var/lib/ysk-server',
    );
    expect(getOpt(['projects', 'list'], '--data-dir')).toBeUndefined();
  });
});

describe('cliPositionals', () => {
  it('does not treat --data-dir value as a command or sub', () => {
    expect(cliPositionals(['--data-dir', '/var/lib/ysk-server', 'projects', 'list'])).toEqual([
      'projects',
      'list',
    ]);
    expect(cliPositionals(['backup', '--data-dir', '/var/lib/ysk-server'])).toEqual(['backup']);
    expect(cliPositionals(['--json', 'projects', 'list'])).toEqual(['projects', 'list']);
    expect(cliPositionals(['ask', 'list projects', '--data-dir', '/var/lib/ysk-server'])).toEqual([
      'ask',
      'list projects',
    ]);
  });

  it('skips --flag=value', () => {
    expect(cliPositionals(['--data-dir=/x', 'users', 'list'])).toEqual(['users', 'list']);
  });
});

describe('parseCliArgv', () => {
  it('finds command after leading globals', () => {
    const p = parseCliArgv(['--data-dir', '/var/lib/ysk-server', '--json', 'projects', 'list']);
    expect(p.command).toBe('projects');
    expect(p.tokens).toEqual(['projects', 'list']);
    expect(p.json).toBe(true);
    expect(p.dataDir).toBe('/var/lib/ysk-server');
  });

  it('detects --help without treating it as a command', () => {
    const p = parseCliArgv(['projects', '--help']);
    expect(p.command).toBe('projects');
    expect(p.help).toBe(true);
  });
});

describe('cliLocale', () => {
  it('defaults to en and ignores LANG', () => {
    expect(cliLocale(undefined, { LANG: 'zh_HK.UTF-8' })).toBe('en');
    expect(cliLocale(undefined, { YSK_LOCALE: 'zh-HK', LANG: 'en_US.UTF-8' })).toBe('zh-HK');
    expect(cliLocale('ja', { YSK_LOCALE: 'zh-HK' })).toBe('ja');
  });
});

describe('resolveCliDataDir', () => {
  it('prefers flag then env then product store for root', () => {
    expect(resolveCliDataDir({ flag: '/explicit', env: { YSK_DATA_DIR: '/env' } })).toBe(
      '/explicit',
    );
    expect(resolveCliDataDir({ env: { YSK_DATA_DIR: '/from-env' }, uid: 0 })).toBe('/from-env');
    expect(
      resolveCliDataDir({
        uid: 0,
        productDir: '/var/lib/ysk-server',
        existsSync: (p) => p === '/var/lib/ysk-server/ysk.json',
      }),
    ).toBe('/var/lib/ysk-server');
    expect(
      resolveCliDataDir({
        uid: 1000,
        productDir: '/var/lib/ysk-server',
        existsSync: () => true,
      }),
    ).toBeUndefined();
  });
});

describe('files shares create', () => {
  it(
    'without --path exits 2 and does not list',
    async () => {
      const { main } = await import('./cli.js');
      const code = await main(['node', 'cli', 'files', 'shares', 'create']);
      expect(code).toBe(2);
    },
    20_000,
  );
});

describe('main --help is a no-op', () => {
  it(
    'projects and store export --help exit 0 without a store',
    async () => {
      const { main } = await import('./cli.js');
      expect(await main(['node', 'cli', 'projects', '--help'])).toBe(0);
      expect(await main(['node', 'cli', 'store', 'export', '--help'])).toBe(0);
    },
    20_000,
  );

  it(
    'update --help does not run a version check',
    async () => {
      const { main } = await import('./cli.js');
      const err: string[] = [];
      const out: string[] = [];
      const se = process.stderr.write.bind(process.stderr);
      const so = process.stdout.write.bind(process.stdout);
      process.stderr.write = ((c: string) => {
        err.push(String(c));
        return true;
      }) as typeof process.stderr.write;
      process.stdout.write = ((c: string) => {
        out.push(String(c));
        return true;
      }) as typeof process.stdout.write;
      try {
        expect(await main(['node', 'cli', 'update', '--help'])).toBe(0);
      } finally {
        process.stderr.write = se;
        process.stdout.write = so;
      }
      const blob = `${err.join('')}${out.join('')}`;
      expect(blob).toMatch(/Usage: ysk-server update/);
      expect(blob).not.toMatch(/up to date/i);
    },
    20_000,
  );

  it(
    'leaf --help prints leaf flags',
    async () => {
      const { main } = await import('./cli.js');
      const err: string[] = [];
      const se = process.stderr.write.bind(process.stderr);
      process.stderr.write = ((c: string) => {
        err.push(String(c));
        return true;
      }) as typeof process.stderr.write;
      try {
        expect(await main(['node', 'cli', 'backup', 'restore', '--help'])).toBe(0);
        expect(await main(['node', 'cli', 'email', 'send', '--help'])).toBe(0);
        expect(await main(['node', 'cli', 'ssl', 'issue', '--help'])).toBe(0);
        expect(await main(['node', 'cli', 'users', 'delete', '--help'])).toBe(0);
      } finally {
        process.stderr.write = se;
      }
      const blob = err.join('');
      expect(blob).toMatch(/--target/);
      expect(blob).toMatch(/email send --from/);
      expect(blob).toMatch(/ssl issue --domain/);
      expect(blob).toMatch(/users delete/);
    },
    20_000,
  );
});

describe('applyLimit', () => {
  it('returns the full list when --limit is omitted', () => {
    const r = applyLimit([1, 2, 3, 4], []);
    expect(r.items).toEqual([1, 2, 3, 4]);
    expect(r.meta.limit).toBeNull();
  });

  it('slices with --limit and --offset', () => {
    const r = applyLimit(['a', 'b', 'c', 'd'], ['--limit', '2', '--offset', '1']);
    expect(r.items).toEqual(['b', 'c']);
    expect(r.meta).toEqual({ total: 4, shown: 2, offset: 1, limit: 2 });
  });

  it('accepts --limit=N', () => {
    const r = applyLimit(['a', 'b', 'c'], ['--limit=1']);
    expect(r.items).toEqual(['a']);
    expect(r.meta).toEqual({ total: 3, shown: 1, offset: 0, limit: 1 });
  });
});

describe('hasFlag', () => {
  it('matches exact flag', () => {
    expect(hasFlag(['--json'], '--json')).toBe(true);
    expect(hasFlag(['--help'], '-h')).toBe(false);
    expect(hasFlag(['-h'], '-h')).toBe(true);
  });
});
