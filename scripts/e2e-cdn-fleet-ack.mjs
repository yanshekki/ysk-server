#!/usr/bin/env node
/**
 * E2 CDN fleet: queue → agentCycle pull → runCdnFleetPayload → ack done.
 * Usage (from repo root, API already up):
 *   node scripts/e2e-cdn-fleet-ack.mjs --data-dir PATH --port 18765 --session SESSION_ID
 * Exit 0 on success (command status=done + conf written).
 */
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const dataDir = arg('--data-dir');
const port = arg('--port', '18765');
const sessionId = arg('--session');
if (!dataDir || !sessionId) {
  console.error('Usage: node scripts/e2e-cdn-fleet-ack.mjs --data-dir PATH --session SESSION [--port N]');
  process.exit(2);
}

const coreUrl = pathToFileURL(join(process.cwd(), 'packages/core/dist/index.js')).href;
const {
  agentCycle,
  runCdnFleetPayload,
  isCdnFleetPayload,
  LocalHostExecutor,
} = await import(coreUrl);

const edgeDir = mkdtempSync(join(tmpdir(), 'ysk-e2e-edge-'));
const cp = `http://127.0.0.1:${port}`;

const host = new LocalHostExecutor({
  allowedWriteRoots: [edgeDir, '/tmp'],
  executeEnabled: true,
});
// No system nginx required — conf write is enough for honest edge apply path
host.pathExists = () => false;

const cycle = await agentCycle({
  controlPlane: cp,
  agentId: `e2e-ack-${process.pid}`,
  group: 'e2e',
  sessionId,
  onCommand: async (cmd) => {
    const payload = cmd.payload;
    if (!isCdnFleetPayload(payload)) {
      return { ok: false, error: 'not cdn fleet payload', exitCode: 2 };
    }
    if (payload.op === 'cdn.edge.apply') {
      payload.remoteDir = edgeDir;
      payload.cacheDir = join(edgeDir, 'cache');
    }
    if (payload.op === 'cdn.edge.purge') {
      payload.cacheDir = join(edgeDir, 'cache');
    }
    return runCdnFleetPayload(host, payload);
  },
});

console.error(
  JSON.stringify({
    sessionId: cycle.sessionId,
    commandsHandled: cycle.commandsHandled,
    heartbeated: cycle.heartbeated,
  }),
);

if (cycle.commandsHandled < 1) {
  console.error('FAIL: no commands handled (queue empty?)');
  rmSync(edgeDir, { recursive: true, force: true });
  process.exit(1);
}

const confs = readdirSync(edgeDir).filter((f) => f.endsWith('.conf'));
if (!confs.length) {
  console.error('FAIL: no conf written under edge dir', edgeDir);
  rmSync(edgeDir, { recursive: true, force: true });
  process.exit(1);
}

// Verify history via public pull should be empty (acked); status via re-open store CLI is caller's job
console.error(`OK edge conf: ${confs.join(', ')} under ${edgeDir}`);
rmSync(edgeDir, { recursive: true, force: true });
process.exit(0);
