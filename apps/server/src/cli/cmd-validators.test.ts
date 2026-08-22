import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('checklist returns NEAR public key and omits secret_key', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-val-cli-check-'));
    dirs.push(dataDir);
    const inst = buildValidatorInstance({
      dataDir,
      chain: 'near',
      network: 'testnet',
      profile: 'pruned',
    });
    mkdirSync(inst.dataPath, { recursive: true });
    const pub = 'ed25519:CE3QAXyVLeScmY9YeEyR3Tw9yXfjBPzFLzroTranYtVb';
    writeFileSync(
      join(inst.dataPath, 'validator_key.json'),
      JSON.stringify({
        account_id: '',
        public_key: pub,
        secret_key: 'ed25519:3D4YudUQk3jWtvzkNY7337sFFnM67Jeo8ZZh8eEVzxQK',
      }),
    );
    upsertValidatorInstance(dataDir, inst);
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
      exitFromResult: (r: { apply_status?: string }) => (r.apply_status === 'blocked' ? 3 : 0),
    };
    try {
      const code = await runValidatorsCommand(
        ctx,
        ['validators', 'checklist', '--id', inst.id],
        true,
        h,
      );
      expect(code).toBe(0);
      const body = printed.at(-1) as { ok: boolean; near?: { stakePublicKey?: string } };
      expect(body.ok).toBe(true);
      expect(body.near?.stakePublicKey).toBe(pub);
      expect(JSON.stringify(body)).not.toMatch(/secret_key|3D4YudUQk3jWtvzkNY7337sFFnM67Jeo8ZZh8eEVzxQK/);

      const dry = await runValidatorsCommand(
        ctx,
        ['validators', 'rewrite-compose', '--id', inst.id],
        true,
        h,
      );
      expect(dry).toBe(0);
      const dryBody = printed.at(-1) as { apply_status?: string; dryRun?: boolean };
      expect(dryBody.apply_status).toBe('written');
      expect(dryBody.dryRun).toBe(true);
    } finally {
      closeAppContext(ctx);
    }
  });

  it('leftover-remove is blocked without EXECUTE; compose-write dry-run is written', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-val-cli-extra-'));
    dirs.push(dataDir);
    const inst = buildValidatorInstance({
      dataDir,
      chain: 'near',
      network: 'testnet',
      profile: 'pruned',
    });
    upsertValidatorInstance(dataDir, inst);
    const leftover = join(dataDir, 'validators', 'orphan-cli');
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, 'keep.txt'), 'x');
    const yamlPath = join(dataDir, 'validators', inst.id, 'compose.yml');
    mkdirSync(join(dataDir, 'validators', inst.id), { recursive: true });
    writeFileSync(yamlPath, `# ysk-server validators ${inst.id}\nservices: {}\n`);
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
      exitFromResult: (r: { apply_status?: string; blocked?: boolean }) =>
        r.apply_status === 'blocked' || r.blocked ? 3 : 0,
    };
    try {
      const leftoverCode = await runValidatorsCommand(
        ctx,
        ['validators', 'leftover-remove', '--path', leftover, '--confirm', 'orphan-cli'],
        true,
        h,
      );
      expect(leftoverCode).toBe(3);
      expect((printed.at(-1) as { apply_status?: string }).apply_status).toBe('blocked');

      const softwareCode = await runValidatorsCommand(ctx, ['validators', 'software'], true, h);
      expect(softwareCode).toBe(0);
      expect((printed.at(-1) as { ok?: boolean; images?: unknown[] }).ok).toBe(true);

      const writeCode = await runValidatorsCommand(
        ctx,
        ['validators', 'compose-write', '--id', inst.id, '--file', yamlPath],
        true,
        h,
      );
      expect(writeCode).toBe(0);
      const writeBody = printed.at(-1) as { apply_status?: string; dryRun?: boolean };
      expect(writeBody.apply_status).toBe('written');
      expect(writeBody.dryRun).toBe(true);
    } finally {
      closeAppContext(ctx);
    }
  });
});
