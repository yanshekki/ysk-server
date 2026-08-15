import { tl } from 'ysk-server-shared';
/**
 * Remote backup destination + exclusion list (panel settings).
 */

import type { JsonStore } from '../db/store.js';
import type { HostExecutor } from '../host/executor.js';
import { existsSync } from 'node:fs';
import { shellBinExists } from './software-probe/index.js';
import { assertSafeOutboundUrl, isMetadataOrLoopbackHost } from '../net/ssrf.js';

export type BackupRemoteSettings = {
  enabled: boolean;
  kind: 'sftp' | 'local' | 's3';
  host?: string;
  port?: number;
  username?: string;
  path?: string;
  password?: string;
  /** SSH identity vault id — preferred over password for scp */
  identityId?: string;
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
 * After local backup, optionally scp to remote (needs execute + identity / sshpass / default key).
 */
export type BackupRemoteTestResult = {
  ok: boolean;
  notes: string[];
  kind?: BackupRemoteSettings['kind'];
  blocked?: boolean;
  requiresExecute?: boolean;
};

/** Probe remote destination. Completeness is free; live connect needs EXECUTE. */
export async function testBackupRemote(input: {
  host: HostExecutor;
  db: JsonStore;
  dataDir?: string;
  /** Form values — not persisted. Empty / *** secrets keep the store. */
  overlay?: Partial<BackupRemoteSettings>;
}): Promise<BackupRemoteTestResult> {
  const stored = getBackupRemote(input.db);
  const remote: BackupRemoteSettings = { ...stored, ...(input.overlay ?? {}) };
  if (input.overlay) {
    if (input.overlay.password === '' || input.overlay.password === '***' || input.overlay.password === undefined) {
      remote.password = stored.password;
    }
    if (
      input.overlay.awsSecretAccessKey === '' ||
      input.overlay.awsSecretAccessKey === '***' ||
      input.overlay.awsSecretAccessKey === undefined
    ) {
      remote.awsSecretAccessKey = stored.awsSecretAccessKey;
    }
  }
  if (!remote.enabled) {
    return { ok: false, notes: [tl('notes.auto.n1479')], kind: remote.kind };
  }
  const notesPrefix =
    input.overlay && stored.enabled !== remote.enabled
      ? [tl('notes.backup.testUnsaved')]
      : [];
  if (remote.kind === 'sftp' && (!remote.host || !remote.username || !remote.path)) {
    return { ok: false, notes: [...notesPrefix, tl('notes.auto.n1474')], kind: remote.kind };
  }
  if (remote.kind === 's3' && !(remote.s3Bucket || remote.path || '').trim()) {
    return { ok: false, notes: [...notesPrefix, tl('notes.auto.n0179')], kind: remote.kind };
  }
  if (remote.kind === 'local' && !(remote.path || '').trim()) {
    return { ok: false, notes: [...notesPrefix, tl('notes.auto.n1474')], kind: remote.kind };
  }
  if (remote.kind === 'sftp' && remote.host && isMetadataOrLoopbackHost(remote.host)) {
    return { ok: false, kind: 'sftp', notes: [...notesPrefix, tl('notes.auto.n0303')] };
  }
  if (remote.kind === 's3' && remote.s3Endpoint?.trim()) {
    try {
      assertSafeOutboundUrl(remote.s3Endpoint.trim(), {
        field: 's3Endpoint',
        policy: 'strict',
      });
    } catch {
      return { ok: false, kind: 's3', notes: [...notesPrefix, tl('notes.auto.n0303')] };
    }
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      blocked: true,
      requiresExecute: true,
      kind: remote.kind,
      notes: [...notesPrefix, tl('notes.auto.n1173')],
    };
  }

  if (remote.kind === 'local' && remote.path) {
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `mkdir -p ${JSON.stringify(remote.path)} && test -w ${JSON.stringify(remote.path)}`,
      ],
      { timeoutMs: 15_000 },
    );
    return {
      ok: r.exitCode === 0,
      kind: 'local',
      notes: [
        r.exitCode === 0
          ? tl('notes.auto.t0374', { v0: remote.path })
          : tl('notes.tpl.copyFailed2', { detail: r.stderr || r.stdout }),
      ],
    };
  }

  if (remote.kind === 's3') {
    const bucket = (remote.s3Bucket || remote.path || '').trim();
    const dest = bucket.startsWith('s3://')
      ? bucket.replace(/\/$/, '')
      : `s3://${bucket.replace(/^s3:\/\//, '').replace(/\/$/, '')}`;
    const region = remote.s3Region || 'us-east-1';
    const env: string[] = [`AWS_DEFAULT_REGION=${JSON.stringify(region)}`];
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
    const r = await input.host.runCommand(
      [
        'bash',
        '-c',
        `${envPrefix} if ${shellBinExists('aws')}; then aws s3 ls ${JSON.stringify(dest)} 2>&1; else echo NEED_AWS_CLI; fi`,
      ],
      { timeoutMs: 30_000 },
    );
    const out = (r.stdout || '') + (r.stderr || '');
    if (out.includes('NEED_AWS_CLI')) {
      return { ok: false, kind: 's3', notes: [tl('notes.auto.n1560')] };
    }
    return {
      ok: r.exitCode === 0,
      kind: 's3',
      notes: [
        r.exitCode === 0
          ? tl('notes.auto.t0382', { v0: dest })
          : tl('notes.auto.t0383', { v0: out.slice(0, 300) }),
      ],
    };
  }

  return probeSftpRemote({
    host: input.host,
    remote,
    dataDir: input.dataDir,
    notesPrefix,
  });
}

function sftpPasswordArgv(input: {
  password: string;
  port: number;
  spec: string;
  batch: string;
}): string[] {
  const sftp = [
    'sftp',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=8',
    '-P',
    String(input.port),
    '-b',
    '-',
    input.spec,
  ];
  return [
    'bash',
    '-c',
    `if ${shellBinExists('sshpass')}; then printf %s ${JSON.stringify(input.batch.endsWith('\n') ? input.batch : `${input.batch}\n`)} | sshpass -p ${JSON.stringify(input.password)} ${sftp.map((a) => JSON.stringify(a)).join(' ')}; else echo NEED_SSHPASS; fi`,
  ];
}

async function probeSftpRemote(input: {
  host: HostExecutor;
  remote: BackupRemoteSettings;
  dataDir?: string;
  notesPrefix: string[];
}): Promise<BackupRemoteTestResult> {
  const port = input.remote.port ?? 22;
  const spec = `${input.remote.username}@${input.remote.host}`;
  const identityId = input.remote.identityId?.trim();
  const {
    resolveIdentityKeyPath,
    buildSftpIdentityArgv,
    sftpStdinArgv,
  } = await import('../security/ssh-identity/ops.js');
  if (identityId && input.dataDir) {
    const key = resolveIdentityKeyPath(input.dataDir, identityId);
    if (!key.ok || !key.path) {
      return {
        ok: false,
        kind: 'sftp',
        notes: [
          ...input.notesPrefix,
          tl('notes.auto.t0375', {
            v0: identityId,
            v1: (key.notes ?? []).join('; ') || tl('notes.tpl.unavailable'),
          }),
        ],
      };
    }
    const argv = sftpStdinArgv(
      buildSftpIdentityArgv(key.path, { port, userAtHost: spec }),
      'pwd\n',
    );
    const r = await input.host.runCommand(argv, { timeoutMs: 20_000 });
    return {
      ok: r.exitCode === 0,
      kind: 'sftp',
      notes: [
        ...input.notesPrefix,
        r.exitCode === 0
          ? tl('notes.backup.testIdentity', { spec })
          : tl('notes.auto.t0377', { v0: (r.stderr || r.stdout).slice(0, 300) }),
      ],
    };
  }
  if (!input.remote.password) {
    return {
      ok: false,
      kind: 'sftp',
      notes: [...input.notesPrefix, tl('notes.auto.n1572')],
    };
  }
  const r = await input.host.runCommand(
    sftpPasswordArgv({ password: input.remote.password, port, spec, batch: 'pwd\n' }),
    { timeoutMs: 20_000 },
  );
  const out = (r.stdout || '') + (r.stderr || '');
  if (out.includes('NEED_SSHPASS')) {
    return { ok: false, kind: 'sftp', notes: [...input.notesPrefix, tl('notes.auto.n1572')] };
  }
  return {
    ok: r.exitCode === 0,
    kind: 'sftp',
    notes: [
      ...input.notesPrefix,
      r.exitCode === 0
        ? tl('notes.auto.t0378', { v0: spec })
        : tl('notes.auto.t0379', { v0: out.slice(0, 300) }),
    ],
  };
}

async function ensureRemoteSftpDir(input: {
  host: HostExecutor;
  remote: BackupRemoteSettings;
  remoteDir: string;
  identityId?: string;
  dataDir?: string;
  port: number;
  spec: string;
}): Promise<{ ok: boolean; notes: string[] }> {
  const dir = input.remoteDir;
  if (!dir || dir === '.') return { ok: true, notes: [] };
  const {
    resolveIdentityKeyPath,
    buildSftpIdentityArgv,
    sftpStdinArgv,
    sftpMkdirBatch,
  } = await import('../security/ssh-identity/ops.js');
  const batch = sftpMkdirBatch(dir);
  if (input.identityId && input.dataDir) {
    const key = resolveIdentityKeyPath(input.dataDir, input.identityId);
    if (!key.ok || !key.path) {
      return {
        ok: false,
        notes: [
          tl('notes.auto.t0375', {
            v0: input.identityId,
            v1: (key.notes ?? []).join('; ') || tl('notes.tpl.unavailable'),
          }),
        ],
      };
    }
    const argv = sftpStdinArgv(
      buildSftpIdentityArgv(key.path, { port: input.port, userAtHost: input.spec }),
      batch,
    );
    const r = await input.host.runCommand(argv, { timeoutMs: 20_000 });
    const out = `${r.stdout || ''} ${r.stderr || ''}`;
    if (r.exitCode !== 0) {
      return { ok: false, notes: [tl('notes.backup.remoteMkdirFailed', { detail: out.slice(0, 200) })] };
    }
    return { ok: true, notes: [] };
  }
  if (input.remote.password) {
    const r = await input.host.runCommand(
      sftpPasswordArgv({
        password: input.remote.password,
        port: input.port,
        spec: input.spec,
        batch,
      }),
      { timeoutMs: 20_000 },
    );
    const out = (r.stdout || '') + (r.stderr || '');
    if (out.includes('NEED_SSHPASS')) return { ok: false, notes: [tl('notes.auto.n1572')] };
    if (r.exitCode !== 0) {
      return { ok: false, notes: [tl('notes.backup.remoteMkdirFailed', { detail: out.slice(0, 200) })] };
    }
    return { ok: true, notes: [] };
  }
  const r = await input.host.runCommand(
    sftpStdinArgv(
      [
        'sftp',
        '-o',
        'StrictHostKeyChecking=accept-new',
        '-o',
        'BatchMode=yes',
        '-o',
        'ConnectTimeout=8',
        '-P',
        String(input.port),
        '-b',
        '-',
        input.spec,
      ],
      batch,
    ),
    { timeoutMs: 20_000 },
  );
  const out = `${r.stdout || ''} ${r.stderr || ''}`;
  if (r.exitCode !== 0) {
    return { ok: false, notes: [tl('notes.backup.remoteMkdirFailed', { detail: out.slice(0, 200) })] };
  }
  return { ok: true, notes: [] };
}

export async function pushBackupRemote(input: {
  host: HostExecutor;
  db: JsonStore;
  localArchivePath: string;
  /** Extra files (e.g. SQL sidecar) copied next to the archive */
  extraLocalPaths?: string[];
  /** override settings identityId */
  identityId?: string;
  dataDir?: string;
}): Promise<{ ok: boolean; notes: string[]; skipped?: boolean }> {
  const remote = getBackupRemote(input.db);
  if (!remote.enabled) {
    return {
      ok: true,
      skipped: true,
      notes: [tl('notes.auto.n1479')],
    };
  }
  if (!existsSync(input.localArchivePath)) {
    return { ok: false, notes: [tl('notes.auto.n0990')] };
  }
  if (remote.kind === 'sftp' && remote.host && isMetadataOrLoopbackHost(remote.host)) {
    return { ok: false, notes: [tl('notes.auto.n0303')] };
  }
  if (remote.kind === 's3' && remote.s3Endpoint?.trim()) {
    try {
      assertSafeOutboundUrl(remote.s3Endpoint.trim(), {
        field: 's3Endpoint',
        policy: 'strict',
      });
    } catch {
      return { ok: false, notes: [tl('notes.auto.n0303')] };
    }
  }
  if (!input.host.executeEnabled()) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1173')],
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
          ? tl('notes.auto.t0374', { v0: (remote.path) })
          : tl('notes.tpl.copyFailed2', { detail: r.stderr || r.stdout }),
      ],
    };
  }
  if (remote.kind === 's3') {
    return pushBackupS3(input.host, remote, input.localArchivePath);
  }
  if (!remote.host || !remote.username || !remote.path) {
    return { ok: false, notes: [tl('notes.auto.n1474')] };
  }
  const port = remote.port ?? 22;
  const remoteDir = (remote.path || '.').replace(/\/+$/, '') || '.';
  const dest = `${remote.username}@${remote.host}:${remoteDir}/`;
  const identityId = input.identityId || remote.identityId;
  const dataDir = input.dataDir;
  const extras = (input.extraLocalPaths ?? []).filter((p) => p && existsSync(p));

  const mkdirNote = await ensureRemoteSftpDir({
    host: input.host,
    remote,
    remoteDir,
    identityId,
    dataDir,
    port,
    spec: `${remote.username}@${remote.host}`,
  });
  if (mkdirNote.ok === false) return mkdirNote;

  const {
    resolveIdentityKeyPath,
    buildSftpIdentityArgv,
    sftpStdinArgv,
    sftpPutBatch,
  } = await import('../security/ssh-identity/ops.js');
  const spec = `${remote.username}@${remote.host}`;
  const putFiles = [input.localArchivePath, ...extras];

  if (identityId && dataDir) {
    const key = resolveIdentityKeyPath(dataDir, identityId);
    if (!key.ok || !key.path) {
      return {
        ok: false,
        notes: [tl('notes.auto.t0375', { v0: (identityId), v1: ((key.notes ?? []).join('; ') || tl('notes.tpl.unavailable')) })],
      };
    }
    const notes: string[] = [];
    for (const file of putFiles) {
      const argv = sftpStdinArgv(
        buildSftpIdentityArgv(key.path, { port, userAtHost: spec }),
        sftpPutBatch(file, remoteDir),
      );
      const r = await input.host.runCommand(argv, { timeoutMs: 180_000 });
      notes.push(
        r.exitCode === 0
          ? file === input.localArchivePath
            ? tl('notes.auto.t0376', { v0: dest })
            : tl('notes.backup.sidecarPushed', { name: file.split('/').pop() ?? file })
          : tl('notes.auto.t0377', { v0: (r.stderr || r.stdout).slice(0, 300) }),
      );
      if (r.exitCode !== 0) return { ok: false, notes };
    }
    return { ok: true, notes };
  }

  if (remote.password) {
    const notes: string[] = [];
    for (const file of putFiles) {
      const r = await input.host.runCommand(
        sftpPasswordArgv({
          password: remote.password,
          port,
          spec,
          batch: sftpPutBatch(file, remoteDir),
        }),
        { timeoutMs: 180_000 },
      );
      const out = (r.stdout || '') + (r.stderr || '');
      if (out.includes('NEED_SSHPASS')) {
        return { ok: false, notes: [tl('notes.auto.n1572')] };
      }
      notes.push(
        r.exitCode === 0
          ? file === input.localArchivePath
            ? tl('notes.auto.t0378', { v0: dest })
            : tl('notes.backup.sidecarPushed', { name: file.split('/').pop() ?? file })
          : tl('notes.auto.t0379', { v0: out.slice(0, 300) }),
      );
      if (r.exitCode !== 0) return { ok: false, notes };
    }
    return { ok: true, notes };
  }

  const notes: string[] = [];
  for (const file of putFiles) {
    const r = await input.host.runCommand(
      sftpStdinArgv(
        [
          'sftp',
          '-o',
          'StrictHostKeyChecking=accept-new',
          '-o',
          'BatchMode=yes',
          '-P',
          String(port),
          '-b',
          '-',
          spec,
        ],
        sftpPutBatch(file, remoteDir),
      ),
      { timeoutMs: 180_000 },
    );
    notes.push(
      r.exitCode === 0
        ? file === input.localArchivePath
          ? tl('notes.auto.t0380', { v0: dest })
          : tl('notes.backup.sidecarPushed', { name: file.split('/').pop() ?? file })
        : tl('notes.auto.t0381', { v0: r.stderr || r.stdout }),
    );
    if (r.exitCode !== 0) return { ok: false, notes };
  }
  return { ok: true, notes };
}

async function pushBackupS3(
  host: HostExecutor,
  remote: BackupRemoteSettings,
  localPath: string,
): Promise<{ ok: boolean; notes: string[] }> {
  const bucket = (remote.s3Bucket || remote.path || '').trim();
  if (!bucket) {
    return { ok: false, notes: [tl('notes.auto.n0179')] };
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
      `${envPrefix} if ${shellBinExists('aws')}; then aws s3 cp ${JSON.stringify(localPath)} ${JSON.stringify(dest)} 2>&1; else echo NEED_AWS_CLI; fi`,
    ],
    { timeoutMs: 300_000 },
  );
  const out = (r.stdout || '') + (r.stderr || '');
  if (out.includes('NEED_AWS_CLI')) {
    return {
      ok: false,
      notes: [tl('notes.auto.n1560')],
    };
  }
  return {
    ok: r.exitCode === 0,
    notes: [r.exitCode === 0 ? tl('notes.auto.t0382', { v0: (dest) }) : tl('notes.auto.t0383', { v0: (out.slice(0, 300)) })],
  };
}
