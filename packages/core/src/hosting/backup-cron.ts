/**
 * Real backup (tar) and cron job management under dataDir.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ErrorCodes, YskError } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import type { YskDatabase } from '../db/database.js';
import { planCronJob } from './extras.js';

/** Constrain archive under dataDir/backups/<projectId>/ */
export function resolveManagedBackupArchive(
  dataDir: string,
  projectId: string,
  archiveName: string,
): { ok: true; root: string; path: string; name: string } | { ok: false; notes: string[] } {
  const id = String(projectId ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);
  if (!id) return { ok: false, notes: ['無效的 projectId'] };
  const safeName = String(archiveName ?? '')
    .replace(/[/\\]/g, '')
    .replace(/\0/g, '');
  if (!safeName.endsWith('.tar.gz') || safeName.includes('..')) {
    return { ok: false, notes: ['無效的備份檔名'] };
  }
  const root = resolve(join(dataDir, 'backups', id));
  const archivePath = resolve(join(root, safeName));
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (archivePath !== root && !archivePath.startsWith(rootPrefix)) {
    return { ok: false, notes: ['路徑越界拒絕'] };
  }
  return { ok: true, root, path: archivePath, name: safeName };
}

export interface BackupResult {
  ok: boolean;
  archivePath?: string;
  bytes?: number;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string }>;
}

export interface BackupListItem {
  projectId: string;
  name: string;
  path: string;
  bytes: number;
  mtime: string;
}

/**
 * List backup archives under dataDir/backups.
 */
export function listBackups(dataDir: string): BackupListItem[] {
  const root = join(dataDir, 'backups');
  if (!existsSync(root)) return [];
  const out: BackupListItem[] = [];
  for (const projectId of readdirSync(root)) {
    const dir = join(root, projectId);
    try {
      if (!statSync(dir).isDirectory()) continue;
      for (const name of readdirSync(dir).filter((f) => f.endsWith('.tar.gz'))) {
        const path = join(dir, name);
        const st = statSync(path);
        out.push({
          projectId,
          name,
          path,
          bytes: st.size,
          mtime: st.mtime.toISOString(),
        });
      }
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
}

/** Notes that mean "not attempted" (skip) — Chinese or English */
export function isBackupSkipNote(note: string): boolean {
  const n = note.trim();
  return (
    /^skip\b/i.test(n) ||
    /^skipped\b/i.test(n) ||
    n.startsWith('略過') ||
    n.startsWith('跳過')
  );
}

export function isBackupSkippedResult(r: {
  ok: boolean;
  notes: string[];
  skipped?: boolean;
}): boolean {
  if (r.skipped === true) return true;
  return r.notes.some(isBackupSkipNote);
}

/**
 * Backup every project that has a home_dir on disk.
 * - 0 projects → ok (nothing to do)
 * - missing home → skipped (not a failure)
 * - ok only if every *attempted* backup succeeds
 */
export async function backupAllProjects(input: {
  host: HostExecutor;
  dataDir: string;
  projects: Array<{ id: string; home_dir: string; name?: string }>;
  excludes?: string[];
}): Promise<{
  ok: boolean;
  results: Array<BackupResult & { projectId: string; skipped?: boolean }>;
  notes: string[];
  empty?: boolean;
}> {
  if (input.projects.length === 0) {
    return {
      ok: true,
      empty: true,
      results: [],
      notes: ['沒有專案可備份（0 個）— 不視為失敗'],
    };
  }

  const results: Array<BackupResult & { projectId: string; skipped?: boolean }> = [];
  for (const p of input.projects) {
    if (!existsSync(p.home_dir)) {
      results.push({
        projectId: p.id,
        ok: true, // skip is not a hard failure of the job
        skipped: true,
        notes: [`略過：家目錄不存在 ${p.home_dir}`],
        commandResults: [],
      });
      continue;
    }
    try {
      const r = await backupProject({
        host: input.host,
        dataDir: input.dataDir,
        projectId: p.id,
        homeDir: p.home_dir,
        excludes: input.excludes,
      });
      results.push({ projectId: p.id, ...r });
    } catch (e) {
      results.push({
        projectId: p.id,
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
        commandResults: [],
      });
    }
  }

  const skipped = results.filter((r) => isBackupSkippedResult(r));
  const attempted = results.filter((r) => !isBackupSkippedResult(r));
  const okCount = attempted.filter((r) => r.ok).length;
  // No attempts (all skipped) → ok; otherwise every attempt must succeed
  const ok =
    attempted.length === 0 ? true : attempted.every((r) => r.ok);

  const notes: string[] = [
    `已備份 ${okCount}/${attempted.length} 個專案` +
      (skipped.length
        ? `（略過 ${skipped.length} 個無 home）`
        : ''),
  ];
  if (attempted.length === 0) {
    notes.push('全部略過（沒有可備份的 home）— 不視為失敗');
  } else if (ok) {
    notes.push('全部成功');
  } else {
    notes.push('部分或全部失敗 — 請查看 results');
  }

  return { ok, results, notes };
}

/**
 * Create tar.gz of project home into dataDir/backups/<projectId>/.
 */
export async function backupProject(input: {
  host: HostExecutor;
  dataDir: string;
  projectId: string;
  homeDir: string;
  extraSources?: string[];
  /** tar --exclude patterns e.g. node_modules, .git */
  excludes?: string[];
}): Promise<BackupResult> {
  if (!existsSync(input.homeDir)) {
    throw new YskError(ErrorCodes.NOT_FOUND, `專案目錄不存在：${input.homeDir}`, {
      httpStatus: 404,
    });
  }
  const destDir = join(input.dataDir, 'backups', input.projectId);
  mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = join(destDir, `backup-${stamp}.tar.gz`);
  const sources = [input.homeDir, ...(input.extraSources ?? [])];
  const excludeArgs = (input.excludes ?? []).flatMap((e) => ['--exclude', e]);
  // tar from parent with relative paths when possible
  const tarTimeoutMs = 600_000; // large homes
  const r = await input.host.runCommand(
    [
      'tar',
      '-czf',
      archivePath,
      ...excludeArgs,
      '-C',
      '/',
      ...sources.map((s) => s.replace(/^\//, '')),
    ],
    { timeoutMs: tarTimeoutMs },
  );
  if (r.exitCode !== 0) {
    // fallback: tar with absolute paths
    const r2 = await input.host.runCommand(['tar', '-czf', archivePath, ...sources], {
      timeoutMs: tarTimeoutMs,
    });
    if (r2.exitCode !== 0) {
      return {
        ok: false,
        notes: [`tar 失敗：${r2.stderr || r.stderr}`],
        commandResults: [
          { argv: ['tar', '...'], exitCode: r.exitCode, stderr: r.stderr },
          { argv: ['tar', '...'], exitCode: r2.exitCode, stderr: r2.stderr },
        ],
      };
    }
  }
  let bytes = 0;
  try {
    bytes = statSync(archivePath).size;
  } catch {
    /* ignore */
  }
  // retention: keep last 10
  const files = readdirSync(destDir)
    .filter((f) => f.endsWith('.tar.gz'))
    .sort()
    .reverse();
  for (const old of files.slice(10)) {
    try {
      unlinkSync(join(destDir, old));
    } catch {
      /* ignore */
    }
  }
  return {
    ok: true,
    archivePath,
    bytes,
    notes: [`已寫入備份 ${archivePath}`, '保留策略：最近 10 份'],
    commandResults: [{ argv: ['tar', '-czf', archivePath], exitCode: 0, stderr: '' }],
  };
}

/**
 * Restore a managed backup archive into the project home.
 * Path must live under dataDir/backups/<projectId>/ — never accepts arbitrary paths.
 */
export async function restoreProjectBackup(input: {
  host: HostExecutor;
  dataDir: string;
  projectId: string;
  archiveName: string;
  homeDir: string;
  /** When set, chown home to project user after restore (root+execute) */
  linuxUser?: string;
  linuxGroup?: string;
  /**
   * full = entire archive (default)
   * web = only files under project home (strip to app/ when possible)
   * dry-run = list archive contents only
   */
  mode?: 'full' | 'web' | 'dry-run';
}): Promise<BackupResult> {
  const resolved = resolveManagedBackupArchive(
    input.dataDir,
    input.projectId,
    input.archiveName,
  );
  if (!resolved.ok) {
    throw new YskError(ErrorCodes.VALIDATION, resolved.notes[0] ?? '無效備份', {
      httpStatus: 400,
    });
  }
  const { path: archivePath, name: safeName } = resolved;
  if (!existsSync(archivePath)) {
    throw new YskError(ErrorCodes.NOT_FOUND, '找不到備份檔', { httpStatus: 404 });
  }
  const mode = input.mode ?? 'full';

  if (mode === 'dry-run') {
    const r = await input.host.runCommand(['tar', '-tzf', archivePath], { timeoutMs: 60_000 });
    const listing = (r.stdout || '').split('\n').filter(Boolean).slice(0, 80);
    return {
      ok: r.exitCode === 0,
      archivePath,
      notes: [
        r.exitCode === 0
          ? `dry-run：檔案 ${listing.length}+ 個（顯示前 ${listing.length}）`
          : `無法列出: ${r.stderr}`,
        ...listing.slice(0, 12).map((l) => `  ${l}`),
      ],
      commandResults: [{ argv: ['tar', '-tzf', archivePath], exitCode: r.exitCode, stderr: r.stderr }],
    };
  }

  if (!existsSync(input.homeDir)) {
    mkdirSync(input.homeDir, { recursive: true });
  }

  if (mode === 'web') {
    // Extract only into project home (safer partial restore for web files)
    const r2 = await input.host.runCommand(
      ['tar', '-xzf', archivePath, '-C', input.homeDir],
      { timeoutMs: 180_000 },
    );
    const notes =
      r2.exitCode === 0
        ? [`已選擇性還原 (web) 到 ${input.homeDir}`]
        : [`web 還原失敗: ${r2.stderr}`];
    if (r2.exitCode === 0) {
      notes.push(...(await chownAfterRestore(input)));
    }
    return {
      ok: r2.exitCode === 0,
      archivePath,
      notes,
      commandResults: [
        { argv: ['tar', '-xzf', archivePath, '-C', input.homeDir], exitCode: r2.exitCode, stderr: r2.stderr },
      ],
    };
  }

  // full: Archives are created with -C / relative paths; extract the same way
  const r = await input.host.runCommand(['tar', '-xzf', archivePath, '-C', '/'], {
    timeoutMs: 180_000,
  });
  if (r.exitCode !== 0) {
    const r2 = await input.host.runCommand(
      ['tar', '-xzf', archivePath, '-C', input.homeDir],
      { timeoutMs: 180_000 },
    );
    if (r2.exitCode !== 0) {
      return {
        ok: false,
        notes: [`還原失敗: ${r2.stderr || r.stderr}`],
        commandResults: [
          { argv: ['tar', '-xzf', archivePath], exitCode: r.exitCode, stderr: r.stderr },
          { argv: ['tar', '-xzf', archivePath], exitCode: r2.exitCode, stderr: r2.stderr },
        ],
      };
    }
  }
  const notes = [`已從 ${safeName} 完整還原到專案目錄`, ...(await chownAfterRestore(input))];
  return {
    ok: true,
    archivePath,
    notes,
    commandResults: [{ argv: ['tar', '-xzf', archivePath], exitCode: 0, stderr: '' }],
  };
}

async function chownAfterRestore(input: {
  host: HostExecutor;
  homeDir: string;
  linuxUser?: string;
  linuxGroup?: string;
}): Promise<string[]> {
  const u = input.linuxUser?.trim();
  if (!u) return [];
  if (!input.host.executeEnabled() || !input.host.isRoot()) {
    return ['還原後未 chown（需 root + YSK_EXECUTE）'];
  }
  const g = (input.linuxGroup || u).trim();
  const r = await input.host.runCommand(
    [
      'bash',
      '-c',
      `chown -R ${JSON.stringify(u)}:${JSON.stringify(g)} ${JSON.stringify(input.homeDir)} 2>&1`,
    ],
    { timeoutMs: 120_000 },
  );
  return r.exitCode === 0
    ? [`已 chown ${u}:${g} → ${input.homeDir}`]
    : [`chown 失敗：${(r.stderr || r.stdout).slice(0, 120)}`];
}

/** Delete one managed backup archive (path constrained). */
export function deleteProjectBackup(
  dataDir: string,
  projectId: string,
  archiveName: string,
): { ok: boolean; notes: string[] } {
  const resolved = resolveManagedBackupArchive(dataDir, projectId, archiveName);
  if (!resolved.ok) return { ok: false, notes: resolved.notes };
  if (!existsSync(resolved.path)) {
    return { ok: false, notes: ['找不到備份檔'] };
  }
  try {
    unlinkSync(resolved.path);
    return { ok: true, notes: [`已刪除 ${resolved.name}`] };
  } catch (e) {
    return { ok: false, notes: [e instanceof Error ? e.message : String(e)] };
  }
}

/** Resolve a managed backup path for download (path constrained). */
export function resolveBackupDownloadPath(
  dataDir: string,
  projectId: string,
  archiveName: string,
): { ok: true; path: string } | { ok: false; notes: string[] } {
  const resolved = resolveManagedBackupArchive(dataDir, projectId, archiveName);
  if (!resolved.ok) return { ok: false, notes: resolved.notes };
  if (!existsSync(resolved.path)) {
    return { ok: false, notes: ['找不到備份檔'] };
  }
  return { ok: true, path: resolved.path };
}

export interface CronJobRecord {
  id: string;
  project_id?: string;
  user: string;
  schedule: string;
  command: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  last_install?: Record<string, unknown>;
}

/**
 * Wrap project-scoped cron command to run as project Linux user.
 * Avoid double-wrapping if already uses runuser.
 */
export function wrapCronCommandAsLinuxUser(command: string, linuxUser: string): string {
  const cmd = command.trim();
  const u = linuxUser.trim();
  if (!u || !cmd) return cmd;
  if (/\brunuser\s+-u\b/.test(cmd) || cmd.includes(`-u ${u}`)) return cmd;
  // Single-quote for bash -lc
  const quoted = `'${cmd.replace(/'/g, `'\\''`)}'`;
  return `runuser -u ${u} -- bash -lc ${quoted}`;
}

export class CronJobService {
  constructor(
    private readonly db: YskDatabase,
    private readonly host: HostExecutor,
    private readonly dataDir: string,
  ) {}

  list(projectId?: string): CronJobRecord[] {
    const all = cronRows(this.db);
    if (!projectId) return all.map((j) => ({ ...j }));
    return all.filter((j) => j.project_id === projectId).map((j) => ({ ...j }));
  }

  /** Resolve project linux_user from DB when projectId set */
  private resolveProjectLinuxUser(projectId?: string): string | undefined {
    if (!projectId) return undefined;
    const p = this.db.snapshot.projects.find((x) => x.id === projectId);
    return p?.linux_user?.trim() || undefined;
  }

  create(input: {
    projectId?: string;
    user: string;
    schedule: string;
    command: string;
    actor: string;
    /** Skip auto runuser wrap (e.g. system backup jobs) */
    skipRunuserWrap?: boolean;
  }): CronJobRecord {
    const projectLinux = this.resolveProjectLinuxUser(input.projectId);
    let command = input.command;
    let user = input.user;
    if (input.projectId && projectLinux && !input.skipRunuserWrap) {
      command = wrapCronCommandAsLinuxUser(command, projectLinux);
      user = projectLinux;
    }
    planCronJob({
      user,
      schedule: input.schedule,
      command,
    });
    const now = new Date().toISOString();
    const row: CronJobRecord = {
      id: randomUUID(),
      project_id: input.projectId,
      user,
      schedule: input.schedule,
      command,
      enabled: true,
      created_at: now,
      updated_at: now,
    };
    this.db.snapshot.cron_jobs.unshift(row as unknown as Record<string, unknown>);
    this.db.persist();
    this.writeManagedCrontab();
    void input.actor;
    return { ...row };
  }

  delete(id: string): boolean {
    const before = this.db.snapshot.cron_jobs.length;
    this.db.snapshot.cron_jobs = this.db.snapshot.cron_jobs.filter((j) => j.id !== id);
    this.db.persist();
    this.writeManagedCrontab();
    return this.db.snapshot.cron_jobs.length < before;
  }

  /** Enable or disable a job and rewrite managed crontab. */
  setEnabled(id: string, enabled: boolean): CronJobRecord | undefined {
    const row = cronRows(this.db).find((j) => j.id === id);
    if (!row) return undefined;
    row.enabled = enabled;
    row.updated_at = new Date().toISOString();
    this.db.persist();
    this.writeManagedCrontab();
    return { ...row };
  }

  /**
   * Run job command once (test). Requires EXECUTE; fail-closed.
   */
  async runNow(
    id: string,
    actor: string,
  ): Promise<{
    ok: boolean;
    notes: string[];
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    requiresExecute?: boolean;
    blocked?: boolean;
  }> {
    const row = cronRows(this.db).find((j) => j.id === id);
    if (!row) {
      return { ok: false, notes: ['找不到 cron 工作'] };
    }
    if (!this.host.executeEnabled()) {
      return {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: ['無法立即執行：伺服器未開啟系統變更權限'],
      };
    }
    const r = await this.host.runCommand(['bash', '-lc', row.command], {
      timeoutMs: 120_000,
    });
    void actor;
    return {
      ok: r.exitCode === 0,
      exitCode: r.exitCode,
      stdout: (r.stdout || '').slice(0, 4000),
      stderr: (r.stderr || '').slice(0, 4000),
      notes: [
        `執行: ${row.command}`,
        `exit=${r.exitCode}`,
        r.exitCode === 0 ? '成功' : '失敗',
      ],
    };
  }

  /** Ensure a daily full-backup job exists (idempotent by command marker). */
  ensureBackupSchedule(schedule = '0 3 * * *'): CronJobRecord {
    const marker = 'ysk-backup-all';
    const existing = cronRows(this.db).find((j) => j.command.includes(marker));
    if (existing) {
      // Repair legacy broken command `ysk-server backup all` without data-dir
      if (
        existing.command.includes(marker) &&
        !existing.command.includes('--data-dir') &&
        existing.command.includes('backup all')
      ) {
        const fixed = this.backupAllCliCommand(marker);
        const row = this.db.snapshot.cron_jobs.find((j) => j.id === existing.id);
        if (row) {
          row.command = fixed;
          row.updated_at = new Date().toISOString();
          this.db.persist();
          this.writeManagedCrontab();
          return { ...(row as unknown as CronJobRecord) };
        }
      }
      return { ...existing };
    }
    return this.create({
      user: 'root',
      schedule,
      command: this.backupAllCliCommand(marker),
      actor: 'system',
      skipRunuserWrap: true,
    });
  }

  /** Absolute-ish CLI for scheduled full backup (must match apps/server cli). */
  private backupAllCliCommand(marker: string): string {
    // Prefer PATH ysk-server; pass dataDir so cron has correct store
    const data = this.dataDir.replace(/'/g, `'\\''`);
    return `ysk-server backup all --data-dir '${data}' # ${marker}`;
  }

  /** Write all enabled jobs to dataDir/cron/ysk.crontab */
  writeManagedCrontab(): string {
    const dir = join(this.dataDir, 'cron');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'ysk.crontab');
    const lines = [
      '# Generated by YSK Server — install with: crontab dataDir/cron/ysk.crontab',
      ...this.list()
        .filter((j) => j.enabled)
        .map((j) => `${j.schedule} ${j.command} # ysk:${j.id}`),
      '',
    ];
    writeFileSync(path, lines.join('\n'), 'utf8');
    return path;
  }

  /**
   * Install managed crontab for current user when EXECUTE.
   * Never fakes success.
   */
  async installCrontab(actor: string): Promise<{
    ok: boolean;
    path: string;
    requiresExecute: boolean;
    notes: string[];
    blocked?: boolean;
    hostInstalled?: boolean;
  }> {
    const path = this.writeManagedCrontab();
    const notes = [`管理 crontab 檔：${path}`];
    if (!this.host.executeEnabled()) {
      return {
        ok: false,
        path,
        requiresExecute: true,
        blocked: true,
        hostInstalled: false,
        notes: [...notes, '無法安裝到系統：伺服器未開啟系統變更權限（僅寫入管理檔）'],
      };
    }
    const r = await this.host.runCommand(['crontab', path], { timeoutMs: 10_000 });
    const ok = r.exitCode === 0;
    notes.push(ok ? '已安裝到目前程序用戶的系統 crontab' : `crontab 失敗: ${r.stderr}`);
    for (const j of this.db.snapshot.cron_jobs) {
      j.last_install = { ok, at: new Date().toISOString(), actor };
    }
    this.db.persist();
    return { ok, path, requiresExecute: false, notes, hostInstalled: ok };
  }

  /** Probe managed file vs host crontab (honest status). */
  async probeInstallStatus(): Promise<{
    managedPath: string;
    managedLines: number;
    enabledJobs: number;
    totalJobs: number;
    hostHasYskEntries: boolean | null;
    hostCrontabPreview: string;
    executeEnabled: boolean;
    lastInstallOk: boolean | null;
    lastInstallAt: string | null;
  }> {
    const path = this.writeManagedCrontab();
    const all = this.list();
    const enabledJobs = all.filter((j) => j.enabled).length;
    let managedLines = 0;
    try {
      managedLines = readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.trim().startsWith('#')).length;
    } catch {
      managedLines = 0;
    }

    let hostHasYskEntries: boolean | null = null;
    let hostCrontabPreview = '';
    try {
      const r = await this.host.runCommand(['crontab', '-l'], { timeoutMs: 5_000 });
      const text = `${r.stdout || ''}`;
      hostCrontabPreview = text.slice(0, 2000);
      if (r.exitCode === 0) {
        hostHasYskEntries = /# ysk:/.test(text) || text.includes('ysk-server');
      } else {
        hostHasYskEntries = false;
        hostCrontabPreview = (r.stderr || text || 'no crontab').slice(0, 500);
      }
    } catch {
      hostHasYskEntries = null;
    }

    const last = all.map((j) => j.last_install).find((x) => x && typeof x === 'object') as
      | { ok?: boolean; at?: string }
      | undefined;

    return {
      managedPath: path,
      managedLines,
      enabledJobs,
      totalJobs: all.length,
      hostHasYskEntries,
      hostCrontabPreview,
      executeEnabled: this.host.executeEnabled(),
      lastInstallOk: last?.ok ?? null,
      lastInstallAt: last?.at ?? null,
    };
  }
}

function cronRows(db: YskDatabase): CronJobRecord[] {
  return (db.snapshot.cron_jobs ?? []) as unknown as CronJobRecord[];
}
