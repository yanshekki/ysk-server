/**
 * Restic-class incremental backup under dataDir (fail-closed, honest notes).
 */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../host/executor.js';
import type { JsonStore } from '../db/store.js';

export type ResticSettings = {
  enabled: boolean;
  /** local restic repo path */
  repoPath?: string;
  /** restic password (stored control-plane; prefer env in prod) */
  password?: string;
  /** optional: s3:s3.amazonaws.com/bucket/path */
  s3Repo?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
};

const KEY = 'restic_settings';

export function getResticSettings(db: JsonStore): ResticSettings {
  try {
    const raw = db.snapshot.settings?.[KEY];
    if (raw) return JSON.parse(raw) as ResticSettings;
  } catch {
    /* ignore */
  }
  return { enabled: false };
}

export function getResticSettingsPublic(db: JsonStore): ResticSettings {
  const s = getResticSettings(db);
  return {
    ...s,
    password: s.password ? '***' : undefined,
    awsSecretAccessKey: s.awsSecretAccessKey ? '***' : undefined,
  };
}

export function setResticSettings(
  db: JsonStore,
  patch: Partial<ResticSettings>,
): ResticSettings {
  const prev = getResticSettings(db);
  const next = { ...prev, ...patch };
  if (!patch.password || patch.password === '***') next.password = prev.password;
  if (!patch.awsSecretAccessKey || patch.awsSecretAccessKey === '***') {
    next.awsSecretAccessKey = prev.awsSecretAccessKey;
  }
  db.snapshot.settings[KEY] = JSON.stringify(next);
  db.persist();
  return getResticSettingsPublic(db);
}

export async function resticBackupProject(input: {
  host: HostExecutor;
  dataDir: string;
  db: JsonStore;
  projectId: string;
  homeDir: string;
}): Promise<{ ok: boolean; notes: string[]; snapshotId?: string; blocked?: boolean }> {
  const settings = getResticSettings(input.db);
  if (!settings.enabled) {
    return { ok: true, notes: ['restic 未啟用（略過增量）'] };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      notes: ['無法 restic：未開啟系統變更權限'],
    };
  }
  const check = await input.host.runCommand(['bash', '-c', 'command -v restic || true'], {
    timeoutMs: 3_000,
  });
  if (!check.stdout.trim()) {
    return {
      ok: false,
      notes: ['restic 不在 PATH — apt install restic 後再試'],
    };
  }

  const defaultRepo = join(input.dataDir, 'restic-repo');
  const repo = settings.s3Repo || settings.repoPath || defaultRepo;
  const password = settings.password || 'ysk-restic-change-me';
  mkdirSync(defaultRepo, { recursive: true });

  const envPrefix = buildResticEnv(settings, password, repo);
  // init if needed
  const init = await input.host.runCommand(
    [
      'bash',
      '-c',
      `${envPrefix} restic snapshots >/dev/null 2>&1 || restic init 2>&1`,
    ],
    { timeoutMs: 60_000 },
  );
  const notes = [`repo=${repo}`, (init.stdout || init.stderr || '').slice(0, 200)];

  if (!existsSync(input.homeDir)) {
    return { ok: false, notes: [...notes, `home 不存在: ${input.homeDir}`] };
  }

  const tag = `project:${input.projectId}`;
  const backup = await input.host.runCommand(
    [
      'bash',
      '-c',
      `${envPrefix} restic backup ${JSON.stringify(input.homeDir)} --tag ${JSON.stringify(tag)} --host ysk 2>&1`,
    ],
    { timeoutMs: 600_000 },
  );
  const out = (backup.stdout || backup.stderr || '').slice(0, 500);
  notes.push(out);
  const snapMatch = out.match(/snapshot\s+([a-f0-9]+)\s+saved/i);
  const ok = backup.exitCode === 0;
  // write last restic note
  const metaDir = join(input.dataDir, 'backups', input.projectId);
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, 'last-restic.json'),
    JSON.stringify({
      at: new Date().toISOString(),
      ok,
      snapshotId: snapMatch?.[1],
      repo,
      notes,
    }),
    'utf8',
  );
  return {
    ok,
    notes: ok
      ? [...notes, 'restic 增量備份完成（written/applied 視 restic exit）']
      : [...notes, `restic exit=${backup.exitCode}`],
    snapshotId: snapMatch?.[1],
  };
}

function buildResticEnv(settings: ResticSettings, password: string, repo: string): string {
  const parts = [
    `export RESTIC_PASSWORD=${JSON.stringify(password)}`,
    `export RESTIC_REPOSITORY=${JSON.stringify(repo)}`,
  ];
  if (settings.s3Repo && settings.awsAccessKeyId) {
    parts.push(`export AWS_ACCESS_KEY_ID=${JSON.stringify(settings.awsAccessKeyId)}`);
    if (settings.awsSecretAccessKey) {
      parts.push(
        `export AWS_SECRET_ACCESS_KEY=${JSON.stringify(settings.awsSecretAccessKey)}`,
      );
    }
  }
  return parts.join('; ') + ';';
}

export type ResticSnapshot = {
  id: string;
  time?: string;
  hostname?: string;
  tags?: string[];
  paths?: string[];
};

/**
 * List restic snapshots (JSON). Optional tag filter project:<id>.
 */
export async function listResticSnapshots(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  projectId?: string;
}): Promise<{ ok: boolean; snapshots: ResticSnapshot[]; notes: string[]; blocked?: boolean }> {
  const settings = getResticSettings(input.db);
  if (!settings.enabled) {
    return { ok: true, snapshots: [], notes: ['restic 未啟用'] };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      snapshots: [],
      blocked: true,
      notes: ['無法 list：未開啟系統變更權限'],
    };
  }
  const check = await input.host.runCommand(['bash', '-c', 'command -v restic || true'], {
    timeoutMs: 3_000,
  });
  if (!check.stdout.trim()) {
    return { ok: false, snapshots: [], notes: ['restic 不在 PATH'] };
  }
  const defaultRepo = join(input.dataDir, 'restic-repo');
  const repo = settings.s3Repo || settings.repoPath || defaultRepo;
  const password = settings.password || 'ysk-restic-change-me';
  const envPrefix = buildResticEnv(settings, password, repo);
  const tagArg = input.projectId
    ? ` --tag ${JSON.stringify(`project:${input.projectId}`)}`
    : '';
  const r = await input.host.runCommand(
    ['bash', '-c', `${envPrefix} restic snapshots --json${tagArg} 2>/dev/null || echo '[]'`],
    { timeoutMs: 60_000 },
  );
  let snapshots: ResticSnapshot[] = [];
  try {
    const raw = JSON.parse(r.stdout.trim() || '[]') as Array<Record<string, unknown>>;
    snapshots = raw.map((s) => ({
      id: String(s.short_id ?? s.id ?? '').slice(0, 16),
      time: s.time ? String(s.time) : undefined,
      hostname: s.hostname ? String(s.hostname) : undefined,
      tags: Array.isArray(s.tags) ? (s.tags as string[]) : undefined,
      paths: Array.isArray(s.paths) ? (s.paths as string[]) : undefined,
    }));
  } catch {
    return {
      ok: false,
      snapshots: [],
      notes: [`無法解析 snapshots JSON: ${(r.stderr || r.stdout).slice(0, 200)}`],
    };
  }
  return {
    ok: true,
    snapshots,
    notes: [`${snapshots.length} snapshots`],
  };
}

/** Required confirm phrase when overwriteHome is true */
export const RESTIC_OVERWRITE_CONFIRM = 'OVERWRITE';

/**
 * Restore a restic snapshot into targetDir (default: homeDir/.restic-restore).
 * Does NOT overwrite live site unless overwriteHome + confirmPhrase.
 * dryRun: list snapshot paths only (restic ls), no file writes.
 */
export async function resticRestoreProject(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir: string;
  projectId: string;
  homeDir: string;
  snapshotId: string;
  /** Restore destination; default homeDir/.restic-restore-<id> */
  targetDir?: string;
  /** Allow writing into homeDir root (destructive) */
  overwriteHome?: boolean;
  /** Must equal RESTIC_OVERWRITE_CONFIRM when overwriteHome */
  confirmPhrase?: string;
  /** List only — no restore */
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  notes: string[];
  targetDir?: string;
  blocked?: boolean;
  dryRun?: boolean;
  paths?: string[];
}> {
  const settings = getResticSettings(input.db);
  if (!settings.enabled) {
    return { ok: false, notes: ['restic 未啟用'] };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      notes: ['無法 restore：未開啟系統變更權限'],
    };
  }
  const snap = input.snapshotId.replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
  if (!snap) return { ok: false, notes: ['無效 snapshot id'] };

  if (input.overwriteHome) {
    if (input.confirmPhrase !== RESTIC_OVERWRITE_CONFIRM) {
      return {
        ok: false,
        blocked: true,
        notes: [
          `覆寫 home 需 confirmPhrase="${RESTIC_OVERWRITE_CONFIRM}"（雙重確認）`,
          '否則只允許還原到 .restic-restore-* 安全目錄',
        ],
      };
    }
  }

  const check = await input.host.runCommand(['bash', '-c', 'command -v restic || true'], {
    timeoutMs: 3_000,
  });
  if (!check.stdout.trim()) {
    return { ok: false, notes: ['restic 不在 PATH'] };
  }

  const defaultRepo = join(input.dataDir, 'restic-repo');
  const repo = settings.s3Repo || settings.repoPath || defaultRepo;
  const password = settings.password || 'ysk-restic-change-me';
  const envPrefix = buildResticEnv(settings, password, repo);

  // Dry-run: restic ls snapshot (paths only)
  if (input.dryRun) {
    const ls = await input.host.runCommand(
      [
        'bash',
        '-c',
        `${envPrefix} restic ls ${JSON.stringify(snap)} 2>&1 | head -n 200`,
      ],
      { timeoutMs: 120_000 },
    );
    const lines = (ls.stdout || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 100);
    return {
      ok: ls.exitCode === 0,
      dryRun: true,
      paths: lines,
      notes:
        ls.exitCode === 0
          ? [
              `dry-run：snapshot ${snap} 含 ${lines.length} 條路徑（最多顯示 100）`,
              '未寫入任何檔案',
              '狀態：preview only',
            ]
          : [`dry-run 失敗: ${(ls.stderr || ls.stdout).slice(0, 300)}`],
    };
  }

  let target =
    input.targetDir?.trim() ||
    join(input.homeDir, `.restic-restore-${snap.slice(0, 8)}`);
  if (input.overwriteHome) {
    target = input.homeDir;
  }
  if (target === input.homeDir && !input.overwriteHome) {
    return {
      ok: false,
      notes: ['拒絕覆寫 homeDir — 請設 overwriteHome + confirmPhrase 或改用安全目標目錄'],
    };
  }

  mkdirSync(target === input.homeDir ? input.homeDir : target, { recursive: true });
  const r = await input.host.runCommand(
    [
      'bash',
      '-c',
      `${envPrefix} restic restore ${JSON.stringify(snap)} --target ${JSON.stringify(target)} 2>&1`,
    ],
    { timeoutMs: 600_000 },
  );
  const out = (r.stdout || r.stderr || '').slice(0, 500);
  const ok = r.exitCode === 0;
  return {
    ok,
    targetDir: target,
    notes: ok
      ? [
          `已還原 snapshot ${snap} → ${target}`,
          out,
          input.overwriteHome
            ? '狀態：applied（已覆寫 homeDir）'
            : '狀態：applied（安全目錄）',
        ]
      : [`restore 失敗 exit=${r.exitCode}`, out],
  };
}

