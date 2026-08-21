import { describe, expect, it, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import type { HostExecutor, RunResult } from '../../host/executor.js';
import { openDatabase, closeDatabase } from '../../db/database.js';
import { makeHost } from '../../test/host.js';
import {
  applyDefensePreset,
  applyDefenseStack,
  defenseBanIp,
  defenseUnbanIp,
  getDefenseStatus,
  listDefenseBans,
  listDefenseTimeline,
} from './defense-service.js';
import { updateAutoBanPolicy } from './auto-ban.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(executeEnabled = false) {
  const { host, dir, cleanup } = makeHost({ executeEnabled });
  cleanups.push(cleanup);
  const db = openDatabase(join(dir, 'db.json'));
  cleanups.push(() => closeDatabase(db));
  return { host, dir, db };
}

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  run?: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>;
}): HostExecutor {
  return {
    executeEnabled: () => opts.executeEnabled !== false,
    isRoot: () => opts.isRoot !== false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({
      stdout: 'inactive',
      stderr: '',
      exitCode: 0,
      argv: [],
      dryRun: false,
    }),
    runCommand: async (argv) => {
      const partial = opts.run ? await opts.run(argv) : {};
      return {
        stdout: '',
        stderr: '',
        exitCode: 0,
        argv,
        dryRun: false,
        ...partial,
      };
    },
  };
}

describe('defense-service honesty', () => {
  it('getDefenseStatus reports executeEnabled and suggestions without root ops', async () => {
    const { host, db, dir } = setup(false);
    const st = await getDefenseStatus({ host, db, dataDir: dir });
    expect(st.executeEnabled).toBe(false);
    expect(st.isRoot).toBe(typeof process.getuid === 'function' ? process.getuid() === 0 : false);
    expect(st.presets.length).toBe(4);
    expect(st.threatLevel).toBeTruthy();
    expect(st.labels.apply.tone).toBe('warn');
    expect(st.suggestions.some((s) => s.id === 'exec')).toBe(true);
    expect(db.snapshot.settings.defense_last_threat).toBe(st.threatLevel);
  });

  it('applyDefensePreset preview does not write; apply writes nginx limits and blocks system', async () => {
    const { host, db, dir } = setup(false);
    const preview = await applyDefensePreset({
      host,
      db,
      dataDir: dir,
      preset: 'daily',
      apply: false,
    });
    expect(preview.ok).toBe(true);
    expect(preview.applied).toBe(false);
    expect(preview.written).toEqual([]);
    expect(preview.actions.length).toBeGreaterThan(0);

    const confDir = join(dir, 'nginx', 'conf.d');
    mkdirSync(confDir, { recursive: true });
    writeFileSync(
      join(confDir, 'site.conf'),
      'server {\n  listen 80;\n  server_name x.test;\n  location / { return 200; }\n}\n',
      'utf8',
    );

    const applied = await applyDefensePreset({
      host,
      db,
      dataDir: dir,
      preset: 'hardened',
      apply: true,
    });
    expect(applied.blocked).toBe(true);
    expect(applied.requiresExecute).toBe(true);
    expect(applied.written.length).toBeGreaterThan(0);
    expect(applied.written.some((p) => p.includes('defense') || p.includes('nginx'))).toBe(true);
    expect(applied.applied).toBe(false);
    expect(db.snapshot.settings.defense_active_preset).toBe('hardened');

    const timeline = listDefenseTimeline(db, 48);
    expect(timeline.some((e) => e.kind === 'preset')).toBe(true);
  });

  it('emergency preset requires confirm token', async () => {
    const { host, db, dir } = setup(false);
    const denied = await applyDefensePreset({
      host,
      db,
      dataDir: dir,
      preset: 'emergency',
      apply: true,
      confirm: 'wrong',
    });
    expect(denied.ok).toBe(false);
    expect(denied.blocked).toBe(true);
    expect(denied.written).toEqual([]);
  });

  it('defenseBanIp dry-run plans; execute=false host blocks; invalid IP fails', async () => {
    const { host, db } = setup(false);

    const bad = await defenseBanIp({ host, db, ip: 'not-an-ip' });
    expect(bad.ok).toBe(false);

    updateAutoBanPolicy(db, { whitelist: ['10.0.0.1'] });
    const wl = await defenseBanIp({ host, db, ip: '10.0.0.1' });
    expect(wl.ok).toBe(false);

    const dry = await defenseBanIp({
      host,
      db,
      ip: '203.0.113.50',
      execute: false,
      method: 'both',
    });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    expect(dry.plan?.some((p) => p.includes('banip'))).toBe(true);
    expect(dry.plan?.some((p) => p.includes('ufw'))).toBe(true);

    const blocked = await defenseBanIp({
      host,
      db,
      ip: '203.0.113.51',
      method: 'fail2ban',
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
    const bans = await listDefenseBans({ host, db });
    expect(bans.items.some((b) => b.ip === '203.0.113.51')).toBe(false);
  });

  it('defenseUnbanIp dry-run and blocked without execute', async () => {
    const { host, db } = setup(false);
    const dry = await defenseUnbanIp({
      host,
      db,
      ip: '203.0.113.9',
      execute: false,
      method: 'both',
    });
    expect(dry.ok).toBe(true);
    expect(dry.dryRun).toBe(true);
    expect(dry.plan?.length).toBe(2);

    const blocked = await defenseUnbanIp({ host, db, ip: '203.0.113.9' });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);
  });

  it('applyDefenseStack with execute false writes plans but reports blocked aggregate', { timeout: 20_000 }, async () => {
    const { host, db, dir } = setup(false);
    const r = await applyDefenseStack({
      host,
      db,
      dataDir: dir,
      execute: false,
    });
    // without execute, firewall/fail2ban steps may still be ok for write-only paths
    expect(r.requiresExecute).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.steps.some((s) => s.id === 'firewall')).toBe(true);
    expect(r.steps.some((s) => s.id === 'fail2ban')).toBe(true);
    expect(r.steps.some((s) => s.id === 'preset')).toBe(true);

    const withExecFlag = await applyDefenseStack({
      host,
      db,
      dataDir: dir,
      execute: true,
    });
    // host still has executeEnabled false → blocked
    expect(withExecFlag.executed).toBe(false);
    expect(withExecFlag.requiresExecute).toBe(true);
    expect(withExecFlag.blocked || !withExecFlag.ok).toBe(true);
  });

  it('listDefenseTimeline filters by hours window', () => {
    const { db } = setup(false);
    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const recent = new Date().toISOString();
    db.snapshot.settings.defense_timeline = JSON.stringify([
      { at: old, kind: 'ban', title: 'old' },
      { at: recent, kind: 'ban', title: 'new' },
    ]);
    db.persist();
    const t = listDefenseTimeline(db, 24);
    expect(t.some((e) => e.title === 'new')).toBe(true);
    expect(t.every((e) => e.title !== 'old')).toBe(true);
  });

  it('ban with execute enabled host runs fail2ban-client', async () => {
    const calls: string[][] = [];
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: (argv) => {
        calls.push(argv);
        return { exitCode: 0, stdout: 'ok' };
      },
    });
    const { dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));

    const r = await defenseBanIp({
      host,
      db,
      ip: '198.51.100.7',
      method: 'fail2ban',
      jail: 'sshd',
    });
    expect(r.ok).toBe(true);
    expect(calls.some((a) => a[0] === 'fail2ban-client' && a.includes('banip'))).toBe(true);
  });
});
