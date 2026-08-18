import { describe, expect, it } from 'vitest';
import { VALIDATOR_CHAIN_IDS } from './validators.js';
import {
  isOfficialStakingHref,
  stakingPlaybookAnchor,
  stakingPlaybookCoversAllChains,
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
  });
});
