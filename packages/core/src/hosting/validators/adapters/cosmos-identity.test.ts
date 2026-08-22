import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCosmosStakingIdentity } from './cosmos-identity.js';

const PUB_B64 = 'AtbAQs/I3FBJ0P9qz9pPjM6qGz8w0n8kP1n6s8kQe1A=';
const PRIV_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const dirs: string[] = [];

function dataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ysk-cosmos-ident-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'config'), { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('readCosmosStakingIdentity', () => {
  it('returns consensus pubkey JSON and never leaks priv_key', () => {
    const dataPath = dataDir();
    writeFileSync(
      join(dataPath, 'config', 'priv_validator_key.json'),
      JSON.stringify({
        address: 'AABBCC',
        pub_key: { type: 'tendermint/PubKeyEd25519', value: PUB_B64 },
        priv_key: { type: 'tendermint/PrivKeyEd25519', value: PRIV_B64 },
      }),
    );
    writeFileSync(
      join(dataPath, 'config', 'config.toml'),
      ['[p2p]', 'laddr = "tcp://0.0.0.0:26656"', 'external_address = "tcp://203.0.113.8:26656"', ''].join(
        '\n',
      ),
    );
    const ident = readCosmosStakingIdentity({ network: 'testnet', dataPath });
    expect(ident.chainId).toBe('provider');
    expect(ident.externalAddress).toBe('tcp://203.0.113.8:26656');
    expect(ident.consensusPubkey).toContain(PUB_B64);
    expect(ident.consensusPubkey).toContain('/cosmos.crypto.ed25519.PubKey');
    expect(ident.createCommand).toContain('--chain-id=provider');
    expect(ident.createCommand).toContain(PUB_B64);
    const dumped = JSON.stringify(ident);
    expect(dumped).not.toContain(PRIV_B64);
    expect(dumped).not.toMatch(/priv_key/i);
  });

  it('uses cosmoshub-4 on mainnet and pending when files are missing', () => {
    const ident = readCosmosStakingIdentity({
      network: 'mainnet',
      dataPath: join(dataDir(), 'empty-home'),
    });
    expect(ident.chainId).toBe('cosmoshub-4');
    expect(ident.consensusPubkey).toBeNull();
    expect(ident.createCommand).toContain('--chain-id=cosmoshub-4');
    expect(ident.createCommand).toContain('<CONSENSUS_PUBKEY_JSON>');
  });
});
