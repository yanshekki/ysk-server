/**
 * Shared host fixture for core unit tests.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalHostExecutor } from '../host/executor.js';

export function makeTempDir(prefix = 'ysk-core-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function makeHost(opts?: {
  dir?: string;
  executeEnabled?: boolean;
}): { host: LocalHostExecutor; dir: string; cleanup: () => void } {
  const dir = opts?.dir ?? makeTempDir();
  const host = new LocalHostExecutor({
    allowedWriteRoots: [dir],
    // Vitest sandboxes need tar/git/run under write roots; honesty tests pass false.
    executeEnabled:
      opts?.executeEnabled ??
      (process.env.VITEST === 'true' || process.env.VITEST === '1'),
  });
  return {
    host,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
