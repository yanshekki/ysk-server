import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildValidatorInstance, upsertValidatorInstance } from 'ysk-server-core';
import { createAppContext, closeAppContext } from '../app-context.js';
import { VERSION } from '../version.js';
import { runValidatorsCommand } from './cmd-validators.js';

describe('cmd-validators', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('lists empty then get 404 / list after upsert', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-val-cli-'));
    dirs.push(dataDir);
    const ctx = createAppContext({ version: VERSION, dataDir, executeEnabled: false });
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
      const listCode = await runValidatorsCommand(ctx, ['validators', 'list'], true, h);
      expect(listCode).toBe(0);
      expect((printed.at(-1) as { instances: unknown[] }).instances).toEqual([]);

      const chainsCode = await runValidatorsCommand(ctx, ['validators', 'chains'], true, h);
      expect(chainsCode).toBe(0);
      expect((printed.at(-1) as { chains: { id: string }[] }).chains.some((c) => c.id === 'eth')).toBe(
        true,
      );

      const missing = await runValidatorsCommand(
        ctx,
        ['validators', 'get', '--id', 'eth-hoodi-1'],
        true,
        h,
      );
      expect(missing).toBe(4);

      upsertValidatorInstance(
        dataDir,
        buildValidatorInstance({
          dataDir,
          chain: 'eth',
          network: 'hoodi',
          profile: 'minimal',
        }),
      );
      const got = await runValidatorsCommand(
        ctx,
        ['validators', 'get', '--id', 'eth-hoodi-1'],
        true,
        h,
      );
      expect(got).toBe(0);
      expect((printed.at(-1) as { instance: { id: string } }).instance.id).toBe('eth-hoodi-1');
    } finally {
      closeAppContext(ctx);
    }
  });
});
