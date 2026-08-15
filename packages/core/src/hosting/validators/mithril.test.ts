import { describe, expect, it } from 'vitest';
import { buildMithrilRunArgv, isMithrilConfirm, mithrilConfigFor, restoreAdaMithril } from './mithril.js';
import { classifyDockerArgv } from '../docker/argv.js';

describe('mithril', () => {
  it('builds a constrained docker run argv', () => {
    const argv = buildMithrilRunArgv({
      instanceId: 'ada-preview-1',
      dataPath: '/var/lib/ysk/validators/ada-preview-1/data',
      aggregator: 'https://aggregator.example/aggregator',
      genesisKey: 'abc',
    });
    expect(classifyDockerArgv(['docker', ...argv])).toBe('mutate');
    expect(argv.join(' ')).toContain('cardano-db download latest');
    expect(argv).not.toContain('--privileged');
  });

  it('maps networks and confirm tokens', () => {
    expect(mithrilConfigFor('mainnet').aggregator).toContain('release-mainnet');
    expect(isMithrilConfirm('ada-preview-1', 'MITHRIL')).toBe(true);
    expect(isMithrilConfirm('ada-preview-1', 'nope')).toBe(false);
  });

  it('rejects non-ada and dry-runs without execute', async () => {
    const host = {
      executeEnabled: () => false,
      runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    };
    const missing = await restoreAdaMithril({
      dataDir: '/tmp/no-such-ysk-validators',
      host: host as never,
      execute: false,
      id: 'ada-preview-1',
      confirm: 'MITHRIL',
    });
    expect(missing.ok).toBe(false);
  });
});
