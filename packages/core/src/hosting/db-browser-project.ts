/**
 * Create a PHP project that hosts Adminer or phpMyAdmin (DB browser).
 * Used from MySQL/MariaDB “Adminer entry” — real project lifecycle + goLive.
 */

import { chmodSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ErrorCodes, YskError, type ProjectDto, tl } from '@ysk/shared';
import type { HostExecutor } from '../host/executor.js';
import type { ProjectService } from './project-service.js';
import type { ProjectOpsService } from './project-ops.js';


export type DbBrowserTool = 'adminer' | 'phpmyadmin';

const ADMINER_URL =
  process.env.YSK_ADMINER_URL ??
  'https://github.com/vrana/adminer/releases/download/v4.8.1/adminer-4.8.1.php';

const PHPMYADMIN_URL =
  process.env.YSK_PHPMYADMIN_URL ??
  'https://files.phpmyadmin.net/phpMyAdmin/5.2.1/phpMyAdmin-5.2.1-all-languages.tar.gz';

export function normalizeDbBrowserTool(raw: unknown): DbBrowserTool {
  const t = String(raw ?? 'adminer').trim().toLowerCase();
  if (t === 'phpmyadmin' || t === 'pma') return 'phpmyadmin';
  return 'adminer';
}

export function defaultDbBrowserProjectName(tool: DbBrowserTool, engine?: string): string {
  const base = tool === 'phpmyadmin' ? 'phpmyadmin' : 'adminer';
  const eng = (engine ?? '').trim().toLowerCase();
  if (eng === 'mysql' || eng === 'mariadb') return `${base}-${eng}`;
  return base;
}

/**
 * Download Adminer or phpMyAdmin into project document root (app/public).
 */
export async function installDbBrowserIntoProject(input: {
  host: HostExecutor;
  homeDir: string;
  /** Absolute public dir; default home/app/public */
  docRoot?: string;
  tool: DbBrowserTool;
  download?: boolean;
}): Promise<{ ok: boolean; notes: string[]; written: string[]; entryFile: string }> {
  const notes: string[] = [];
  const written: string[] = [];
  const docRoot = input.docRoot ?? join(input.homeDir, 'app', 'public');
  mkdirSync(docRoot, { recursive: true });
  const download = input.download !== false;

  if (input.tool === 'adminer') {
    const path = join(docRoot, 'index.php');
    if (!download) {
      if (!existsSync(path) && !existsSync(join(docRoot, 'adminer.php'))) {
        return {
          ok: false,
          notes: [tl('notes.auto.n0074')],
          written,
          entryFile: 'index.php',
        };
      }
      notes.push(tl('notes.auto.t0355', { v0: path }));
      return { ok: true, notes, written, entryFile: 'index.php' };
    }
    if (!input.host.executeEnabled()) {
      writeFileSync(
        path,
        `<?php\necho "Adminer not downloaded — enable YSK_EXECUTE and re-run";\n`,
        'utf8',
      );
      written.push(path);
      return {
        ok: false,
        notes: [tl('notes.auto.n1141'), tl('notes.auto.t0351', { v0: path })],
        written,
        entryFile: 'index.php',
      };
    }
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `curl -fsSL ${JSON.stringify(ADMINER_URL)} -o ${JSON.stringify(path)}`,
      ],
      { timeoutMs: 120_000 },
    );
    if (r.exitCode !== 0 || !existsSync(path)) {
      notes.push(tl('notes.auto.t0353', { v0: (r.stderr || r.stdout || '').slice(0, 200) }));
      return { ok: false, notes, written, entryFile: 'index.php' };
    }
    written.push(path);
    notes.push(tl('notes.auto.t0354', { v0: path }));
    return { ok: true, notes, written, entryFile: 'index.php' };
  }

  // phpMyAdmin — extract all-languages tarball into docRoot
  const marker = join(docRoot, 'index.php');
  if (!download) {
    if (!existsSync(marker)) {
      return {
        ok: false,
        notes: [tl('notes.auto.n0074')],
        written,
        entryFile: 'index.php',
      };
    }
    // Repair cookie/HTTP config without re-download (fixes "Failed to set session cookie")
    const repaired = ensurePhpMyAdminRuntimeFiles(docRoot);
    written.push(...repaired.written);
    notes.push(tl('notes.auto.t0355', { v0: marker }), ...repaired.notes);
    return { ok: true, notes, written, entryFile: 'index.php' };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1141')],
      written,
      entryFile: 'index.php',
    };
  }
  const tmp = join(input.homeDir, 'tmp', 'pma.tgz');
  mkdirSync(join(input.homeDir, 'tmp'), { recursive: true });
  const pmaTmp = join(docRoot, 'tmp');
  const script = [
    `set -e`,
    `curl -fsSL ${JSON.stringify(PHPMYADMIN_URL)} -o ${JSON.stringify(tmp)}`,
    `rm -rf ${JSON.stringify(join(docRoot, '.pma-extract'))}`,
    `mkdir -p ${JSON.stringify(join(docRoot, '.pma-extract'))}`,
    `tar -xzf ${JSON.stringify(tmp)} -C ${JSON.stringify(join(docRoot, '.pma-extract'))}`,
    // Flatten phpMyAdmin-*-all-languages/* into docRoot
    `INNER=$(find ${JSON.stringify(join(docRoot, '.pma-extract'))} -maxdepth 1 -type d -name 'phpMyAdmin-*' | head -1)`,
    `if [ -z "$INNER" ]; then echo "phpMyAdmin extract failed"; exit 1; fi`,
    `shopt -s dotglob`,
    `cp -a "$INNER"/* ${JSON.stringify(docRoot)}/`,
    `rm -rf ${JSON.stringify(join(docRoot, '.pma-extract'))} ${JSON.stringify(tmp)}`,
    `mkdir -p ${JSON.stringify(pmaTmp)}`,
    `chmod 777 ${JSON.stringify(pmaTmp)}`,
  ].join('\n');
  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 180_000 });
  if (r.exitCode !== 0 || !existsSync(marker)) {
    notes.push(
      tl('notes.dbBrowser.pmaExtractFailed', {
        detail: (r.stderr || r.stdout || '').slice(0, 300),
      }),
    );
    return { ok: false, notes, written, entryFile: 'index.php' };
  }
  const runtime = ensurePhpMyAdminRuntimeFiles(docRoot);
  written.push(docRoot, ...runtime.written);
  notes.push(tl('notes.dbBrowser.pmaInstalled', { path: docRoot }), ...runtime.notes);
  return { ok: true, notes, written, entryFile: 'index.php' };
}

/** Write/refresh config.inc.php, tmp/, .user.ini for cookie login over HTTP. */
export function ensurePhpMyAdminRuntimeFiles(docRoot: string): {
  written: string[];
  notes: string[];
} {
  const written: string[] = [];
  const notes: string[] = [];
  const pmaTmp = join(docRoot, 'tmp');
  const configPath = join(docRoot, 'config.inc.php');
  const userIniPath = join(docRoot, '.user.ini');
  mkdirSync(pmaTmp, { recursive: true });
  try {
    // world-writable so www-data can session even if owner is panel user
    chmodSync(pmaTmp, 0o777);
  } catch {
    /* best-effort */
  }
  writeFileSync(configPath, buildPhpMyAdminConfigInc(randomBlowfish()), 'utf8');
  writeFileSync(
    userIniPath,
    [
      '; YSK-managed: phpMyAdmin cookie login over HTTP needs non-secure sessions',
      'session.cookie_secure = 0',
      'session.cookie_samesite = "Lax"',
      'session.cookie_httponly = 1',
      '',
    ].join('\n'),
    'utf8',
  );
  written.push(configPath, userIniPath, pmaTmp);
  notes.push(tl('notes.dbBrowser.pmaConfigWritten'));
  return { written, notes };
}

/**
 * Managed phpMyAdmin config — cookie auth to local MySQL/MariaDB.
 * HTTP-safe: ForceSSL off, writable TempDir (session cookies fail without it).
 */
export function buildPhpMyAdminConfigInc(blowfishSecret: string): string {
  const secret = String(blowfishSecret || randomBlowfish()).replace(/'/g, '');
  return `<?php
/**
 * YSK-managed phpMyAdmin config (cookie auth → 127.0.0.1).
 * Do not use the web installer. Log in with MySQL/MariaDB user + password.
 */
$cfg['blowfish_secret'] = '${secret}';
$i = 0;
$i++;
$cfg['Servers'][$i]['auth_type'] = 'cookie';
$cfg['Servers'][$i]['host'] = '127.0.0.1';
$cfg['Servers'][$i]['compress'] = false;
$cfg['Servers'][$i]['AllowNoPassword'] = false;
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
/* Session / cookies fail with "Failed to set session cookie" if TempDir is missing */
$cfg['TempDir'] = __DIR__ . '/tmp';
/* Panel domains often start on HTTP; enable SSL on the project when ready */
$cfg['ForceSSL'] = false;
$cfg['CheckConfigurationPermissions'] = false;
$cfg['LoginCookieValidity'] = 1440;
$cfg['LoginCookieStore'] = 0;
$cfg['LoginCookieDeleteAll'] = true;
`;
}

function randomBlowfish(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)]!;
  return s;
}

/**
 * Create PHP project + install Adminer/phpMyAdmin + goLive (deploy + nginx).
 */
export async function createDbBrowserProject(input: {
  projects: ProjectService;
  projectOps: ProjectOpsService;
  host: HostExecutor;
  actor: string;
  actorUserId?: string;
  /** Project display name — unique */
  name: string;
  domain: string;
  tool: DbBrowserTool;
  download?: boolean;
  /** engine hint for default naming only */
  engine?: string;
}): Promise<{
  ok: boolean;
  project?: ProjectDto;
  projectId?: string;
  urlHint?: string;
  notes: string[];
  written: string[];
  blocked?: boolean;
  blockMessage?: string;
  requiresExecute?: boolean;
  requiresRoot?: boolean;
  apply_status: 'applied' | 'written' | 'blocked' | 'failed';
}> {
  const notes: string[] = [];
  const written: string[] = [];
  const name = input.name.trim();
  const domain = input.domain.trim().toLowerCase();
  const tool = normalizeDbBrowserTool(input.tool);

  if (!name) {
    throw new YskError(ErrorCodes.VALIDATION, tl('notes.needProjectName'), { httpStatus: 400 });
  }
  if (!domain) {
    throw new YskError(ErrorCodes.VALIDATION, 'Domain is required', { httpStatus: 400 });
  }

  // Explicit pre-check for clear operator message (create also enforces)
  const existing = input.projects.list().find(
    (p) => p.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    return {
      ok: false,
      notes: [
        tl('notes.ops.projectNameExists', { name }),
        `existingProjectId=${existing.id}`,
      ],
      written,
      apply_status: 'failed',
    };
  }

  let created: Awaited<ReturnType<ProjectService['create']>>;
  try {
    created = await input.projects.create({
      name,
      domain,
      runtime: 'php',
      templateId: 'php-hello',
      forceTemplate: true,
      actor: input.actor,
      actorUserId: input.actorUserId,
    });
  } catch (e) {
    if (e instanceof YskError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, notes: [msg], written, apply_status: 'failed' };
  }
  notes.push(
    tl('notes.dbBrowser.projectCreated', { id: created.project.id, name }),
  );
  if (created.scaffold?.notes?.length) notes.push(...created.scaffold.notes.slice(0, 4));

  const row = input.projects.get(created.project.id);
  const docRoot = join(row.homeDir, (row.docRoot || 'app/public').replace(/^\//, ''));

  // Clear hello world for browser tool
  try {
    const hello = join(docRoot, 'index.php');
    if (existsSync(hello)) rmSync(hello, { force: true });
  } catch {
    /* best-effort */
  }

  const inst = await installDbBrowserIntoProject({
    host: input.host,
    homeDir: row.homeDir,
    docRoot,
    tool,
    download: input.download !== false,
  });
  notes.push(...inst.notes);
  written.push(...inst.written);
  if (!inst.ok) {
    return {
      ok: false,
      project: row,
      projectId: row.id,
      notes,
      written,
      urlHint: `http://${domain}/`,
      apply_status: 'failed',
    };
  }

  const live = await input.projectOps.goLive(row.id, { actor: input.actor });
  notes.push(...(live.notes ?? []).slice(0, 16));
  const fresh = input.projects.get(row.id);
  const ok = Boolean(live.ok) && inst.ok;
  return {
    ok,
    project: fresh,
    projectId: fresh.id,
    urlHint: `http://${domain}/`,
    notes,
    written,
    blocked: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
    requiresExecute: Boolean(live.deploy?.requiresExecute || live.publish?.requiresExecute),
    requiresRoot: Boolean(live.deploy?.requiresRoot || live.publish?.requiresRoot),
    apply_status: ok ? 'applied' : live.ok === false ? 'failed' : 'written',
  };
}
