import { describe, expect, it } from 'vitest';
import {
  ethPandaopsArchiveUrl,
  isEthPandaopsUrl,
  resolveEthPandaopsArchive,
} from './snapshots.js';
import { nativePrunePlan } from './native-prune.js';
import type { ValidatorInstanceDto } from 'ysk-server-shared';

describe('eth pandaops snapshot urls', () => {
  it('accepts only the official host and snapshot path', () => {
    const url = ethPandaopsArchiveUrl('hoodi', 'geth', '123');
    expect(isEthPandaopsUrl(url)).toBe(true);
    expect(isEthPandaopsUrl('https://evil.example/hoodi/geth/123/snapshot.tar.zst')).toBe(false);
    expect(isEthPandaopsUrl('https://snapshots.ethpandaops.io/hoodi/geth/latest')).toBe(false);
  });

  it('resolves latest pointer then builds archive url', async () => {
    const fetchFn = (async (input: string) => {
      if (String(input).endsWith('/latest')) {
        return { ok: true, status: 200, text: async () => '4242' };
      }
      return { ok: false, status: 404, text: async () => '' };
    }) as typeof fetch;
    const r = await resolveEthPandaopsArchive({ network: 'hoodi', clientId: 'geth', fetchFn });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.block).toBe('4242');
      expect(r.url).toContain('/hoodi/geth/4242/snapshot.tar.zst');
    }
  });
});

describe('native prune plan', () => {
  it('plans geth snapshot prune-state', () => {
    const spec = {
      chain: 'eth',
      network: 'hoodi',
      dataPath: '/var/lib/ysk/validators/eth-hoodi-1/data',
      clients: { el: { id: 'geth', image: 'ethereum/client-go', tag: 'v1.15.11' } },
    } as ValidatorInstanceDto;
    const plan = nativePrunePlan(spec);
    expect(plan?.argv).toContain('prune-state');
    expect(plan?.argv.join(' ')).toContain('/data/geth');
  });
});
