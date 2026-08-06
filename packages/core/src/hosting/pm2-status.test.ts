import { describe, expect, it } from 'vitest';
import {
  filterPm2Apps,
  normalizePm2App,
  parsePm2Jlist,
  collectPm2Snapshot,
} from './pm2-status.js';
import type { HostExecutor } from '../host/executor.js';

const SAMPLE = [
  {
    name: 'ysk-ysks_demo',
    pm_id: 0,
    pid: 12345,
    monit: { cpu: 1.5, memory: 48_000_000 },
    pm2_env: {
      status: 'online',
      restart_time: 2,
      unstable_restarts: 0,
      pm_uptime: Date.now() - 60_000,
      exec_mode: 'fork_mode',
      instances: 1,
      pm_exec_path: '/home/p/app/server.js',
      pm_cwd: '/home/p/app',
      exec_interpreter: '/usr/local/ysk/node/26/bin/node',
      node_args: '',
      env: { PORT: '3100', NODE_ENV: 'production' },
      watch: false,
    },
  },
  {
    name: 'other-app',
    pm_id: 1,
    pid: 0,
    monit: { cpu: 0, memory: 0 },
    pm2_env: {
      status: 'stopped',
      restart_time: 0,
      pm_exec_path: '/tmp/x.js',
      pm_cwd: '/tmp',
      exec_interpreter: 'node',
      env: {},
    },
  },
];

describe('pm2-status', () => {
  it('parsePm2Jlist normalizes jlist fields', () => {
    const rows = parsePm2Jlist(JSON.stringify(SAMPLE));
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe('ysk-ysks_demo');
    expect(rows[0].yskManaged).toBe(true);
    expect(rows[0].status).toBe('online');
    expect(rows[0].cpu).toBe(1.5);
    expect(rows[0].memory).toBe(48_000_000);
    expect(rows[0].port).toBe('3100');
    expect(rows[0].interpreter).toContain('node');
    expect(rows[1].yskManaged).toBe(false);
    expect(rows[1].status).toBe('stopped');
  });

  it('parsePm2Jlist handles empty and invalid', () => {
    expect(parsePm2Jlist('')).toEqual([]);
    expect(parsePm2Jlist('not-json')).toEqual([]);
    expect(parsePm2Jlist('{}')).toEqual([]);
  });

  it('filterPm2Apps yskOnly and query', () => {
    const rows = parsePm2Jlist(JSON.stringify(SAMPLE));
    expect(filterPm2Apps(rows, { yskOnly: true })).toHaveLength(1);
    expect(filterPm2Apps(rows, { q: 'stopped' })).toHaveLength(1);
    expect(filterPm2Apps(rows, { q: '3100' })).toHaveLength(0); // port not in filter text for pid path
    expect(filterPm2Apps(rows, { q: 'server.js' })).toHaveLength(1);
  });

  it('normalizePm2App tolerates missing nested', () => {
    const r = normalizePm2App({ name: 'x' });
    expect(r.name).toBe('x');
    expect(r.status).toBe('unknown');
    expect(r.yskManaged).toBe(false);
  });

  it('collectPm2Snapshot when pm2 missing', async () => {
    const host = {
      runCommand: async () => ({
        stdout: '',
        stderr: '',
        exitCode: 127,
        argv: [],
        dryRun: false,
      }),
      pathExists: () => false,
    } as unknown as HostExecutor;
    // resolveBin uses runCommand command -v — return empty
    const snap = await collectPm2Snapshot(host);
    expect(snap.available).toBe(false);
    expect(snap.apps).toEqual([]);
    expect(snap.notes.some((n) => /pm2 not found/i.test(n))).toBe(true);
  });

  it('collectPm2Snapshot with jlist', async () => {
    const host = {
      runCommand: async (argv: string[]) => {
        const j = argv.join(' ');
        if (argv[0] === 'bash' && j.includes('command -v pm2')) {
          return {
            stdout: '/usr/bin/pm2\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        if (argv[0] === 'pm2' && argv[1] === '-v') {
          return { stdout: '5.4.0\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv[0] === 'pm2' && argv[1] === 'jlist') {
          return {
            stdout: JSON.stringify(SAMPLE),
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
      pathExists: (p: string) => p === '/usr/bin/pm2' || p.includes('pm2'),
    } as unknown as HostExecutor;

    const snap = await collectPm2Snapshot(host);
    expect(snap.available).toBe(true);
    expect(snap.apps).toHaveLength(2);
    expect(snap.running).toBe(1);
    expect(snap.stopped).toBe(1);
    expect(snap.version).toBe('5.4.0');
    expect(snap.path).toBe('/usr/bin/pm2');
  });
});
