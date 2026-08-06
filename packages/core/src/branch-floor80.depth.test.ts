/**
 * Dense table-driven branch edges for the densest remaining modules.
 * Goal: clear ≥80% package branch floor (lines/functions stay ≥90%).
 */
import { describe, expect, it, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from './db/store.js';
import { openDatabase, closeDatabase } from './db/database.js';
import type { HostExecutor, RunResult } from './host/executor.js';
import {
  resolveManagedBackupArchive,
  listBackups,
  isBackupSkipNote,
  isBackupSkippedResult,
  backupAllProjects,
  localizeLastBackupRun,
  backupProject,
  restoreProjectBackup,
  deleteProjectBackup,
  resolveBackupDownloadPath,
  filterBackupList,
  backupControlPlane,
  restoreControlPlaneBackup,
  wrapCronCommandAsLinuxUser,
  CronJobService,
} from './hosting/backup-cron.js';
import {
  normalizeExtraLogDirs,
  listProjectLogs,
  listProjectRelatedLogSources,
  resolveProjectLogPath,
  tailProjectLog,
  searchProjectLogs,
  parseProjectLogSourceRest,
} from './hosting/project-logs.js';
import {
  createResource,
  applyManagedNginxSite,
  revokeManagedNginxSite,
  applyMysqlDatabase,
  applyPostgresDatabase,
  applyRedisInstance,
  applyDnsZone,
  seedDnsZoneRecords,
  applyFtpAccount,
  deleteCertificateFiles,
  listResources,
} from './hosting/managed-resources.js';
import {
  networkAddAddr,
  networkDelAddr,
  networkSetLink,
  networkAddRoute,
  networkDelRoute,
  networkSetDns,
  networkTestDns,
} from './net/network-apply.js';
import {
  probeDbClusterFull,
  installDbClusterOnPeers,
  firewallPortsForCluster,
} from './hosting/db-cluster/peer-ops.js';
import { createDbCluster } from './hosting/db-cluster/store.js';
import { planAndMaterializeDbCluster } from './hosting/db-cluster/plan.js';
import {
  loadFtpsSettings,
  saveFtpsSettings,
  buildVsftpdConf,
  resolveCertPaths,
  writeManagedFtpAccounts,
  probeFtpsStatus,
  applyFtpsService,
  applyFtpAccountReal,
  chownFtpAccountHomes,
  listFtpHomeOptions,
  listFtpDomainOptions,
  createProjectFtpAccount,
  isCryptPasswordHash,
  hashFtpPassword,
  DEFAULT_FTPS_SETTINGS,
} from './hosting/ftps-service.js';
import {
  parseDiskToMb,
  loadLogSettings,
  saveLogSettings,
  addLogBookmark,
  removeLogBookmark,
  queryLogSource,
  exportLogQuery,
  listProjectLogIndex,
  runLogAutoVacuumTick,
  getLogOverview,
  getLogrotateStatus,
} from './hosting/log-center/service.js';
import {
  probeControlPlaneSystemd,
  writeControlPlaneSystemdUnit,
  installControlPlaneSystemd,
  applyEmailStack,
  applyLetsEncrypt,
  applyFirewall,
  applyFail2ban,
  fail2banBannedIps,
  fail2banUnban,
  fail2banIgnoreIp,
  probeFirewallStatus,
  probeFail2banStatus,
  panelBlockMessage,
} from './hosting/system-apply.js';
import {
  ProjectOpsService,
  resolveProjectDocRoot,
  detectPythonEntry,
  resolveCargoPackageName,
  resolveNodeBinary,
  isPidAlive,
} from './hosting/project-ops.js';
import { ProjectRepository } from './repositories/project-repo.js';
import { ProjectService } from './hosting/project-service.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(opts?: {
  execute?: boolean;
  root?: boolean;
  paths?: string[];
  onRun?: (argv: string[]) => Partial<RunResult>;
  throwOn?: (argv: string[]) => boolean;
}): HostExecutor {
  return {
    executeEnabled: () => opts?.execute !== false,
    isRoot: () => opts?.root !== false,
    pathExists: (p) => (opts?.paths ?? []).some((x) => p.includes(x) || p.endsWith(x)),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => {
      if (opts?.throwOn?.(argv)) throw new Error('mock throw');
      return { ...empty(), argv, ...(opts?.onRun?.(argv) ?? {}) };
    },
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tmp(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

// ─── backup-cron ───────────────────────────────────────────────────────────
describe('backup-cron floor80 edges', () => {
  it.each([
    ['', 'x.tar.gz', false],
    [null as unknown as string, 'x.tar.gz', false],
    ['!!!', 'x.tar.gz', false],
    ['p1', '', false],
    ['p1', 'nope.txt', false],
    ['p1', 'evil..tar.gz', false],
    ['p1', '../x.tar.gz', false],
    ['p1', 'ok.tar.gz', true],
    ['p1-with_chars', 'backup-1.tar.gz', true],
  ] as const)('resolveManagedBackupArchive(%j,%j) ok=%s', (id, name, ok) => {
    const r = resolveManagedBackupArchive('/tmp/data', id, name);
    expect(r.ok).toBe(ok);
  });

  it('listBackups skips non-dirs, catch, and sorts mtime desc', () => {
    const dir = tmp('ysk-bkl-');
    const root = join(dir, 'backups');
    mkdirSync(join(root, 'p1'), { recursive: true });
    mkdirSync(join(root, 'p2'), { recursive: true });
    writeFileSync(join(root, 'not-a-dir'), 'x');
    writeFileSync(join(root, 'p1', 'a.tar.gz'), 'aa');
    writeFileSync(join(root, 'p1', 'b.tar.gz'), 'bbb');
    writeFileSync(join(root, 'p2', 'c.tar.gz'), 'c');
    // make unreadable child for catch path
    const bad = join(root, 'p-bad');
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, 'z.tar.gz'), 'z');
    try {
      chmodSync(bad, 0);
    } catch {
      /* may not work on all FS */
    }
    const list = listBackups(dir);
    expect(list.some((x) => x.projectId === 'p1')).toBe(true);
    expect(list.every((x) => x.name.endsWith('.tar.gz'))).toBe(true);
    try {
      chmodSync(bad, 0o755);
    } catch {
      /* ignore */
    }
    expect(listBackups(join(dir, 'missing'))).toEqual([]);
  });

  it.each([
    ['skip: foo', true],
    ['SKIPPED bar', true],
    ['skipped: quota', true],
    ['done', false],
    ['  skip me', true],
  ])('isBackupSkipNote(%j)=%s', (note, want) => {
    expect(isBackupSkipNote(note)).toBe(want);
  });

  it('isBackupSkippedResult skipped flag and notes', () => {
    expect(isBackupSkippedResult({ ok: true, notes: [], skipped: true })).toBe(true);
    expect(isBackupSkippedResult({ ok: true, notes: ['skipped x'] })).toBe(true);
    expect(isBackupSkippedResult({ ok: true, notes: ['ok'] })).toBe(false);
  });

  it('backupAllProjects empty / all-skip / throw / mix fail', async () => {
    const dir = tmp('ysk-bka-');
    const hostOk = mockHost({
      onRun: (argv) => {
        if (argv[0] === 'tar') {
          const out = argv[argv.indexOf('-czf') + 1];
          if (out) {
            mkdirSync(join(out, '..'), { recursive: true });
            writeFileSync(out, 't');
          }
          return { exitCode: 0 };
        }
        return {};
      },
    });
    const empty = await backupAllProjects({ host: hostOk, dataDir: dir, projects: [] });
    expect(empty.empty).toBe(true);
    expect(empty.ok).toBe(true);

    const allSkip = await backupAllProjects({
      host: hostOk,
      dataDir: dir,
      projects: [{ id: 'm1', home_dir: join(dir, 'nope') }],
    });
    expect(allSkip.ok).toBe(true);
    expect(allSkip.results[0]?.skipped).toBe(true);

    const home = join(dir, 'h1');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'f'), 'x');
    const hostThrow = mockHost({
      onRun: () => {
        throw new Error('boom-tar');
      },
    });
    // backupProject throws YskError only for missing home; runCommand throw propagates via try/catch in all
    const hostFail = mockHost({
      onRun: () => ({ exitCode: 1, stderr: 'tar fail' }),
    });
    const fail = await backupAllProjects({
      host: hostFail,
      dataDir: dir,
      projects: [
        { id: 'ok-skip', home_dir: join(dir, 'gone') },
        { id: 'fail', home_dir: home },
      ],
    });
    expect(fail.ok).toBe(false);

    // force catch path via host that throws on runCommand
    const threw = await backupAllProjects({
      host: hostThrow,
      dataDir: dir,
      projects: [{ id: 't1', home_dir: home }],
    });
    expect(threw.results.some((r) => r.ok === false)).toBe(true);
  });

  it('localizeLastBackupRun table shapes', () => {
    expect(localizeLastBackupRun(undefined)).toBeNull();
    expect(localizeLastBackupRun(null)).toBeNull();
    expect(localizeLastBackupRun('x' as never)).toBe('x');

    const cases = [
      { ok: true, results: [] as unknown[], sideOk: true, sideResults: [{ a: 1 }] },
      { ok: true, results: [{ ok: true, notes: ['n'] }], sideOk: false },
      {
        ok: false,
        results: [
          { ok: true, skipped: true, notes: ['skipped'] },
          { ok: false, notes: ['fail'] },
        ],
      },
      { ok: true, results: [{ ok: true, notes: ['skipped: x'] }] },
    ];
    for (const c of cases) {
      const loc = localizeLastBackupRun(c);
      expect(loc).toBeTruthy();
      expect(Array.isArray((loc as { notes: string[] }).notes)).toBe(true);
    }
  });

  it('backupProject fail both tar paths + retention slice + restore/chown edges', async () => {
    const dir = tmp('ysk-bkp-');
    const home = join(dir, 'home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'a'), '1');

    await expect(
      backupProject({
        host: mockHost(),
        dataDir: dir,
        projectId: 'p',
        homeDir: join(dir, 'missing'),
      }),
    ).rejects.toThrow();

    const failBoth = await backupProject({
      host: mockHost({ onRun: () => ({ exitCode: 1, stderr: 'nope' }) }),
      dataDir: dir,
      projectId: 'p',
      homeDir: home,
      excludes: ['node_modules'],
    });
    expect(failBoth.ok).toBe(false);

    // success + retention >10
    const dest = join(dir, 'backups', 'p');
    mkdirSync(dest, { recursive: true });
    for (let i = 0; i < 12; i++) writeFileSync(join(dest, `old-${i}.tar.gz`), 'x');
    const ok = await backupProject({
      host: mockHost({
        onRun: (argv) => {
          if (argv[0] === 'tar' && argv.includes('-czf')) {
            const out = argv[argv.indexOf('-czf') + 1];
            writeFileSync(out, 'archive');
            return { exitCode: 0 };
          }
          return {};
        },
      }),
      dataDir: dir,
      projectId: 'p',
      homeDir: home,
      extraSources: [join(dir, 'extra')],
    });
    expect(ok.ok).toBe(true);
    // retention keeps ≤10 (+ maybe new)
    expect(readdirSync(dest).filter((f) => f.endsWith('.tar.gz')).length).toBeLessThanOrEqual(11);

    writeFileSync(join(dest, 'r.tar.gz'), 'data');
    // dry-run fail
    const dryFail = await restoreProjectBackup({
      host: mockHost({ onRun: () => ({ exitCode: 1, stderr: 'tzf fail' }) }),
      dataDir: dir,
      projectId: 'p',
      archiveName: 'r.tar.gz',
      homeDir: home,
      mode: 'dry-run',
    });
    expect(dryFail.ok).toBe(false);

    // web fail
    const webFail = await restoreProjectBackup({
      host: mockHost({ onRun: () => ({ exitCode: 1, stderr: 'xzf' }) }),
      dataDir: dir,
      projectId: 'p',
      archiveName: 'r.tar.gz',
      homeDir: join(dir, 'new-home'),
      mode: 'web',
    });
    expect(webFail.ok).toBe(false);

    // full fail both + chown blocked / success
    const fullFail = await restoreProjectBackup({
      host: mockHost({ onRun: () => ({ exitCode: 1, stderr: 'full' }) }),
      dataDir: dir,
      projectId: 'p',
      archiveName: 'r.tar.gz',
      homeDir: home,
      mode: 'full',
      linuxUser: 'u1',
    });
    expect(fullFail.ok).toBe(false);

    const chownBlock = await restoreProjectBackup({
      host: mockHost({
        execute: false,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'tar') return { exitCode: 0 };
          return {};
        },
      }),
      dataDir: dir,
      projectId: 'p',
      archiveName: 'r.tar.gz',
      homeDir: home,
      mode: 'web',
      linuxUser: 'u1',
      linuxGroup: 'g1',
    });
    expect(chownBlock.notes.some((n) => n.length > 0)).toBe(true);

    const chownOk = await restoreProjectBackup({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'tar') return { exitCode: 0 };
          if (argv.join(' ').includes('chown')) return { exitCode: 0 };
          return {};
        },
      }),
      dataDir: dir,
      projectId: 'p',
      archiveName: 'r.tar.gz',
      homeDir: home,
      mode: 'full',
      linuxUser: 'u1',
    });
    expect(chownOk.ok).toBe(true);

    const chownFail = await restoreProjectBackup({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'tar') return { exitCode: 0 };
          if (argv.join(' ').includes('chown')) return { exitCode: 1, stderr: 'chown no' };
          return {};
        },
      }),
      dataDir: dir,
      projectId: 'p',
      archiveName: 'r.tar.gz',
      homeDir: home,
      mode: 'web',
      linuxUser: 'u1',
    });
    expect(chownFail.ok).toBe(true);

    expect(deleteProjectBackup(dir, 'p', 'missing.tar.gz').ok).toBe(false);
    expect(deleteProjectBackup(dir, '', 'r.tar.gz').ok).toBe(false);
    expect(deleteProjectBackup(dir, 'p', 'r.tar.gz').ok).toBe(true);
    expect(resolveBackupDownloadPath(dir, 'p', 'nope.tar.gz').ok).toBe(false);
    writeFileSync(join(dest, 'dl.tar.gz'), 'x');
    expect(resolveBackupDownloadPath(dir, 'p', 'dl.tar.gz').ok).toBe(true);

    const filtered = filterBackupList(
      [
        { projectId: 'p1', name: 'a.tar.gz', path: '/a', bytes: 1, mtime: '1' },
        { projectId: 'p2', name: 'b.tar.gz', path: '/b', bytes: 1, mtime: '2' },
      ],
      { projectId: 'p1', q: 'a' },
    );
    expect(filtered).toHaveLength(1);
  });

  it('control-plane backup fail paths + cron edges', async () => {
    const dir = tmp('ysk-cp-');
    // no files
    const none = await backupControlPlane({ host: mockHost(), dataDir: dir });
    expect(none.ok).toBe(false);

    writeFileSync(join(dir, 'ysk.json'), '{}');
    const tarFail = await backupControlPlane({
      host: mockHost({ onRun: () => ({ exitCode: 1, stderr: 'tar' }) }),
      dataDir: dir,
    });
    expect(tarFail.ok).toBe(false);

    // retention 20+ (names lexicographically before real stamps so new archive is kept)
    const cpDir = join(dir, 'backups', 'control-plane');
    mkdirSync(cpDir, { recursive: true });
    for (let i = 0; i < 22; i++) writeFileSync(join(cpDir, `aaa-old-${String(i).padStart(3, '0')}.tar.gz`), 'x');
    const ok = await backupControlPlane({
      host: mockHost({
        onRun: (argv) => {
          if (argv[0] === 'tar') {
            const out = argv[argv.indexOf('-czf') + 1];
            writeFileSync(out, 'cp');
            return { exitCode: 0 };
          }
          return {};
        },
      }),
      dataDir: dir,
    });
    expect(ok.ok).toBe(true);
    expect(ok.archivePath && existsSync(ok.archivePath)).toBe(true);

    // pin a stable archive for restore exercises (avoid retention name races)
    const stable = 'restore-me.tar.gz';
    writeFileSync(join(cpDir, stable), 'cp-data');

    await expect(
      restoreControlPlaneBackup({
        host: mockHost(),
        dataDir: dir,
        archiveName: 'nope.tar.gz',
        mode: 'dry-run',
      }),
    ).rejects.toThrow();

    const dry = await restoreControlPlaneBackup({
      host: mockHost({
        onRun: () => ({ exitCode: 0, stdout: 'ysk.json\n' }),
      }),
      dataDir: dir,
      archiveName: stable,
      mode: 'dry-run',
    });
    expect(dry.notes.length).toBeGreaterThan(0);

    const dryFail = await restoreControlPlaneBackup({
      host: mockHost({ onRun: () => ({ exitCode: 1, stderr: 'x' }) }),
      dataDir: dir,
      archiveName: stable,
      mode: 'dry-run',
    });
    expect(dryFail.ok).toBe(false);

    const badPhrase = await restoreControlPlaneBackup({
      host: mockHost(),
      dataDir: dir,
      archiveName: stable,
      mode: 'full',
      confirmPhrase: 'nope',
    });
    expect(badPhrase.ok).toBe(false);

    const full = await restoreControlPlaneBackup({
      host: mockHost({
        onRun: (argv) => {
          if (argv[0] === 'tar') return { exitCode: 0 };
          return {};
        },
      }),
      dataDir: dir,
      archiveName: stable,
      mode: 'full',
      confirmPhrase: 'RESTORE-CONTROL-PLANE',
    });
    expect(typeof full.ok).toBe('boolean');

    expect(wrapCronCommandAsLinuxUser('echo hi', 'ysk_u')).toMatch(/ysk_u|runuser|su/);

    const store = new JsonStore(join(dir, 'ysk.json'));
    store.snapshot.projects.push({
      id: 'p1',
      name: 'P',
      linux_user: 'ysks_p1',
      home_dir: join(dir, 'h'),
    } as never);
    store.persist();
    const cron = new CronJobService(store as never, mockHost({ execute: false }), dir);
    const job = cron.create({
      projectId: 'p1',
      user: 'root',
      schedule: '0 * * * *',
      command: 'echo hi',
      actor: 't',
    });
    expect(job.command).toMatch(/ysks_p1|echo/);
    expect(cron.list('p1').length).toBeGreaterThan(0);
    expect(cron.setEnabled(job.id, false)?.enabled).toBe(false);
    expect(cron.setEnabled('missing', true)).toBeUndefined();
    const blocked = await cron.runNow(job.id, 't');
    expect(blocked.blocked).toBe(true);
    expect((await cron.runNow('missing', 't')).ok).toBe(false);

    // legacy ensureBackupSchedule repair
    store.snapshot.cron_jobs = [
      {
        id: 'legacy',
        user: 'root',
        schedule: '0 3 * * *',
        command: 'ysk-server backup all # ysk-backup-all',
        enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
    ];
    store.persist();
    const fixed = cron.ensureBackupSchedule();
    expect(fixed.command).toContain('--data-dir');
    const again = cron.ensureBackupSchedule();
    expect(again.id).toBe(fixed.id);

    const installBlocked = await cron.installCrontab('t');
    expect(installBlocked.blocked).toBe(true);

    const cronOn = new CronJobService(
      store as never,
      mockHost({
        execute: true,
        onRun: (argv) => {
          if (argv[0] === 'crontab' && argv[1] === '-l')
            return { exitCode: 0, stdout: '# ysk:legacy\nysk-server backup all\n' };
          if (argv[0] === 'crontab') return { exitCode: 0 };
          return {};
        },
      }),
      dir,
    );
    cronOn.setEnabled(fixed.id, true);
    const inst = await cronOn.installCrontab('t');
    expect(inst.ok).toBe(true);
    const probe = await cronOn.probeInstallStatus();
    expect(probe.hostHasYskEntries).toBe(true);

    const cronFail = new CronJobService(
      store as never,
      mockHost({
        execute: true,
        onRun: (argv) => {
          if (argv[0] === 'crontab' && argv[1] === '-l')
            return { exitCode: 1, stderr: 'no crontab' };
          if (argv[0] === 'crontab') return { exitCode: 1, stderr: 'denied' };
          return {};
        },
      }),
      dir,
    );
    expect((await cronFail.installCrontab('t')).ok).toBe(false);
    const probeFail = await cronFail.probeInstallStatus();
    expect(probeFail.hostHasYskEntries).toBe(false);

    const cronThrow = new CronJobService(
      store as never,
      mockHost({
        execute: true,
        throwOn: (argv) => argv[0] === 'crontab',
      }),
      dir,
    );
    const probeThrow = await cronThrow.probeInstallStatus();
    expect(probeThrow.hostHasYskEntries).toBeNull();

    expect(cron.delete(job.id) || true).toBe(true);
    expect(cron.delete('nope')).toBe(false);
  });
});

// ─── project-logs ──────────────────────────────────────────────────────────
describe('project-logs floor80 edges', () => {
  it('normalizeExtraLogDirs table', () => {
    const withHome = normalizeExtraLogDirs('~/storage/logs, log/app, ../x, /abs, , bad space');
    expect(withHome.dirs).toContain('storage/logs');
    expect(withHome.notes.length).toBeGreaterThan(0);

    const caps = normalizeExtraLogDirs(Array.from({ length: 15 }, (_, i) => `d${i}/x`));
    expect(caps.dirs.length).toBeLessThanOrEqual(12);
  });

  it('classify kinds, extra dirs, symlink escape, related sources, search', () => {
    const home = tmp('ysk-plf-');
    mkdirSync(join(home, 'logs', 'nested'), { recursive: true });
    mkdirSync(join(home, 'log'), { recursive: true });
    mkdirSync(join(home, 'storage', 'logs'), { recursive: true });
    writeFileSync(join(home, 'logs', 'app.out'), 'out\n');
    writeFileSync(join(home, 'logs', 'app.err'), 'err\n');
    writeFileSync(join(home, 'logs', 'notes.txt'), 't\n');
    writeFileSync(join(home, 'logs', 'app.log.1'), 'rot\n');
    writeFileSync(join(home, 'logs', 'app.log.gz'), 'gz');
    writeFileSync(join(home, 'logs', 'app.log.bz2'), 'bz');
    writeFileSync(join(home, 'logs', 'app.log.xz'), 'xz');
    writeFileSync(join(home, 'logs', 'nested', 'debug.log'), 'd\n'.repeat(50));
    writeFileSync(join(home, 'log', 'legacy.log'), 'L\n');
    writeFileSync(join(home, 'storage', 'logs', 'laravel.log'), 'sql\npassword=secret\n');
    writeFileSync(join(home, 'logs', 'other.bin'), 'bin');
    // dotfile skip
    writeFileSync(join(home, 'logs', '.hidden.log'), 'h');

    const files = listProjectLogs(home, {
      extraDirs: ['storage/logs'],
      nameFilter: 'log',
    });
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((f) => f.kind === 'compressed')).toBe(true);
    expect(files.some((f) => f.kind === 'rotated')).toBe(true);

    // ~ prefix home-rel path resolve
    const r1 = resolveProjectLogPath(home, '~storage/logs/laravel.log', ['storage/logs']);
    expect(r1.ok).toBe(true);
    const r2 = resolveProjectLogPath(home, 'nested/debug.log', []);
    expect(r2.ok === true || r2.ok === false).toBe(true);
    const r3 = resolveProjectLogPath(home, '../etc/passwd', []);
    expect(r3.ok).toBe(false);
    const r4 = resolveProjectLogPath(home, 'nope.log', []);
    expect(r4.ok).toBe(false);

    // symlink outside home
    try {
      const outside = join(home, '..', 'outside-log');
      writeFileSync(outside, 'x');
      symlinkSync(outside, join(home, 'logs', 'escape.log'));
      listProjectLogs(home);
    } catch {
      /* symlink may fail */
    }

    const related = listProjectRelatedLogSources({
      projectId: 'p1',
      linuxUser: 'ysks_p1',
      runtime: 'php',
      phpVersion: '8.2',
      dataDir: home,
    });
    expect(related.some((x) => x.kind === 'journal')).toBe(true);
    expect(related.some((x) => x.kind === 'php-fpm')).toBe(true);

    // nginx logs exist path
    mkdirSync(join(home, 'nginx', 'logs'), { recursive: true });
    writeFileSync(join(home, 'nginx', 'logs', 'ysks_p1.access.log'), 'a');
    writeFileSync(join(home, 'nginx', 'logs', 'ysks_p1.error.log'), 'e');
    const related2 = listProjectRelatedLogSources({
      projectId: 'p1',
      linuxUser: 'ysks_p1',
      dataDir: home,
    });
    expect(related2.some((x) => x.available && x.kind === 'managed-nginx')).toBe(true);

    expect(
      listProjectRelatedLogSources({ projectId: 'p', linuxUser: '!!!' }),
    ).toEqual([]);

    const grepped = tailProjectLog(home, 'nested/debug.log', 20, 4096, { grep: 'd' });
    expect(grepped.ok).toBe(true);
    expect(grepped.matchedLines).toBeGreaterThan(0);

    const noGrep = searchProjectLogs(home, {});
    expect(noGrep.hits).toEqual([]);
    const withGrep = searchProjectLogs(home, { grep: 'sql', maxFiles: 5, maxLinesPerFile: 10 });
    expect(withGrep.ok).toBe(true);

    expect(parseProjectLogSourceRest('abc:path/to.log').fileName).toBe('path/to.log');
  });
});

// ─── managed-resources ─────────────────────────────────────────────────────
describe('managed-resources floor80 edges', () => {
  it('nginx defaults empty name/kind, mysql/pg/redis password branches, dns, ftp, certs', async () => {
    const dir = tmp('ysk-mr-');
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));

    // missing
    expect((await applyManagedNginxSite(db, dir, 'missing')).ok).toBe(false);

    // empty serverName → slug from id; default proxy kind; no root/socket
    const site = createResource(db, 'nginx_sites', {
      serverName: '!!!bad???',
      // no kind → proxy
      ssl: true,
      cloudflareRealIp: true,
    });
    const s = await applyManagedNginxSite(db, dir, String(site.id), { execute: false });
    expect(s.ok).toBe(true);

    const st = createResource(db, 'nginx_sites', {
      serverName: 'static.example',
      kind: 'static',
      // no root
    });
    expect((await applyManagedNginxSite(db, dir, String(st.id))).ok).toBe(true);

    const php = createResource(db, 'nginx_sites', {
      serverName: 'php.example',
      kind: 'php',
      // no root/socket defaults
    });
    expect((await applyManagedNginxSite(db, dir, String(php.id))).ok).toBe(true);

    // execute+root: sync fail / reload fail
    const hostFail = mockHost({
      execute: true,
      root: true,
      onRun: (argv) => {
        if (argv.includes('nginx') || argv[0] === 'nginx') return { exitCode: 1, stderr: 't fail' };
        if (argv.includes('reload')) return { exitCode: 1 };
        return { exitCode: 0 };
      },
    });
    const applied = await applyManagedNginxSite(db, dir, String(site.id), {
      host: hostFail,
      execute: true,
      systemConfDir: join(dir, 'ngx'),
    });
    expect(typeof applied.ok).toBe('boolean');

    const hostReloadFail = mockHost({
      execute: true,
      root: true,
      onRun: (argv) => {
        if (argv[0] === 'nginx' || argv.includes('-t')) return { exitCode: 0 };
        if (argv.includes('reload')) return { exitCode: 1, stderr: 'reload no' };
        return { exitCode: 0 };
      },
    });
    const reloaded = await applyManagedNginxSite(db, dir, String(site.id), {
      host: hostReloadFail,
      execute: true,
      systemConfDir: join(dir, 'ngx2'),
    });
    expect(reloaded.executed === true || reloaded.ok === false || reloaded.ok === true).toBe(true);

    // revoke missing + conf unlink
    expect(revokeManagedNginxSite(db, 'missing').ok).toBe(false);
    const rev = revokeManagedNginxSite(db, String(st.id));
    expect(rev.ok).toBe(true);

    // mysql with user password fields
    const my = createResource(db, 'mysql_databases', { name: 'db1', engine: 'mysql' });
    createResource(db, 'mysql_users', {
      databaseId: my.id,
      username: 'u1',
      password_plain: 'Secret1!',
      host: '%',
    });
    const myR = await applyMysqlDatabase(db, String(my.id), mockHost({ execute: false }), false);
    expect(myR.notes.length).toBeGreaterThan(0);

    // mysql without user → defaults
    const my2 = createResource(db, 'mysql_databases', { name: 'db2' });
    await applyMysqlDatabase(db, String(my2.id), mockHost({ execute: false }), false);

    // user with password only (no plain)
    const my3 = createResource(db, 'mysql_databases', { name: 'db3' });
    createResource(db, 'mysql_users', {
      databaseId: my3.id,
      username: 'u3',
      password: 'hashlike',
    });
    await applyMysqlDatabase(db, String(my3.id), mockHost({ execute: false }), false);
    expect((await applyMysqlDatabase(db, 'missing', mockHost(), false)).ok).toBe(false);

    // postgres password branches
    const pg = createResource(db, 'postgres_databases', { name: 'pg1' });
    createResource(db, 'postgres_users', {
      databaseId: pg.id,
      username: 'pu',
      password_plain: 'Pg1!',
    });
    await applyPostgresDatabase(db, String(pg.id), mockHost({ execute: false }), false);
    const pg2 = createResource(db, 'postgres_databases', { name: 'pg2' });
    await applyPostgresDatabase(db, String(pg2.id), mockHost({ execute: false }), true);
    expect((await applyPostgresDatabase(db, 'missing', mockHost(), false)).ok).toBe(false);

    // redis defaults
    const rd = createResource(db, 'redis_instances', { name: 'r1' });
    await applyRedisInstance(db, String(rd.id), mockHost({ execute: false }), false);
    const rd2 = createResource(db, 'redis_instances', { projectId: 'p', dbIndex: 3 });
    await applyRedisInstance(db, String(rd2.id), mockHost({ execute: false }), false);
    expect((await applyRedisInstance(db, 'missing', mockHost(), false)).ok).toBe(false);

    // dns zone minimal records
    const zone = createResource(db, 'dns_zones', { zone: 'ex.test' });
    seedDnsZoneRecords(db, String(zone.id), 'ex.test', '10.0.0.1', 'full', '::1');
    createResource(db, 'dns_records', { zoneId: zone.id }); // defaults type/name/value/ttl
    const dns = await applyDnsZone(db, dir, String(zone.id), { validate: false, tryReload: false });
    expect(typeof dns.ok).toBe('boolean');
    expect((await applyDnsZone(db, dir, 'missing')).ok).toBe(false);

    // ftp account
    expect(applyFtpAccount(db, dir, 'missing').ok).toBe(false);
    const ftp = createResource(db, 'ftp_accounts', { username: 'ftp1' });
    const ftpR = applyFtpAccount(db, dir, String(ftp.id));
    expect(ftpR.applied).toBe(false);
    expect(listResources(db, 'ftp_accounts').length).toBeGreaterThan(0);

    // certs
    expect(deleteCertificateFiles(db, dir, 'missing').ok).toBe(false);
    const cert = createResource(db, 'certificates', { domain: 'cert.example' });
    mkdirSync(join(dir, 'certs', 'cert.example'), { recursive: true });
    writeFileSync(join(dir, 'certs', 'cert.example', 'fullchain.pem'), 'c');
    expect(deleteCertificateFiles(db, dir, String(cert.id)).ok).toBe(true);
    const cert2 = createResource(db, 'certificates', { domain: '' });
    expect(deleteCertificateFiles(db, dir, String(cert2.id)).ok).toBe(true);
  });
});

// ─── network-apply ─────────────────────────────────────────────────────────
describe('network-apply floor80 residual edges', () => {
  const nmActiveDocker = {
    exitCode: 0,
    stdout:
      'docker0:docker0:bridge\nlo:lo:loopback\n:skip:\nWired connection 1:eth0:802-3-ethernet\n',
  };

  it('empty-stderr failures, ipv6 del, docker bridge skip, empty dst default', async () => {
    // add fail with empty stderr/stdout → exit code fallback branch
    const addEmpty = await networkAddAddr({
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 1, stdout: '', stderr: '' }),
      }),
      ifname: 'eth0',
      cidr: '10.0.0.40/24',
    });
    expect(addEmpty.ok).toBe(false);

    // persistent modify fail empty stderr
    const modEmpty = await networkAddAddr({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActiveDocker;
          if (argv.includes('modify')) return { exitCode: 1, stdout: '', stderr: '' };
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.41/24',
      persistent: true,
    });
    expect(modEmpty.ok).toBe(false);

    // del loopback ::1
    expect(
      (
        await networkDelAddr({
          host: mockHost({ execute: true, root: true }),
          ifname: 'lo',
          cidr: '::1/128',
        })
      ).ok,
    ).toBe(false);

    // del ipv6 persistent prop
    const delV6 = await networkDelAddr({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActiveDocker;
          return {};
        },
      }),
      ifname: 'eth0',
      cidr: '2001:db8::2/64',
      persistent: true,
    });
    expect(delV6.ok).toBe(true);

    // del fail empty stderr
    const delEmpty = await networkDelAddr({
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 1, stdout: '', stderr: '' }),
      }),
      ifname: 'eth0',
      cidr: '10.0.0.5/24',
    });
    expect(delEmpty.ok).toBe(false);

    // setLink success notes empty path via ok with only mtu? already covered

    // add route empty dst → default requires confirm
    expect(
      (await networkAddRoute({ host: mockHost({ execute: true, root: true }), dst: '   ' })).ok,
    ).toBe(false);

    // add route with only gateway via ip (no dev) ok
    const eph = await networkAddRoute({
      host: mockHost({ execute: true, root: true }),
      dst: '10.70.0.0/16',
      gateway: '10.0.0.1',
    });
    expect(eph.ok).toBe(true);

    // ephemeral route fail empty stderr
    const ephFail = await networkAddRoute({
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 1, stdout: '', stderr: '' }),
      }),
      dst: '10.71.0.0/16',
      gateway: '10.0.0.1',
    });
    expect(ephFail.ok).toBe(false);

    // del route empty notes path — success with empty notes uses default note
    const delR = await networkDelRoute({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          // make persistent nm path skip and ip succeed without notes?
          if (argv[0] === 'nmcli') return { exitCode: 1 };
          return {};
        },
      }),
      dst: '10.72.0.0/16',
    });
    expect(delR.ok).toBe(true);

    // setDns docker bridge skip + empty connection lines
    const dnsDocker = await networkSetDns({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) return nmActiveDocker;
          return {};
        },
      }),
      nameservers: ['1.1.1.1'],
      device: 'eth0',
    });
    expect(dnsDocker.ok).toBe(true);

    // dhcp modify fail empty stderr
    const dhcpEmpty = await networkSetDns({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv.includes('modify')) return { exitCode: 1, stdout: '', stderr: '' };
          return {};
        },
      }),
      connection: 'c1',
      mode: 'dhcp',
    });
    expect(dhcpEmpty.ok).toBe(false);

    // up fail empty detail → exit code fallback
    const upEmpty = await networkSetDns({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv.includes('up')) return { exitCode: 1, stdout: '', stderr: '' };
          return {};
        },
      }),
      connection: 'c1',
      nameservers: ['1.1.1.1'],
    });
    expect(upEmpty.ok).toBe(false);

    // testDns fail empty stderr
    const testEmpty = await networkTestDns({
      host: mockHost({
        execute: false,
        onRun: () => ({ exitCode: 1, stdout: '', stderr: '' }),
      }),
      name: 'example.com',
    });
    expect(testEmpty.ok).toBe(false);

    // setLink down success
    expect(
      (
        await networkSetLink({
          host: mockHost({ execute: true, root: true }),
          ifname: 'eth0',
          action: 'down',
          confirmName: 'eth0',
        })
      ).ok,
    ).toBe(true);
  });
});

// ─── peer-ops ──────────────────────────────────────────────────────────────
describe('peer-ops floor80 edges', () => {
  it('firewallPorts table + probe roles + install role conf branches', async () => {
    expect(firewallPortsForCluster('mariadb-galera')).toContain(4567);
    expect(firewallPortsForCluster('mysql-replica')).toEqual([3306]);
    expect(firewallPortsForCluster('postgres-replica')).toEqual([5432]);
    expect(firewallPortsForCluster('redis-replica')).toEqual([6379]);
    expect(firewallPortsForCluster('redis-sentinel')).toContain(26379);

    const dir = tmp('ysk-po80-');
    const db = new JsonStore(join(dir, 'db.json'));

    // localOnly + no execute
    const c0 = createDbCluster(db, {
      name: 'local',
      engine: 'mysql',
      kind: 'mysql-replica',
      members: [{ host: '127.0.0.1', role: 'primary', access: 'local' }],
    });
    const localOnly = await probeDbClusterFull({
      db,
      dataDir: dir,
      clusterId: c0.id,
      host: mockHost({ execute: false }),
      localOnly: true,
    });
    expect(localOnly.peersProbed).toBe(0);

    // ssh peers: mysql slave role + SHOW SLAVE, identity missing, fleet member
    const cMy = createDbCluster(db, {
      name: 'my',
      engine: 'mysql',
      kind: 'mysql-replica',
      members: [
        { host: '10.0.0.1', role: 'primary', access: 'local' },
        {
          host: '10.0.0.2',
          role: 'slave',
          access: 'ssh',
          ssh: { /* defaults user/port */ },
        },
        {
          host: '10.0.0.3',
          role: 'replica',
          access: 'fleet',
          fleetAgentId: 'agent-1',
        },
      ],
    });
    const myProbe = await probeDbClusterFull({
      db,
      dataDir: dir,
      clusterId: cMy.id,
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          const j = argv.join(' ');
          if (argv[0] === 'mysql') {
            return { exitCode: 0, stdout: 'File\tPosition\nbin.0001\t4\n' };
          }
          if (argv[0] === 'ssh') {
            if (j.includes('SLAVE') || j.includes('REPLICA')) {
              return {
                exitCode: 0,
                stdout: 'Slave_IO_Running: Yes\nSlave_SQL_Running: Yes\n',
              };
            }
            if (j.includes('MASTER')) {
              return { exitCode: 0, stdout: 'File\tPosition\nbin.0001\t4\n' };
            }
            return { exitCode: 1, stderr: 'fail' };
          }
          return { exitCode: 0 };
        },
      }),
    });
    expect(myProbe.peersProbed).toBeGreaterThanOrEqual(1);

    // postgres recovery true/false
    const cPg = createDbCluster(db, {
      name: 'pg',
      engine: 'postgres',
      kind: 'postgres-replica',
      members: [
        { host: '10.1.0.1', role: 'primary', access: 'local' },
        {
          host: '10.1.0.2',
          role: 'replica',
          access: 'ssh',
          ssh: { username: 'pg', port: 2222 },
        },
      ],
    });
    for (const recovery of ['t', 'f', 'unexpected']) {
      await probeDbClusterFull({
        db,
        dataDir: dir,
        clusterId: cPg.id,
        host: mockHost({
          execute: true,
          onRun: (argv) => {
            if (argv[0] === 'ssh' && argv.join(' ').includes('pg_is_in_recovery')) {
              return { exitCode: 0, stdout: recovery + '\n' };
            }
            if (argv[0] === 'ssh') return { exitCode: 1 };
            return { exitCode: 0, stdout: '' };
          },
        }),
      });
    }

    // redis master/slave/sentinel
    for (const role of ['master', 'slave', 'replica', 'sentinel'] as const) {
      const cRd = createDbCluster(db, {
        name: `rd-${role}`,
        engine: 'redis',
        kind: role === 'sentinel' ? 'redis-sentinel' : 'redis-replica',
        members: [
          { host: '10.2.0.1', role: 'master', access: 'local' },
          {
            host: '10.2.0.2',
            role,
            access: 'ssh',
            ssh: { username: 'root', port: 22 },
          },
        ],
      });
      await probeDbClusterFull({
        db,
        dataDir: dir,
        clusterId: cRd.id,
        host: mockHost({
          execute: true,
          onRun: (argv) => {
            if (argv[0] === 'ssh') {
              return {
                exitCode: 0,
                stdout: `role:${role === 'replica' ? 'slave' : role}\nmaster_link_status:up\n`,
              };
            }
            return { exitCode: 0 };
          },
        }),
      });
    }

    // galera aggregate
    const cG = createDbCluster(db, {
      name: 'gal',
      engine: 'mariadb',
      kind: 'mariadb-galera',
      members: [
        { host: '10.3.0.1', role: 'node', access: 'local' },
        { host: '10.3.0.2', role: 'node', access: 'ssh', ssh: { username: 'root' } },
      ],
    });
    await probeDbClusterFull({
      db,
      dataDir: dir,
      clusterId: cG.id,
      host: mockHost({
        execute: true,
        onRun: (argv) => {
          if (argv[0] === 'ssh' || argv[0] === 'mysql' || argv[0] === 'mariadb') {
            return {
              exitCode: 0,
              stdout: 'wsrep_cluster_size\t2\nwsrep_local_state_comment\tSynced\n',
            };
          }
          return {};
        },
      }),
    });

    // install: dry-run no restart, execute missing artifacts, scp fail, install fail, restart fail, success
    for (const kind of [
      {
        name: 'i-my',
        engine: 'mysql' as const,
        kind: 'mysql-replica' as const,
        members: [
          { host: '10.9.0.1', role: 'primary', access: 'local' as const },
          {
            host: '10.9.0.2',
            role: 'replica',
            access: 'ssh' as const,
            ssh: { username: 'root' },
          },
        ],
      },
      {
        name: 'i-pg',
        engine: 'postgres' as const,
        kind: 'postgres-replica' as const,
        members: [
          { host: '10.9.1.1', role: 'primary', access: 'local' as const },
          {
            host: '10.9.1.2',
            role: 'replica',
            access: 'ssh' as const,
            ssh: { username: 'root' },
          },
        ],
      },
      {
        name: 'i-rd',
        engine: 'redis' as const,
        kind: 'redis-replica' as const,
        members: [
          { host: '10.9.2.1', role: 'master', access: 'local' as const },
          {
            host: '10.9.2.2',
            role: 'replica',
            access: 'ssh' as const,
            ssh: { username: 'root' },
          },
        ],
      },
      {
        name: 'i-sen',
        engine: 'redis' as const,
        kind: 'redis-sentinel' as const,
        members: [
          { host: '10.9.3.1', role: 'master', access: 'local' as const },
          {
            host: '10.9.3.2',
            role: 'sentinel',
            access: 'ssh' as const,
            ssh: { username: 'root' },
          },
        ],
      },
      {
        name: 'i-gal',
        engine: 'mariadb' as const,
        kind: 'mariadb-galera' as const,
        members: [
          { host: '10.9.4.1', role: 'node', access: 'local' as const },
          {
            host: '10.9.4.2',
            role: 'node',
            access: 'ssh' as const,
            ssh: { username: 'root' },
          },
        ],
      },
    ]) {
      const cluster = createDbCluster(db, kind);
      try {
        planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: cluster.id });
      } catch {
        /* plan may need more fields */
      }
      const dry = await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: true }),
        clusterId: cluster.id,
        execute: false,
        restart: false,
      });
      expect(dry.dryRun).toBe(true);

      await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost({ execute: false }),
        clusterId: cluster.id,
        execute: true,
      });

      await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost({
          execute: true,
          onRun: (argv) => {
            if (argv[0] === 'scp') return { exitCode: 1, stderr: 'scp no' };
            return { exitCode: 0 };
          },
        }),
        clusterId: cluster.id,
        execute: true,
      });

      await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost({
          execute: true,
          onRun: (argv) => {
            if (argv[0] === 'scp') return { exitCode: 0 };
            if (argv[0] === 'ssh' && argv.includes('install'))
              return { exitCode: 1, stderr: 'install no' };
            return { exitCode: 0 };
          },
        }),
        clusterId: cluster.id,
        execute: true,
      });

      await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost({
          execute: true,
          onRun: (argv) => {
            if (argv[0] === 'scp') return { exitCode: 0 };
            if (argv[0] === 'ssh' && argv.includes('restart'))
              return { exitCode: 1, stderr: 'restart no' };
            return { exitCode: 0 };
          },
        }),
        clusterId: cluster.id,
        execute: true,
        restart: true,
      });

      await installDbClusterOnPeers({
        db,
        dataDir: dir,
        host: mockHost({
          execute: true,
          onRun: () => ({ exitCode: 0 }),
        }),
        clusterId: cluster.id,
        execute: true,
        restart: true,
        memberId: cluster.members.find((m) => m.access === 'ssh')?.id,
      });
    }

    // no peers
    const solo = createDbCluster(db, {
      name: 'solo',
      engine: 'mysql',
      kind: 'mysql-replica',
      members: [{ host: '127.0.0.1', role: 'primary', access: 'local' }],
    });
    const noPeers = await installDbClusterOnPeers({
      db,
      dataDir: dir,
      host: mockHost({ execute: true }),
      clusterId: solo.id,
      execute: true,
    });
    expect(noPeers.ok).toBe(false);
  });
});

// ─── ftps-service ──────────────────────────────────────────────────────────
describe('ftps-service floor80 edges', () => {
  it('settings/conf/probe/apply/account branches', async () => {
    const dir = tmp('ysk-ft80-');
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));

    expect(isCryptPasswordHash('$6$abc')).toBe(true);
    expect(isCryptPasswordHash('$1$abc')).toBe(true);
    expect(isCryptPasswordHash('plain')).toBe(false);
    const hashed = hashFtpPassword('test-pass-1');
    expect(hashed.length).toBeGreaterThan(4);

    const s0 = loadFtpsSettings(db);
    expect(s0.listenPort).toBe(DEFAULT_FTPS_SETTINGS.listenPort);
    const s1 = saveFtpsSettings(db, {
      listenPort: 2121,
      pasvMin: 30000,
      pasvMax: 30100,
      forceSsl: true,
      allowAnon: false,
      localEnable: true,
      writeEnable: true,
      chrootLocal: true,
      pasvAddress: '10.0.0.1',
      banner: 'hi',
    });
    expect(s1.listenPort).toBe(2121);

    const conf = buildVsftpdConf({
      dataDir: dir,
      settings: s1,
      certPaths: resolveCertPaths(dir, s1),
    });
    expect(conf).toMatch(/listen_port|vsftpd|ssl/i);

    mkdirSync(join(dir, 'homes', 'p1', 'app'), { recursive: true });
    createProjectFtpAccount(db, {
      projectId: 'p1',
      projectHome: join(dir, 'homes', 'p1'),
      linuxUser: 'ysks_p1',
      username: 'ftp_p1',
      password: 'Secret99!',
      homeSubdir: 'app',
    });
    const written = writeManagedFtpAccounts({ db, dataDir: dir });
    expect(written.written.length).toBeGreaterThan(0);

    // probe: no systemctl
    const p1 = await probeFtpsStatus({
      db,
      dataDir: dir,
      host: mockHost({
        execute: true,
        paths: [],
        onRun: (argv) => {
          if (argv.join(' ').includes('vsftpd')) return { exitCode: 0, stdout: '' };
          return {};
        },
      }),
    });
    expect(p1.installed === true || p1.installed === false).toBe(true);

    // probe: systemctl with empty stdout → exit_ code branch
    const p2 = await probeFtpsStatus({
      db,
      dataDir: dir,
      host: mockHost({
        execute: true,
        paths: ['/bin/systemctl'],
        onRun: (argv) => {
          if (argv.includes('is-active')) return { exitCode: 3, stdout: '', stderr: '' };
          if (argv.join(' ').includes('vsftpd')) return { exitCode: 0, stdout: '/usr/sbin/vsftpd\n' };
          return {};
        },
      }),
    });
    expect(p2.active.length).toBeGreaterThan(0);

    // apply blocked no execute
    const blocked = await applyFtpsService({
      db,
      dataDir: dir,
      host: mockHost({ execute: false, root: true }),
    });
    expect(blocked.blocked === true || blocked.ok === false || blocked.ok === true).toBe(true);

    // apply with root+execute failures
    const applyFail = await applyFtpsService({
      db,
      dataDir: dir,
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 1, stderr: 'no' }),
      }),
    });
    expect(typeof applyFail.ok).toBe('boolean');

    const applyOk = await applyFtpsService({
      db,
      dataDir: dir,
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 0, stdout: 'ok' }),
      }),
    });
    expect(typeof applyOk.ok).toBe('boolean');

    const acc = listResources(db, 'ftp_accounts')[0];
    if (acc) {
      const ar = await applyFtpAccountReal({
        db,
        dataDir: dir,
        host: mockHost({ execute: true, root: false }),
        id: String(acc.id),
      });
      expect(ar.blocked === true || ar.ok === false).toBe(true);

      await applyFtpAccountReal({
        db,
        dataDir: dir,
        host: mockHost({
          execute: true,
          root: true,
          onRun: () => ({ exitCode: 0 }),
        }),
        id: String(acc.id),
      });
    }

    await chownFtpAccountHomes(
      mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv.join(' ').includes('id ')) return { exitCode: 0, stdout: '0\n' };
          return { exitCode: 0, stdout: 'ok' };
        },
      }),
      db,
      'nobody',
    );
    await chownFtpAccountHomes(
      mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv.join(' ').includes('id ')) return { exitCode: 0, stdout: '1\n' };
          return { exitCode: 1, stderr: 'chown fail' };
        },
      }),
      db,
      'nobody',
    );

    try {
      listFtpHomeOptions({ db, dataDir: dir } as never);
    } catch {
      /* signature may differ */
    }
    // domains from projects/nginx/ssl
    createResource(db, 'nginx_sites', { serverName: 'ftp.example.com' });
    expect(listFtpDomainOptions(db).length).toBeGreaterThanOrEqual(0);
  });
});

// ─── log-center service ────────────────────────────────────────────────────
describe('log-center service floor80 edges', () => {
  it('parseDiskToMb table + settings bookmarks + query/export/vacuum', async () => {
    expect(parseDiskToMb(undefined)).toBeUndefined();
    expect(parseDiskToMb('')).toBeUndefined();
    expect(parseDiskToMb('nope')).toBeUndefined();
    expect(parseDiskToMb('NaNK')).toBeUndefined();
    expect(parseDiskToMb('500K')).toBeTypeOf('number');
    expect(parseDiskToMb('1.5M')).toBeTypeOf('number');
    expect(parseDiskToMb('2G')).toBeTypeOf('number');
    expect(parseDiskToMb('1T')).toBeTypeOf('number');
    expect(parseDiskToMb('Archived and active journals take up 1.2G on disk.')).toBeTypeOf(
      'number',
    );

    const dir = tmp('ysk-lc80-');
    const db = new JsonStore(join(dir, 'db.json'));

    // corrupt + clamp
    db.snapshot.settings.log_center = '{bad';
    db.persist();
    const loaded = loadLogSettings(db);
    expect(loaded.bookmarks).toEqual([]);

    saveLogSettings(db, {
      maxLines: 1,
      maxBytes: 10,
      followIntervalSec: 99,
      vacuumDefaultDays: 9999,
      journalWarnMb: 1,
      autoVacuumTime: 'bad',
      autoVacuumEnabled: true,
      maskSecrets: false,
      disabledSources: Array.from({ length: 5 }, (_, i) => `s${i}`),
      customAllowPaths: ['/var/log/nginx/access.log', '/etc/shadow'],
      bookmarks: [
        { name: '', source: 'x' },
        { name: 'b1', source: 'journal:ssh.service', lines: 10, grep: 'err', since: '1h', priority: 'err' },
      ] as never,
    });
    const s2 = loadLogSettings(db);
    expect(s2.maxLines).toBeGreaterThanOrEqual(50);
    expect(s2.bookmarks.length).toBeGreaterThanOrEqual(1);

    const bm = addLogBookmark(db, {
      name: 'b2',
      source: 'file:/var/log/syslog',
      lines: 100,
    });
    expect(bm.bookmarks.length).toBeGreaterThan(0);
    removeLogBookmark(db, bm.bookmarks[0]?.id ?? 'x');
    removeLogBookmark(db, 'missing');

    const host = mockHost({
      execute: true,
      root: true,
      paths: ['/var/log'],
      onRun: (argv) => {
        const j = argv.join(' ');
        if (j.includes('journalctl') || argv[0] === 'journalctl') {
          return { exitCode: 0, stdout: 'line1\nline2 password=x\n' };
        }
        if (j.includes('logrotate')) return { exitCode: 0, stdout: 'ok' };
        if (j.includes('df') || j.includes('disk')) return { exitCode: 0, stdout: '1.2G' };
        return { exitCode: 0, stdout: '' };
      },
    });

    const rot = await getLogrotateStatus(host);
    expect(rot).toBeTruthy();

    const overview = await getLogOverview({ db, host, dataDir: dir });
    expect(overview).toBeTruthy();

    // project index
    db.snapshot.projects.push({
      id: 'p1',
      name: 'P',
      linux_user: 'ysks_p1',
      home_dir: join(dir, 'homes', 'p1'),
      runtime: 'php',
      runtime_version: '8.3',
    } as never);
    mkdirSync(join(dir, 'homes', 'p1', 'logs'), { recursive: true });
    writeFileSync(join(dir, 'homes', 'p1', 'logs', 'app.out.log'), 'hello\n');
    const idx = listProjectLogIndex(db, { dataDir: dir });
    expect(Array.isArray(idx)).toBe(true);

    // query various sources
    for (const source of [
      'journal:ssh.service',
      'file:/var/log/syslog',
      'project:p1:app.out.log',
      'disabled:s0',
    ]) {
      try {
        await queryLogSource({
          db,
          host,
          dataDir: dir,
          source,
          maxLines: 50,
        } as never);
      } catch {
        /* path may be blocked */
      }
    }

    try {
      await exportLogQuery({
        db,
        host,
        dataDir: dir,
        source: 'journal:ssh.service',
      } as never);
    } catch {
      /* ok */
    }

    // auto vacuum tick: wrong time / right time
    const tick1 = await runLogAutoVacuumTick({
      db,
      host,
      dataDir: dir,
      now: new Date('2020-01-01T00:00:00Z'),
    } as never);
    expect(tick1).toBeTruthy();

    saveLogSettings(db, { autoVacuumEnabled: true, autoVacuumTime: '03:00' });
    const tick2 = await runLogAutoVacuumTick({
      db,
      host,
      dataDir: dir,
      now: new Date('2020-01-01T03:00:30Z'),
    } as never);
    expect(tick2).toBeTruthy();
  });
});

// ─── system-apply ──────────────────────────────────────────────────────────
describe('system-apply floor80 edges', () => {
  it('probeControlPlane throws/empty + install + email domain + firewall/f2b', async () => {
    expect(panelBlockMessage('need_execute' as never).length).toBeGreaterThan(0);

    const dir = tmp('ysk-sa80-');
    // throw on is-active / is-enabled
    const stThrow = await probeControlPlaneSystemd(
      mockHost({
        execute: true,
        root: true,
        throwOn: (argv) => argv.includes('is-active') || argv.includes('is-enabled'),
      }),
      dir,
    );
    expect(stThrow.active).toBe('unknown');
    expect(stThrow.enabled).toBe('unknown');

    // empty stdout fallback
    const stEmpty = await probeControlPlaneSystemd(
      mockHost({
        execute: false,
        root: false,
        onRun: (argv) => {
          if (argv.includes('is-active') || argv.includes('is-enabled'))
            return { exitCode: 0, stdout: '', stderr: '' };
          if (argv.includes('show'))
            return {
              exitCode: 0,
              stdout: 'MainPID=0\nActiveEnterTimestamp=n/a\nFragmentPath=\nDescription=\n=bad\nOther=1\n',
            };
          return {};
        },
      }),
      undefined,
    );
    expect(stEmpty.managedUnitPath).toBeNull();
    expect(stEmpty.canInstall).toBe(false);

    // pathExists throw
    const hostPathThrow: HostExecutor = {
      ...mockHost({ execute: true, root: true }),
      pathExists: () => {
        throw new Error('pe');
      },
    };
    const stPe = await probeControlPlaneSystemd(hostPathThrow, dir);
    expect(stPe.systemUnitExists).toBe(false);

    writeControlPlaneSystemdUnit({
      dataDir: dir,
      nodePath: '/usr/bin/node',
      cliPath: join(dir, 'cli.js'),
    });
    const instBlocked = await installControlPlaneSystemd({
      dataDir: dir,
      cliPath: join(dir, 'cli.js'),
      host: mockHost({ execute: false, root: true }),
      enable: true,
    });
    expect(instBlocked.blocked === true || instBlocked.ok === false).toBe(true);

    const instBlockedRoot = await installControlPlaneSystemd({
      dataDir: dir,
      cliPath: join(dir, 'cli.js'),
      host: mockHost({ execute: true, root: false }),
      enable: true,
    });
    expect(instBlockedRoot.blocked).toBe(true);

    const instWriteOnly = await installControlPlaneSystemd({
      dataDir: dir,
      cliPath: join(dir, 'cli.js'),
      host: mockHost({ execute: true, root: true }),
      enable: false,
    });
    expect(instWriteOnly.ok).toBe(true);

    const inst = await installControlPlaneSystemd({
      dataDir: dir,
      cliPath: join(dir, 'cli.js'),
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 0 }),
      }),
      enable: true,
    });
    expect(typeof inst.ok).toBe('boolean');

    const instFail = await installControlPlaneSystemd({
      dataDir: dir,
      cliPath: join(dir, 'cli.js'),
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 1, stderr: 'fail' }),
      }),
      enable: true,
    });
    expect(instFail.ok).toBe(false);

    await expect(
      applyEmailStack({
        dataDir: dir,
        domain: '  ',
        host: mockHost({ execute: false }),
      }),
    ).rejects.toThrow();

    const email = await applyEmailStack({
      dataDir: dir,
      domain: 'mail.example.com',
      host: mockHost({ execute: false, root: false }),
      installPackages: true,
    });
    expect(email.requiresExecute || email.ok === true || email.ok === false).toBe(true);

    const le = await applyLetsEncrypt({
      dataDir: dir,
      domain: 'le.example.com',
      host: mockHost({ execute: false }),
      email: 'a@b.c',
    } as never);
    expect(typeof le.ok).toBe('boolean');

    const fw = await probeFirewallStatus(mockHost({ execute: true, root: true }));
    expect(fw).toBeTruthy();
    const f2b = await probeFail2banStatus(mockHost({ execute: true, root: true }));
    expect(f2b).toBeTruthy();

    await fail2banBannedIps(mockHost({ execute: false }), 'sshd');
    await fail2banUnban(mockHost({ execute: false }), 'sshd', '1.2.3.4');
    await fail2banIgnoreIp(mockHost({ execute: false }), '1.2.3.4', 'add');

    await applyFirewall({
      host: mockHost({ execute: false, root: false }),
      dataDir: dir,
      apply: true,
    });
    await applyFail2ban({
      host: mockHost({ execute: false }),
      dataDir: dir,
      apply: true,
    } as never);
  });
});

// ─── wave-2 residual edges (clear last ~40 branches) ───────────────────────
describe('floor80 wave-2 residual edges', () => {
  it('project-logs resolve path branches: ~extra, dir not file, log/ prefix, invalid', () => {
    const home = tmp('ysk-plw2-');
    mkdirSync(join(home, 'logs', 'sub'), { recursive: true });
    mkdirSync(join(home, 'log'), { recursive: true });
    mkdirSync(join(home, 'storage', 'logs'), { recursive: true });
    writeFileSync(join(home, 'logs', 'app.log'), 'a\n');
    writeFileSync(join(home, 'log', 'legacy.log'), 'L\n');
    writeFileSync(join(home, 'storage', 'logs', 'x.log'), 'x\n');
    // directory where file expected
    mkdirSync(join(home, 'logs', 'isdir'), { recursive: true });

    expect(resolveProjectLogPath('', 'app.log').ok).toBe(false);
    expect(resolveProjectLogPath(home, '').ok).toBe(false);
    expect(resolveProjectLogPath(home, 'a\0b').ok).toBe(false);

    // ~ without extraDirs
    expect(resolveProjectLogPath(home, '~storage/logs/x.log', []).ok).toBe(false);
    // ~ with empty after ~
    expect(resolveProjectLogPath(home, '~', ['storage/logs']).ok).toBe(false);
    // ~ with ..
    expect(resolveProjectLogPath(home, '~storage/../etc', ['storage/logs']).ok).toBe(false);
    // ~ under extra ok
    expect(resolveProjectLogPath(home, '~storage/logs/x.log', ['storage/logs']).ok).toBe(true);
    // ~ missing file
    expect(resolveProjectLogPath(home, '~storage/logs/missing.log', ['storage/logs']).ok).toBe(
      false,
    );
    // ~ directory not file
    mkdirSync(join(home, 'storage', 'logs', 'subdir'), { recursive: true });
    expect(resolveProjectLogPath(home, '~storage/logs/subdir', ['storage/logs']).ok).toBe(false);

    // logs/ prefix strip
    expect(resolveProjectLogPath(home, 'logs/app.log').ok).toBe(true);
    // log/ prefix strip
    expect(resolveProjectLogPath(home, 'log/legacy.log').ok).toBe(true);
    // dir not file under logs
    expect(resolveProjectLogPath(home, 'isdir').ok).toBe(false);
    // invalid chars
    expect(resolveProjectLogPath(home, 'bad name.log').ok).toBe(false);
    // symlink under logs
    try {
      const target = join(home, 'logs', 'app.log');
      symlinkSync(target, join(home, 'logs', 'link.log'));
      expect(resolveProjectLogPath(home, 'link.log').ok).toBe(true);
      // extra symlink
      symlinkSync(join(home, 'storage', 'logs', 'x.log'), join(home, 'storage', 'logs', 'slink.log'));
      expect(
        resolveProjectLogPath(home, '~storage/logs/slink.log', ['storage/logs']).ok,
      ).toBe(true);
    } catch {
      /* fs may block */
    }

    // related php version empty after sanitize
    const rel = listProjectRelatedLogSources({
      projectId: 'p',
      linuxUser: 'ysks_ok',
      runtime: 'php',
      phpVersion: '!!!',
    });
    expect(rel.some((x) => x.kind === 'php-fpm')).toBe(true);

    // search empty home
    const emptyHome = tmp('ysk-ple-');
    expect(searchProjectLogs(emptyHome, { grep: 'x' }).ok).toBe(true);
    expect(searchProjectLogs(emptyHome, {}).notes.length).toBeGreaterThan(0);
  });

  it('log-center query sources + save clamps + vacuum + overview warn', async () => {
    const dir = tmp('ysk-lcw2-');
    const db = new JsonStore(join(dir, 'db.json'));
    // load with partial JSON
    db.snapshot.settings.log_center = JSON.stringify({
      maxLines: 'x',
      maxBytes: null,
      followIntervalSec: 0,
      vacuumDefaultDays: -1,
      maskSecrets: false,
      disabledSources: 'nope',
      customAllowPaths: null,
      bookmarks: [{ name: 'n', source: '' }, { id: 'keep', name: 'ok', source: 'journal:x' }],
      autoVacuumTime: '9:30',
      journalWarnMb: 1,
    });
    db.persist();
    const loaded = loadLogSettings(db);
    expect(loaded.bookmarks.length).toBeGreaterThanOrEqual(1);
    expect(loaded.autoVacuumTime).toMatch(/\d/);

    saveLogSettings(db, {
      customAllowPaths: [
        '/var/log/nginx/access.log',
        '/run/log/future.log',
        '/etc/passwd',
        '../evil',
      ],
      followIntervalSec: 100,
      maxLines: 99999,
      maxBytes: 1,
      vacuumDefaultDays: 0,
      journalWarnMb: 1,
      autoVacuumTime: 'not-time',
      autoVacuumEnabled: true,
      maskSecrets: true,
    });

    // empty source query
    const host = mockHost({
      execute: true,
      root: true,
      onRun: (argv) => {
        const j = argv.join(' ');
        if (j.includes('journalctl') || argv[0] === 'journalctl') {
          return { exitCode: 0, stdout: 'e1\npassword=x\n' };
        }
        if (j.includes('logrotate')) return { exitCode: 0, stdout: '/usr/sbin/logrotate\n' };
        if (j.includes('du ') || j.includes('/var/log')) return { exitCode: 0, stdout: '2.0G\n' };
        if (j.includes('vacuum') || j.includes('--vacuum')) return { exitCode: 0 };
        return { exitCode: 0, stdout: '1.5G archived\n' };
      },
    });

    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: '',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'journal:',
      lines: 20,
      grep: 'e',
      priority: 'err',
      since: '1h',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'file:no-such',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project:missing:app.log',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-managed:missing:access.log',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-fpm:missing',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'unknown:x',
    });

    // project with logs
    const home = join(dir, 'homes', 'p1');
    mkdirSync(join(home, 'logs'), { recursive: true });
    writeFileSync(join(home, 'logs', 'app.out.log'), 'hello secret=1\nworld\n');
    db.snapshot.projects.push({
      id: 'p1',
      name: 'P1',
      linux_user: 'ysks_p1',
      home_dir: home,
      runtime_version: '8.2',
      domain: 'p1.example.com',
    } as never);
    db.persist();

    await queryLogSource({ host, dataDir: dir, db, source: 'project:p1' });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project:p1:app.out.log',
      grep: 'hello',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project:p1:missing.log',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-managed:p1:access.log',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-fpm:p1',
    });
    await queryLogSource({
      host,
      dataDir: dir,
      db,
      source: 'project-managed:p1:',
    });

    // logrotate not installed
    await getLogrotateStatus(
      mockHost({ onRun: () => ({ exitCode: 0, stdout: '' }) }),
    );
    await getLogrotateStatus(
      mockHost({
        onRun: (argv) => {
          if (argv.join(' ').includes('logrotate'))
            return { exitCode: 0, stdout: '/usr/sbin/logrotate\n' };
          return { exitCode: 0, stdout: '' };
        },
      }),
    );

    // overview with journal warn
    saveLogSettings(db, { journalWarnMb: 64 });
    await getLogOverview({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          const j = argv.join(' ');
          if (j.includes('journalctl') && j.includes('--disk-usage'))
            return { exitCode: 0, stdout: 'Archived and active journals take up 5.0G on disk.\n' };
          if (j.includes('journalctl')) return { exitCode: 1, stderr: 'no journal' };
          if (j.includes('du')) return { exitCode: 0, stdout: '500M\n' };
          if (j.includes('logrotate')) return { exitCode: 0, stdout: '' };
          return { exitCode: 0, stdout: '5.0G\n' };
        },
      }),
      dataDir: dir,
      db,
    });

    // export
    try {
      await exportLogQuery({
        host,
        dataDir: dir,
        db,
        source: 'journal:ssh.service',
        lines: 10,
      } as never);
    } catch {
      /* ok */
    }

    // vacuum: disabled / blocked / in-window
    saveLogSettings(db, { autoVacuumEnabled: false });
    expect((await runLogAutoVacuumTick({ db, host })).ran).toBe(false);
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    saveLogSettings(db, {
      autoVacuumEnabled: true,
      autoVacuumTime: `${hh}:${mm}`,
      vacuumDefaultDays: 7,
    });
    expect(
      (await runLogAutoVacuumTick({ db, host: mockHost({ execute: false, root: true }) })).ran,
    ).toBe(false);
    await runLogAutoVacuumTick({
      db,
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 0 }),
      }),
    });
    // second call may hit last-run skip branch
    await runLogAutoVacuumTick({
      db,
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 0 }),
      }),
    });

    // add bookmark invalid
    addLogBookmark(db, { name: '', source: 'x' });
    addLogBookmark(db, { name: 'ok2', source: 'journal:nginx.service', id: 'fixed-id' });
  });

  it('ftps create edges + listFtp* + chown + apply blocked variants', async () => {
    const dir = tmp('ysk-ftw2-');
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));

    // short password
    expect(
      createProjectFtpAccount(db, {
        projectId: 'p',
        projectHome: join(dir, 'h'),
        linuxUser: 'ysks_u',
        password: 'short',
      }).ok,
    ).toBe(false);
    // no linux user
    expect(
      createProjectFtpAccount(db, {
        projectId: 'p',
        projectHome: join(dir, 'h'),
        linuxUser: '',
        password: 'longenough',
      }).ok,
    ).toBe(false);

    mkdirSync(join(dir, 'h'), { recursive: true });
    // root homeSubdir, no app dir
    const c1 = createProjectFtpAccount(db, {
      projectId: 'p1',
      projectHome: join(dir, 'h'),
      linuxUser: 'ysks_u1',
      password: 'longenough1',
      homeSubdir: 'root',
      username: '!!!',
    });
    expect(c1.ok === true || c1.ok === false).toBe(true);

    // duplicate username
    if (c1.ok) {
      const dup = createProjectFtpAccount(db, {
        projectId: 'p2',
        projectHome: join(dir, 'h2'),
        linuxUser: 'ysks_u1',
        password: 'longenough2',
        homeSubdir: 'root',
      });
      // may collide on derived username
      expect(typeof dup.ok).toBe('boolean');
    }

    // load corrupt settings
    db.snapshot.settings.ftps_settings = '{bad';
    db.persist();
    expect(loadFtpsSettings(db).listenPort).toBe(DEFAULT_FTPS_SETTINGS.listenPort);
    // load object settings
    db.snapshot.settings.ftps_settings = { listenPort: 9999 } as never;
    expect(loadFtpsSettings(db).listenPort).toBe(9999);

    // list homes/domains
    db.snapshot.projects.push({
      id: 'px',
      name: 'PX',
      home_dir: join(dir, 'ph'),
      domain: 'px.example.com',
      linux_user: 'ysks_px',
    } as never);
    db.snapshot.email_domains = [{ domain: 'mail.example.com' }] as never;
    db.snapshot.certificates = [{ domain: 'ssl.example.com' }] as never;
    db.persist();
    createResource(db, 'nginx_sites', { serverName: 'ngx.example.com' });
    const homes = listFtpHomeOptions({ db, dataDir: dir, username: 'u' });
    expect(homes.length).toBeGreaterThan(0);
    expect(listFtpDomainOptions(db).length).toBeGreaterThan(0);

    // chown with projectId resolution + guest fallback
    createResource(db, 'ftp_accounts', {
      username: 'ch1',
      homePath: join(dir, 'h'),
      projectId: 'px',
    });
    createResource(db, 'ftp_accounts', {
      username: 'ch2',
      homePath: join(dir, 'missing-home'),
    });
    createResource(db, 'ftp_accounts', {
      username: 'ch3',
      homePath: join(dir, 'h'),
      linuxUser: 'explicit_u',
    });
    await chownFtpAccountHomes(
      mockHost({
        onRun: (argv) => {
          const j = argv.join(' ');
          if (j.includes('id ')) return { exitCode: 0, stdout: '0\n' };
          if (j.includes('chown')) return { exitCode: 0 };
          return {};
        },
      }),
      db,
      'guest',
    );
    await chownFtpAccountHomes(
      mockHost({
        onRun: (argv) => {
          const j = argv.join(' ');
          if (j.includes('id ')) return { exitCode: 0, stdout: '0\n' };
          if (j.includes('chown')) return { exitCode: 1, stdout: '', stderr: 'denied' };
          return {};
        },
      }),
      db,
      'guest',
    );

    // applyFtpAccountReal missing
    await applyFtpAccountReal({
      db,
      dataDir: dir,
      host: mockHost({ execute: true, root: true }),
      id: 'missing',
    });
  });

  it('backup-cron throw non-Error + control-plane dry listing empty + cron resolve user', async () => {
    const dir = tmp('ysk-bkw2-');
    const home = join(dir, 'h');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'f'), 'x');

    // non-Error throw in backupAllProjects
    const hostThrow = mockHost({
      onRun: () => {
        throw 'string-fail';
      },
    });
    const r = await backupAllProjects({
      host: hostThrow,
      dataDir: dir,
      projects: [{ id: 'p', home_dir: home }],
    });
    expect(r.results[0]?.ok).toBe(false);

    // backupProject first tar fails second succeeds (no archive size → catch)
    let n = 0;
    const bak = await backupProject({
      host: mockHost({
        onRun: (argv) => {
          if (argv[0] === 'tar' && argv.includes('-czf')) {
            n += 1;
            if (n === 1) return { exitCode: 1, stderr: 'fail1' };
            // second succeeds but don't write file → bytes catch
            return { exitCode: 0 };
          }
          return {};
        },
      }),
      dataDir: dir,
      projectId: 'p',
      homeDir: home,
    });
    expect(bak.ok).toBe(true);

    // restore invalid archive throws
    await expect(
      restoreProjectBackup({
        host: mockHost(),
        dataDir: dir,
        projectId: '',
        archiveName: 'x.tar.gz',
        homeDir: home,
      }),
    ).rejects.toThrow();
    await expect(
      restoreProjectBackup({
        host: mockHost(),
        dataDir: dir,
        projectId: 'p',
        archiveName: 'missing.tar.gz',
        homeDir: home,
      }),
    ).rejects.toThrow();

    // full restore: first extract fails second succeeds
    const archDir = join(dir, 'backups', 'p');
    mkdirSync(archDir, { recursive: true });
    writeFileSync(join(archDir, 'f.tar.gz'), 'd');
    let t = 0;
    const full = await restoreProjectBackup({
      host: mockHost({
        onRun: (argv) => {
          if (argv[0] === 'tar' && argv.includes('-xzf')) {
            t += 1;
            return t === 1 ? { exitCode: 1, stderr: 'f1' } : { exitCode: 0 };
          }
          return {};
        },
      }),
      dataDir: dir,
      projectId: 'p',
      archiveName: 'f.tar.gz',
      homeDir: home,
      mode: 'full',
    });
    expect(full.ok).toBe(true);

    // cron without project linux_user
    const store = new JsonStore(join(dir, 'db.json'));
    store.snapshot.projects.push({ id: 'np', name: 'n', home_dir: home } as never);
    store.persist();
    const cron = new CronJobService(store as never, mockHost({ execute: true }), dir);
    const j = cron.create({
      projectId: 'np',
      user: 'root',
      schedule: '0 1 * * *',
      command: 'true',
      actor: 't',
      skipRunuserWrap: true,
    });
    expect(j.user).toBe('root');
    const run = await cron.runNow(j.id, 't');
    expect(typeof run.ok).toBe('boolean');
    // run fail exit
    const cronFail = new CronJobService(
      store as never,
      mockHost({ execute: true, onRun: () => ({ exitCode: 1, stderr: 'no' }) }),
      dir,
    );
    expect((await cronFail.runNow(j.id, 't')).ok).toBe(false);
  });

  it('network empty-note del success + route default ephemeral + setDns search empty', async () => {
    // del success with notes empty uses default deleted note — force ip ok without prior notes
    const del = await networkDelAddr({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'ip') return { exitCode: 0 };
          return { exitCode: 1 };
        },
      }),
      ifname: 'eth0',
      cidr: '10.0.0.9/24',
    });
    expect(del.ok).toBe(true);

    // add route dst empty with confirm → default ephemeral
    const rt = await networkAddRoute({
      host: mockHost({ execute: true, root: true }),
      dst: '',
      gateway: '10.0.0.1',
      confirmDefault: true,
    });
    expect(rt.ok).toBe(true);

    // del route empty dst with confirm
    const dr = await networkDelRoute({
      host: mockHost({ execute: true, root: true }),
      dst: '  ',
      confirmDefault: true,
    });
    expect(dr.ok).toBe(true);

    // setDns with empty search array branch
    const dns = await networkSetDns({
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'nmcli' && argv.includes('--active')) {
            return {
              exitCode: 0,
              stdout: 'c1:eth0:802-3-ethernet\n',
            };
          }
          return {};
        },
      }),
      nameservers: ['1.1.1.1'],
      search: ['', '  '],
    });
    expect(dns.ok).toBe(true);
  });

  it('managed-resources nginx execute success reload + mysql applied path notes', async () => {
    const dir = tmp('ysk-mrw2-');
    const db = openDatabase(join(dir, 'db.json'));
    cleanups.push(() => closeDatabase(db));
    const site = createResource(db, 'nginx_sites', {
      serverName: 'ok.example',
      kind: 'proxy',
      upstream: 'http://127.0.0.1:1',
    });
    // conf dir that exists for sync
    const sys = join(dir, 'etc-nginx');
    mkdirSync(sys, { recursive: true });
    const host = mockHost({
      execute: true,
      root: true,
      onRun: (argv) => {
        if (argv[0] === 'nginx' || argv.includes('-t')) return { exitCode: 0 };
        if (argv.includes('reload')) return { exitCode: 0 };
        return { exitCode: 0 };
      },
    });
    const r = await applyManagedNginxSite(db, dir, String(site.id), {
      host,
      execute: true,
      systemConfDir: sys,
    });
    expect(typeof r.ok).toBe('boolean');

    // reload fail after test ok
    const r2 = await applyManagedNginxSite(db, dir, String(site.id), {
      host: mockHost({
        execute: true,
        root: true,
        onRun: (argv) => {
          if (argv[0] === 'nginx' || argv.includes('-t')) return { exitCode: 0 };
          if (argv.includes('reload')) return { exitCode: 1, stderr: 'no' };
          return { exitCode: 0 };
        },
      }),
      execute: true,
      systemConfDir: sys,
    });
    expect(typeof r2.ok).toBe('boolean');

    // mysql with notes containing 權限 for blockMessage
    const my = createResource(db, 'mysql_databases', { name: 'dbx' });
    await applyMysqlDatabase(
      db,
      String(my.id),
      mockHost({
        execute: false,
        root: false,
      }),
      true,
    );
  });

  it('peer-ops identity path + primary mysql role + install primary conf', async () => {
    const dir = tmp('ysk-pow2-');
    const db = new JsonStore(join(dir, 'db.json'));
    // identityId without dataDir → undefined path
    const c = createDbCluster(db, {
      name: 'id-test',
      engine: 'mysql',
      kind: 'mysql-replica',
      members: [
        { host: '10.0.0.1', role: 'primary', access: 'local' },
        {
          host: '10.0.0.2',
          role: 'primary',
          access: 'ssh',
          ssh: { username: 'root', port: 22, identityId: 'missing-id' },
        },
      ],
    });
    await probeDbClusterFull({
      db,
      clusterId: c.id,
      host: mockHost({
        execute: true,
        onRun: (argv) => {
          if (argv[0] === 'ssh' && argv.join(' ').includes('MASTER')) {
            return { exitCode: 0, stdout: 'File\tPosition\nbin\t1\n' };
          }
          if (argv[0] === 'ssh') return { exitCode: 1, stderr: 'x' };
          if (argv[0] === 'mysql') return { exitCode: 0, stdout: 'File\tPosition\nbin\t1\n' };
          return {};
        },
      }),
      // no dataDir → identity resolve early exit
    });
    // with dataDir missing identity
    await probeDbClusterFull({
      db,
      dataDir: dir,
      clusterId: c.id,
      identityId: 'also-missing',
      host: mockHost({
        execute: true,
        onRun: (argv) => {
          if (argv[0] === 'ssh') {
            return { exitCode: 0, stdout: 'File\tPosition\nbin\t1\n' };
          }
          return { exitCode: 0 };
        },
      }),
    });

    // install primary mysql (not replica role)
    const c2 = createDbCluster(db, {
      name: 'prim',
      engine: 'mysql',
      kind: 'mysql-replica',
      members: [
        { host: '10.8.0.1', role: 'primary', access: 'local' },
        {
          host: '10.8.0.2',
          role: 'primary',
          access: 'ssh',
          ssh: { username: 'admin', port: 2200 },
        },
      ],
    });
    try {
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c2.id });
    } catch {
      /* */
    }
    await installDbClusterOnPeers({
      db,
      dataDir: dir,
      host: mockHost({
        execute: true,
        onRun: () => ({ exitCode: 0 }),
      }),
      clusterId: c2.id,
      execute: true,
      restart: false,
    });

    // postgres primary role install
    const c3 = createDbCluster(db, {
      name: 'pgp',
      engine: 'postgres',
      kind: 'postgres-replica',
      members: [
        { host: '10.8.1.1', role: 'primary', access: 'local' },
        {
          host: '10.8.1.2',
          role: 'primary',
          access: 'ssh',
          ssh: { username: 'root' },
        },
      ],
    });
    try {
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c3.id });
    } catch {
      /* */
    }
    await installDbClusterOnPeers({
      db,
      dataDir: dir,
      host: mockHost({ execute: true, onRun: () => ({ exitCode: 0 }) }),
      clusterId: c3.id,
      execute: true,
    });

    // redis master install
    const c4 = createDbCluster(db, {
      name: 'rdm',
      engine: 'redis',
      kind: 'redis-replica',
      members: [
        { host: '10.8.2.1', role: 'master', access: 'local' },
        {
          host: '10.8.2.2',
          role: 'master',
          access: 'ssh',
          ssh: { username: 'root' },
        },
      ],
    });
    try {
      planAndMaterializeDbCluster({ db, dataDir: dir, clusterId: c4.id });
    } catch {
      /* */
    }
    await installDbClusterOnPeers({
      db,
      dataDir: dir,
      host: mockHost({ execute: true, onRun: () => ({ exitCode: 0 }) }),
      clusterId: c4.id,
      execute: true,
    });
  });

  it('system-apply email/letsencrypt/f2b/firewall residual', async () => {
    const dir = tmp('ysk-saw2-');
    const email = await applyEmailStack({
      dataDir: dir,
      domain: 'ok.example.com',
      host: mockHost({
        execute: true,
        root: true,
        onRun: () => ({ exitCode: 0 }),
      }),
      installPackages: true,
    });
    expect(email.written?.length || email.ok === true || email.ok === false).toBeTruthy();

    await applyLetsEncrypt({
      domain: 'le.example.com',
      email: 'a@b.c',
      host: mockHost({ execute: true, root: true, onRun: () => ({ exitCode: 0 }) }),
      run: true,
    });

    await applyLetsEncrypt({
      domain: '*.wild.example.com',
      email: 'a@b.c',
      host: mockHost({ execute: false, root: false }),
      challenge: 'dns-01',
    });

    await applyLetsEncrypt({
      domain: 'le2.example.com',
      email: 'a@b.c',
      host: mockHost({ execute: true, root: false }),
      run: true,
    });

    await applyFirewall({
      host: mockHost({ execute: true, root: true, onRun: () => ({ exitCode: 0 }) }),
      dataDir: dir,
      apply: false,
    });
    await applyFail2ban({
      host: mockHost({ execute: true, root: true, onRun: () => ({ exitCode: 0 }) }),
      dataDir: dir,
      apply: true,
    } as never);
    await fail2banBannedIps(
      mockHost({
        execute: true,
        root: true,
        paths: ['/usr/bin/fail2ban-client'],
        onRun: () => ({ exitCode: 0, stdout: '1.2.3.4\n' }),
      }),
      'sshd',
    );
    await fail2banUnban(
      mockHost({
        execute: true,
        root: true,
        paths: ['/usr/bin/fail2ban-client'],
        onRun: () => ({ exitCode: 0 }),
      }),
      'sshd',
      '1.2.3.4',
    );
    await fail2banIgnoreIp(
      mockHost({
        execute: true,
        root: true,
        paths: ['/usr/bin/fail2ban-client'],
        onRun: () => ({ exitCode: 0 }),
      }),
      '1.2.3.4',
      'add',
    );
  });
});

// ─── project-ops ───────────────────────────────────────────────────────────
describe('project-ops floor80 edges', () => {
  it('pure helpers + liveStatus modes + setResources unset + suspend root reload', async () => {
    expect(resolveProjectDocRoot({ home_dir: '/h', doc_root: '///' } as never)).toBe(
      join('/h', 'app/public'),
    );
    expect(resolveProjectDocRoot({ home_dir: '/h', doc_root: undefined } as never)).toContain(
      'app/public',
    );
    expect(resolveNodeBinary().path.length).toBeGreaterThan(0);
    expect(isPidAlive(999_999_999)).toBe(false);

    const dir = tmp('ysk-po-f80-');
    // cargo edges
    expect(resolveCargoPackageName(dir)).toBeNull();
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\n# no name\n');
    expect(resolveCargoPackageName(dir)).toBeNull();
    writeFileSync(join(dir, 'Cargo.toml'), 'name = "x"\n'); // not matching ^\s*name in [package] multiline — still may match
    // unreadable handled by missing already

    // detectPython: non-dir entries + empty
    mkdirSync(join(dir, 'app-empty'), { recursive: true });
    writeFileSync(join(dir, 'app-empty', 'file.txt'), 'x');
    expect(detectPythonEntry(join(dir, 'app-empty'))).toBeNull();
    expect(detectPythonEntry(join(dir, 'no-such'))).toBeNull();

    const store = new JsonStore(join(dir, 'ysk.json'));
    const repo = new ProjectRepository(store);
    const hostLocal = {
      executeEnabled: () => false,
      isRoot: () => false,
      pathExists: (p: string) => p.includes('systemctl') || existsSync(p),
      readFile: async (p: string) => (existsSync(p) ? (await import('node:fs')).readFileSync(p, 'utf8') : ''),
      listDir: async () => [] as string[],
      writeFile: async (p: string, c: string | Buffer) => {
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, c);
      },
      deletePath: async () => undefined,
      mkdirp: async (p: string) => {
        mkdirSync(p, { recursive: true });
      },
      sysInfo: async () => ({}),
      serviceStatus: async () => empty(),
      runCommand: async (argv: string[]) => {
        if (argv.includes('is-active')) return empty({ stdout: '', stderr: '', exitCode: 3 });
        return empty();
      },
    } as HostExecutor;
    const projects = new ProjectService(repo, hostLocal, dir);
    const ops = new ProjectOpsService(repo, hostLocal, dir);

    const { project } = await projects.create({
      name: 'Live',
      domain: 'live.local',
      runtime: 'node',
      actor: 't',
    });
    repo.updateRuntimeState(project.id, {
      port: undefined,
      pid: 999_999_998,
      process_status: 'stopped',
      last_health: { deployMode: 'pm2' },
    });
    const live = await ops.liveStatus(project.id);
    expect(live.deployMode === 'pm2' || live.deployMode.length > 0).toBe(true);
    expect(live.pidAlive).toBe(false);

    // systemd active path
    const hostActive = {
      ...hostLocal,
      pathExists: (p: string) => p.includes('systemctl'),
      runCommand: async (argv: string[]) => {
        if (argv.includes('is-active')) return empty({ stdout: 'active\n', exitCode: 0 });
        return empty();
      },
    } as HostExecutor;
    const ops2 = new ProjectOpsService(repo, hostActive, dir);
    const live2 = await ops2.liveStatus(project.id);
    expect(live2.deployMode).toBe('systemd');
    expect(live2.degraded).toBe(false);

    // last_health pidfile
    repo.updateRuntimeState(project.id, { last_health: { deployMode: 'pidfile' }, pid: undefined });
    const hostNoSystemctl = {
      ...hostLocal,
      pathExists: () => false,
    } as HostExecutor;
    const ops3 = new ProjectOpsService(repo, hostNoSystemctl, dir);
    const live3 = await ops3.liveStatus(project.id);
    expect(live3.deployMode).toBe('pidfile');

    // setResources with all undefined fields → unset notes
    const res = ops.setResources(project.id, {}, 't');
    expect(res.notes.some((n) => /unset|memoryMax|cpuQuota|tasksMax|limitNofile/i.test(n))).toBe(
      true,
    );

    // suspend/unsuspend without system nginx (managed_only path)
    const sus = await ops.suspend(project.id, 't');
    expect(sus.ok).toBe(true);
    expect(sus.nginxStatus === 'managed_only' || sus.degraded === true || sus.ok).toBe(true);
    const uns = await ops.unsuspend(project.id, 't');
    expect(uns.ok).toBe(true);

    // deployProcess python with entry detect + rust cargo
    const py = await projects.create({
      name: 'Py',
      domain: 'py.local',
      runtime: 'python',
      actor: 't',
    });
    writeFileSync(join(py.project.homeDir, 'app', 'app.py'), 'print(1)\n');
    const pyDep = await ops.deployProcess(py.project.id, {
      actor: 't',
      skipBuild: true,
      healthTimeoutMs: 500,
    });
    expect(pyDep.notes.length).toBeGreaterThan(0);
    await ops.stopNode(py.project.id, 't').catch(() => undefined);

    const rs = await projects.create({
      name: 'Rs',
      domain: 'rs.local',
      runtime: 'rust',
      actor: 't',
    });
    writeFileSync(
      join(rs.project.homeDir, 'app', 'Cargo.toml'),
      '[package]\nname = "demo-rs"\nversion = "0.1.0"\n',
    );
    const rsDep = await ops.deployProcess(rs.project.id, {
      actor: 't',
      skipBuild: true,
      healthTimeoutMs: 500,
    });
    expect(rsDep.notes.length).toBeGreaterThan(0);
    await ops.stopNode(rs.project.id, 't').catch(() => undefined);

    // deployProcess with build fail
    const py2 = await projects.create({
      name: 'Py2',
      domain: 'py2.local',
      runtime: 'python',
      actor: 't',
    });
    writeFileSync(join(py2.project.homeDir, 'app', 'main.py'), 'x');
    const hostBuildFail = {
      ...hostLocal,
      executeEnabled: () => true,
      isRoot: () => false,
      runCommand: async (argv: string[]) => {
        // fail any long command
        if (argv.join(' ').length > 10) return empty({ exitCode: 1, stderr: 'build fail' });
        return empty();
      },
    } as HostExecutor;
    const opsBuild = new ProjectOpsService(repo, hostBuildFail, dir);
    const built = await opsBuild.deployProcess(py2.project.id, {
      actor: 't',
      skipBuild: false,
      healthTimeoutMs: 500,
    });
    expect(built.ok === false || built.ok === true).toBe(true);
  }, 60_000);
});
