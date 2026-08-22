import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import {
  applyHostCronLineEdit,
  buildHostCronJobLine,
  findHostJobRaw,
  findRawLineIndexes,
  isInstallOwnedCronUser,
  joinCrontabBody,
  parseJobFields,
  rewriteHostCronLine,
  splitCrontabBody,
} from './cron-host-rewrite.js';
import { CronJobService, parseCrontabText } from './backup-cron.js';
import type { YskDatabase } from '../db/database.js';

describe('cron host rewrite (pure)', () => {
  const sample = [
    'MAILTO=ops@example.com',
    '# header',
    '*/15 * * * * /root/soul-generate/random_soul.sh && /root/soul-generate/random_soul_v2.sh >> /root/soul-generate/cron.log 2>&1',
    '0 3 * * * /usr/bin/true # ysk:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    '',
  ].join('\n');

  it('finds a unique raw line', () => {
    const lines = splitCrontabBody(sample);
    const raw =
      '*/15 * * * * /root/soul-generate/random_soul.sh && /root/soul-generate/random_soul_v2.sh >> /root/soul-generate/cron.log 2>&1';
    expect(findRawLineIndexes(lines, raw)).toEqual([2]);
  });

  it('replaces only that job; env and comments stay', () => {
    const lines = splitCrontabBody(sample);
    const raw = lines[2]!;
    const idx = findRawLineIndexes(lines, raw)[0]!;
    const edited = applyHostCronLineEdit(lines, idx, {
      type: 'replace',
      schedule: '0 * * * *',
      command: '/root/soul-generate/random_soul.sh',
    });
    const body = joinCrontabBody(edited.lines);
    expect(body).toContain('MAILTO=ops@example.com');
    expect(body).toContain('# header');
    expect(body).toContain('0 * * * * /root/soul-generate/random_soul.sh');
    expect(body).not.toContain('random_soul_v2.sh');
    expect(body).toContain('# ysk:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  });

  it('keeps a disabled line commented on replace', () => {
    const lines = ['# 0 1 * * * /usr/bin/old'];
    const edited = applyHostCronLineEdit(lines, 0, {
      type: 'replace',
      schedule: '0 2 * * *',
      command: '/usr/bin/new',
    });
    expect(edited.preview.startsWith('# ')).toBe(true);
    expect(edited.preview).toContain('0 2 * * * /usr/bin/new');
  });

  it('comments and uncomments', () => {
    const lines = ['0 1 * * * /usr/bin/true'];
    const off = applyHostCronLineEdit(lines, 0, { type: 'comment' });
    expect(off.preview).toBe('# 0 1 * * * /usr/bin/true');
    const on = applyHostCronLineEdit(off.lines, 0, { type: 'uncomment' });
    expect(on.preview).toBe('0 1 * * * /usr/bin/true');
  });

  it('deletes the line', () => {
    const lines = ['MAILTO=a', '0 1 * * * /usr/bin/true', '0 2 * * * /usr/bin/false'];
    const edited = applyHostCronLineEdit(lines, 1, { type: 'delete' });
    expect(edited.lines).toEqual(['MAILTO=a', '0 2 * * * /usr/bin/false']);
  });

  it('adopts by tagging ysk id', () => {
    const line = buildHostCronJobLine('0 4 * * *', '/usr/bin/true', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    expect(line).toBe('0 4 * * * /usr/bin/true # ysk:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('refuses newline in command via parse/build', () => {
    expect(() => buildHostCronJobLine('0 1 * * *', 'echo\nhi')).toThrow();
  });

  it('duplicate identity is counted', () => {
    const text = '0 1 * * * /usr/bin/true\n0 1 * * * /usr/bin/true\n';
    const r = findHostJobRaw(text, '0 1 * * *', '/usr/bin/true');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('duplicate');
  });

  it('parses job fields and disabled comments', () => {
    expect(parseJobFields('*/15 * * * * echo hi')).toEqual({
      schedule: '*/15 * * * *',
      command: 'echo hi',
    });
    const parsed = parseCrontabText('root', '# 0 5 * * * /usr/bin/true\n');
    const job = parsed.find((l) => l.kind === 'job');
    expect(job?.disabled).toBe(true);
    expect(job?.command).toBe('/usr/bin/true');
  });
});

describe('rewriteHostCronLine (host)', () => {
  function makeHost(opts: { execute: boolean; root: boolean; crontab: string }) {
    let stored = opts.crontab;
    const host = {
      executeEnabled: () => opts.execute,
      isRoot: () => opts.root,
      runCommand: vi.fn(async (argv: string[]) => {
        if (argv[0] === 'crontab' && argv.includes('-l')) {
          return { exitCode: 0, stdout: stored, stderr: '', argv, dryRun: false };
        }
        if (argv[0] === 'crontab') {
          const file = argv[argv.length - 1]!;
          stored = readFileSync(file, 'utf8');
          return { exitCode: 0, stdout: '', stderr: '', argv, dryRun: false };
        }
        return { exitCode: 1, stdout: '', stderr: 'unexpected', argv, dryRun: false };
      }),
    } as unknown as HostExecutor;
    return { host, get: () => stored };
  }

  it('blocks without EXECUTE and does not write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-rw-'));
    const raw = '*/15 * * * * /root/job.sh';
    const { host, get } = makeHost({
      execute: false,
      root: true,
      crontab: `${raw}\n`,
    });
    const r = await rewriteHostCronLine({
      host,
      dataDir: dir,
      user: 'root',
      oldRaw: raw,
      next: { type: 'replace', schedule: '0 * * * *', command: '/root/job.sh' },
    });
    expect(r.ok).toBe(false);
    expect(r.requiresExecute).toBe(true);
    expect(get()).toContain('*/15');
  });

  it('writes a replace when EXECUTE is on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-rw-'));
    writeFileSync(join(dir, 'keep'), 'x');
    const raw = '*/15 * * * * /root/job.sh';
    const { host, get } = makeHost({
      execute: true,
      root: true,
      crontab: `MAILTO=ops\n${raw}\n`,
    });
    const r = await rewriteHostCronLine({
      host,
      dataDir: dir,
      user: 'root',
      oldRaw: raw,
      next: { type: 'replace', schedule: '0 * * * *', command: '/root/job.sh' },
    });
    expect(r.ok).toBe(true);
    expect(get()).toContain('MAILTO=ops');
    expect(get()).toContain('0 * * * * /root/job.sh');
    expect(get()).not.toContain('*/15');
  });

  it('fails when the raw line is missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-rw-'));
    const { host } = makeHost({ execute: true, root: true, crontab: '0 1 * * * /usr/bin/true\n' });
    const r = await rewriteHostCronLine({
      host,
      dataDir: dir,
      user: 'root',
      oldRaw: '0 2 * * * /usr/bin/false',
      next: { type: 'delete' },
    });
    expect(r.ok).toBe(false);
  });
});

describe('adoptHostLine', () => {
  function emptyDb(): YskDatabase {
    return {
      snapshot: { cron_jobs: [], projects: [], settings: {} },
      persist: () => undefined,
    } as unknown as YskDatabase;
  }

  function makeHost(opts: { execute: boolean; crontab: string }) {
    let stored = opts.crontab;
    const host = {
      executeEnabled: () => opts.execute,
      isRoot: () => true,
      runCommand: vi.fn(async (argv: string[]) => {
        if (argv[0] === 'crontab' && argv.includes('-l')) {
          return { exitCode: 0, stdout: stored, stderr: '', argv, dryRun: false };
        }
        if (argv[0] === 'crontab') {
          stored = readFileSync(argv[argv.length - 1]!, 'utf8');
          return { exitCode: 0, stdout: '', stderr: '', argv, dryRun: false };
        }
        return { exitCode: 1, stdout: '', stderr: 'unexpected', argv, dryRun: false };
      }),
    } as unknown as HostExecutor;
    return { host, get: () => stored };
  }

  it('does not create a panel row without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-ad-'));
    const raw = '0 7 * * * /usr/bin/true';
    const { host } = makeHost({ execute: false, crontab: `${raw}\n` });
    const cron = new CronJobService(emptyDb(), host, dir);
    const r = await cron.adoptHostLine({ user: 'root', oldRaw: raw, actor: 'test' });
    expect(r.ok).toBe(false);
    expect(r.requiresExecute).toBe(true);
    expect(cron.list()).toHaveLength(0);
  });

  it('tags the live line and registers a job', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-ad-'));
    const raw = '0 7 * * * /usr/bin/true';
    const { host, get } = makeHost({ execute: true, crontab: `${raw}\n` });
    const cron = new CronJobService(emptyDb(), host, dir);
    const r = await cron.adoptHostLine({ user: 'root', oldRaw: raw, actor: 'test' });
    expect(r.ok).toBe(true);
    expect(r.jobId).toBeTruthy();
    expect(get()).toContain(`# ysk:${r.jobId}`);
    expect(cron.list()).toHaveLength(1);
  });

  it('refuses adopt for a user install does not write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-ad-'));
    const raw = '0 7 * * * /usr/bin/true';
    const { host } = makeHost({ execute: true, crontab: `${raw}\n` });
    const cron = new CronJobService(emptyDb(), host, dir);
    const r = await cron.adoptHostLine({ user: 'www-data', oldRaw: raw, actor: 'test' });
    expect(r.ok).toBe(false);
    expect(cron.list()).toHaveLength(0);
  });

  it('refuses adopt of a commented line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cron-ad-'));
    const raw = '# 0 7 * * * /usr/bin/true';
    const { host } = makeHost({ execute: true, crontab: `${raw}\n` });
    const cron = new CronJobService(emptyDb(), host, dir);
    const r = await cron.adoptHostLine({ user: 'root', oldRaw: raw, actor: 'test' });
    expect(r.ok).toBe(false);
    expect(cron.list()).toHaveLength(0);
  });

  it('install-owned users are root and current', () => {
    expect(isInstallOwnedCronUser('root')).toBe(true);
    expect(isInstallOwnedCronUser('current')).toBe(true);
    expect(isInstallOwnedCronUser('www-data')).toBe(false);
    expect(isInstallOwnedCronUser('www-data', 'www-data')).toBe(true);
  });
});
