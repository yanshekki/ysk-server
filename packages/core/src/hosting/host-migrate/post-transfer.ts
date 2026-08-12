/**
 * Chain restore → reapply → verify on the target host (local HostExecutor).
 * Call after transfer completed and process runs against target dataDir.
 */

import type { HostManifest, MigrateJobDto, OpsResultDto } from 'ysk-server-shared';
import { assertHonestOps, tl} from 'ysk-server-shared';
import type { HostExecutor } from '../../host/executor.js';
import type { JsonStore } from '../../db/store.js';
import { restoreOnHost, type RestoreResult } from './restore.js';
import { reapplyOnHost, type ReapplyResult } from './reapply.js';
import { verifyOnHost, type VerifyResult } from './verify.js';
import type { HostManifestDatabase } from 'ysk-server-shared';

export type PostTransferResult = OpsResultDto & {
  restore?: RestoreResult;
  reapply?: ReapplyResult;
  verify?: VerifyResult;
};

/**
 * Full post-transfer pipeline on target.
 */
export async function runPostTransferOnHost(input: {
  host: HostExecutor;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  db: JsonStore;
  resolveSqlPassword?: (db: HostManifestDatabase) => string | undefined;
  cliPath?: string;
  /** Stop after restore (debug) */
  skipReapply?: boolean;
  skipVerify?: boolean;
}): Promise<PostTransferResult> {
  const restore = await restoreOnHost({
    host: input.host,
    dataDir: input.dataDir,
    job: input.job,
    manifest: input.manifest,
    db: input.db,
    resolveSqlPassword: input.resolveSqlPassword,
  });

  if (!restore.ok) {
    return assertHonestOps({
      ok: false,
      blocked: restore.blocked,
      apply_status: restore.apply_status ?? 'failed',
      notes: [tl('notes.auto.n0382'), ...restore.notes],
      restore,
    }) as PostTransferResult;
  }

  if (input.skipReapply) {
    return assertHonestOps({
      ok: true,
      apply_status: 'partial',
      notes: [tl('notes.auto.n0415'), ...restore.notes],
      restore,
    }) as PostTransferResult;
  }

  const reapply = await reapplyOnHost({
    host: input.host,
    dataDir: input.dataDir,
    job: input.job,
    manifest: input.manifest,
    db: input.db,
    cliPath: input.cliPath,
  });

  if (!reapply.ok) {
    return assertHonestOps({
      ok: false,
      blocked: reapply.blocked,
      apply_status: reapply.apply_status ?? 'failed',
      notes: [tl('notes.auto.n0381'), ...reapply.notes],
      restore,
      reapply,
    }) as PostTransferResult;
  }

  if (input.skipVerify) {
    return assertHonestOps({
      ok: true,
      apply_status: 'partial',
      notes: [tl('notes.auto.n0420'), ...reapply.notes],
      restore,
      reapply,
    }) as PostTransferResult;
  }

  const verify = await verifyOnHost({
    host: input.host,
    dataDir: input.dataDir,
    job: input.job,
    manifest: input.manifest,
    db: input.db,
  });

  return assertHonestOps({
    ok: verify.ok,
    apply_status: verify.apply_status ?? (verify.ok ? 'applied' : 'failed'),
    notes: [...restore.notes.slice(0, 2), ...reapply.notes.slice(0, 2), ...verify.notes],
    restore,
    reapply,
    verify,
  }) as PostTransferResult;
}
