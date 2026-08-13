/**
 * Ephemeral SSH key for migrate: generate on source, install pubkey on target via password once.
 * Private key lives under dataDir/migrate/<jobId>/ssh/ — never in ysk.json.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { OpsResultDto } from 'ysk-server-shared';
import { assertHonestOps, tl} from 'ysk-server-shared';
import { generateSshKeyPair } from '../../security/ssh-identity/generate.js';
import { migrateJobDir } from './types.js';
import {
  type MigrateSshAuth,
  type MigrateSshEndpoint,
  runSshCommand,
  userAtHost,
} from './transport.js';

export type TempKeyMaterial = {
  privateKeyPath: string;
  publicKeyPath: string;
  publicKey: string;
  fingerprintSha256: string;
};

/**
 * Generate ed25519 key pair under job migrate dir.
 */
export function createMigrateTempKey(input: {
  dataDir: string;
  jobId: string;
}): TempKeyMaterial & OpsResultDto {
  const dir = join(migrateJobDir(input.dataDir, input.jobId), 'ssh');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* */
  }
  try {
    const pair = generateSshKeyPair({
      algorithm: 'ed25519',
      comment: `ysk-migrate-${input.jobId.slice(0, 8)}`,
    });
    const privateKeyPath = join(dir, 'id_ed25519');
    const publicKeyPath = join(dir, 'id_ed25519.pub');
    writeFileSync(
      privateKeyPath,
      pair.privateKey.endsWith('\n') ? pair.privateKey : pair.privateKey + '\n',
      { mode: 0o600 },
    );
    try {
      chmodSync(privateKeyPath, 0o600);
    } catch {
      /* */
    }
    writeFileSync(publicKeyPath, pair.publicKey.endsWith('\n') ? pair.publicKey : pair.publicKey + '\n', {
      mode: 0o644,
    });
    return assertHonestOps({
      ok: true,
      apply_status: 'written',
      notes: [tl('notes.auto.t0641', { v0: (pair.fingerprintSha256) })],
      privateKeyPath,
      publicKeyPath,
      publicKey: pair.publicKey.trim(),
      fingerprintSha256: pair.fingerprintSha256,
    }) as TempKeyMaterial & OpsResultDto;
  } catch (e) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [
        tl('notes.auto.t0642', { v0: (e instanceof Error ? e.message : String(e)) }),
      ],
      privateKeyPath: '',
      publicKeyPath: '',
      publicKey: '',
      fingerprintSha256: '',
    }) as TempKeyMaterial & OpsResultDto;
  }
}

/**
 * Install public key on target using password auth (one-shot).
 * Remote: mkdir ~/.ssh && append authorized_keys.
 */
export async function installTempKeyOnTarget(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  password: string;
  publicKey: string;
}): Promise<OpsResultDto> {
  const pub = input.publicKey.trim();
  if (!pub.startsWith('ssh-')) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [tl('notes.auto.n1104')],
    });
  }
  // Avoid shell injection: base64 the key for remote decode
  const b64 = Buffer.from(pub + '\n', 'utf8').toString('base64');
  const remote = [
    'umask 077',
    'mkdir -p ~/.ssh',
    'touch ~/.ssh/authorized_keys',
    `echo ${JSON.stringify(b64)} | base64 -d >> ~/.ssh/authorized_keys`,
    'chmod 700 ~/.ssh',
    'chmod 600 ~/.ssh/authorized_keys',
    'echo YSK_KEY_INSTALLED',
  ].join(' && ');

  const r = await runSshCommand({
    host: input.host,
    endpoint: input.endpoint,
    auth: { kind: 'password', password: input.password },
    remoteCommand: remote,
    timeoutMs: 30_000,
    name: 'install-temp-key',
  });

  if (!r.ok) return r;
  if (!r.stdout.includes('YSK_KEY_INSTALLED') && !r.stderr.includes('YSK_KEY_INSTALLED')) {
    // some ssh merge stdout
    const combined = r.stdout + r.stderr;
    if (!combined.includes('YSK_KEY_INSTALLED')) {
      return assertHonestOps({
        ok: false,
        apply_status: 'failed',
        notes: [
          tl('notes.auto.t0643', { v0: ((r.stdout || r.stderr).slice(0, 200)) }),
        ],
      });
    }
  }
  return assertHonestOps({
    ok: true,
    apply_status: 'applied',
    notes: [
      tl('notes.auto.t0644', { v0: (userAtHost(input.endpoint)) }),
    ],
  });
}

/**
 * Full flow: generate key + install with password → return identity auth for later phases.
 */
export async function bootstrapTempKeyAuth(input: {
  host: HostExecutor;
  dataDir: string;
  jobId: string;
  endpoint: MigrateSshEndpoint;
  password: string;
}): Promise<OpsResultDto & { auth?: MigrateSshAuth; privateKeyPath?: string }> {
  const gen = createMigrateTempKey({
    dataDir: input.dataDir,
    jobId: input.jobId,
  });
  if (!gen.ok || !gen.privateKeyPath) {
    return gen;
  }
  const inst = await installTempKeyOnTarget({
    host: input.host,
    endpoint: input.endpoint,
    password: input.password,
    publicKey: gen.publicKey,
  });
  if (!inst.ok) {
    return assertHonestOps({
      ok: false,
      blocked: inst.blocked,
      blockMessage: inst.blockMessage,
      apply_status: inst.apply_status ?? 'failed',
      notes: [...gen.notes, ...inst.notes],
    });
  }
  return assertHonestOps({
    ok: true,
    apply_status: 'applied',
    notes: [...gen.notes, ...inst.notes],
    auth: { kind: 'identity', privateKeyPath: gen.privateKeyPath },
    privateKeyPath: gen.privateKeyPath,
  }) as OpsResultDto & { auth?: MigrateSshAuth; privateKeyPath?: string };
}

/** Remove temp key files (and optionally strip from target — call revoke separately). */
export function destroyLocalTempKey(dataDir: string, jobId: string): OpsResultDto {
  const dir = join(migrateJobDir(dataDir, jobId), 'ssh');
  if (!existsSync(dir)) {
    return assertHonestOps({
      ok: true,
      apply_status: 'written',
      notes: [tl('notes.auto.n1198')],
    });
  }
  try {
    rmSync(dir, { recursive: true, force: true });
    return assertHonestOps({
      ok: true,
      apply_status: 'applied',
      notes: [tl('notes.auto.n0739')],
    });
  } catch (e) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [tl('notes.auto.t0645', { v0: (e instanceof Error ? e.message : String(e)) })],
    });
  }
}

/**
 * Best-effort: remove our public key line from target authorized_keys.
 */
export async function revokeTempKeyOnTarget(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  publicKey: string;
}): Promise<OpsResultDto> {
  const pub = input.publicKey.trim();
  const b64 = Buffer.from(pub, 'utf8').toString('base64');
  const remote = [
    `KEY=$(echo ${JSON.stringify(b64)} | base64 -d)`,
    'if [ -f ~/.ssh/authorized_keys ]; then',
    '  grep -vF "$KEY" ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.ysk-tmp || true',
    '  mv ~/.ssh/authorized_keys.ysk-tmp ~/.ssh/authorized_keys',
    '  chmod 600 ~/.ssh/authorized_keys',
    'fi',
    'echo YSK_KEY_REVOKED',
  ].join('\n');

  return runSshCommand({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    remoteCommand: remote,
    timeoutMs: 20_000,
  });
}

export function readTempPublicKey(
  dataDir: string,
  jobId: string,
): string | null {
  const p = join(migrateJobDir(dataDir, jobId), 'ssh', 'id_ed25519.pub');
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8').trim();
  } catch {
    return null;
  }
}
