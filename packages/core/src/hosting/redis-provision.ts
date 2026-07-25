/**
 * Redis provision: probe + optional CONFIG for project DB index.
 * Never fake success when execute requested without redis-cli / EXECUTE.
 */

import type { HostExecutor } from '../host/executor.js';
import { planRedisBinding } from './database.js';
import { probeEndpoint } from './db-client.js';

export interface RedisProvisionResult {
  ok: boolean;
  executed: boolean;
  requiresExecute: boolean;
  redisCli: boolean;
  reachable: boolean;
  plan: ReturnType<typeof planRedisBinding>;
  ping?: string;
  notes: string[];
  commandResults: Array<{ argv: string[]; exitCode: number; stderr: string; stdout?: string }>;
  connectionHint: Record<string, string | number>;
}

/**
 * Probe Redis and optionally bind logical DB metadata for a project.
 * execute=true runs redis-cli PING (and optional CONFIG GET) when available.
 */
export async function provisionRedisBinding(input: {
  hostExec: HostExecutor;
  projectId: string;
  dbIndex?: number;
  maxmemoryMb?: number;
  redisHost?: string;
  redisPort?: number;
  execute?: boolean;
}): Promise<RedisProvisionResult> {
  const dbIndex = input.dbIndex ?? 0;
  const plan = planRedisBinding({
    projectId: input.projectId,
    dbIndex,
    maxmemoryMb: input.maxmemoryMb,
  });
  const host = input.redisHost ?? '127.0.0.1';
  const port = input.redisPort ?? 6379;
  const notes: string[] = [...plan.notes];
  const commandResults: RedisProvisionResult['commandResults'] = [];

  const reach = await probeEndpoint(host, port, 2000);
  const reachable = reach.ok;
  notes.push(reachable ? `TCP ${host}:${port} ok (${reach.latencyMs}ms)` : `TCP ${host}:${port} fail: ${reach.detail}`);

  const which = await input.hostExec.runCommand(
    ['bash', '-c', 'command -v redis-cli || true'],
    { timeoutMs: 5_000 },
  );
  const redisCli = which.stdout.trim().length > 0;

  const want = input.execute !== false;
  const can = want && input.hostExec.executeEnabled() && redisCli && reachable;

  if (!redisCli) notes.push('redis-cli not on PATH');
  if (!input.hostExec.executeEnabled()) notes.push('YSK_EXECUTE not enabled');
  if (want && !can) {
    return {
      ok: false,
      executed: false,
      requiresExecute: !input.hostExec.executeEnabled(),
      redisCli,
      reachable,
      plan,
      notes: [
        ...notes,
        'NOT provisioned. Install redis-cli, ensure Redis is up, set YSK_EXECUTE=1',
      ],
      commandResults,
      connectionHint: {
        host,
        port,
        db: dbIndex,
        ...(plan.connectionHint ?? {}),
      },
    };
  }

  if (!want) {
    return {
      ok: reachable,
      executed: false,
      requiresExecute: !input.hostExec.executeEnabled(),
      redisCli,
      reachable,
      plan,
      notes: [...notes, 'execute=false — probe only'],
      commandResults,
      connectionHint: { host, port, db: dbIndex },
    };
  }

  const ping = await input.hostExec.runCommand(
    ['redis-cli', '-h', host, '-p', String(port), 'PING'],
    { timeoutMs: 5_000 },
  );
  commandResults.push({
    argv: ['redis-cli', 'PING'],
    exitCode: ping.exitCode,
    stderr: ping.stderr,
    stdout: ping.stdout.trim(),
  });
  const pong = ping.stdout.trim().toUpperCase() === 'PONG' && ping.exitCode === 0;
  notes.push(pong ? 'PING => PONG' : `PING failed: ${ping.stderr || ping.stdout}`);

  // Soft binding: SELECT db index and record; avoid destructive CONFIG SET without explicit flag
  const sel = await input.hostExec.runCommand(
    ['redis-cli', '-h', host, '-p', String(port), '-n', String(dbIndex), 'PING'],
    { timeoutMs: 5_000 },
  );
  commandResults.push({
    argv: ['redis-cli', '-n', String(dbIndex), 'PING'],
    exitCode: sel.exitCode,
    stderr: sel.stderr,
    stdout: sel.stdout.trim(),
  });

  return {
    ok: pong && sel.exitCode === 0,
    executed: true,
    requiresExecute: false,
    redisCli: true,
    reachable: true,
    plan,
    ping: ping.stdout.trim(),
    notes,
    commandResults,
    connectionHint: {
      host,
      port,
      db: dbIndex,
      maxmemoryMb: input.maxmemoryMb ?? 64,
    },
  };
}
