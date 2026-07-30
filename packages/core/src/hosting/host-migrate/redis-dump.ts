/**
 * Redis RDB snapshot for host migrate (honest fail-closed).
 * Prefers `redis-cli --rdb`; falls back to BGSAVE + copy of dump.rdb.
 */

import { existsSync, mkdirSync, statSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';
import type { OpsResultDto } from '@ysk/shared';
import { assertHonestOps } from '@ysk/shared';

export type RedisDumpResult = OpsResultDto & {
  path?: string;
  bytes?: number;
  method?: 'rdb-flag' | 'bgsave-copy';
};

function fileBytes(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

/**
 * Dump Redis instance to an RDB file under outputPath.
 */
export async function dumpRedisRdb(input: {
  host: HostExecutor;
  /** Absolute path for .rdb output */
  outputPath: string;
  redisHost?: string;
  redisPort?: number;
  password?: string;
  /** Max wait for BGSAVE fallback (ms) */
  bgsaveTimeoutMs?: number;
}): Promise<RedisDumpResult> {
  if (!input.host.executeEnabled()) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      requiresExecute: true,
      blockMessage: '伺服器未開啟系統變更權限，無法匯出 Redis',
      notes: ['Redis dump 需要 YSK_EXECUTE=1'],
    });
  }

  const out = input.outputPath;
  mkdirSync(dirname(out), { recursive: true });
  const host = input.redisHost ?? '127.0.0.1';
  const port = input.redisPort ?? 6379;
  const auth = input.password
    ? `-a ${JSON.stringify(input.password)} --no-auth-warning `
    : '';
  const base = `redis-cli -h ${JSON.stringify(host)} -p ${port} ${auth}`.trim();

  // Probe redis-cli
  const which = await input.host.runCommand(
    ['bash', '-c', 'command -v redis-cli >/dev/null 2>&1 && echo ok || true'],
    { timeoutMs: 5_000 },
  );
  if (!which.stdout.includes('ok')) {
    return assertHonestOps({
      ok: false,
      blocked: true,
      blockMessage: '未安裝 redis-cli',
      notes: ['無法 dump Redis：缺 redis-cli'],
    });
  }

  // Method 1: redis-cli --rdb (Redis 6+)
  const rdb = await input.host.runCommand(
    [
      'bash',
      '-c',
      `${base} --rdb ${JSON.stringify(out)} 2>&1`,
    ],
    { timeoutMs: 300_000 },
  );
  if (rdb.exitCode === 0 && existsSync(out) && fileBytes(out) > 0) {
    return assertHonestOps({
      ok: true,
      apply_status: 'written',
      notes: [`Redis RDB 已寫入 ${out}（--rdb）`],
      path: out,
      bytes: fileBytes(out),
      method: 'rdb-flag' as const,
      written: [out],
    });
  }

  // Method 2: BGSAVE + copy dump.rdb from dir
  const bgsave = await input.host.runCommand(
    ['bash', '-c', `${base} BGSAVE 2>&1`],
    { timeoutMs: 30_000 },
  );
  if (bgsave.exitCode !== 0) {
    return assertHonestOps({
      ok: false,
      apply_status: 'failed',
      notes: [
        `--rdb 失敗: ${(rdb.stderr || rdb.stdout || '').slice(0, 200)}`,
        `BGSAVE 失敗: ${(bgsave.stderr || bgsave.stdout || '').slice(0, 200)}`,
      ],
    });
  }

  const timeout = input.bgsaveTimeoutMs ?? 120_000;
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    const st = await input.host.runCommand(
      ['bash', '-c', `${base} LASTSAVE 2>&1; ${base} INFO persistence 2>&1 | head -20`],
      { timeoutMs: 10_000 },
    );
    last = st.stdout || st.stderr || '';
    // rdb_bgsave_in_progress:0 means done
    if (/rdb_bgsave_in_progress:0/.test(last) || /Background saving terminated/.test(last)) {
      break;
    }
    await sleep(500);
  }

  // Locate dump.rdb via CONFIG GET dir
  const cfg = await input.host.runCommand(
    ['bash', '-c', `${base} CONFIG GET dir 2>&1; ${base} CONFIG GET dbfilename 2>&1`],
    { timeoutMs: 10_000 },
  );
  const cfgOut = cfg.stdout || '';
  // redis-cli CONFIG GET returns:
  // dir
  // /var/lib/redis
  // dbfilename
  // dump.rdb
  const lines = cfgOut
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  let dir = '/var/lib/redis';
  let name = 'dump.rdb';
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i] === 'dir') dir = lines[i + 1] || dir;
    if (lines[i] === 'dbfilename') name = lines[i + 1] || name;
  }
  const src = join(dir, name);

  // Prefer shell cp via host (permissions)
  const cp = await input.host.runCommand(
    [
      'bash',
      '-c',
      `if [ -f ${JSON.stringify(src)} ]; then cp -a ${JSON.stringify(src)} ${JSON.stringify(out)} && echo YSK_RDB_COPIED; else echo YSK_RDB_MISSING; fi`,
    ],
    { timeoutMs: 60_000 },
  );
  const copied =
    cp.exitCode === 0 &&
    (cp.stdout.includes('YSK_RDB_COPIED') || (existsSync(out) && fileBytes(out) > 0));

  if (!copied) {
    // local copyFile fallback if same machine readable
    try {
      if (existsSync(src)) {
        copyFileSync(src, out);
      }
    } catch {
      /* */
    }
  }

  if (existsSync(out) && fileBytes(out) > 0) {
    return assertHonestOps({
      ok: true,
      apply_status: 'written',
      notes: [`Redis RDB 已複製 ${src} → ${out}（BGSAVE）`],
      path: out,
      bytes: fileBytes(out),
      method: 'bgsave-copy' as const,
      written: [out],
    });
  }

  return assertHonestOps({
    ok: false,
    apply_status: 'failed',
    notes: [
      `無法取得 Redis RDB（src=${src}）`,
      (rdb.stderr || rdb.stdout || '').slice(0, 150),
      (cp.stdout || cp.stderr || '').slice(0, 150),
      last.slice(0, 100),
    ].filter(Boolean),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
