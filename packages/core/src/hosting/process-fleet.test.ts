import { describe, expect, it } from 'vitest';
import {
  applySystemdProjectAction,
  collectProjectProcessRows,
} from './process-fleet.js';
import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';

describe('process-fleet', () => {
  it('applySystemdProjectAction restarts known unit', async () => {
    const db = {
      snapshot: {
        projects: [{ id: 'p1', name: 'n', runtime: 'node', linux_user: 'ysks_demo' }],
      },
    } as unknown as JsonStore;
    const calls: string[] = [];
    const host = {
      executeEnabled: () => true,
      isRoot: () => true,
      runCommand: async (argv: string[]) => {
        calls.push(argv.join(' '));
        if (argv[0] === 'systemctl' && argv[1] === 'restart') {
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (argv.includes('is-active')) {
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
      },
    } as unknown as HostExecutor;
    const r = await applySystemdProjectAction({
      host,
      db,
      projectId: 'p1',
      action: 'restart',
    });
    expect(r.ok).toBe(true);
    expect(r.unit).toContain('ysks_demo');
    expect(calls.some((c) => c.includes('restart'))).toBe(true);
  });

  it('applySystemdProjectAction blocks without execute', async () => {
    const db = {
      snapshot: {
        projects: [{ id: 'p1', linux_user: 'ysks_demo' }],
      },
    } as unknown as JsonStore;
    const host = {
      executeEnabled: () => false,
      isRoot: () => true,
      runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    } as unknown as HostExecutor;
    const r = await applySystemdProjectAction({
      host,
      db,
      projectId: 'p1',
      action: 'stop',
    });
    expect(r.ok).toBe(false);
    expect(r.requiresExecute).toBe(true);
  });

  it('lists node projects with systemctl status', async () => {
    const db = {
      snapshot: {
        projects: [
          {
            id: 'p1',
            name: 'my-node',
            runtime: 'node',
            runtime_version: '26',
            linux_user: 'ysks_demo',
            port: 3100,
            last_health: { deployMode: 'systemd' },
          },
          {
            id: 'p2',
            name: 'php-app',
            runtime: 'php',
            linux_user: 'ysks_php',
          },
        ],
      },
    } as unknown as JsonStore;

    const host = {
      runCommand: async (argv: string[]) => {
        const j = argv.join(' ');
        if (j.includes('is-active') && j.includes('ysks_demo')) {
          return { stdout: 'active\n', stderr: '', exitCode: 0, argv, dryRun: false };
        }
        if (j.includes('show') && j.includes('ysks_demo')) {
          return {
            stdout: '12345\n/usr/local/ysk/node/26/bin/node server.js\n',
            stderr: '',
            exitCode: 0,
            argv,
            dryRun: false,
          };
        }
        return { stdout: 'inactive\n', stderr: '', exitCode: 3, argv, dryRun: false };
      },
    } as unknown as HostExecutor;

    const rows = await collectProjectProcessRows(host, db, ['node', 'bun']);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('my-node');
    expect(rows[0].active).toBe('active');
    expect(rows[0].mainPid).toBe(12345);
    expect(rows[0].port).toBe(3100);
    expect(rows[0].unit).toContain('ysks_demo');
  });
});
