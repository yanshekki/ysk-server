import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppContext, closeAppContext } from '../app-context.js';
import { VERSION } from '../version.js';
import { runDockerCommand } from './cmd-docker.js';

describe('cmd-docker', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('status returns json without execute', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dock-cli-'));
    dirs.push(dataDir);
    const ctx = createAppContext({ version: VERSION, dataDir, executeEnabled: false });
    ctx.host.runCommand = async (argv: string[]) => ({
      stdout: argv[1] === 'version' ? '' : '',
      stderr: 'docker unavailable',
      exitCode: 1,
      argv,
      dryRun: false,
    });
    const printed: unknown[] = [];
    const h = {
      printJson: (d: unknown) => {
        printed.push(d);
      },
      getOpt: (args: string[], name: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args[i + 1] : undefined;
      },
      hasFlag: (args: string[], name: string) => args.includes(name),
      wantsHostExecute: () => false,
      exitFromResult: () => 0,
    };
    try {
      const code = await runDockerCommand(ctx, ['docker', 'status'], true, h);
      expect(code).toBe(0);
      const last = printed.at(-1) as { ok: boolean; status: { installed: boolean } };
      expect(last.ok).toBe(true);
      expect(typeof last.status.installed).toBe('boolean');
    } finally {
      closeAppContext(ctx);
    }
  });
});
