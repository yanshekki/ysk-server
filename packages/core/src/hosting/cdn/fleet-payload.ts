/**
 * CDN fleet command payloads — control plane enqueues; edge agent executes.
 * Honesty: queued ≠ nginx applied until agent ack with ok.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HostExecutor } from '../../host/executor.js';

export type CdnFleetEnqueueFn = (
  sessionId: string,
  payload: unknown,
) => { id: string; agent_session_id?: string; status?: string };

export type CdnFleetApplyPayload = {
  op: 'cdn.edge.apply';
  siteId: string;
  edgeNodeId: string;
  confBasename: string;
  confContent: string;
  remoteDir: string;
  cacheDir: string;
};

export type CdnFleetPurgePayload = {
  op: 'cdn.edge.purge';
  siteId: string;
  edgeNodeId: string;
  cacheDir: string;
};

export type CdnFleetPayload = CdnFleetApplyPayload | CdnFleetPurgePayload;

export function isCdnFleetPayload(p: unknown): p is CdnFleetPayload {
  if (!p || typeof p !== 'object') return false;
  const op = (p as { op?: string }).op;
  return op === 'cdn.edge.apply' || op === 'cdn.edge.purge';
}

export type CdnFleetRunResult = {
  ok: boolean;
  exitCode: number;
  op: string;
  notes: string[];
  reloaded?: boolean;
  path?: string;
  at: string;
};

/**
 * Run CDN fleet payload on the local host (edge agent side).
 * Never pretends success without real nginx/write results.
 */
export async function runCdnFleetPayload(
  host: HostExecutor,
  payload: CdnFleetPayload,
): Promise<CdnFleetRunResult> {
  const at = new Date().toISOString();
  if (payload.op === 'cdn.edge.purge') {
    const cacheDir = payload.cacheDir?.trim() || `/var/cache/ysk-cdn/${payload.siteId}`;
    const purgeCmd = [
      `if [ -d ${JSON.stringify(cacheDir)} ]; then`,
      `  find ${JSON.stringify(cacheDir)} -type f -delete 2>/dev/null;`,
      `  echo PURGE_OK;`,
      `else`,
      `  mkdir -p ${JSON.stringify(cacheDir)}; echo PURGE_EMPTY;`,
      `fi`,
    ].join(' ');
    const r = await host.runCommand(['bash', '-c', purgeCmd], { timeoutMs: 40_000 });
    const ok =
      r.exitCode === 0 &&
      (/PURGE_OK/.test(r.stdout || '') || /PURGE_EMPTY/.test(r.stdout || ''));
    return {
      ok,
      exitCode: r.exitCode,
      op: payload.op,
      notes: [
        ok
          ? /PURGE_EMPTY/.test(r.stdout || '')
            ? `cache empty/created ${cacheDir}`
            : `purged ${cacheDir}`
          : `purge failed: ${(r.stderr || r.stdout || '').slice(0, 160)}`,
      ],
      at,
    };
  }

  // apply
  const remoteDir = payload.remoteDir?.trim() || '/etc/nginx/conf.d';
  const confBasename = payload.confBasename?.trim() || 'ysk-cdn.conf';
  const dest = join(remoteDir, confBasename);
  const cacheDir = payload.cacheDir?.trim() || `/var/cache/ysk-cdn/${payload.siteId}`;
  const notes: string[] = [];

  if (!payload.confContent || !payload.confContent.trim()) {
    return {
      ok: false,
      exitCode: 2,
      op: payload.op,
      notes: ['confContent empty — refuse write'],
      at,
    };
  }

  try {
    mkdirSync(remoteDir, { recursive: true });
    writeFileSync(dest, payload.confContent, 'utf8');
    notes.push(`wrote ${dest}`);
  } catch (e) {
    return {
      ok: false,
      exitCode: 1,
      op: payload.op,
      notes: [
        `write conf failed: ${e instanceof Error ? e.message : String(e)}`,
      ],
      at,
    };
  }

  await host.runCommand(['mkdir', '-p', cacheDir], { timeoutMs: 8_000 });

  const hasNginx =
    host.pathExists('/usr/sbin/nginx') || host.pathExists('/usr/bin/nginx');
  if (!hasNginx) {
    notes.push('no nginx on this host — conf written only');
    return {
      ok: true,
      exitCode: 0,
      op: payload.op,
      notes,
      reloaded: false,
      path: dest,
      at,
    };
  }

  const t = await host.runCommand(['nginx', '-t'], { timeoutMs: 20_000 });
  if (t.exitCode !== 0) {
    notes.push(`nginx -t failed: ${(t.stderr || t.stdout || '').slice(0, 160)}`);
    return {
      ok: false,
      exitCode: t.exitCode,
      op: payload.op,
      notes,
      reloaded: false,
      path: dest,
      at,
    };
  }

  const r = await host.runCommand(
    ['bash', '-c', 'systemctl reload nginx 2>/dev/null || nginx -s reload'],
    { timeoutMs: 20_000 },
  );
  if (r.exitCode === 0) {
    notes.push('nginx reload OK');
    return {
      ok: true,
      exitCode: 0,
      op: payload.op,
      notes,
      reloaded: true,
      path: dest,
      at,
    };
  }
  notes.push(`reload failed: ${(r.stderr || r.stdout || '').slice(0, 120)}`);
  return {
    ok: false,
    exitCode: r.exitCode || 1,
    op: payload.op,
    notes,
    reloaded: false,
    path: dest,
    at,
  };
}
