/**
 * Remote backup destination + exclusion list (panel settings).
 */

import type { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
import { existsSync } from 'node:fs';

export type BackupRemoteSettings = {
  enabled: boolean;
  kind: 'sftp' | 'local' | 's3';
  host?: string;
  port?: number;
  username?: string;
  path?: string;
  password?: string;
  /** S3: bucket name or s3://bucket/prefix */
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
};

export function getBackupRemote(db: JsonStore): BackupRemoteSettings {
  return (
    db.snapshot.backup_remote ?? {
      enabled: false,
      kind: 'sftp',
      port: 22,
      path: '/backups/ysk',
    }
  );
}

/** Public view — never return stored password plaintext. */
export function getBackupRemotePublic(db: JsonStore): BackupRemoteSettings {
  const r = getBackupRemote(db);
  return {
    ...r,
    password: r.password ? '***' : undefined,
    awsSecretAccessKey: r.awsSecretAccessKey ? '***' : undefined,
  };
}

export function setBackupRemote(
  db: JsonStore,
  patch: Partial<BackupRemoteSettings>,
): BackupRemoteSettings {
  const prev = getBackupRemote(db);
  const next = { ...prev, ...patch };
  // Empty password in patch means keep previous (UI leaves blank when masked)
  if (patch.password === '' || patch.password === undefined) {
    next.password = prev.password;
  }
  if (patch.password === '***') {
    next.password = prev.password;
  }
  if (patch.awsSecretAccessKey === '' || patch.awsSecretAccessKey === undefined) {
    next.awsSecretAccessKey = prev.awsSecretAccessKey;
  }
  if (patch.awsSecretAccessKey === '***') {
    next.awsSecretAccessKey = prev.awsSecretAccessKey;
  }
  db.snapshot.backup_remote = next;
  db.persist();
  return getBackupRemotePublic(db);
}

export function getBackupExclusions(db: JsonStore): string[] {
  return [...(db.snapshot.backup_exclusions ?? [])];
}

export function setBackupExclusions(db: JsonStore, patterns: string[]): string[] {
  const cleaned = patterns.map((p) => p.trim()).filter(Boolean);
  db.snapshot.backup_exclusions = cleaned;
  db.persist();
  return cleaned;
}

/**
 * After local backup, optionally scp to remote (needs execute + sshpass or key auth).
 */
export async function pushBackupRemote(input: {
  host: HostExecutor;
  db: JsonStore;
  localArchivePath: string;
}): Promise<{ ok: boolean; notes: string[] }> {
  const remote = getBackupRemote(input.db);
  if (!remote.enabled) {
    return { ok: true, notes: ['遠端備份未啟用'] };
  }
  if (!existsSync(input.localArchivePath)) {
    return { ok: false, notes: ['本地備份檔不存在'] };
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: ['無法推送遠端：未開啟系統變更權限（本地備份仍成功）'],
    };
  }
  if (remote.kind === 'local' && remote.path) {
    const r = await input.host.runCommand(
      ['bash', '-c', `mkdir -p ${JSON.stringify(remote.path)} && cp ${JSON.stringify(input.localArchivePath)} ${JSON.stringify(remote.path)}/`],
      { timeoutMs: 120_000 },
    );
    return {
      ok: r.exitCode === 0,
      notes: [
        r.exitCode === 0
          ? `已複製到本機路徑 ${remote.path}`
          : `複製失敗: ${r.stderr || r.stdout}`,
      ],
    };
  }
  if (remote.kind === 's3') {
    return pushBackupS3(input.host, remote, input.localArchivePath);
  }
  if (!remote.host || !remote.username || !remote.path) {
    return { ok: false, notes: ['遠端 SFTP 設定不完整（host/username/path）'] };
  }
  const port = remote.port ?? 22;
  const dest = `${remote.username}@${remote.host}:${remote.path}/`;
  // Prefer scp; with password use sshpass if available
  if (remote.password) {
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `command -v sshpass >/dev/null && sshpass -p ${JSON.stringify(remote.password)} scp -o StrictHostKeyChecking=no -P ${port} ${JSON.stringify(input.localArchivePath)} ${JSON.stringify(dest)} || echo NEED_SSHPASS`,
      ],
      { timeoutMs: 180_000 },
    );
    const out = (r.stdout || '') + (r.stderr || '');
    if (out.includes('NEED_SSHPASS')) {
      return {
        ok: false,
        notes: ['需要 sshpass 或改用 SSH key 做 scp'],
      };
    }
    return {
      ok: r.exitCode === 0,
      notes: [r.exitCode === 0 ? `已 scp 到 ${dest}` : `scp 失敗: ${out.slice(0, 300)}`],
    };
  }
  const r = await input.host.runCommand(
    [
      'scp',
      '-o',
      'StrictHostKeyChecking=no',
      '-P',
      String(port),
      input.localArchivePath,
      dest,
    ],
    { timeoutMs: 180_000 },
  );
  return {
    ok: r.exitCode === 0,
    notes: [r.exitCode === 0 ? `已 scp 到 ${dest}` : `scp 失敗: ${r.stderr || r.stdout}`],
  };
}

async function pushBackupS3(
  host: HostExecutor,
  remote: BackupRemoteSettings,
  localPath: string,
): Promise<{ ok: boolean; notes: string[] }> {
  const bucket = (remote.s3Bucket || remote.path || '').trim();
  if (!bucket) {
    return { ok: false, notes: ['S3 bucket/path 未設定'] };
  }
  const region = remote.s3Region || 'us-east-1';
  const dest = bucket.startsWith('s3://')
    ? `${bucket.replace(/\/$/, '')}/`
    : `s3://${bucket.replace(/^s3:\/\//, '').replace(/\/$/, '')}/`;
  const env: string[] = [
    `AWS_DEFAULT_REGION=${JSON.stringify(region)}`,
  ];
  if (remote.awsAccessKeyId) {
    env.push(`AWS_ACCESS_KEY_ID=${JSON.stringify(remote.awsAccessKeyId)}`);
  }
  if (remote.awsSecretAccessKey) {
    env.push(`AWS_SECRET_ACCESS_KEY=${JSON.stringify(remote.awsSecretAccessKey)}`);
  }
  if (remote.s3Endpoint) {
    env.push(`AWS_ENDPOINT_URL=${JSON.stringify(remote.s3Endpoint)}`);
  }
  const envPrefix = env.map((e) => `export ${e}`).join('; ') + ';';
  // Prefer aws cli; fallback restic-less message
  const r = await host.runCommand(
    [
      'bash',
      '-c',
      `${envPrefix} command -v aws >/dev/null && aws s3 cp ${JSON.stringify(localPath)} ${JSON.stringify(dest)} 2>&1 || echo NEED_AWS_CLI`,
    ],
    { timeoutMs: 300_000 },
  );
  const out = (r.stdout || '') + (r.stderr || '');
  if (out.includes('NEED_AWS_CLI')) {
    return {
      ok: false,
      notes: ['需要 aws CLI（或改用 restic s3 repo）'],
    };
  }
  return {
    ok: r.exitCode === 0,
    notes: [r.exitCode === 0 ? `已上傳 S3 ${dest}` : `S3 失敗: ${out.slice(0, 300)}`],
  };
}
