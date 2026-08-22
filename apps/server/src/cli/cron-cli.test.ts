import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSetup } from './setup.js';
import { main } from '../cli.js';

async function runMain(argv: string[]): Promise<{ code: number; out: string }> {
  const logs: string[] = [];
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    logs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await main(argv);
    return { code, out: logs.join('') };
  } finally {
    process.stdout.write = origWrite;
  }
}

function parseJson(out: string): Record<string, unknown> {
  const start = out.indexOf('{');
  return JSON.parse(start >= 0 ? out.slice(start) : out) as Record<string, unknown>;
}

describe('cli cron update', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('patches managed job fields', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-cron-cli-'));
    dirs.push(dataDir);
    runSetup({
      dataDir,
      nonInteractive: true,
      force: true,
      adminPassword: 'admin',
      allowInsecureDefaults: true,
    });
    const created = await runMain([
      'node',
      'ysk-server',
      '--data-dir',
      dataDir,
      '--json',
      'cron',
      'create',
      '--schedule',
      '0 3 * * *',
      '--command',
      'echo before',
    ]);
    expect(created.code).toBe(0);
    const job = (parseJson(created.out).job as { id: string }) ?? { id: '' };
    expect(job.id).toBeTruthy();

    const empty = await runMain([
      'node',
      'ysk-server',
      '--data-dir',
      dataDir,
      '--json',
      'cron',
      'update',
      '--id',
      job.id,
    ]);
    expect(empty.code).toBe(2);

    const missing = await runMain([
      'node',
      'ysk-server',
      '--data-dir',
      dataDir,
      '--json',
      'cron',
      'update',
      '--id',
      'no-such-job',
      '--command',
      'echo x',
    ]);
    expect(missing.code).toBe(4);

    const updated = await runMain([
      'node',
      'ysk-server',
      '--data-dir',
      dataDir,
      '--json',
      'cron',
      'update',
      '--id',
      job.id,
      '--schedule',
      '0 5 * * *',
      '--command',
      'echo after',
      '--disable',
    ]);
    expect(updated.code).toBe(0);
    const body = parseJson(updated.out);
    const next = body.job as { schedule?: string; command?: string; enabled?: boolean };
    expect(next.schedule).toBe('0 5 * * *');
    expect(next.command).toBe('echo after');
    expect(next.enabled).toBe(false);
  });
});
