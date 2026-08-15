import { describe, expect, it } from 'vitest';
import {
  applyValidatorUpgrade,
  detectUpgradeForInstance,
  shouldAutoApply,
  tagIsBreaking,
  tagIsNewer,
} from './upgrade.js';
import type { ValidatorInstanceDto } from 'ysk-server-shared';

describe('validator upgrade helpers', () => {
  it('compares tags', () => {
    expect(tagIsNewer('v1.4.8', 'v1.4.9')).toBe(true);
    expect(tagIsNewer('v1.4.8', 'v1.4.8')).toBe(false);
    expect(tagIsBreaking('v1.4.8', 'v2.0.0')).toBe(true);
    expect(tagIsBreaking('v1.4.8', 'v1.5.0')).toBe(false);
  });

  it('detects a newer registry pin', () => {
    const spec = {
      id: 'eth-hoodi-1',
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
      slug: '1',
      dataPath: '/x',
      rpcHost: '127.0.0.1',
      upgradePolicy: 'notify',
      desiredState: 'stopped',
      createdAt: '',
      updatedAt: '',
      clients: {
        el: { id: 'reth', image: 'ghcr.io/paradigmxyz/reth', tag: 'v1.0.0' },
      },
      ports: {},
    } as ValidatorInstanceDto;
    const offer = detectUpgradeForInstance(spec);
    expect(offer?.clientId).toBe('reth');
    expect(offer?.nextTag).toBe('v1.4.8');
    expect(offer?.changelogUrl).toContain('paradigmxyz/reth');
  });

  it('offers a newer official remote tag when it is within one major of the pin', () => {
    const spec = {
      id: 'eth-hoodi-1',
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
      slug: '1',
      dataPath: '/x',
      rpcHost: '127.0.0.1',
      upgradePolicy: 'notify',
      desiredState: 'stopped',
      createdAt: '',
      updatedAt: '',
      clients: {
        el: { id: 'reth', image: 'ghcr.io/paradigmxyz/reth', tag: 'v1.4.8' },
      },
      ports: {},
    } as ValidatorInstanceDto;
    const offer = detectUpgradeForInstance(spec, { reth: 'v1.5.1' });
    expect(offer?.nextTag).toBe('v1.5.1');
    expect(offer?.breaking).toBe(false);
  });

  it('never auto-applies on mainnet', () => {
    expect(
      shouldAutoApply('auto-all', { currentTag: 'v1', nextTag: 'v2', clientId: 'x', breaking: true }, 'mainnet'),
    ).toBe(false);
    expect(
      shouldAutoApply('auto-safe', { currentTag: 'v1.0.0', nextTag: 'v1.0.1', clientId: 'x', breaking: false }, 'testnet'),
    ).toBe(true);
  });
});

describe('applyValidatorUpgrade rollback', () => {
  it('restores previous compose tag when health fails', async () => {
    const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-upg-'));
    const spec = {
      id: 'eth-hoodi-1',
      chain: 'eth',
      network: 'hoodi',
      profile: 'minimal',
      slug: '1',
      dataPath: join(dataDir, 'validators', 'eth-hoodi-1', 'data'),
      rpcHost: '127.0.0.1',
      upgradePolicy: 'notify',
      desiredState: 'running',
      createdAt: '',
      updatedAt: '',
      clients: {
        el: { id: 'reth', image: 'ghcr.io/paradigmxyz/reth', tag: 'v1.0.0' },
        cl: { id: 'lighthouse', image: 'sigp/lighthouse', tag: 'v7.1.0' },
      },
      ports: { rpc: 8545, beacon: 5052 },
    } as ValidatorInstanceDto;
    mkdirSync(join(dataDir, 'validators', 'eth-hoodi-1'), { recursive: true });
    writeFileSync(
      join(dataDir, 'validators', 'instances.json'),
      JSON.stringify({ version: 1, instances: [spec] }),
    );
    writeFileSync(
      join(dataDir, 'validators', 'eth-hoodi-1', 'compose.yml'),
      'services:\n  el:\n    image: ghcr.io/paradigmxyz/reth:v1.0.0\n',
    );
    const ups: string[] = [];
    const host = {
      executeEnabled: () => true,
      runCommand: async (argv: string[]) => {
        if (argv.includes('up')) ups.push(argv.join(' '));
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      },
    };
    try {
      const r = await applyValidatorUpgrade({
        dataDir,
        host: host as never,
        spec,
        execute: true,
        health: async () => false,
        healthTimeoutMs: 0,
        sleep: async () => undefined,
      });
      expect(r.rolledBack).toBe(true);
      expect(r.ok).toBe(true);
      expect(r.spec.clients.el?.tag).toBe('v1.0.0');
      expect(r.spec.lastUpgrade?.result).toBe('rolled-back');
      expect(readFileSync(join(dataDir, 'validators', 'eth-hoodi-1', 'compose.yml'), 'utf8')).toContain(
        'v1.0.0',
      );
      expect(ups.length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
