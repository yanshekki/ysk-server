import { describe, expect, it } from 'vitest';
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import {
  buildAptosComposeYaml,
  buildBtcComposeYaml,
  buildCosmosComposeYaml,
  buildDotComposeYaml,
  buildSolComposeYaml,
  buildSuiComposeYaml,
  parseAptosLedger,
  parseBtcInfo,
  parseCosmosStatus,
  parseDotSync,
  parseSolHealth,
  parseSuiHealth,
} from './phase2.js';

function spec(over: Partial<ValidatorInstanceDto> & Pick<ValidatorInstanceDto, 'id' | 'chain' | 'network'>): ValidatorInstanceDto {
  return {
    profile: 'pruned',
    slug: '1',
    dataPath: `/data/${over.id}`,
    rpcHost: '127.0.0.1',
    upgradePolicy: 'notify',
    desiredState: 'stopped',
    createdAt: '',
    updatedAt: '',
    clients: {},
    ports: {},
    ...over,
  };
}

describe('phase 2 compose + status parsers', () => {
  it('Bitcoin prune + localhost rpc', () => {
    const y = buildBtcComposeYaml(spec({ id: 'btc-testnet-1', chain: 'btc', network: 'testnet', ports: { rpc: 18332, p2p: 18333 } }));
    expect(y).toContain('lncm/bitcoind');
    expect(y).not.toMatch(/command:\n\s+- bitcoind\n/);
    expect(y).toContain('-prune=550');
    expect(y).toContain('-testnet=1');
    expect(y).toContain('127.0.0.1:18332:18332');
    expect(parseBtcInfo({ result: { verificationprogress: 0.5, connections: 8, chain: 'test' } }).syncProgress).toBe(0.5);
  });

  it('Cosmos gaiad init + rpc', () => {
    const y = buildCosmosComposeYaml(spec({ id: 'cosmos-testnet-1', chain: 'cosmos', network: 'testnet', ports: { rpc: 26657, p2p: 26656 } }));
    expect(y).toContain('gaiad');
    expect(y).toContain('data dir not writable');
    expect(y).toContain('127.0.0.1:26657:26657');
    expect(parseCosmosStatus({ result: { sync_info: { catching_up: false }, node_info: { version: '23' } } }).syncProgress).toBe(1);
  });

  it('Sui / Aptos / Polkadot / Solana heavy', () => {
    expect(buildSuiComposeYaml(spec({ id: 'sui-testnet-1', chain: 'sui', network: 'testnet', ports: { rpc: 9002 } }))).toContain('sui-node');
    expect(buildAptosComposeYaml(spec({ id: 'aptos-testnet-1', chain: 'aptos', network: 'testnet', ports: { rpc: 8080, p2p: 6180 } }))).toContain('aptos-node');
    expect(buildDotComposeYaml(spec({ id: 'dot-westend-1', chain: 'dot', network: 'westend', ports: { rpc: 9933, p2p: 30333 } }))).toContain('--chain=westend');
    const sol = buildSolComposeYaml(spec({ id: 'sol-mainnet-1', chain: 'sol', network: 'mainnet', ports: { rpc: 8899 } }));
    expect(sol).toContain('HEAVY');
    expect(sol).toContain('--no-voting');
    expect(parseSuiHealth({ result: 1 }).syncProgress).toBe(1);
    expect(parseAptosLedger({ chain_id: 1, ledger_version: '9' }).syncProgress).toBe(1);
    expect(parseDotSync({ result: { currentBlock: 5, highestBlock: 10, isSyncing: true } }).syncProgress).toBe(0.5);
    expect(parseSolHealth({ result: 'ok' }).syncProgress).toBe(1);
  });
});
