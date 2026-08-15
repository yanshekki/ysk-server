import { describe, expect, it } from 'vitest';
import { applyComposeLimits } from './compose-runner.js';
import { snapshotOffer, stakingChecklist } from './extras.js';

describe('validator extras', () => {
  it('applies mem/cpu limits under restart', () => {
    const y = applyComposeLimits('services:\n  el:\n    restart: unless-stopped\n', {
      memory: '4g',
      cpus: '2.0',
    });
    expect(y).toContain('mem_limit: 4g');
    expect(y).toContain('cpus: "2.0"');
  });

  it('offers mithril for ada and checkpoint for eth', () => {
    expect(snapshotOffer('ada', 'preview').kind).toBe('mithril');
    expect(snapshotOffer('eth', 'hoodi').kind).toBe('checkpoint');
    expect(snapshotOffer('btc', 'testnet').kind).toBe('none');
  });

  it('returns non-custodial staking links for eth', () => {
    const c = stakingChecklist('eth');
    expect(c.links.some((l) => l.href.includes('launchpad.ethereum.org'))).toBe(true);
    expect(c.items.length).toBeGreaterThan(0);
  });
});
