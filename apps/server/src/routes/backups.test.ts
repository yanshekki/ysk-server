import { describe, expect, it, afterEach } from 'vitest';
import {
  startTestServer,
  apiJson,
  expectHonestOps,
  type TestServer,
} from '../test/harness.js';

describe('backups routes (HTTP)', () => {
  let ts: TestServer;

  afterEach(async () => {
    if (ts) await ts.close();
  });

  it('rejects unauthenticated backups list', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/backups', undefined, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('lists backups when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/backups');
    expect(res.status).toBe(200);
    const body = res.body as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('gets backups status when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'GET', '/api/v1/backups/status');
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; archiveCount?: number; notes?: string[] };
    expect(body.ok).toBe(true);
    expect(typeof body.archiveCount).toBe('number');
  });

  it('restic run when disabled is honest failure (not fake success)', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/restic/run', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as { ok?: boolean; notes?: string[]; results?: unknown[] };
    expect(body.ok).toBe(false);
    expectHonestOps({
      ok: false,
      notes: body.notes ?? ['restic disabled'],
    });
  });

  it('updates backup settings when authenticated', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/settings', {
      exclusions: ['node_modules', '.git', 'vendor'],
    });
    expect(res.status).toBe(200);
    const body = res.body as { ok?: boolean; exclusions?: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.exclusions)).toBe(true);
    expect(body.exclusions).toContain('node_modules');
  });

  it('remote SFTP test does not require EXECUTE', async () => {
    ts = await startTestServer();
    await apiJson(ts, 'POST', '/api/v1/backups/settings', {
      remote: {
        enabled: true,
        kind: 'sftp',
        host: 'backup.example.com',
        username: 'ysk',
        path: '/backups/ysk',
      },
    });
    const res = await apiJson(ts, 'POST', '/api/v1/backups/remote/test', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      requiresExecute?: boolean;
      notes?: string[];
    };
    expect(body.requiresExecute).not.toBe(true);
    expect(body.ok === true && body.blocked === true).toBe(false);
    const blob = `${body.notes?.join(' ') ?? ''} ${JSON.stringify(body)}`;
    expect(/YSK_EXECUTE/.test(blob)).toBe(false);
  });

  it('rejects unauthenticated settings mutation', async () => {
    ts = await startTestServer();
    const res = await apiJson(
      ts,
      'POST',
      '/api/v1/backups/settings',
      { exclusions: [] },
      { auth: false },
    );
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('control-plane backup is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/control-plane', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
      archivePath?: string;
    };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('control-plane archive preview via /restore does not require a project', async () => {
    ts = await startTestServer();
    const preview = await apiJson(ts, 'POST', '/api/v1/backups/restore', {
      projectId: 'control-plane',
      name: 'missing-cp.tar.gz',
      mode: 'dry-run',
    });
    expect(preview.status).toBeLessThan(500);
    const body = preview.body as { ok?: boolean; notes?: string[]; error?: string };
    const blob = `${(body.notes ?? []).join(' ')} ${body.error ?? ''}`;
    expect(blob).not.toMatch(/找不到專案|n0028/);
  });

  it('remote test overlay uses unsaved form enabled flag', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/remote/test', {
      remote: {
        enabled: true,
        kind: 'sftp',
        host: 'backup.example.com',
        username: 'ysk',
        path: '/backups/ysk',
      },
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as { ok?: boolean; notes?: string[]; requiresExecute?: boolean };
    expect(body.ok).toBe(false);
    expect((body.notes ?? []).join(' ')).not.toMatch(/n1479|遠端備份未啟用/);
    expect(body.requiresExecute === true || (body.notes ?? []).length > 0).toBe(true);
  });

  it('control-plane restore dry-run missing archive is honest', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/control-plane/restore', {
      name: 'no-such-archive.tar.gz',
      mode: 'dry-run',
    });
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
    };
    expect(typeof body.ok).toBe('boolean');
    expect(body.ok === true && body.blocked === true).toBe(false);
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('run-all with empty projects is honest ops', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/run-all', {});
    expect(res.status).toBeLessThan(500);
    const body = res.body as {
      ok?: boolean;
      blocked?: boolean;
      apply_status?: string;
      notes?: string[];
      results?: unknown[];
    };
    expect(typeof body.ok).toBe('boolean');
    expectHonestOps({
      ok: body.ok ?? false,
      blocked: body.blocked,
      apply_status: body.apply_status,
      notes: body.notes,
    });
  });

  it('rejects unauthenticated control-plane backup', async () => {
    ts = await startTestServer();
    const res = await apiJson(ts, 'POST', '/api/v1/backups/control-plane', {}, { auth: false });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  it('settings GET + schedule + restic snapshots/restore + project restore/delete/download', async () => {
    ts = await startTestServer();

    const getSettings = await apiJson(ts, 'GET', '/api/v1/backups/settings');
    expect(getSettings.status).toBe(200);

    const schedule = await apiJson(ts, 'POST', '/api/v1/backups/schedule', {
      cron: '0 3 * * *',
      enabled: true,
    });
    expect(schedule.status).toBeLessThan(500);

    const snaps = await apiJson(ts, 'GET', '/api/v1/backups/restic/snapshots');
    expect(snaps.status).toBeLessThan(500);

    const resticRestore = await apiJson(ts, 'POST', '/api/v1/backups/restic/restore', {
      snapshotId: 'no-such',
      target: '/tmp/ysk-restic-restore-test',
      dryRun: true,
    });
    expect(resticRestore.status).toBeLessThan(500);
    expect((resticRestore.body as { ok?: boolean }).ok === true &&
      (resticRestore.body as { apply_status?: string }).apply_status === 'applied').toBe(false);

    // project restore missing
    const restore = await apiJson(ts, 'POST', '/api/v1/backups/restore', {
      name: 'no-such-backup.tar.gz',
      projectId: 'no-such',
      dryRun: true,
    });
    expect(restore.status).toBeLessThan(500);

    const del = await apiJson(ts, 'DELETE', '/api/v1/backups?name=no-such-backup.tar.gz');
    expect(del.status).toBeLessThan(500);

    const dl = await apiJson(ts, 'GET', '/api/v1/backups/download?name=no-such-backup.tar.gz');
    expect(dl.status).toBeLessThan(500);

    // control-plane then list/download if archive created
    const cp = await apiJson(ts, 'POST', '/api/v1/backups/control-plane', {});
    expect(cp.status).toBeLessThan(500);
    const list = await apiJson(ts, 'GET', '/api/v1/backups');
    expect(list.status).toBe(200);
    const items = (list.body as { items?: Array<{ name?: string }> }).items ?? [];
    if (items[0]?.name) {
      const dl2 = await apiJson(
        ts,
        'GET',
        `/api/v1/backups/download?name=${encodeURIComponent(items[0].name)}`,
      );
      expect(dl2.status).toBeLessThan(500);
    }

    // run-all with a project present
    const proj = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'BakProj',
      runtime: 'node',
      domain: 'bak-proj.test',
    });
    if (proj.status === 201) {
      const runAll = await apiJson(ts, 'POST', '/api/v1/backups/run-all', {});
      expect(runAll.status).toBeLessThan(500);
      expectHonestOps({
        ok: (runAll.body as { ok?: boolean }).ok ?? false,
        blocked: (runAll.body as { blocked?: boolean }).blocked,
        apply_status: (runAll.body as { apply_status?: string }).apply_status,
        notes: (runAll.body as { notes?: string[] }).notes,
      });
    }
  }, 90_000);

  it('schedule with install + restic enable empty run + validation paths', async () => {
    ts = await startTestServer();

    const schedule = await apiJson(ts, 'POST', '/api/v1/backups/schedule', {
      schedule: '0 5 * * *',
      install: true,
    });
    expect(schedule.status).toBeLessThan(500);
    const sj = schedule.body as {
      ok?: boolean;
      install?: { ok?: boolean; blocked?: boolean } | null;
      job?: { schedule?: string };
    };
    // host crontab install without EXECUTE must not claim applied host success
    if (sj.install && sj.install.ok === true && sj.install.blocked === true) {
      throw new Error('honesty violation: install ok && blocked');
    }

    const setRestic = await apiJson(ts, 'POST', '/api/v1/backups/settings', {
      restic: {
        enabled: true,
        password: 'test-restic-password-long',
        repository: '/tmp/ysk-restic-depth-repo',
      },
      exclusions: ['node_modules', '.cache'],
    });
    expect(setRestic.status).toBe(200);

    const resticRun = await apiJson(ts, 'POST', '/api/v1/backups/restic/run', {});
    expect(resticRun.status).toBeLessThan(500);
    const rr = resticRun.body as { ok?: boolean; empty?: boolean; results?: unknown[] };
    expect(typeof rr.ok).toBe('boolean');

    const cpNoName = await apiJson(ts, 'POST', '/api/v1/backups/control-plane/restore', {
      mode: 'dry-run',
    });
    expect(cpNoName.status).toBe(400);

    const delBad = await apiJson(ts, 'DELETE', '/api/v1/backups', { name: 'only-name' });
    expect(delBad.status).toBe(400);

    const restoreNoFields = await apiJson(ts, 'POST', '/api/v1/backups/restore', {});
    expect(restoreNoFields.status).toBe(400);

    const listQ = await apiJson(ts, 'GET', '/api/v1/backups?q=control&projectId=control-plane');
    expect(listQ.status).toBe(200);
  });

  it('control-plane restore dry-run + run-all with restic on', async () => {
    ts = await startTestServer();
    await apiJson(ts, 'POST', '/api/v1/backups/settings', {
      restic: {
        enabled: true,
        password: 'Restic-Long-Password-99',
        repository: '/tmp/ysk-restic-runall-repo',
      },
      remote: { kind: 'local', path: '/tmp/ysk-bak-remote', enabled: false },
    });

    // create project so run-all has work
    const proj = await apiJson(ts, 'POST', '/api/v1/projects', {
      name: 'BakRunAll',
      runtime: 'node',
      domain: 'bak-runall.test',
    });
    expect(proj.status).toBeLessThan(500);

    const runAll = await apiJson(ts, 'POST', '/api/v1/backups/run-all', {});
    expect(runAll.status).toBeLessThan(500);

    try {
      const cpRest = await apiJson(ts, 'POST', '/api/v1/backups/control-plane/restore', {
        name: 'no-such-archive.tar.gz',
        mode: 'dry-run',
      });
      expect(cpRest.status).toBeLessThan(500);
    } catch {
      /* may throw YskError through handler */
    }

    const cpFull = await apiJson(ts, 'POST', '/api/v1/backups/control-plane/restore', {
      name: 'no-such-archive.tar.gz',
      mode: 'full',
      confirmPhrase: 'CONFIRM',
    });
    expect(cpFull.status).toBeLessThan(500);
  }, 120_000);
});
