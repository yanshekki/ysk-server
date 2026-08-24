import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { patchNearValidatorAccountId, readNearStakingIdentity } from './near.js';
import { buildValidatorInstance, upsertValidatorInstance } from '../store.js';

const PUB = 'ed25519:CE3QAXyVLeScmY9YeEyR3Tw9yXfjBPzFLzroTranYtVb';
const SECRET = 'ed25519:3D4YudUQk3jWtvzkNY7337sFFnM67Jeo8ZZh8eEVzxQK';

const dirs: string[] = [];

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-near-ident-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readNearStakingIdentity', () => {
  it('returns public fields only and never leaks secret_key', () => {
    const dataPath = dataDir();
    writeFileSync(
      join(dataPath, 'validator_key.json'),
      JSON.stringify({
        account_id: 'demo.pool.f863973.m0',
        public_key: PUB,
        secret_key: SECRET,
      }),
    );
    writeFileSync(
      join(dataPath, 'config.json'),
      JSON.stringify({
        network: { addr: '0.0.0.0:24567', public_addr: '203.0.113.9:24567' },
      }),
    );
    const ident = readNearStakingIdentity({ network: 'testnet', dataPath });
    expect(ident.stakePublicKey).toBe(PUB);
    expect(ident.accountId).toBe('demo.pool.f863973.m0');
    expect(ident.publicAddr).toBe('203.0.113.9:24567');
    expect(ident.factoryAccount).toBe('pool.f863973.m0');
    expect(ident.poolAccountSuffix).toBe('.pool.f863973.m0');
    expect(ident.storageNear).toBe(30);
    expect(ident.createCommand).toContain(PUB);
    expect(ident.createCommand).toContain('pool.f863973.m0');
    expect(ident.createCommand).toContain('--amount=30');
    const dumped = JSON.stringify(ident);
    expect(dumped).not.toContain(SECRET);
    expect(dumped).not.toMatch(/secret_key|private_key/i);
  });

  it('treats missing files as pending, still returns the factory command', () => {
    const ident = readNearStakingIdentity({
      network: 'mainnet',
      dataPath: join(dataDir(), 'missing'),
    });
    expect(ident.stakePublicKey).toBeNull();
    expect(ident.accountId).toBeNull();
    expect(ident.publicAddr).toBeNull();
    expect(ident.factoryAccount).toBe('poolv1.near');
    expect(ident.createCommand).toContain('poolv1.near');
    expect(ident.createCommand).toContain('<STAKE_PUBLIC_KEY>');
  });

  it('ignores broken JSON and secret-shaped public_key', () => {
    const dataPath = dataDir();
    writeFileSync(join(dataPath, 'validator_key.json'), '{not json');
    writeFileSync(join(dataPath, 'config.json'), '{"network":{"public_addr":');
    const ident = readNearStakingIdentity({ network: 'testnet', dataPath });
    expect(ident.stakePublicKey).toBeNull();
    expect(ident.publicAddr).toBeNull();
    expect(JSON.stringify(ident)).not.toMatch(/secret_key/i);
  });

  it('reads top-level public_addr when network.public_addr is absent', () => {
    const dataPath = dataDir();
    mkdirSync(dataPath, { recursive: true });
    writeFileSync(
      join(dataPath, 'config.json'),
      JSON.stringify({ public_addr: '198.51.100.4:24567' }),
    );
    const ident = readNearStakingIdentity({ network: 'testnet', dataPath });
    expect(ident.publicAddr).toBe('198.51.100.4:24567');
  });
});

describe('patchNearValidatorAccountId', () => {
  const host = { executeEnabled: () => true, isRoot: () => true } as never;

  it('writes only account_id and never returns secret_key', () => {
    const root = dataDir();
    const inst = buildValidatorInstance({
      dataDir: root,
      chain: 'near',
      network: 'testnet',
      profile: 'pruned',
    });
    mkdirSync(inst.dataPath, { recursive: true });
    const keyPath = join(inst.dataPath, 'validator_key.json');
    writeFileSync(
      keyPath,
      JSON.stringify({ account_id: '', public_key: PUB, secret_key: SECRET }),
    );
    upsertValidatorInstance(root, inst);
    const dry = patchNearValidatorAccountId({
      dataDir: root,
      host,
      id: inst.id,
      poolSlug: 'demo',
      confirm: inst.id,
      execute: false,
    });
    expect(dry.apply_status).toBe('written');
    expect(JSON.parse(readFileSync(keyPath, 'utf8')).account_id).toBe('');

    const applied = patchNearValidatorAccountId({
      dataDir: root,
      host,
      id: inst.id,
      poolSlug: 'demo',
      confirm: inst.id,
      execute: true,
    });
    expect(applied.apply_status).toBe('applied');
    expect(JSON.stringify(applied)).not.toContain(SECRET);
    const onDisk = JSON.parse(readFileSync(keyPath, 'utf8')) as {
      account_id: string;
      public_key: string;
      secret_key: string;
    };
    expect(onDisk.account_id).toBe('demo.pool.f863973.m0');
    expect(onDisk.public_key).toBe(PUB);
    expect(onDisk.secret_key).toBe(SECRET);
  });

  it('rejects a bad slug and a missing key file', () => {
    const root = dataDir();
    const inst = buildValidatorInstance({
      dataDir: root,
      chain: 'near',
      network: 'testnet',
      profile: 'pruned',
    });
    mkdirSync(inst.dataPath, { recursive: true });
    upsertValidatorInstance(root, inst);
    const bad = patchNearValidatorAccountId({
      dataDir: root,
      host,
      id: inst.id,
      poolSlug: 'No.Dots',
      confirm: inst.id,
      execute: true,
    });
    expect(bad.apply_status).toBe('blocked');
    writeFileSync(join(inst.dataPath, 'validator_key.json'), JSON.stringify({ account_id: '' }));
    const missing = patchNearValidatorAccountId({
      dataDir: root,
      host,
      id: inst.id,
      poolSlug: 'demo',
      confirm: inst.id,
      execute: true,
    });
    expect(missing.apply_status).toBe('blocked');
  });
});
