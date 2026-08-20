import { describe, expect, it } from 'vitest';
import {
  defaultValidatorNetwork,
  findValidatorClient,
  getValidatorChain,
  getValidatorNetwork,
  listValidatorChains,
  minFreeBytesFor,
  suiNodeImagePins,
  suiNodeTag,
  v1ValidatorClients,
} from './registry.js';

describe('validator registry', () => {
  it('lists v1 ETH AVAX NEAR ADA with testnet + mainnet', () => {
    const chains = listValidatorChains();
    expect(chains.map((c) => c.id).sort()).toEqual([
      'ada',
      'aptos',
      'avax',
      'btc',
      'cosmos',
      'dot',
      'eth',
      'near',
      'sol',
      'sui',
    ]);
    const eth = getValidatorChain('eth');
    expect(eth?.networks.map((n) => n.id)).toEqual(['hoodi', 'sepolia', 'mainnet']);
    expect(getValidatorNetwork('eth', 'hoodi')?.kind).toBe('testnet');
    expect(getValidatorNetwork('eth', 'mainnet')?.kind).toBe('mainnet');
    expect(getValidatorNetwork('avax', 'fuji')?.kind).toBe('testnet');
    expect(getValidatorNetwork('near', 'testnet')?.kind).toBe('testnet');
    expect(getValidatorNetwork('ada', 'preview')?.kind).toBe('testnet');
    expect(getValidatorNetwork('ada', 'preprod')?.kind).toBe('testnet');
  });

  it('defaults to recommended testnet', () => {
    expect(defaultValidatorNetwork('eth')).toBe('hoodi');
    expect(defaultValidatorNetwork('avax')).toBe('fuji');
    expect(defaultValidatorNetwork('near')).toBe('testnet');
    expect(defaultValidatorNetwork('ada')).toBe('preview');
    expect(defaultValidatorNetwork('nope')).toBeUndefined();
  });

  it('has conservative mainnet minima larger than testnet', () => {
    const hoodi = minFreeBytesFor('eth', 'hoodi', 'minimal');
    const main = minFreeBytesFor('eth', 'mainnet', 'minimal');
    expect(hoodi).toBeGreaterThan(0);
    expect(main).toBeGreaterThan(hoodi!);
    expect(minFreeBytesFor('avax', 'mainnet', 'minimal')).toBeGreaterThan(
      minFreeBytesFor('avax', 'fuji', 'minimal')!,
    );
  });

  it('ships ETH EL×CL matrix and defaults to reth + lighthouse', () => {
    const clients = v1ValidatorClients('eth');
    expect(clients.map((c) => c.id)).toEqual(
      expect.arrayContaining(['reth', 'geth', 'nethermind', 'lighthouse', 'prysm', 'teku', 'nimbus']),
    );
    expect(clients.every((c) => c.image && c.tag)).toBe(true);
    expect(v1ValidatorClients('near').map((c) => c.id)).toEqual(['neard']);
    expect(v1ValidatorClients('ada').map((c) => c.id)).toEqual(['cardano-node']);
    expect(v1ValidatorClients('ada')[0]?.image).toBe('ghcr.io/intersectmbo/cardano-node');
    expect(v1ValidatorClients('ada')[0]?.tag).toBe('11.0.1');
    expect(v1ValidatorClients('btc').map((c) => c.id)).toEqual(['bitcoind']);
    expect(getValidatorChain('sol')?.heavy).toBe(true);
    expect(defaultValidatorNetwork('btc')).toBe('testnet');
    expect(defaultValidatorNetwork('dot')).toBe('westend');
  });

  it('pins Sui testnet and mainnet to tags that exist', () => {
    expect(suiNodeTag('testnet')).toBe('testnet-v1.78.0');
    expect(suiNodeTag('mainnet')).toBe('mainnet-v1.77.2');
    expect(suiNodeImagePins().some((r) => r.includes('mainnet-v1.44.2'))).toBe(false);
  });

  it('finds catalog clients by id', () => {
    expect(findValidatorClient('lighthouse')?.tag).toBe('v8.2.2');
    expect(findValidatorClient('agave')?.image).toBe('anzaxyz/agave');
    expect(findValidatorClient('agave')?.tag).toBe('v2.1.11');
    expect(findValidatorClient('avalanchego')?.tag).toBe('v1.14.1');
    expect(findValidatorClient('sui-node')?.image).toBe('mysten/sui-node');
    expect(findValidatorClient('nope')).toBeUndefined();
  });
});
