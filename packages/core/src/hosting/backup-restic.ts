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
