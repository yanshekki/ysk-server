import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AppContext } from './app-context.js';
import { listenControlPlane } from './http-server.js';
import type { YskConfig } from '@ysk-server/core';

const closers: Array<() => void> = [];

afterEach(() => {
  while (closers.length) closers.pop()?.();
});

function minimalCtx(config: Partial<YskConfig> & { dataDir: string }): AppContext {
  const cfg: YskConfig = {
    version: 1,
    product: 'ysk-server',
    dataDir: config.dataDir,
    listenHost: '127.0.0.1',
    listenPort: 19287,
    adminUsername: 'admin',
    locale: 'zh-HK',
    setupCompleted: true,
    createdAt: new Date().toISOString(),
    ...config,
  };
  return {
    config: cfg,
    configPath: join(config.dataDir, 'config.json'),
    dataDir: config.dataDir,
    requestHits: [],
    version: 'test',
    startedAt: new Date().toISOString(),
    webRoot: undefined,
    host: {
      executeEnabled: () => false,
      isRoot: () => false,
      runCommand: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: true }),
      pathExists: () => false,
      readFile: async () => '',
    },
  } as unknown as AppContext;
}

describe('listenControlPlane', () => {
  it('binds plain HTTP when TLS off', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-http-'));
    writeFileSync(join(dir, 'config.json'), '{}');
    const ctx = minimalCtx({ dataDir: dir, tlsEnabled: false });
    const dual = await listenControlPlane(ctx, '127.0.0.1', 0);
    for (const s of dual.servers) {
      closers.push(() => {
        s.close();
      });
    }
    expect(dual.https).toBe(false);
    expect(dual.primary.scheme).toBe('http');
    expect(dual.primary.port).toBeGreaterThan(0);
    expect(dual.http).toBeUndefined();
    expect(dual.servers.length).toBe(1);
  });
});
