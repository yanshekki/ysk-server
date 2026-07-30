/**
 * Source + target preflight for host migrate.
 * Fail-closed: blocked when EXECUTE/root/tools/SSH/disk insufficient.
 */

import { existsSync, statfsSync } from 'node:fs';
import type { HostExecutor } from '../../host/executor.js';
import type { HostManifest, OpsResultDto } from '@ysk/shared';
import { assertHonestOps } from '@ysk/shared';
import {
  type MigrateSshAuth,
  type MigrateSshEndpoint,
  runSshCommand,
  userAtHost,
} from './transport.js';

export type PreflightCheck = {
  id: string;
  ok: boolean;
  blocked?: boolean;
  detail: string;
};

export type PreflightReport = OpsResultDto & {
  checks: PreflightCheck[];
  estimatedBytes?: number;
  targetFreeBytes?: number;
};

function push(
  checks: PreflightCheck[],
  id: string,
  ok: boolean,
  detail: string,
  blocked?: boolean,
): void {
  checks.push({ id, ok, detail, blocked });
}

/** Rough lower bound when du is unavailable (control plane floor). */
export function estimateTransferBytes(manifest: HostManifest): number {
  // Prefer async du in preflightSource; this is a sync floor only.
  return 512 * 1024 * 1024 + manifest.paths.homes.length * 64 * 1024 * 1024;
}

async function duBytes(
  host: HostExecutor,
  path: string,
): Promise<number | undefined> {
  if (!existsSync(path)) return 0;
  const r = await host.runCommand(
    ['bash', '-c', `du -sb ${JSON.stringify(path)} 2>/dev/null | awk '{print $1}'`],
    { timeoutMs: 120_000 },
  );
  const n = Number((r.stdout || '').trim().split('\n')[0]);
  return Number.isFinite(n) ? n : undefined;
}

async function localFreeBytes(path: string): Promise<number | undefined> {
  try {
    // Node 18.15+ statfsSync
    if (typeof statfsSync === 'function') {
      const s = statfsSync(path);
      return Number(s.bavail) * Number(s.bsize);
    }
  } catch {
    /* */
  }
  return undefined;
}

/**
 * Source host readiness (before touching target).
 */
export async function preflightSource(input: {
  host: HostExecutor;
  dataDir: string;
  manifest?: HostManifest;
  /** Require maintenance acceptance for full migrate */
  maintenanceAccepted?: boolean;
}): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const notes: string[] = [];

  const exec = input.host.executeEnabled();
  push(
    checks,
    'execute',
    exec,
    exec ? 'YSK_EXECUTE 已開啟' : '未開啟 YSK_EXECUTE',
    !exec,
  );

  const root = input.host.isRoot();
  push(
    checks,
    'root',
    root,
    root ? '以 root 執行' : '非 root（目標 useradd/apt 會 blocked）',
    !root,
  );

  if (input.maintenanceAccepted !== true) {
    push(
      checks,
      'maintenance',
      false,
      '尚未確認維護窗（package 階段會停服）',
      true,
    );
  } else {
    push(checks, 'maintenance', true, '已確認維護窗');
  }

  for (const bin of ['ssh', 'rsync', 'ssh-keygen'] as const) {
    const r = await input.host.runCommand(
      ['bash', '-c', `command -v ${bin} >/dev/null 2>&1 && echo ok || true`],
      { timeoutMs: 3_000 },
    );
    const ok = r.stdout.includes('ok');
    push(
      checks,
      `bin:${bin}`,
      ok,
      ok ? `${bin} 可用` : `缺少 ${bin}`,
      !ok && (bin === 'ssh' || bin === 'rsync'),
    );
  }

  // sshpass optional — only blocked if password auth will be used (checked by caller)
  const sp = await input.host.runCommand(
    ['bash', '-c', 'command -v sshpass >/dev/null 2>&1 && echo ok || true'],
    { timeoutMs: 3_000 },
  );
  push(
    checks,
    'bin:sshpass',
    sp.stdout.includes('ok'),
    sp.stdout.includes('ok')
      ? 'sshpass 可用（密碼登入）'
      : '無 sshpass（僅能用 key/agent 登入）',
  );

  if (!existsSync(input.dataDir)) {
    push(checks, 'dataDir', false, `dataDir 不存在: ${input.dataDir}`, true);
  } else {
    push(checks, 'dataDir', true, `dataDir ${input.dataDir}`);
  }

  let estimatedBytes = 512 * 1024 * 1024;
  if (input.manifest) {
    let sum = 0;
    const dDu = await duBytes(input.host, input.dataDir);
    if (dDu != null) sum += dDu;
    for (const home of input.manifest.paths.homes) {
      const h = await duBytes(input.host, home);
      if (h != null) sum += h;
    }
    if (sum > 0) estimatedBytes = sum;
    notes.push(`預估傳輸量 ~${formatBytes(estimatedBytes)}`);
  }

  const free = await localFreeBytes(input.dataDir);
  if (free != null) {
    // source only needs room for dumps (~10% headroom of data), not full copy
    const need = Math.floor(estimatedBytes * 0.15) + 256 * 1024 * 1024;
    const ok = free >= need;
    push(
      checks,
      'source_disk',
      ok,
      ok
        ? `來源可用 ${formatBytes(free)}（dump 緩衝充足）`
        : `來源磁碟不足：可用 ${formatBytes(free)}，建議 ≥ ${formatBytes(need)}`,
      !ok,
    );
  }

  if (input.manifest?.warnings.length) {
    notes.push(`盤點警告 ${input.manifest.warnings.length} 則（非全部阻塞）`);
  }

  const hardFail = checks.some((c) => !c.ok && c.blocked);
  const blocked = hardFail;
  return assertHonestOps({
    ok: !hardFail,
    blocked: blocked || undefined,
    requiresExecute: !exec,
    requiresRoot: !root,
    blockMessage: blocked
      ? checks
          .filter((c) => !c.ok && c.blocked)
          .map((c) => c.detail)
          .join('；')
      : undefined,
    apply_status: hardFail ? (blocked ? 'blocked' : 'failed') : 'written',
    notes: [
      hardFail ? '來源預檢未通過' : '來源預檢通過',
      ...notes,
      ...checks.filter((c) => !c.ok).map((c) => `· ${c.detail}`),
    ],
    checks,
    estimatedBytes,
  }) as PreflightReport;
}

/**
 * Target host preflight via SSH (Debian/Ubuntu, disk, root, empty-or-force).
 */
export async function preflightTarget(input: {
  host: HostExecutor;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  targetDataDir: string;
  estimatedBytes: number;
  forceWipeTarget?: boolean;
}): Promise<PreflightReport> {
  const checks: PreflightCheck[] = [];
  const notes: string[] = [];
  const td = input.targetDataDir.replace(/'/g, '');

  // Remote script prints KEY=value lines
  const remote = [
    'set -e',
    'echo YSK_PREFLIGHT_BEGIN',
    'echo USER=$(id -un)',
    'echo UID=$(id -u)',
    'echo OS_ID=$(. /etc/os-release 2>/dev/null; echo ${ID:-unknown})',
    'echo OS_LIKE=$(. /etc/os-release 2>/dev/null; echo ${ID_LIKE:-})',
    'echo ARCH=$(uname -m)',
    `echo TARGET_DIR=${JSON.stringify(td)}`,
    `if [ -d ${JSON.stringify(td)} ]; then echo TARGET_EXISTS=1; else echo TARGET_EXISTS=0; fi`,
    `if [ -f ${JSON.stringify(td + '/ysk.json')} ]; then echo YSK_JSON=1; else echo YSK_JSON=0; fi`,
    "echo FREE_KB=$(df -Pk / | awk 'NR==2{print $4}')",
    'command -v rsync >/dev/null && echo HAS_RSYNC=1 || echo HAS_RSYNC=0',
    'command -v apt-get >/dev/null && echo HAS_APT=1 || echo HAS_APT=0',
    'date -u +%s | awk \'{print "TIME_UTC="$1}\'',
    'echo YSK_PREFLIGHT_END',
  ].join('\n');

  const ssh = await runSshCommand({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    remoteCommand: remote,
    timeoutMs: 45_000,
    name: 'target-preflight',
  });

  if (!ssh.ok) {
    push(
      checks,
      'ssh',
      false,
      ssh.blockMessage || ssh.notes[0] || 'SSH 連線失敗',
      ssh.blocked === true,
    );
    return assertHonestOps({
      ok: false,
      blocked: ssh.blocked,
      requiresExecute: ssh.requiresExecute,
      blockMessage: ssh.blockMessage || '無法連線目標機',
      apply_status: ssh.apply_status ?? 'failed',
      notes: ['目標預檢失敗', ...ssh.notes],
      checks,
    }) as PreflightReport;
  }

  push(checks, 'ssh', true, `SSH 連線 ${userAtHost(input.endpoint)}`);

  const kv = parseKv(ssh.stdout + '\n' + ssh.stderr);

  const isRoot = kv.UID === '0' || kv.USER === 'root';
  push(
    checks,
    'target_root',
    isRoot,
    isRoot ? '目標為 root' : `目標用戶 ${kv.USER || '?'} 非 root（MVP 需要 root）`,
    !isRoot,
  );

  const osId = (kv.OS_ID || '').toLowerCase();
  const osLike = (kv.OS_LIKE || '').toLowerCase();
  const debish =
    osId === 'debian' ||
    osId === 'ubuntu' ||
    osLike.includes('debian') ||
    osLike.includes('ubuntu');
  push(
    checks,
    'os',
    debish,
    debish
      ? `OS ${osId || osLike || 'debian-like'}`
      : `不支援的 OS（${osId || 'unknown'}）；需要 Debian/Ubuntu`,
    !debish,
  );

  const hasApt = kv.HAS_APT === '1';
  push(
    checks,
    'apt',
    hasApt,
    hasApt ? 'apt-get 可用' : '無 apt-get',
    !hasApt,
  );

  // rsync on target optional for receive (rsync sender can push without remote rsync daemon;
  // remote shell still needs rsync binary for rsync-over-ssh)
  const hasRsync = kv.HAS_RSYNC === '1';
  push(
    checks,
    'target_rsync',
    hasRsync,
    hasRsync ? '目標有 rsync' : '目標缺 rsync（將在 bootstrap 安裝）',
  );

  const freeKb = Number(kv.FREE_KB || 0);
  const freeBytes = Number.isFinite(freeKb) ? freeKb * 1024 : undefined;
  const need = Math.floor(input.estimatedBytes * 1.2) + 512 * 1024 * 1024;
  if (freeBytes != null && freeBytes > 0) {
    const ok = freeBytes >= need;
    push(
      checks,
      'target_disk',
      ok,
      ok
        ? `目標可用 ${formatBytes(freeBytes)} ≥ 需求 ${formatBytes(need)}`
        : `目標磁碟不足：可用 ${formatBytes(freeBytes)}，需要約 ${formatBytes(need)}`,
      !ok,
    );
  } else {
    push(checks, 'target_disk', false, '無法讀取目標磁碟空間', true);
  }

  const exists = kv.TARGET_EXISTS === '1';
  const hasYsk = kv.YSK_JSON === '1';
  if (hasYsk && !input.forceWipeTarget) {
    push(
      checks,
      'target_clean',
      false,
      `目標已有 ${td}/ysk.json — 拒絕覆蓋（需 forceWipeTarget）`,
      true,
    );
  } else if (hasYsk && input.forceWipeTarget) {
    push(
      checks,
      'target_clean',
      true,
      '目標已有 YSK 資料，已確認 forceWipeTarget',
    );
    notes.push('警告：將覆寫目標既有 YSK 資料');
  } else if (exists) {
    push(checks, 'target_clean', true, `目標目錄存在但無 ysk.json: ${td}`);
  } else {
    push(checks, 'target_clean', true, `目標目錄將建立: ${td}`);
  }

  // clock skew
  const remoteTs = Number(kv.TIME_UTC || 0);
  const localTs = Math.floor(Date.now() / 1000);
  if (remoteTs > 0) {
    const skew = Math.abs(remoteTs - localTs);
    const ok = skew < 120;
    push(
      checks,
      'clock',
      ok,
      ok ? `時鐘偏差 ${skew}s` : `時鐘偏差 ${skew}s ≥ 120s（影響 TLS/TOTP）`,
      !ok,
    );
  }

  const hardFail = checks.some((c) => !c.ok && c.blocked);
  return assertHonestOps({
    ok: !hardFail,
    blocked: hardFail || undefined,
    blockMessage: hardFail
      ? checks
          .filter((c) => !c.ok && c.blocked)
          .map((c) => c.detail)
          .join('；')
      : undefined,
    apply_status: hardFail ? 'blocked' : 'written',
    notes: [
      hardFail ? '目標預檢未通過' : '目標預檢通過',
      ...notes,
      ...checks.filter((c) => !c.ok).map((c) => `· ${c.detail}`),
    ],
    checks,
    estimatedBytes: input.estimatedBytes,
    targetFreeBytes: freeBytes,
  }) as PreflightReport;
}

/**
 * Combined preflight for a migrate job (source then target).
 */
export async function preflightMigrate(input: {
  host: HostExecutor;
  dataDir: string;
  endpoint: MigrateSshEndpoint;
  auth: MigrateSshAuth;
  targetDataDir: string;
  manifest: HostManifest;
  maintenanceAccepted?: boolean;
  forceWipeTarget?: boolean;
  /** Password auth requires sshpass on source */
  usingPassword?: boolean;
}): Promise<PreflightReport> {
  const source = await preflightSource({
    host: input.host,
    dataDir: input.dataDir,
    manifest: input.manifest,
    maintenanceAccepted: input.maintenanceAccepted,
  });

  if (input.usingPassword) {
    const hasPass = source.checks.find((c) => c.id === 'bin:sshpass');
    if (hasPass && !hasPass.ok) {
      return assertHonestOps({
        ok: false,
        blocked: true,
        blockMessage: '密碼登入需要本機安裝 sshpass',
        apply_status: 'blocked',
        notes: ['來源缺 sshpass', ...source.notes],
        checks: [
          ...source.checks,
          {
            id: 'password_auth',
            ok: false,
            blocked: true,
            detail: '密碼登入需要 sshpass',
          },
        ],
        estimatedBytes: source.estimatedBytes,
      }) as PreflightReport;
    }
  }

  if (!source.ok) {
    return source;
  }

  const target = await preflightTarget({
    host: input.host,
    endpoint: input.endpoint,
    auth: input.auth,
    targetDataDir: input.targetDataDir,
    estimatedBytes: source.estimatedBytes ?? 1024 * 1024 * 1024,
    forceWipeTarget: input.forceWipeTarget,
  });

  const checks = [...source.checks, ...target.checks];
  const hardFail = !target.ok;
  return assertHonestOps({
    ok: !hardFail,
    blocked: target.blocked,
    blockMessage: target.blockMessage,
    apply_status: hardFail ? target.apply_status ?? 'failed' : 'written',
    notes: [...source.notes, ...target.notes],
    checks,
    estimatedBytes: source.estimatedBytes,
    targetFreeBytes: target.targetFreeBytes,
  }) as PreflightReport;
}

function parseKv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
