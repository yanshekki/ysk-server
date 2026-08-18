import { describe, expect, it } from 'vitest';
import { buildEthComposeYaml, parseEthPeerCount, parseEthSyncing } from './eth.js';
import { buildAvaxComposeYaml, parseAvaxHealth } from './avax.js';
import type { ValidatorInstanceDto } from 'ysk-server-shared';

const ethSpec = {
  id: 'eth-hoodi-1',
  chain: 'eth',
  network: 'hoodi',
  profile: 'minimal',
  slug: '1',
  dataPath: '/var/lib/ysk/validators/eth-hoodi-1/data',
  rpcHost: '127.0.0.1',
  upgradePolicy: 'notify',
  desiredState: 'stopped',
  createdAt: '',
  updatedAt: '',
  clients: {
    el: { id: 'reth', image: 'ghcr.io/paradigmxyz/reth', tag: 'v1.4.8' },
    cl: { id: 'lighthouse', image: 'sigp/lighthouse', tag: 'v7.1.0' },
  },
  ports: { rpc: 8545, p2p: 30303, p2pCl: 9000, beacon: 5052 },
} as ValidatorInstanceDto;

describe('eth adapter', () => {
  it('writes reth + lighthouse compose with localhost rpc', () => {
    const y = buildEthComposeYaml(ethSpec);
    expect(y).toContain('reth');
    expect(y).toContain('lighthouse');
    expect(y).toContain('--chain');
    expect(y).toContain('hoodi');
    expect(y).toContain('127.0.0.1:8545:8545');
    expect(y).toContain('jwt.hex');
    expect(y).not.toMatch(/mnemonic|private.?key/i);
    expect(y).toContain('--disable-deposit-contract-sync');
    expect(y).not.toMatch(/":\//);
    expect(y).toContain('"/var/lib/ysk/validators/eth-hoodi-1/data/reth:/data/reth"');
    expect(y).toContain('"/var/lib/ysk/validators/eth-hoodi-1/jwt.hex:/jwt/jwt.hex:ro"');
  });

  it('covers EL×CL combinations with jwt and localhost rpc', () => {
    const els = [
      { id: 'reth', image: 'ghcr.io/paradigmxyz/reth', tag: 'v1.4.8' },
      { id: 'geth', image: 'ethereum/client-go', tag: 'v1.15.11' },
      { id: 'nethermind', image: 'nethermind/nethermind', tag: '1.31.11' },
    ];
    const cls = [
      { id: 'lighthouse', image: 'sigp/lighthouse', tag: 'v7.1.0' },
      { id: 'prysm', image: 'gcr.io/prysmaticlabs/prysm/beacon-chain', tag: 'v6.0.4' },
      { id: 'teku', image: 'consensys/teku', tag: '25.4.1' },
      { id: 'nimbus', image: 'statusim/nimbus-eth2', tag: 'multiarch-v25.4.1' },
    ];
    let n = 0;
    for (const el of els) {
      for (const cl of cls) {
        const y = buildEthComposeYaml({ ...ethSpec, clients: { el, cl } });
        expect(y).toContain(el.image);
        expect(y).toContain(cl.image);
        expect(y).toContain('127.0.0.1:8545:8545');
        expect(y).toContain('jwt.hex');
        expect(y).not.toMatch(/mnemonic|private.?key|keystore/i);
        expect(y).not.toMatch(/":\//);
        n += 1;
      }
    }
    expect(n).toBe(12);
  });

  it('parses eth_syncing and peer count', () => {
    expect(parseEthSyncing({ result: false })).toEqual({ syncing: false, progress: 1 });
    expect(parseEthSyncing({ result: { currentBlock: '0xa', highestBlock: '0x14' } }).progress).toBe(
      0.5,
    );
    expect(parseEthPeerCount({ result: '0x10' })).toBe(16);
  });
});

describe('avax adapter', () => {
  it('enables state-sync and binds rpc localhost', () => {
    const y = buildAvaxComposeYaml({
      ...ethSpec,
      id: 'avax-fuji-1',
      chain: 'avax',
      network: 'fuji',
      clients: {
        node: { id: 'avalanchego', image: 'avaplatform/avalanchego', tag: 'v1.13.5' },
      },
      ports: { rpc: 9650, p2p: 9651 },
    });
    expect(y).toContain('avalanchego');
    expect(y).not.toContain('/avalanchego/build/avalanchego');
    expect(y).toContain('fuji');
    expect(y).toContain('--state-sync-enabled=true');
    expect(y).toContain('127.0.0.1:9650:9650');
    expect(parseAvaxHealth({ healthy: true }).healthy).toBe(true);
  });
});

describe('near + ada adapters', () => {
  it('NEAR downloads genesis and binds rpc localhost', async () => {
    const { buildNearComposeYaml, parseNearStatus } = await import('./near.js');
    const y = buildNearComposeYaml({
      ...ethSpec,
      id: 'near-testnet-1',
      chain: 'near',
      network: 'testnet',
      clients: {
        node: { id: 'neard', image: 'nearprotocol/nearcore', tag: '2.5.0' },
      },
      ports: { rpc: 3030, p2p: 24567 },
    });
    expect(y).toContain('neard');
    expect(y).toContain('--chain-id testnet');
    expect(y).toContain('127.0.0.1:3030:3030');
    expect(y).not.toMatch(/mnemonic|private.?key/i);
    expect(parseNearStatus({ sync_info: { syncing: false }, version: { version: '2.5.0' }, peers: [1, 2] })).toEqual({
      syncProgress: 1,
      peers: 2,
      version: '2.5.0',
    });
  });

  it('Cardano is relay-first with NETWORK env', async () => {
    const { buildAdaComposeYaml, parseAdaMetrics } = await import('./ada.js');
    const y = buildAdaComposeYaml({
      ...ethSpec,
      id: 'ada-preview-1',
      chain: 'ada',
      network: 'preview',
      clients: {
        node: { id: 'cardano-node', image: 'inputoutput/cardano-node', tag: '10.1.4' },
      },
      ports: { p2p: 3001, metrics: 12798 },
    });
    expect(y).toContain('NETWORK: preview');
    expect(y).toContain('cardano-node');
    expect(y).toContain('127.0.0.1:12798:12798');
    expect(y).not.toMatch(/mnemonic|kes|vrf|cold.key/i);
    expect(
      parseAdaMetrics('cardano_node_metrics_connectedPeers_int 8\ncardano_node_metrics_slotNum_int 99\n'),
    ).toEqual({ peers: 8, syncProgress: 1 });
  });
});
