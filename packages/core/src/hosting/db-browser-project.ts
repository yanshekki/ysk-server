/**
 * Create a PHP project that hosts Adminer or phpMyAdmin (DB browser).
 * Used from MySQL/MariaDB “Adminer entry” — real project lifecycle + goLive.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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
    notes.push(tl('notes.auto.t0355', { v0: marker }));
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
    // Minimal config so setup is not forced (connect with DB credentials in UI)
    `if [ ! -f ${JSON.stringify(join(docRoot, 'config.inc.php'))} ]; then`,
    `  cat > ${JSON.stringify(join(docRoot, 'config.inc.php'))} <<'EOF'`,
    `<?php`,
    `$cfg['blowfish_secret'] = '${randomBlowfish()}';`,
    `$i = 0;`,
    `$i++;`,
    `$cfg['Servers'][$i]['auth_type'] = 'cookie';`,
    `$cfg['Servers'][$i]['host'] = '127.0.0.1';`,
    `$cfg['UploadDir'] = '';`,
    `$cfg['SaveDir'] = '';`,
    `EOF`,
    `fi`,
  ].join('\n');
  const r = await input.host.runCommand(['bash', '-c', script], { timeoutMs: 180_000 });
  if (r.exitCode !== 0 || !existsSync(marker)) {
    notes.push(
      `phpMyAdmin download/extract failed: ${(r.stderr || r.stdout || '').slice(0, 300)}`,
    );
    return { ok: false, notes, written, entryFile: 'index.php' };
  }
  written.push(docRoot);
  notes.push(`phpMyAdmin installed under ${docRoot}`);
  return { ok: true, notes, written, entryFile: 'index.php' };
}

function randomBlowfish(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars[Math.floor(Math.random() * chars.length)];
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
        `專案名稱已存在：${name}`,
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
  notes.push(`project created: ${created.project.id} (${name})`);
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
