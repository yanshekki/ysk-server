import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from './cli/setup.js';
import { runUpdate } from './cli/update.js';
import { VERSION, PRODUCT, CLI } from './version.js';
import { createAppContext } from './app-context.js';
import { createHttpServer, listen } from './http-server.js';

describe('CLI naming', () => {
  it('exports YSK Server product names', () => {
    expect(PRODUCT).toBe('YSK Server');
    expect(CLI).toBe('ysk-server');
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('setup', () => {
  it('writes config skeleton in non-destructive dry-run and real mode', () => {
    const dry = runSetup({
      dataDir: join(tmpdir(), 'ysk-never-write'),
      dryRun: true,
      nonInteractive: true,
    });
    expect(dry.ok).toBe(true);
    expect(dry.code).toBe('YSK_SETUP_DRY_RUN');
    expect(dry.data?.config.product).toBe('ysk-server');

    const dir = mkdtempSync(join(tmpdir(), 'ysk-setup-'));
    try {
      const result = runSetup({
        dataDir: dir,
        nonInteractive: true,
        listenPort: 8799,
        locale: 'zh-TW',
      });
      expect(result.ok).toBe(true);
      expect(result.data?.configPath).toBe(join(dir, 'config.json'));
      const cfg = JSON.parse(readFileSync(result.data!.configPath, 'utf8'));
      expect(cfg.product).toBe('ysk-server');
      expect(cfg.listenPort).toBe(8799);
      expect(result.data?.nextSteps?.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('update', () => {
  it('reports structured self-update status', () => {
    const upToDate = runUpdate({ checkOnly: true, latest: VERSION });
    expect(upToDate.ok).toBe(true);
    expect(upToDate.data?.status.currentVersion).toBe(VERSION);

    const available = runUpdate({ checkOnly: true, latest: '9.9.9' });
    expect(available.data?.status.updateAvailable).toBe(true);
  });
});

describe('HTTP control plane', () => {
  it('boots and returns sane health JSON twice', async () => {
    const ctx = createAppContext(VERSION);
    const server = createHttpServer(ctx);
    const { port } = await listen(server, '127.0.0.1', 0);
    const address = server.address();
    const realPort = typeof address === 'object' && address ? address.port : port;

    async function probe() {
      const res = await fetch(`http://127.0.0.1:${realPort}/health`);
      const body = (await res.json()) as {
        status: string;
        product: string;
        version: string;
        protectionMode: string;
      };
      expect(res.status).toBe(200);
      expect(body.product).toBe('YSK Server');
      expect(body.version).toBe(VERSION);
      expect(body.status).toMatch(/ok|degraded|offline/);
      expect(body.protectionMode).toBeTruthy();
      return body;
    }

    const a = await probe();
    const b = await probe();
    expect(a.product).toBe(b.product);
    server.close();
  });
});
