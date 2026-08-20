import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ValidatorInstanceDto } from 'ysk-server-shared';
import {
  btcCookiePaths,
  aptosFullnodeYaml,
  buildAptosComposeYaml,
  buildBtcComposeYaml,
  buildCosmosComposeYaml,
  buildDotComposeYaml,
  buildSolComposeYaml,
  buildSuiComposeYaml,
  cosmosChainId,
  cosmosGenesisUrl,
  cosmosSeeds,
  cosmosStateSyncRpcs,
  ensureCosmosGenesisFile,
  ensureCosmosStateSyncFile,
  ensureSuiFullnodeFiles,
  suiFullnodeYaml,
  parseAptosLedger,
  parseBtcCookieFile,
  parseBtcInfo,
  parseCosmosStatus,
  parseDotSync,
  parseSolHealth,
  parseSuiHealth,
  probeBtcStatus,
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

  it('Bitcoin empty RPC body is unreachable, not a JSON syntax error', async () => {
    const fetchFn = (async () => new Response('', { status: 200 })) as unknown as typeof fetch;
    const r = await probeBtcStatus(
      spec({ id: 'btc-testnet-2', chain: 'btc', network: 'testnet', ports: { rpc: 8334 } }),
      fetchFn,
    );
    expect(r.lastError).toMatch(/rpc/i);
    expect(r.lastError).not.toMatch(/JSON/i);
  });

  it('Bitcoin cookie file is used for RPC basic auth', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-btc-cookie-'));
    mkdirSync(join(dir, 'testnet3'), { recursive: true });
    writeFileSync(join(dir, 'testnet3', '.cookie'), '__cookie__:s3cret\n');
    expect(btcCookiePaths(dir, 'testnet')[0]).toContain('testnet3/.cookie');
    expect(parseBtcCookieFile('__cookie__:s3cret')).toEqual({ user: '__cookie__', pass: 's3cret' });
    let auth = '';
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      const h = init?.headers as Record<string, string> | undefined;
      auth = String(h?.authorization ?? '');
      return new Response(
        JSON.stringify({ result: { verificationprogress: 0.2, connections: 1, chain: 'test' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const r = await probeBtcStatus(
      spec({
        id: 'btc-testnet-2',
        chain: 'btc',
        network: 'testnet',
        dataPath: dir,
        ports: { rpc: 8334 },
      }),
      fetchFn,
    );
    rmSync(dir, { recursive: true, force: true });
    expect(auth.startsWith('Basic ')).toBe(true);
    expect(r.syncProgress).toBe(0.2);
    expect(r.lastError).toBeNull();
  });

  it('Cosmos gaiad init + rpc', () => {
    const y = buildCosmosComposeYaml(spec({ id: 'cosmos-testnet-1', chain: 'cosmos', network: 'testnet', ports: { rpc: 26657, p2p: 26656 } }));
    expect(y).toContain('gaiad');
    expect(y).toContain('--minimum-gas-prices=0.005uatom');
    expect(y).toContain('official-genesis.json');
    expect(y).toContain('--chain-id provider');
    expect(y).toContain('provider-seed-01');
    expect(y).toContain('--p2p.seeds=');
    expect(y).toContain('v28.0.0-rc0');
    expect(y).toContain('statesync.env');
    expect(y).toContain('[statesync]');
    expect(y).toContain('s/^enable = .*/enable = true/');
    expect(y).not.toContain("'/enable =/");
    expect(y).toContain('refusing InitChain');
    expect(y).toContain('ifconfig.me');
    expect(y).toContain('external_address');
    expect(y).toContain('data dir not writable');
    expect(y).toContain('127.0.0.1:26657:26657');
    expect(cosmosChainId('testnet')).toBe('provider');
    expect(cosmosGenesisUrl('testnet')).toContain('provider-genesis.json');
    expect(cosmosSeeds('testnet')).toContain('provider-seed-01');
    expect(cosmosStateSyncRpcs('testnet')[0]).toContain('provider-state-sync-01');
    expect(cosmosStateSyncRpcs('mainnet')).toEqual([]);
    expect(parseCosmosStatus({ result: { sync_info: { catching_up: false }, node_info: { version: '23' } } }).syncProgress).toBe(1);
  });

  it('writes official Cosmos genesis instead of empty gaiad init', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cosmos-'));
    const fetchFn = (async () =>
      new Response(Buffer.from(`{"chain_id":"provider","app_state":${'{}'.repeat(20)}}`), {
        status: 200,
      })) as unknown as typeof fetch;
    const r = await ensureCosmosGenesisFile(dir, 'testnet', fetchFn);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'official-genesis.json'), 'utf8')).toContain('provider');
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes Cosmos state-sync trust height from official RPC', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cosmos-ss-'));
    const fetchFn = (async (url: string) => {
      const u = String(url);
      if (u.includes('height=')) {
        return new Response(JSON.stringify({ result: { block_id: { hash: 'A'.repeat(64) } } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify({ result: { block: { header: { height: '18547000' } } } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const r = await ensureCosmosStateSyncFile(dir, 'testnet', fetchFn);
    expect(r.ok).toBe(true);
    const env = readFileSync(join(dir, 'statesync.env'), 'utf8');
    expect(env).toContain('TRUST_HEIGHT=18546000');
    expect(env).toContain(`TRUST_HASH=${'A'.repeat(64)}`);
    expect(env).toContain('provider-state-sync-01');
    rmSync(dir, { recursive: true, force: true });
  });

  it('Sui / Aptos / Polkadot / Solana heavy', () => {
    const sui = buildSuiComposeYaml(spec({ id: 'sui-testnet-1', chain: 'sui', network: 'testnet', ports: { rpc: 9002 } }));
    expect(sui).toContain('sui-node');
    expect(sui).toContain('8084/udp');
    expect(sui).toContain('testnet-v1.78.0');
    expect(sui).not.toContain('mainnet-v1.44.2');
    expect(
      buildSuiComposeYaml(spec({ id: 'sui-mainnet-1', chain: 'sui', network: 'mainnet', ports: { rpc: 9002 } })),
    ).toContain('mainnet-v1.77.2');
    const aptos = buildAptosComposeYaml(
      spec({ id: 'aptos-testnet-1', chain: 'aptos', network: 'testnet', ports: { rpc: 18080, p2p: 6180 } }),
    );
    expect(aptos).toContain('aptos-node');
    expect(aptosFullnodeYaml()).toContain('network_id: "public"');
    expect(aptos).toContain('127.0.0.1:18080:8080');
    expect(aptos).not.toContain('127.0.0.1:8080:8080');
    expect(aptos).toContain('nofile:');
    expect(aptos).toContain('1048576');
    expect(aptos).not.toContain('65536');
    expect(buildDotComposeYaml(spec({ id: 'dot-westend-1', chain: 'dot', network: 'westend', ports: { rpc: 9933, p2p: 30333 } }))).toContain('--chain=westend');
    const sol = buildSolComposeYaml(spec({ id: 'sol-mainnet-1', chain: 'sol', network: 'mainnet', ports: { rpc: 8899 } }));
    expect(sol).toContain('HEAVY');
    expect(sol).toContain('anzaxyz/agave:v2.1.11');
    expect(sol).not.toContain('solanalabs/solana');
    expect(sol).toContain('agave-validator');
    expect(sol).not.toContain('solana-validator');
    expect(sol).toContain('--no-voting');
    expect(sol).toContain('8000-8020/udp');
    expect(sol).not.toContain('--expected-genesis-hash');
    expect(parseSuiHealth({ result: 1 }).syncProgress).toBe(1);
    expect(parseAptosLedger({ chain_id: 1, ledger_version: '9' }).syncProgress).toBe(1);
    expect(parseDotSync({ result: { currentBlock: 5, highestBlock: 10, isSyncing: true } }).syncProgress).toBe(0.5);
    expect(parseSolHealth({ result: 'ok' }).syncProgress).toBe(1);
  });

  it('writes Sui fullnode.yaml and genesis from the official URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sui-'));
    const fetchFn = (async () => new Response(Buffer.from('genesis-blob-contents-ok'), { status: 200 })) as unknown as typeof fetch;
    const r = await ensureSuiFullnodeFiles(dir, 'testnet', fetchFn);
    expect(r.ok).toBe(true);
    expect(readFileSync(join(dir, 'fullnode.yaml'), 'utf8')).toContain('genesis-file-location');
    expect(suiFullnodeYaml('testnet')).toContain('testnet');
    expect(suiFullnodeYaml('testnet')).toContain('ewr-tnt-ssfn');
    expect(suiFullnodeYaml('testnet')).toContain('seed-peers');
    rmSync(dir, { recursive: true, force: true });
  });
});
