import { describe, expect, it } from 'vitest';
import { buildConfigFromSetup, parseConfig } from './schema.js';

describe('config schema', () => {
  it('builds and parses ysk-server config', () => {
    const cfg = buildConfigFromSetup({
      dataDir: '/var/lib/ysk-server',
      listenPort: 9287,
      adminUsername: 'admin',
      locale: 'zh-TW',
      nonInteractive: true,
      listenHost: '127.0.0.1',
    });
    expect(cfg.product).toBe('ysk-server');
    expect(cfg.setupCompleted).toBe(true);
    const parsed = parseConfig(cfg);
    expect(parsed.dataDir).toBe('/var/lib/ysk-server');
  });

  it('rejects invalid port and product', () => {
    expect(() => buildConfigFromSetup({ dataDir: '/x', listenPort: 99999 } as never)).toThrow();
    expect(() => parseConfig({ product: 'other', dataDir: '/x' })).toThrow();
  });
});
