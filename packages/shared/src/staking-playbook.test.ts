import { describe, expect, it } from 'vitest';
import { VALIDATOR_CHAIN_IDS } from './validators.js';
import {
  buildCosmosCreateValidatorCommand,
  buildNearCreateStakingPoolCommand,
  cosmosStakingChainId,
  ethLaunchpadHref,
  isOfficialStakingHref,
  nearStakingFactory,
  stakingPlaybookAnchor,
  stakingPlaybookCoversAllChains,
  stakingPlaybookLinksForInstance,
  stakingPlaybookMeta,
  STAKING_PLAYBOOKS,
} from './staking-playbook.js';

describe('staking playbook catalog', () => {
  it('covers every shipped chain', () => {
    expect(stakingPlaybookCoversAllChains()).toBe(true);
    expect(STAKING_PLAYBOOKS).toHaveLength(VALIDATOR_CHAIN_IDS.length);
  });

  it('uses only official https links', () => {
    for (const row of STAKING_PLAYBOOKS) {
      expect(row.links.length).toBeGreaterThan(0);
      for (const link of row.links) {
        expect(isOfficialStakingHref(link.href)).toBe(true);
      }
    }
  });

  it('keeps Ethereum launchpads and Bitcoin as not-pos', () => {
    const eth = stakingPlaybookMeta('eth');
    expect(eth?.model).toBe('deposit-contract');
    expect(eth?.links.some((l) => l.href.includes('hoodi.launchpad.ethereum.org'))).toBe(true);
    expect(eth?.links.some((l) => l.href === 'https://launchpad.ethereum.org')).toBe(true);
    expect(stakingPlaybookMeta('btc')?.model).toBe('not-pos');
    expect(stakingPlaybookAnchor('avax')).toBe('stake-avax');
    expect(stakingPlaybookMeta('avax')?.links.some((l) => l.href.includes('build.avax.network'))).toBe(
      true,
    );
    expect(stakingPlaybookMeta('sol')?.links.some((l) => l.href.includes('docs.anza.xyz'))).toBe(true);
    expect(stakingPlaybookMeta('ada')?.links.some((l) => l.href.includes('stake-pool-operators'))).toBe(
      true,
    );
    expect(
      stakingPlaybookMeta('near')?.links.some((l) =>
        l.href.includes('near-nodes.io/validator/deploy-on-mainnet'),
      ),
    ).toBe(true);
  });

  it('points NEAR create_staking_pool at the official factory, not an IP', () => {
    expect(nearStakingFactory('mainnet')).toEqual({
      factoryAccount: 'poolv1.near',
      poolAccountSuffix: '.poolv1.near',
    });
    expect(nearStakingFactory('testnet')).toEqual({
      factoryAccount: 'pool.f863973.m0',
      poolAccountSuffix: '.pool.f863973.m0',
    });
    const cmd = buildNearCreateStakingPoolCommand({
      network: 'testnet',
      stakePublicKey: 'ed25519:AbC123',
    });
    expect(cmd).toContain('near call pool.f863973.m0 create_staking_pool');
    expect(cmd).toContain('ed25519:AbC123');
    expect(cmd).toContain('--amount=30');
    expect(cmd).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    const pending = buildNearCreateStakingPoolCommand({ network: 'mainnet' });
    expect(pending).toContain('poolv1.near');
    expect(pending).toContain('<STAKE_PUBLIC_KEY>');
  });

  it('points Cosmos create-validator at consensus pubkey, not an IP', () => {
    expect(cosmosStakingChainId('mainnet')).toBe('cosmoshub-4');
    expect(cosmosStakingChainId('testnet')).toBe('provider');
    const cmd = buildCosmosCreateValidatorCommand({
      network: 'testnet',
      consensusPubkey: '{"@type":"/cosmos.crypto.ed25519.PubKey","key":"abc"}',
    });
    expect(cmd).toContain('--chain-id=provider');
    expect(cmd).toContain('create-validator');
    expect(cmd).toContain('--gas-prices="0.005uatom"');
    expect(cmd).not.toContain('0.0025uatom');
    expect(cmd).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  it('keeps only this network’s Ethereum launchpad on the instance page', () => {
    expect(ethLaunchpadHref('hoodi')).toBe('https://hoodi.launchpad.ethereum.org');
    expect(ethLaunchpadHref('mainnet')).toBe('https://launchpad.ethereum.org');
    expect(ethLaunchpadHref('sepolia')).toBeNull();
    const hoodi = stakingPlaybookLinksForInstance('eth', 'hoodi').map((l) => l.href);
    expect(hoodi).toContain('https://hoodi.launchpad.ethereum.org');
    expect(hoodi).not.toContain('https://launchpad.ethereum.org');
    const sepolia = stakingPlaybookLinksForInstance('eth', 'sepolia').map((l) => l.href);
    expect(sepolia.every((h) => !h.includes('launchpad.ethereum.org'))).toBe(true);
  });
});
