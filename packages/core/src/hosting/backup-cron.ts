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
  unlinkSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ErrorCodes, YskError, tl} from 'ysk-server-shared';
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
  if (!id) return { ok: false, notes: [tl('notes.auto.n1115')] };
  const safeName = String(archiveName ?? '')
    .replace(/[/\\]/g, '')
    .replace(/\0/g, '');
  if (!safeName.endsWith('.tar.gz') || safeName.includes('..')) {
    return { ok: false, notes: [tl('notes.auto.n1116')] };
  }
  const root = resolve(join(dataDir, 'backups', id));
  const archivePath = resolve(join(root, safeName));
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (archivePath !== root && !archivePath.startsWith(rootPrefix)) {
    return { ok: false, notes: [tl('notes.auto.n1460')] };
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
          mtime: st.mtime.toISOString() });
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
    n.startsWith(tl('notes.auto.n1252')) ||
    n.startsWith(tl('notes.auto.n1461'))
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
      notes: [tl('notes.auto.n1050')] };
  }

  const results: Array<BackupResult & { projectId: string; skipped?: boolean }> = [];
  for (const p of input.projects) {
    if (!existsSync(p.home_dir)) {
      results.push({
        projectId: p.id,
        ok: true, // skip is not a hard failure of the job
        skipped: true,
        notes: [tl('notes.auto.t0325', { v0: (p.home_dir) })],
        commandResults: [] });
      continue;
    }
    try {
      const r = await backupProject({
        host: input.host,
        dataDir: input.dataDir,
        projectId: p.id,
        homeDir: p.home_dir,
        excludes: input.excludes });
      results.push({ projectId: p.id, ...r });
    } catch (e) {
      results.push({
        projectId: p.id,
        ok: false,
        notes: [e instanceof Error ? e.message : String(e)],
        commandResults: [] });
    }
  }

  const skipped = results.filter((r) => isBackupSkippedResult(r));
  const attempted = results.filter((r) => !isBackupSkippedResult(r));
  const okCount = attempted.filter((r) => r.ok).length;
  // No attempts (all skipped) → ok; otherwise every attempt must succeed
  const ok =
    attempted.length === 0 ? true : attempted.every((r) => r.ok);

  const notes: string[] = [
    tl('notes.auto.t0326', { v0: (okCount), v1: (attempted.length) }) +
      (skipped.length
        ? tl('notes.auto.t0327', { v0: (skipped.length) })
        : ''),
  ];
  if (attempted.length === 0) {
    notes.push(tl('notes.auto.n0590'));
  } else if (ok) {
    notes.push(tl('notes.auto.n0589'));
  } else {
    notes.push(tl('notes.auto.n1492'));
  }

  return { ok, results, notes };
}

/**
 * Re-localize a persisted last_backup_run payload under the current request locale.
 * Historical runs stored free-text notes (often zh-HK); recompute summary notes from structure.
 */
export function localizeLastBackupRun(
  last: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!last || typeof last !== 'object') return last ?? null;
  const results = Array.isArray(last.results)
    ? (last.results as Array<{ ok: boolean; notes?: string[]; skipped?: boolean }>)
    : [];
  const asSkip = (r: { ok: boolean; notes?: string[]; skipped?: boolean }) =>
    isBackupSkippedResult({ ok: r.ok, notes: r.notes ?? [], skipped: r.skipped });
  const skipped = results.filter(asSkip);
  const attempted = results.filter((r) => !asSkip(r));
  const okCount = attempted.filter((r) => r.ok).length;

  const notes: string[] = [
    tl('notes.auto.t0326', { v0: okCount, v1: attempted.length }) +
      (skipped.length ? tl('notes.auto.t0327', { v0: skipped.length }) : ''),
  ];
  if (last.ok === true) {
    notes.push(
      attempted.length === 0 ? tl('notes.auto.n0590') : tl('notes.auto.n0589'),
    );
  } else {
    notes.push(tl('notes.auto.n1492'));
  }
  if (last.sideOk === false) {
    notes.push(tl('notes.auto.n1482'));
  } else if (
    last.sideOk === true &&
    Array.isArray(last.sideResults) &&
    (last.sideResults as unknown[]).length > 0
  ) {
    notes.push(tl('notes.auto.n1486'));
  }

  // Per-result notes: pass through (may be free-text errors); skip detection uses skipped flag
  return { ...last, notes };
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
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.auto.t0328', { v0: (input.homeDir) }), {
      httpStatus: 404 });
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
      timeoutMs: tarTimeoutMs });
    if (r2.exitCode !== 0) {
      return {
        ok: false,
        notes: [tl('notes.auto.t0329', { v0: (r2.stderr || r.stderr) })],
        commandResults: [
          { argv: ['tar', '...'], exitCode: r.exitCode, stderr: r.stderr },
          { argv: ['tar', '...'], exitCode: r2.exitCode, stderr: r2.stderr },
        ] };
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
    notes: [tl('notes.auto.t0330', { v0: (archivePath) }), tl('notes.auto.n0556')],
    commandResults: [{ argv: ['tar', '-czf', archivePath], exitCode: 0, stderr: '' }] };
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
    throw new YskError(ErrorCodes.VALIDATION, resolved.notes[0] ?? tl('notes.auto.n1111'), {
      httpStatus: 400 });
  }
  const { path: archivePath, name: safeName } = resolved;
  if (!existsSync(archivePath)) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.backup.fileNotFound'), { httpStatus: 404 });
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
          ? tl('notes.auto.t0331', { v0: (listing.length), v1: (listing.length) })
          : tl('notes.auto.t0332', { v0: (r.stderr) }),
        ...listing.slice(0, 12).map((l) => `  ${l}`),
      ],
      commandResults: [{ argv: ['tar', '-tzf', archivePath], exitCode: r.exitCode, stderr: r.stderr }] };
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
        ? [tl('notes.auto.t0333', { v0: (input.homeDir) })]
        : [tl('notes.auto.t0334', { v0: (r2.stderr) })];
    if (r2.exitCode === 0) {
      notes.push(...(await chownAfterRestore(input)));
    }
    return {
      ok: r2.exitCode === 0,
      archivePath,
      notes,
      commandResults: [
        { argv: ['tar', '-xzf', archivePath, '-C', input.homeDir], exitCode: r2.exitCode, stderr: r2.stderr },
      ] };
  }

  // full: Archives are created with -C / relative paths; extract the same way
  const r = await input.host.runCommand(['tar', '-xzf', archivePath, '-C', '/'], {
    timeoutMs: 180_000 });
  if (r.exitCode !== 0) {
    const r2 = await input.host.runCommand(
      ['tar', '-xzf', archivePath, '-C', input.homeDir],
      { timeoutMs: 180_000 },
    );
    if (r2.exitCode !== 0) {
      return {
        ok: false,
        notes: [tl('notes.auto.t0335', { v0: (r2.stderr || r.stderr) })],
        commandResults: [
          { argv: ['tar', '-xzf', archivePath], exitCode: r.exitCode, stderr: r.stderr },
          { argv: ['tar', '-xzf', archivePath], exitCode: r2.exitCode, stderr: r2.stderr },
        ] };
    }
  }
  const notes = [tl('notes.auto.t0336', { v0: (safeName) }), ...(await chownAfterRestore(input))];
  return {
    ok: true,
    archivePath,
    notes,
    commandResults: [{ argv: ['tar', '-xzf', archivePath], exitCode: 0, stderr: '' }] };
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
    return [tl('notes.auto.n1488')];
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
    ? [tl('notes.auto.t0337', { v0: (u), v1: (g), v2: (input.homeDir) })]
    : [tl('notes.tpl.chownFailed', { detail: (r.stderr || r.stdout).slice(0, 120) })];
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
    return { ok: false, notes: [tl('notes.backup.fileNotFound')] };
  }
  try {
    unlinkSync(resolved.path);
    return { ok: true, notes: [tl('notes.tpl.deleted', { name: resolved.name })] };
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
    return { ok: false, notes: [tl('notes.backup.fileNotFound')] };
  }
  return { ok: true, path: resolved.path };
}

/** Stable id for control-plane (store + config) archives under dataDir/backups/. */
export const CONTROL_PLANE_BACKUP_ID = 'control-plane';

/**
 * Filter backup list by projectId and free-text q (name / path / id).
 */
export function filterBackupList(
  items: BackupListItem[],
  opts?: { projectId?: string; q?: string },
): BackupListItem[] {
  let out = items;
  const pid = opts?.projectId?.trim();
  if (pid) {
    const safe = pid.replace(/[^a-zA-Z0-9_-]/g, '');
    out = out.filter((x) => x.projectId === safe || x.projectId === pid);
  }
  const q = opts?.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (x) =>
        x.name.toLowerCase().includes(q) ||
        x.projectId.toLowerCase().includes(q) ||
        x.path.toLowerCase().includes(q),
    );
  }
  return out;
}

/**
 * Tar control-plane state: ysk.json (+ config.json if present).
 * Stored under dataDir/backups/control-plane/ — same path rules as project backups.
 * Does NOT include project homes (use backup all / project backup for those).
 */
export async function backupControlPlane(input: {
  host: HostExecutor;
  dataDir: string;
}): Promise<BackupResult & { projectId: string }> {
  const dataDir = resolve(input.dataDir);
  const destDir = join(dataDir, 'backups', CONTROL_PLANE_BACKUP_ID);
  mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = join(destDir, `cp-${stamp}.tar.gz`);

  const candidates = ['ysk.json', 'config.json'];
  const sources: string[] = [];
  for (const name of candidates) {
    const p = join(dataDir, name);
    if (existsSync(p)) sources.push(name);
  }
  if (sources.length === 0) {
    return {
      ok: false,
      projectId: CONTROL_PLANE_BACKUP_ID,
      notes: [tl('notes.auto.n0028'), 'no ysk.json/config.json under dataDir'],
      commandResults: [],
    };
  }

  const tarTimeoutMs = 120_000;
  const r = await input.host.runCommand(
    ['tar', '-czf', archivePath, '-C', dataDir, ...sources],
    { timeoutMs: tarTimeoutMs },
  );
  if (r.exitCode !== 0) {
    return {
      ok: false,
      projectId: CONTROL_PLANE_BACKUP_ID,
      notes: [tl('notes.auto.t0329', { v0: r.stderr || 'tar failed' })],
      commandResults: [
        { argv: ['tar', '-czf', archivePath, ...sources], exitCode: r.exitCode, stderr: r.stderr },
      ],
    };
  }

  let bytes = 0;
  try {
    bytes = statSync(archivePath).size;
  } catch {
    /* ignore */
  }

  // retention: keep last 20 control-plane archives
  const files = readdirSync(destDir)
    .filter((f) => f.endsWith('.tar.gz'))
    .sort()
    .reverse();
  for (const old of files.slice(20)) {
    try {
      unlinkSync(join(destDir, old));
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    projectId: CONTROL_PLANE_BACKUP_ID,
    archivePath,
    bytes,
    notes: [
      tl('notes.auto.t0330', { v0: archivePath }),
      `sources=${sources.join(',')}`,
      'control-plane only (not project homes)',
    ],
    commandResults: [{ argv: ['tar', '-czf', archivePath], exitCode: 0, stderr: '' }],
  };
}

/**
 * Restore control-plane archive into dataDir (ysk.json / config.json).
 * Default dry-run lists contents. Real restore requires confirmPhrase === RESTORE-CONTROL-PLANE.
 * Does not restart the API process — operator must reload/restart after restore.
 */
export async function restoreControlPlaneBackup(input: {
  host: HostExecutor;
  dataDir: string;
  archiveName: string;
  /** dry-run (default) | full */
  mode?: 'dry-run' | 'full';
  confirmPhrase?: string;
}): Promise<BackupResult> {
  const mode = input.mode ?? 'dry-run';
  const resolved = resolveManagedBackupArchive(
    input.dataDir,
    CONTROL_PLANE_BACKUP_ID,
    input.archiveName,
  );
  if (!resolved.ok) {
    throw new YskError(ErrorCodes.VALIDATION, resolved.notes[0] ?? tl('notes.auto.n1111'), {
      httpStatus: 400,
    });
  }
  const { path: archivePath, name: safeName } = resolved;
  if (!existsSync(archivePath)) {
    throw new YskError(ErrorCodes.NOT_FOUND, tl('notes.backup.fileNotFound'), { httpStatus: 404 });
  }

  if (mode === 'dry-run') {
    const r = await input.host.runCommand(['tar', '-tzf', archivePath], { timeoutMs: 60_000 });
    const listing = (r.stdout || '').split('\n').filter(Boolean).slice(0, 40);
    return {
      ok: r.exitCode === 0,
      archivePath,
      notes: [
        r.exitCode === 0
          ? tl('notes.auto.t0331', { v0: listing.length, v1: listing.length })
          : tl('notes.auto.t0332', { v0: r.stderr }),
        'dry-run only — pass mode=full + confirmPhrase=RESTORE-CONTROL-PLANE to write',
        ...listing.slice(0, 12).map((l) => `  ${l}`),
      ],
      commandResults: [{ argv: ['tar', '-tzf', archivePath], exitCode: r.exitCode, stderr: r.stderr }],
    };
  }

  if (input.confirmPhrase !== 'RESTORE-CONTROL-PLANE') {
    return {
      ok: false,
      archivePath,
      notes: [
        'refused: full control-plane restore requires confirmPhrase=RESTORE-CONTROL-PLANE',
        'restart API after a successful restore',
      ],
      commandResults: [],
    };
  }

  const dataDir = resolve(input.dataDir);
  const r = await input.host.runCommand(
    ['tar', '-xzf', archivePath, '-C', dataDir],
    { timeoutMs: 120_000 },
  );
  return {
    ok: r.exitCode === 0,
    archivePath,
    notes:
      r.exitCode === 0
        ? [
            tl('notes.auto.t0336', { v0: safeName }),
            'control-plane files written under dataDir — restart ysk-server to load',
          ]
        : [tl('notes.auto.t0335', { v0: r.stderr })],
    commandResults: [
      { argv: ['tar', '-xzf', archivePath, '-C', dataDir], exitCode: r.exitCode, stderr: r.stderr },
    ],
  };
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

/** One parsed line from a user crontab (host truth inventory). */
export type HostCronLineKind = 'job' | 'env' | 'comment' | 'unknown';
export type HostCronSource = 'ysk' | 'host';

export interface HostCronLine {
  user: string;
  projectId?: string;
  projectName?: string;
  schedule?: string;
  command?: string;
  raw: string;
  kind: HostCronLineKind;
  source: HostCronSource;
  managedJobId?: string;
}

export interface HostCronUserSlot {
  user: string;
  projectId?: string;
  projectName?: string;
  available: boolean;
  notes: string[];
  lineCount: number;
  jobCount: number;
}

export interface HostCronInventory {
  users: HostCronUserSlot[];
  lines: HostCronLine[];
  notes: string[];
  partial: boolean;
  isRoot: boolean;
  executeEnabled: boolean;
}

export function extractYskManagedId(text: string): string | undefined {
  const m = String(text || '').match(/#\s*ysk:([a-fA-F0-9-]{8,})/);
  return m?.[1];
}

export function classifyCronSource(raw: string): HostCronSource {
  const t = String(raw || '');
  if (/#\s*ysk:/i.test(t)) return 'ysk';
  if (/Generated by YSK Server/i.test(t)) return 'ysk';
  if (/\bysk-server\b/i.test(t) && /backup|cron/i.test(t)) return 'ysk';
  return 'host';
}

/**
 * Parse crontab -l text into structured lines (pure; no host I/O).
 */
export function parseCrontabText(
  user: string,
  text: string,
  meta?: { projectId?: string; projectName?: string },
): HostCronLine[] {
  const out: HostCronLine[] = [];
  const base = {
    user,
    projectId: meta?.projectId,
    projectName: meta?.projectName,
  };
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const t = line.trim();
    if (!t) continue;

    const source = classifyCronSource(line);
    const managedJobId = extractYskManagedId(line);

    if (t.startsWith('#')) {
      out.push({ ...base, raw: line, kind: 'comment', source, managedJobId });
      continue;
    }
    // Env assignments (MAILTO=..., PATH=...)
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) {
      out.push({ ...base, raw: line, kind: 'env', source: 'host', managedJobId });
      continue;
    }
    // @reboot / @daily / @hourly …
    if (t.startsWith('@')) {
      const sp = t.search(/\s+/);
      const schedule = sp > 0 ? t.slice(0, sp) : t;
      let command = sp > 0 ? t.slice(sp).trim() : '';
      command = command.replace(/\s+#\s*ysk:[^\s#]+/i, '').trim();
      out.push({
        ...base,
        raw: line,
        kind: 'job',
        schedule,
        command,
        source,
        managedJobId,
      });
      continue;
    }
    // Standard 5-field cron: min hour dom mon dow command…
    const m = t.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
    if (m) {
      let command = m[2] ?? '';
      command = command.replace(/\s+#\s*ysk:[^\s#]+/i, '').trim();
      out.push({
        ...base,
        raw: line,
        kind: 'job',
        schedule: m[1],
        command,
        source,
        managedJobId,
      });
      continue;
    }
    out.push({ ...base, raw: line, kind: 'unknown', source, managedJobId });
  }
  return out;
}

/**
 * Build user list for host crontab scan (root + unique project linux users).
 */
export function cronHostUserSlots(
  projects: Array<{
    id: string;
    name: string;
    linuxUser?: string;
    linux_user?: string;
  }>,
): Array<{ user: string; projectId?: string; projectName?: string }> {
  const out: Array<{ user: string; projectId?: string; projectName?: string }> = [
    { user: 'root' },
  ];
  const seen = new Set<string>(['root']);
  for (const p of projects) {
    const u = String(p.linuxUser ?? p.linux_user ?? '').trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push({ user: u, projectId: p.id, projectName: p.name });
  }
  return out;
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
      command });
    const now = new Date().toISOString();
    const row: CronJobRecord = {
      id: randomUUID(),
      project_id: input.projectId,
      user,
      schedule: input.schedule,
      command,
      enabled: true,
      created_at: now,
      updated_at: now };
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
      return { ok: false, notes: [tl('notes.auto.n0019')] };
    }
    if (!this.host.executeEnabled()) {
      return {
        ok: false,
        blocked: true,
        requiresExecute: true,
        notes: [tl('notes.auto.n1178')] };
    }
    const r = await this.host.runCommand(['bash', '-lc', row.command], {
      timeoutMs: 120_000 });
    void actor;
    return {
      ok: r.exitCode === 0,
      exitCode: r.exitCode,
      stdout: (r.stdout || '').slice(0, 4000),
      stderr: (r.stderr || '').slice(0, 4000),
      notes: [
        tl('notes.auto.t0338', { v0: (row.command) }),
        `exit=${r.exitCode}`,
        r.exitCode === 0 ? tl('notes.tpl.success') : tl('notes.failed'),
      ] };
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
      skipRunuserWrap: true });
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
   * Merges with existing host lines that are not YSK-managed (preserves operator jobs).
   * Never fakes success.
   */
  async installCrontab(actor: string): Promise<{
    ok: boolean;
    path: string;
    requiresExecute: boolean;
    notes: string[];
    blocked?: boolean;
    hostInstalled?: boolean;
    preservedHostLines?: number;
  }> {
    const managedPath = this.writeManagedCrontab();
    const notes = [tl('notes.auto.t0339', { v0: managedPath })];
    if (!this.host.executeEnabled()) {
      return {
        ok: false,
        path: managedPath,
        requiresExecute: true,
        blocked: true,
        hostInstalled: false,
        notes: [...notes, tl('notes.auto.n1165')] };
    }

    // Preserve non-YSK host crontab lines so install is not a silent full replace
    let preserved: string[] = [];
    try {
      const cur = await this.host.runCommand(['crontab', '-l'], { timeoutMs: 5_000 });
      if (cur.exitCode === 0 && cur.stdout) {
        preserved = cur.stdout
          .split('\n')
          .map((l) => l.replace(/\r$/, ''))
          .filter((l) => {
            const t = l.trim();
            if (!t) return false;
            if (t.startsWith('# Generated by YSK Server')) return false;
            if (/#\s*ysk:/i.test(t)) return false;
            if (/\bysk-server\b/.test(t) && /backup|cron/i.test(t)) return false;
            return true;
          });
      }
    } catch {
      preserved = [];
    }
    if (preserved.length > 0) {
      notes.push(tl('notes.cron.preserveHostLines', { count: preserved.length }));
    } else {
      notes.push(tl('notes.cron.noHostLinesOrEmpty'));
    }

    let managedBody = '';
    try {
      managedBody = readFileSync(managedPath, 'utf8');
    } catch {
      managedBody = '';
    }
    const merged = [
      '# YSK Server crontab merge — host (non-ysk) lines preserved above YSK block',
      ...preserved,
      '',
      managedBody.trimEnd(),
      '',
    ].join('\n');
    const mergePath = join(this.dataDir, 'cron', 'ysk.crontab.merged');
    mkdirSync(join(this.dataDir, 'cron'), { recursive: true });
    writeFileSync(mergePath, merged, 'utf8');

    const r = await this.host.runCommand(['crontab', mergePath], { timeoutMs: 10_000 });
    const ok = r.exitCode === 0;
    notes.push(ok ? tl('notes.auto.n0759') : tl('notes.auto.t0340', { v0: (r.stderr) }));
    if (ok) {
      notes.push(tl('notes.cron.installReplacesYskOnly'));
    }
    for (const j of this.db.snapshot.cron_jobs) {
      j.last_install = { ok, at: new Date().toISOString(), actor };
    }
    this.db.persist();
    return {
      ok,
      path: mergePath,
      requiresExecute: false,
      notes,
      hostInstalled: ok,
      preservedHostLines: preserved.length,
    };
  }

  /**
   * Read real host crontabs for root + project Linux users (Terminal-style inventory).
   * Non-root: only `crontab -l` for the control-plane process user (honest partial).
   */
  async listHostCrontabs(
    projects: Array<{
      id: string;
      name: string;
      linuxUser?: string;
      linux_user?: string;
    }> = [],
  ): Promise<HostCronInventory> {
    const executeEnabled = this.host.executeEnabled();
    const isRoot = this.host.isRoot();
    const notes: string[] = [];
    let partial = false;

    if (!executeEnabled) {
      notes.push(tl('notes.auto.n1165'));
      partial = true;
    }

    const users: HostCronUserSlot[] = [];
    const lines: HostCronLine[] = [];

    type Slot = { user: string; projectId?: string; projectName?: string };
    let slots: Slot[];

    if (isRoot) {
      slots = cronHostUserSlots(projects);
    } else {
      partial = true;
      notes.push(tl('notes.cron.hostScanNeedRoot'));
      // Single current-user crontab only
      slots = [{ user: 'current' }];
    }

    const readOne = async (
      slot: Slot,
    ): Promise<{
      slot: Slot;
      available: boolean;
      text: string;
      uNotes: string[];
      err: boolean;
    }> => {
      try {
        const argv =
          isRoot && slot.user !== 'current'
            ? ['crontab', '-u', slot.user, '-l']
            : ['crontab', '-l'];
        const r = await this.host.runCommand(argv, { timeoutMs: 5_000 });
        const stdout = String(r.stdout || '');
        const stderr = String(r.stderr || '');
        if (r.exitCode === 0) {
          return { slot, available: true, text: stdout, uNotes: [], err: false };
        }
        if (
          /no crontab/i.test(stderr) ||
          /no crontab/i.test(stdout) ||
          r.exitCode === 1
        ) {
          return { slot, available: true, text: '', uNotes: [], err: false };
        }
        return {
          slot,
          available: false,
          text: '',
          uNotes: [stderr.slice(0, 200) || `exit=${r.exitCode}`],
          err: true,
        };
      } catch (e) {
        return {
          slot,
          available: false,
          text: '',
          uNotes: [e instanceof Error ? e.message : String(e)],
          err: true,
        };
      }
    };

    const concurrency = 4;
    for (let i = 0; i < slots.length; i += concurrency) {
      const batch = slots.slice(i, i + concurrency);
      const results = await Promise.all(batch.map((s) => readOne(s)));
      for (const res of results) {
        if (res.err) partial = true;
        const labelUser = res.slot.user === 'current' ? 'current' : res.slot.user;
        const parsed = parseCrontabText(labelUser, res.text, {
          projectId: res.slot.projectId,
          projectName: res.slot.projectName,
        });
        lines.push(...parsed);
        users.push({
          user: labelUser,
          projectId: res.slot.projectId,
          projectName: res.slot.projectName,
          available: res.available,
          notes: res.uNotes,
          lineCount: parsed.length,
          jobCount: parsed.filter((l) => l.kind === 'job').length,
        });
      }
    }

    return {
      users,
      lines,
      notes,
      partial,
      isRoot,
      executeEnabled,
    };
  }

  /** Probe managed file vs host crontab (honest status). */
  async probeInstallStatus(): Promise<{
    managedPath: string;
    managedLines: number;
    enabledJobs: number;
    totalJobs: number;
    hostHasYskEntries: boolean | null;
    hostCrontabPreview: string;
    /** Non-YSK job lines on host crontab (honesty for operators) */
    hostOtherLines: number | null;
    hostTotalLines: number | null;
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
    let hostOtherLines: number | null = null;
    let hostTotalLines: number | null = null;
    try {
      const r = await this.host.runCommand(['crontab', '-l'], { timeoutMs: 5_000 });
      const text = `${r.stdout || ''}`;
      hostCrontabPreview = text.slice(0, 2000);
      if (r.exitCode === 0) {
        const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        hostTotalLines = lines.filter((l) => !l.startsWith('#')).length;
        hostHasYskEntries = /# ysk:/.test(text) || text.includes('ysk-server');
        hostOtherLines = lines.filter((l) => {
          if (l.startsWith('#')) return false;
          if (/#\s*ysk:/i.test(l)) return false;
          if (/\bysk-server\b/.test(l)) return false;
          return true;
        }).length;
      } else {
        hostHasYskEntries = false;
        hostOtherLines = 0;
        hostTotalLines = 0;
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
      hostOtherLines,
      hostTotalLines,
      executeEnabled: this.host.executeEnabled(),
      lastInstallOk: last?.ok ?? null,
      lastInstallAt: last?.at ?? null };
  }
}

function cronRows(db: YskDatabase): CronJobRecord[] {
  return (db.snapshot.cron_jobs ?? []) as unknown as CronJobRecord[];
}
