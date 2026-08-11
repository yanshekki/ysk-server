import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  ensurePostfixMainCf,
  postfixMainCfMissing,
  preparePostfixForStart,
  preseedPostfixDebconf,
} from './postfix-bootstrap.js';

function host(opts: {
  paths?: string[];
  run?: (argv: string[]) => RunResult;
}): HostExecutor {
  const paths = new Set(opts.paths ?? []);
  return {
    executeEnabled: () => true,
    isRoot: () => true,
    pathExists: (p) => paths.has(p),
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
    runCommand: async (argv) => {
      if (opts.run) return opts.run(argv);
      // successful cp adds main.cf
      if (argv[0] === 'cp') {
        paths.add('/etc/postfix/main.cf');
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      }
      return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
    },
  };
}

describe('postfix-bootstrap', () => {
  it('detects missing main.cf', async () => {
    const h = host({ paths: ['/etc/postfix/main.cf.proto'] });
    expect(await postfixMainCfMissing(h)).toBe(true);
  });

  it('no-ops when main.cf already present', async () => {
    const h = host({ paths: ['/etc/postfix/main.cf'] });
    const r = await ensurePostfixMainCf(h);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(false);
    expect(r.notes).toEqual([]);
  });

  it('creates main.cf from proto when missing', async () => {
    const h = host({ paths: ['/etc/postfix/main.cf.proto'] });
    const r = await ensurePostfixMainCf(h);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.path).toBe('/etc/postfix/main.cf');
    expect(r.notes.some((n) => n.includes('main.cf.proto'))).toBe(true);
    expect(await postfixMainCfMissing(h)).toBe(false);
  });

  it('falls back to main.cf.debian', async () => {
    const h = host({ paths: ['/usr/share/postfix/main.cf.debian'] });
    const r = await ensurePostfixMainCf(h);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.notes.some((n) => n.includes('main.cf.debian'))).toBe(true);
  });

  it('fails clearly when no template', async () => {
    const h = host({ paths: [] });
    const r = await ensurePostfixMainCf(h);
    expect(r.ok).toBe(false);
    expect(r.created).toBe(false);
    expect(r.notes.join(' ')).toMatch(/no template/i);
  });

  it('preparePostfixForStart is quiet when already configured', async () => {
    const h = host({
      paths: ['/etc/postfix/main.cf'],
      run: (argv) => {
        const s = argv.join(' ');
        if (s.includes('setgid_group')) {
          return {
            stdout: 'postdrop\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const r = await preparePostfixForStart(h);
    expect(r.ok).toBe(true);
    expect(r.notes.some((n) => n.includes('setgid_group=postdrop'))).toBe(true);
  });

  it('preparePostfixForStart creates when missing', async () => {
    const h = host({
      paths: ['/etc/postfix/main.cf.proto'],
      run: (argv) => {
        const s = argv.join(' ');
        if (argv[0] === 'cp') {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (s.includes('setgid_group')) {
          return {
            stdout: 'postdrop\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    });
    const r = await preparePostfixForStart(h);
    expect(r.ok).toBe(true);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it('cp failure is honest', async () => {
    const h = host({
      paths: ['/etc/postfix/main.cf.proto'],
      run: (argv) => ({
        stdout: '',
        stderr: 'permission denied',
        exitCode: argv[0] === 'cp' ? 1 : 0,
        argv,
        dryRun: false,
      }),
    });
    const r = await ensurePostfixMainCf(h);
    expect(r.ok).toBe(false);
    expect(r.notes.join(' ')).toMatch(/failed|permission/i);
  });

  it('preseedPostfixDebconf notes success and soft-fail', async () => {
    const ok = await preseedPostfixDebconf(
      host({
        run: () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      }),
    );
    expect(ok.some((n) => /Internet Site|debconf/i.test(n))).toBe(true);

    const soft = await preseedPostfixDebconf(
      host({
        run: () => ({
          stdout: '',
          stderr: 'debconf missing',
          exitCode: 1,
          argv: [],
          dryRun: false,
        }),
      }),
    );
    expect(soft.some((n) => /soft-fail|debconf/i.test(n))).toBe(true);
  });
});
