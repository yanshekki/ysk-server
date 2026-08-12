/**
 * Detached BT tracker worker entry.
 * Usage: node worker.js --data-dir=/var/lib/ysk
 */
import { loadBtTrackerSettings } from './settings.js';
import { startBtTracker, stopBtTracker } from './service.js';
import type { HostExecutor } from '../../host/executor.js';

function parseDataDir(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--data-dir=')) return a.slice('--data-dir='.length);
    if (a === '--data-dir' && argv[i + 1]) return argv[i + 1]!;
  }
  return process.env.YSK_BT_TRACKER_DATA_DIR || process.env.YSK_DATA_DIR || '';
}

const host: HostExecutor = {
  executeEnabled: () => process.env.YSK_EXECUTE === '1',
  isRoot: () => typeof process.getuid === 'function' && process.getuid() === 0,
} as HostExecutor;

async function main(): Promise<void> {
  const dataDir = parseDataDir(process.argv.slice(2)).trim();
  if (!dataDir) {
    process.stderr.write('bt-tracker-worker: need --data-dir\n');
    process.exit(2);
  }
  const settings = loadBtTrackerSettings(dataDir);
  const r = await startBtTracker({ dataDir, host });
  if (!r.ok) {
    process.stderr.write(`bt-tracker-worker: start failed: ${r.notes.join('; ')}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `bt-tracker-worker: listening httpPort=${settings.httpPort} pid=${process.pid}\n`,
  );

  const shutdown = async () => {
    await stopBtTracker();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
  // keep alive
  setInterval(() => undefined, 60_000).unref();
}

void main().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.stack || e.message : e) + '\n');
  process.exit(1);
});
