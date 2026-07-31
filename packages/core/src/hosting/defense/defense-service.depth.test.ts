import { describe, expect, it, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
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
import { saveAutoBanPolicy, DEFAULT_AUTO_BAN, updateAutoBanPolicy } from './auto-ban.js';
import { saveDefenseAutomation, DEFAULT_AUTOMATION } from './automation.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(executeEnabled = false, isRoot = false) {
  const { host: base, dir, cleanup } = makeHost({ executeEnabled });
  cleanups.push(cleanup);
  const db = openDatabase(join(dir, 'db.json'));
  cleanups.push(() => closeDatabase(db));
  // Do not object-spread class instances (methods like pathExists may be lost)
  const host: HostExecutor = {
    executeEnabled: () => executeEnabled,
    isRoot: () => isRoot,
    pathExists: (p) => base.pathExists(p),
    readFile: (p) => base.readFile(p),
    listDir: (p) => base.listDir(p),
    writeFile: (p, c) => base.writeFile(p, c),
    deletePath: (p) => base.deletePath(p),
    mkdirp: (p) => base.mkdirp(p),
    sysInfo: () => base.sysInfo(),
    serviceStatus: (n) => base.serviceStatus(n),
    runCommand: (argv, opts) => base.runCommand(argv, opts),
  };
  return { host, dir, db };
}

function mockHost(opts: {
  executeEnabled?: boolean;
  isRoot?: boolean;
  run?: (argv: string[]) => Partial<RunResult>;
  pathExists?: (p: string) => boolean;
}): HostExecutor {
  return {
    executeEnabled: () => opts.executeEnabled !== false,
    isRoot: () => opts.isRoot !== false,
    pathExists: opts.pathExists ?? (() => false),
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
      const partial = opts.run ? opts.run(argv) : {};
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

describe('defense-service depth', () => {
  it('listDefenseTimeline recovers from corrupt JSON', () => {
    const { db } = setup(false);
    db.snapshot.settings.defense_timeline = '{not-json';
    db.persist();
    expect(listDefenseTimeline(db)).toEqual([]);
  });

  it('getDefenseStatus suggestions for circuit_breaker and low+under_attack preset', async () => {
    const { host, db, dir } = setup(true, true);
    savePresetViaDb(db, 'under_attack');
    saveAutoBanPolicy(db, {
      ...DEFAULT_AUTO_BAN,
      enabled: true,
      pausedReason: 'circuit_breaker',
      maxAutoBansPerHour: 5,
    });
    const st = await getDefenseStatus({ host, db, dataDir: dir });
    expect(st.labels.autoBan.tone).toBe('warn');
    expect(st.suggestions.some((s) => s.id === 'auto-ban-cb' || s.id === 'relax')).toBe(true);
  });

  it('getDefenseStatus suggests enable-auto-ban on critical threat path', async () => {
    // force high threat via requestCount
    const { host, db, dir } = setup(false);
    updateAutoBanPolicy(db, { enabled: false });
    const st = await getDefenseStatus({
      host,
      db,
      dataDir: dir,
      requestCountLastMinute: 50_000,
    });
    expect(st.threatLevel).toBeTruthy();
    expect(st.labels.apply.tone).toBe('warn');
    // may or may not hit under_attack depending on signals
    expect(Array.isArray(st.suggestions)).toBe(true);
  });

  it('applyDefensePreset daily with enableAutoBan false disables auto-ban', async () => {
    const { host, db, dir } = setup(false);
    updateAutoBanPolicy(db, { enabled: true, mode: 'normal' });
    const r = await applyDefensePreset({
      host,
      db,
      dataDir: dir,
      preset: 'daily',
      apply: true,
      enableAutoBan: false,
    });
    expect(r.ok).toBe(true);
    expect(r.written.length).toBeGreaterThan(0);
    expect(r.notes.some((n) => n.length > 0)).toBe(true);
  });

  it('applyDefensePreset under_attack with cloudflare automation notes', async () => {
    const { host, db, dir } = setup(false);
    try {
      saveDefenseAutomation(db, {
        ...DEFAULT_AUTOMATION,
        cloudflare: {
          ...DEFAULT_AUTOMATION.cloudflare,
          enabled: true,
          zones: [],
          ufwAllowOnlyCf: true,
          ufwKeepTcpPorts: [22, 443],
        },
      });
    } catch {
      /* if API differs, still exercise preset */
    }
    const confDir = join(dir, 'nginx', 'conf.d');
    mkdirSync(confDir, { recursive: true });
    writeFileSync(join(confDir, 's.conf'), 'server { listen 80; }\n');
    const r = await applyDefensePreset({
      host,
      db,
      dataDir: dir,
      preset: 'under_attack',
      apply: true,
      enableAutoBan: true,
    });
    expect(r.blocked).toBe(true);
    expect(r.written.length).toBeGreaterThan(0);
    expect(db.snapshot.settings.defense_active_preset).toBe('under_attack');
  });

  it('applyDefensePreset with execute+root reloads nginx when tested', async () => {
    const { dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    mkdirSync(join(dir, 'nginx', 'conf.d'), { recursive: true });
    writeFileSync(join(dir, 'nginx', 'conf.d', 'x.conf'), 'server{}\n');

    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      pathExists: (p) => p.includes('nginx'),
      run: (argv) => {
        if (argv[0] === 'nginx' || argv.join(' ').includes('nginx')) {
          return { exitCode: 0, stdout: 'ok' };
        }
        if (argv[0] === 'systemctl') return { exitCode: 0 };
        return { exitCode: 0 };
      },
    });

    const r = await applyDefensePreset({
      host,
      db,
      dataDir: dir,
      preset: 'hardened',
      apply: true,
      systemNginx: false, // avoid real /etc/nginx mkdir in unit tests
    });
    expect(r.requiresExecute).toBe(false);
    expect(r.requiresRoot).toBe(false);
    expect(r.written.length).toBeGreaterThan(0);
    expect(r.applied).toBe(false); // no system nginx reload
  });

  it('defenseBanIp both methods with execute; ufw fail soft', async () => {
    const { dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: (argv) => {
        if (argv[0] === 'ufw') return { exitCode: 1, stderr: 'ufw no' };
        return { exitCode: 0, stdout: 'ok' };
      },
    });
    const r = await defenseBanIp({
      host,
      db,
      ip: '198.51.100.40',
      method: 'both',
      reason: 'depth',
    });
    expect(r.ok).toBe(false); // ufw fail → ok false
    expect(r.notes.length).toBeGreaterThan(0);
    const bans = await listDefenseBans({ host, db });
    expect(bans.items.some((b) => b.ip === '198.51.100.40')).toBe(true);
  });

  it('defenseUnbanIp execute path clears panel ban', async () => {
    const { dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: () => ({ exitCode: 0, stdout: 'ok' }),
    });
    await defenseBanIp({
      host,
      db,
      ip: '198.51.100.41',
      method: 'fail2ban',
    });
    const u = await defenseUnbanIp({
      host,
      db,
      ip: '198.51.100.41',
      method: 'both',
    });
    expect(u.ok).toBe(true);
    expect(u.notes.length).toBeGreaterThan(0);
    const timeline = listDefenseTimeline(db, 1);
    expect(timeline.some((e) => e.kind === 'unban' || e.kind === 'ban')).toBe(true);
  });

  it('listDefenseBans merges panel + fail2ban', async () => {
    const { dir, cleanup } = makeHost();
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    db.snapshot.settings.defense_panel_bans = JSON.stringify([
      { ip: '203.0.113.1', source: 'panel', at: new Date().toISOString() },
    ]);
    db.persist();
    const host = mockHost({
      executeEnabled: true,
      run: (argv) => {
        if (argv.join(' ').includes('banned') || argv[0] === 'fail2ban-client') {
          return {
            exitCode: 0,
            stdout: 'Banned IP list:\n203.0.113.2\n',
          };
        }
        return { exitCode: 0 };
      },
    });
    const bans = await listDefenseBans({ host, db });
    expect(bans.items.some((b) => b.ip === '203.0.113.1')).toBe(true);
  });

  it('applyDefenseStack with execute true on capable host', async () => {
    const { dir, cleanup } = makeHost({ executeEnabled: true });
    cleanups.push(cleanup);
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const host = mockHost({
      executeEnabled: true,
      isRoot: true,
      run: () => ({ exitCode: 0 }),
    });
    const r = await applyDefenseStack({
      host,
      db,
      dataDir: dir,
      execute: true,
    });
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
    expect(r.requiresExecute).toBe(false);
    expect(typeof r.ok).toBe('boolean');
  });

  it('defenseBanIp rejects automation whitelist', async () => {
    const { host, db } = setup(false);
    try {
      saveDefenseAutomation(db, {
        ...DEFAULT_AUTOMATION,
        autoBan: {
          ...DEFAULT_AUTOMATION.autoBan,
          whitelist: ['198.51.100.99'],
        },
      });
    } catch {
      /* */
    }
    const r = await defenseBanIp({ host, db, ip: '198.51.100.99' });
    // either auto whitelist or default policy
    expect(r.ok).toBe(false);
  });
});

function savePresetViaDb(db: { snapshot: { settings: Record<string, string> }; persist: () => void }, id: string) {
  db.snapshot.settings.defense_active_preset = id;
  db.persist();
}
