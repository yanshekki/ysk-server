import { describe, expect, it } from 'vitest';
import { applyComposeLimits, composeBind, writeComposeFile } from './compose-runner.js';
import { rankValidatorAutoClearCandidates, snapshotOffer, stakingChecklist } from './extras.js';
import { buildEthComposeYaml } from './adapters/eth.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

describe('validator extras', () => {
  it('applies mem/cpu limits under restart', () => {
    const y = applyComposeLimits('services:\n  el:\n    restart: unless-stopped\n', {
      memory: '4g',
      cpus: '2.0',
    });
    expect(y).toContain('mem_limit: 4g');
    expect(y).toContain('memswap_limit: 4g');
    expect(y).toContain('pids_limit: 4096');
    expect(y).toContain('cpus: "2.0"');
  });

  it('replaces existing mem_limit instead of stacking a second one', () => {
    const y = applyComposeLimits(
      'services:\n  node:\n    restart: unless-stopped\n    mem_limit: 8g\n    memswap_limit: 8g\n',
      { memory: '4g' },
    );
    expect(y).toContain('mem_limit: 4g');
    expect(y).toContain('memswap_limit: 4g');
    expect(y).not.toContain('mem_limit: 8g');
  });

  it('quotes the full bind so YAML does not split on host-path quotes', () => {
    expect(composeBind('/var/lib/ysk/data', '/data')).toBe('"/var/lib/ysk/data:/data"');
    expect(composeBind('/var/lib/ysk/jwt.hex', '/jwt/jwt.hex', 'ro')).toBe(
      '"/var/lib/ysk/jwt.hex:/jwt/jwt.hex:ro"',
    );
  });

  it('stamped eth compose.yml is valid YAML', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-val-yml-'));
    const path = join(dir, 'compose.yml');
    writeComposeFile(
      path,
      buildEthComposeYaml({
        id: 'eth-hoodi-2',
        chain: 'eth',
        network: 'hoodi',
        profile: 'minimal',
        slug: '2',
        dataPath: '/var/lib/ysk-server/validators/eth-hoodi-2/data',
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
      } as never),
      'eth-hoodi-2',
    );
    const body = readFileSync(path, 'utf8');
    expect(body).not.toMatch(/":\//);
    execFileSync('python3', ['-c', 'import sys,yaml; yaml.safe_load(sys.stdin)'], {
      input: body,
    });
  });

  it('offers mithril for ada and checkpoint for eth', () => {
    expect(snapshotOffer('ada', 'preview').kind).toBe('mithril');
    expect(snapshotOffer('eth', 'hoodi').kind).toBe('archive');
    expect(snapshotOffer('eth', 'mainnet').kind).toBe('checkpoint');
    expect(snapshotOffer('near', 'testnet').kind).toBe('epoch');
    expect(snapshotOffer('btc', 'testnet').kind).toBe('none');
  });

  it('returns non-custodial staking links for eth', () => {
    const c = stakingChecklist('eth');
    expect(c.links.some((l) => l.href.includes('launchpad.ethereum.org'))).toBe(true);
    expect(c.items.length).toBeGreaterThan(0);
    expect(c.links.every((l) => l.href.startsWith('https://'))).toBe(true);
  });

  it('treats Bitcoin as not-pos with official https docs', () => {
    const c = stakingChecklist('btc');
    expect(c.items.some((i) => /Bitcoin|not proof-of-stake|不是權益證明/i.test(i))).toBe(true);
    expect(c.links.some((l) => l.href === 'https://bitcoin.org/en/full-node')).toBe(true);
    expect(c.links.every((l) => l.href.startsWith('https://'))).toBe(true);
  });

  it('ranks auto-clear so empty failed nodes are last', () => {
    const ranked = rankValidatorAutoClearCandidates([
      { id: 'avax-fuji-1', usedBytes: 0, running: false },
      { id: 'ada-preview-1', usedBytes: 80, running: false },
      { id: 'eth-hoodi-1', usedBytes: 400, running: true },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['ada-preview-1', 'avax-fuji-1']);
  });

  it('points Avalanche at Core and Builder Hub', () => {
    const c = stakingChecklist('avax');
    expect(c.links.some((l) => l.href === 'https://core.app')).toBe(true);
    expect(c.links.some((l) => l.href.includes('build.avax.network'))).toBe(true);
  });
});
