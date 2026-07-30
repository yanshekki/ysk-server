/**
 * Transfer phase: rsync dataDir + project homes + optional /etc paths to target.
 * Requires package phase dumps already under dataDir (included in dataDir rsync).
 */

import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { HostManifest, MigrateJobDto, OpsResultDto } from '@ysk/shared';
import { assertHonestOps } from '@ysk/shared';
import type { HostExecutor } from '../../host/executor.js';
import {
  appendMigrateStep,
  setMigratePhase,
  writeMigrateProgress,
} from './job-store.js';
import {
  type MigrateSshAuth,
  type MigrateSshEndpoint,
  rsyncToRemote,
  runSshCommand,
  userAtHost,
} from './transport.js';

export type TransferItemResult = {
  id: string;
  kind: 'mkdir' | 'dataDir' | 'home' | 'optionalEtc' | 'verify';
  ok: boolean;
  notes: string[];
  blocked?: boolean;
};

export type TransferResult = OpsResultDto & {
  items: TransferItemResult[];
  targetDataDir: string;
};

function sha256Local(path: string): string | undefined {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
  } catch {
    return undefined;
  }
}

/**
 * Ensure remote parent directories exist.
 */
export async function ensureRemoteDirs(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  dirs: string[];
}): Promise<OpsResultDto> {
  const list = input.dirs
    .filter(Boolean)
    .map((d) => JSON.stringify(d))
    .join(' ');
  if (!list) {
    return assertHonestOps({
      ok: true,
      apply_status: 'written',
      notes: ['無需建立遠端目錄'],
    });
  }
  return runSshCommand({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    remoteCommand: `mkdir -p ${list} && echo YSK_MKDIR_OK`,
    timeoutMs: 30_000,
    name: 'mkdir-remote',
  });
}

/**
 * Sample verify: compare ysk.json sha256 source vs target.
 */
export async function verifyRemoteYskJson(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  localDataDir: string;
  targetDataDir: string;
  expectedSha?: string;
}): Promise<OpsResultDto & { localSha?: string; remoteSha?: string }> {
  const localPath = join(input.localDataDir, 'ysk.json');
  const localSha = input.expectedSha ?? sha256Local(localPath);
  if (!localSha) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: ['本機 ysk.json 無法讀取 / 無 fingerprint'],
    });
  }
  const remotePath = JSON.stringify(join(input.targetDataDir, 'ysk.json'));
  const r = await runSshCommand({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    remoteCommand: `sha256sum ${remotePath} 2>/dev/null | awk '{print $1}'; echo YSK_SHA_DONE`,
    timeoutMs: 60_000,
  });
  if (!r.ok) {
    return assertHonestOps({
      ok: false,
      blocked: r.blocked,
      apply_status: r.apply_status ?? 'failed',
      notes: ['目標 ysk.json 校驗失敗', ...r.notes],
      localSha,
    });
  }
  const remoteSha = (r.stdout || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^[a-f0-9]{64}$/i.test(l));
  if (!remoteSha) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [`無法解析目標 sha256: ${(r.stdout || '').slice(0, 120)}`],
      localSha,
    });
  }
  const ok = remoteSha.toLowerCase() === localSha.toLowerCase();
  return assertHonestOps({
    ok,
    apply_status: ok ? 'applied' : 'failed',
    notes: [
      ok
        ? `ysk.json sha256 一致 ${localSha.slice(0, 12)}…`
        : `ysk.json 不一致 local=${localSha.slice(0, 12)} remote=${remoteSha.slice(0, 12)}`,
    ],
    localSha,
    remoteSha,
  }) as OpsResultDto & { localSha?: string; remoteSha?: string };
}

/**
 * Rsync full migrate payload to target.
 */
export async function transferMigratePayload(input: {
  host: HostExecutor;
  dataDir: string;
  job: MigrateJobDto;
  manifest: HostManifest;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  targetDataDir?: string;
  /** Also rsync optionalEtc from manifest (e.g. /etc/letsencrypt) */
  includeOptionalEtc?: boolean;
  dryRun?: boolean;
}): Promise<TransferResult> {
  const items: TransferItemResult[] = [];
  const targetDataDir =
    input.targetDataDir ?? input.job.targetDataDir ?? '/var/lib/ysk-server';
  const dataDir = input.dataDir;

  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: '伺服器未開啟系統變更權限，無法 rsync',
      notes: ['transfer 需要 YSK_EXECUTE=1'],
      items: [],
      targetDataDir,
    }) as TransferResult;
  }

  if (!input.manifest.packagedAt && !input.dryRun) {
    // Soft warning only if dumps empty — still allow transfer of control plane
    // Hard rule from design: package failure blocks transfer; missing packagedAt is warning
    items.push({
      id: 'package-check',
      kind: 'verify',
      ok: true,
      notes: ['警告：manifest 無 packagedAt — 若需 DB 請先跑 package'],
    });
  }

  setMigratePhase(dataDir, input.job, 'transfer');
  writeMigrateProgress(dataDir, input.job.id, {
    phase: 'transfer',
    status: 'starting',
    target: userAtHost(input.endpoint),
  });

  // 1) mkdir
  const homeParents = [
    ...new Set(
      input.manifest.paths.homes
        .map((h) => h.replace(/\/[^/]+\/?$/, '') || '/home')
        .filter(Boolean),
    ),
  ];
  const mkdir = await ensureRemoteDirs({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    dirs: [targetDataDir, ...homeParents, '/home'],
  });
  items.push({
    id: 'mkdir',
    kind: 'mkdir',
    ok: mkdir.ok,
    notes: mkdir.notes,
    blocked: mkdir.blocked,
  });
  appendMigrateStep(dataDir, input.job, {
    phase: 'transfer',
    name: 'mkdir-remote',
    result: {
      ok: mkdir.ok,
      blocked: mkdir.blocked,
      apply_status: mkdir.apply_status,
      notes: mkdir.notes,
    },
  });
  if (!mkdir.ok) {
    setMigratePhase(dataDir, input.job, 'failed', '遠端 mkdir 失敗');
    return assertHonestOps({
      ok: false,
      blocked: mkdir.blocked,
      apply_status: mkdir.apply_status ?? 'failed',
      notes: ['transfer 中止：無法建立遠端目錄', ...mkdir.notes],
      items,
      targetDataDir,
    }) as TransferResult;
  }

  // 2) dataDir
  writeMigrateProgress(dataDir, input.job.id, {
    phase: 'transfer',
    status: 'rsync-dataDir',
  });
  if (!existsSync(dataDir)) {
    items.push({
      id: 'dataDir',
      kind: 'dataDir',
      ok: false,
      notes: [`本機 dataDir 不存在: ${dataDir}`],
    });
    setMigratePhase(dataDir, input.job, 'failed', 'dataDir 不存在');
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [`dataDir 不存在: ${dataDir}`],
      items,
      targetDataDir,
    }) as TransferResult;
  }

  const dataRsync = await rsyncToRemote({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    localPath: dataDir,
    remotePath: targetDataDir,
    dryRun: input.dryRun,
    timeoutMs: 3_600_000,
  });
  items.push({
    id: 'dataDir',
    kind: 'dataDir',
    ok: dataRsync.ok,
    notes: dataRsync.notes,
    blocked: dataRsync.blocked,
  });
  appendMigrateStep(dataDir, input.job, {
    phase: 'transfer',
    name: 'rsync-dataDir',
    result: {
      ok: dataRsync.ok,
      blocked: dataRsync.blocked,
      apply_status: dataRsync.apply_status,
      notes: dataRsync.notes,
    },
  });
  if (!dataRsync.ok) {
    setMigratePhase(dataDir, input.job, 'failed', 'rsync dataDir 失敗');
    return assertHonestOps({
      ok: false,
      blocked: dataRsync.blocked,
      apply_status: dataRsync.apply_status ?? 'failed',
      blockMessage: dataRsync.blockMessage,
      notes: ['transfer 中止：dataDir rsync 失敗', ...dataRsync.notes],
      items,
      targetDataDir,
    }) as TransferResult;
  }

  // 3) homes (skip those already under dataDir to avoid double-copy noise)
  const dataResolved = dataDir.replace(/\/$/, '');
  let homeIdx = 0;
  for (const home of input.manifest.paths.homes) {
    homeIdx += 1;
    if (!existsSync(home)) {
      items.push({
        id: `home:${home}`,
        kind: 'home',
        ok: true,
        notes: [`略過不存在的 home: ${home}`],
      });
      continue;
    }
    if (home === dataResolved || home.startsWith(dataResolved + '/')) {
      items.push({
        id: `home:${home}`,
        kind: 'home',
        ok: true,
        notes: [`home 已在 dataDir 內，隨 dataDir 傳輸: ${home}`],
      });
      continue;
    }
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'transfer',
      status: 'rsync-home',
      home,
      index: homeIdx,
      total: input.manifest.paths.homes.length,
    });
    const hr = await rsyncToRemote({
      host: input.host,
      endpoint: input.endpoint,
      auth: input.auth,
      localPath: home,
      remotePath: home,
      dryRun: input.dryRun,
      timeoutMs: 3_600_000,
    });
    items.push({
      id: `home:${home}`,
      kind: 'home',
      ok: hr.ok,
      notes: hr.notes,
      blocked: hr.blocked,
    });
    appendMigrateStep(dataDir, input.job, {
      phase: 'transfer',
      name: `rsync-home:${home}`,
      result: {
        ok: hr.ok,
        blocked: hr.blocked,
        apply_status: hr.apply_status,
        notes: hr.notes,
      },
    });
    if (!hr.ok) {
      setMigratePhase(dataDir, input.job, 'failed', `rsync home 失敗 ${home}`);
      return assertHonestOps({
        ok: false,
        blocked: hr.blocked,
        apply_status: hr.apply_status ?? 'failed',
        notes: [`transfer 中止：home rsync 失敗 ${home}`, ...hr.notes],
        items,
        targetDataDir,
      }) as TransferResult;
    }
  }

  // 4) optional etc
  if (input.includeOptionalEtc !== false) {
    for (const etc of input.manifest.paths.optionalEtc) {
      if (!existsSync(etc)) {
        items.push({
          id: `etc:${etc}`,
          kind: 'optionalEtc',
          ok: true,
          notes: [`略過不存在: ${etc}`],
        });
        continue;
      }
      const er = await rsyncToRemote({
        host: input.host,
        endpoint: input.endpoint,
        auth: input.auth,
        localPath: etc,
        remotePath: etc,
        dryRun: input.dryRun,
        timeoutMs: 1_800_000,
      });
      items.push({
        id: `etc:${etc}`,
        kind: 'optionalEtc',
        ok: er.ok,
        notes: er.notes,
        blocked: er.blocked,
      });
      appendMigrateStep(dataDir, input.job, {
        phase: 'transfer',
        name: `rsync-etc:${etc}`,
        result: {
          ok: er.ok,
          blocked: er.blocked,
          apply_status: er.apply_status,
          notes: er.notes,
        },
      });
      // optional etc failure is non-fatal (LE may re-issue)
      if (!er.ok) {
        items[items.length - 1]!.notes.push(
          'optionalEtc 失敗不中止 transfer（可於目標重簽憑證）',
        );
      }
    }
  }

  // 5) verify ysk.json (skip pure dry-run)
  if (!input.dryRun) {
    writeMigrateProgress(dataDir, input.job.id, {
      phase: 'transfer',
      status: 'verify-ysk-json',
    });
    const expected =
      input.manifest.fingerprints['dataDir/ysk.json'] ?? sha256Local(join(dataDir, 'ysk.json'));
    const v = await verifyRemoteYskJson({
      host: input.host,
      endpoint: input.endpoint,
      auth: input.auth,
      localDataDir: dataDir,
      targetDataDir,
      expectedSha: expected,
    });
    items.push({
      id: 'verify-ysk-json',
      kind: 'verify',
      ok: v.ok,
      notes: v.notes,
      blocked: v.blocked,
    });
    appendMigrateStep(dataDir, input.job, {
      phase: 'transfer',
      name: 'verify-ysk-json',
      result: {
        ok: v.ok,
        blocked: v.blocked,
        apply_status: v.apply_status,
        notes: v.notes,
      },
    });
    if (!v.ok) {
      setMigratePhase(dataDir, input.job, 'failed', 'ysk.json 校驗失敗');
      return assertHonestOps({
        ok: false,
        apply_status: 'failed',
        notes: ['transfer 校驗失敗', ...v.notes],
        items,
        targetDataDir,
      }) as TransferResult;
    }
  }

  writeMigrateProgress(dataDir, input.job.id, {
    phase: 'transfer',
    status: 'done',
  });

  const hardFail = items.some(
    (i) =>
      !i.ok &&
      i.kind !== 'optionalEtc' &&
      i.id !== 'package-check',
  );
  // optionalEtc failures already noted as non-fatal; package-check is warning

  return assertHonestOps({
    ok: !hardFail,
    apply_status: input.dryRun ? 'written' : hardFail ? 'failed' : 'applied',
    notes: [
      hardFail
        ? 'transfer 有失敗項'
        : `transfer 完成 → ${userAtHost(input.endpoint)}:${targetDataDir}`,
      `homes ${input.manifest.paths.homes.length} · optionalEtc ${input.manifest.paths.optionalEtc.length}`,
      ...items.filter((i) => !i.ok).flatMap((i) => i.notes),
    ],
    items,
    targetDataDir,
  }) as TransferResult;
}
