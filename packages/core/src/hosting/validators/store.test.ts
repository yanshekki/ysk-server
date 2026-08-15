import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildValidatorInstance,
  deleteValidatorInstance,
  getValidatorInstance,
  listValidatorInstances,
  nextValidatorInstanceId,
  upsertValidatorInstance,
} from './store.js';

describe('validator store', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function tmp(): string {
    const d = mkdtempSync(join(tmpdir(), 'ysk-val-'));
    dirs.push(d);
    return d;
  }

  it('creates sequential ids and persists', () => {
    const dataDir = tmp();
    expect(nextValidatorInstanceId(dataDir, 'eth', 'hoodi')).toBe('eth-hoodi-1');
    const a = buildValidatorInstance({
      dataDir,
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
    });
    upsertValidatorInstance(dataDir, a);
    expect(nextValidatorInstanceId(dataDir, 'eth', 'hoodi')).toBe('eth-hoodi-2');
    expect(listValidatorInstances(dataDir)).toHaveLength(1);
    expect(getValidatorInstance(dataDir, 'eth-hoodi-1')?.profile).toBe('minimal');
    expect(getValidatorInstance(dataDir, 'eth-hoodi-1')?.rpcHost).toBe('127.0.0.1');
    expect(getValidatorInstance(dataDir, 'eth-hoodi-1')?.upgradePolicy).toBe('notify');
  });

  it('defaults mainnet upgrade policy to manual', () => {
    const dataDir = tmp();
    const inst = buildValidatorInstance({
      dataDir,
      chain: 'eth',
      network: 'mainnet',
      profile: 'pruned',
    });
    expect(inst.upgradePolicy).toBe('manual');
  });

  it('rejects junk records on load and can delete', () => {
    const dataDir = tmp();
    const inst = buildValidatorInstance({
      dataDir,
      chain: 'avax',
      network: 'fuji',
      profile: 'minimal',
    });
    upsertValidatorInstance(dataDir, inst);
    expect(deleteValidatorInstance(dataDir, inst.id)).toBe(true);
    expect(deleteValidatorInstance(dataDir, inst.id)).toBe(false);
    expect(listValidatorInstances(dataDir)).toEqual([]);
  });

  it('drops invalid stored ids', () => {
    const dataDir = tmp();
    mkdirSync(join(dataDir, 'validators'), { recursive: true });
    writeFileSync(
      join(dataDir, 'validators', 'instances.json'),
      JSON.stringify({
        version: 1,
        instances: [{ id: '../evil', chain: 'eth', network: 'hoodi', profile: 'rpc' }],
      }),
    );
    expect(listValidatorInstances(dataDir)).toEqual([]);
  });
});
