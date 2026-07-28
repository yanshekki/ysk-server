import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultTuningValues,
  listTuningCatalog,
  loadRuntimeTuning,
  saveRuntimeTuning,
  tuningToEnv,
} from './runtime-tuning.js';

describe('runtime-tuning', () => {
  it('has catalogs for node/python/go/rust', () => {
    for (const k of ['node', 'python', 'go', 'rust'] as const) {
      expect(listTuningCatalog(k).length).toBeGreaterThan(0);
      expect(Object.keys(defaultTuningValues(k)).length).toBeGreaterThan(0);
    }
  });

  it('node builds NODE_OPTIONS from max_old_space_size', () => {
    const env = tuningToEnv({
      kind: 'node',
      version: '20',
      values: {
        ...defaultTuningValues('node'),
        max_old_space_size: 1024,
        max_http_header_size: 32768,
        node_env: 'production',
      },
      env: {},
    });
    expect(env.NODE_OPTIONS).toContain('--max-old-space-size=1024');
    expect(env.NODE_OPTIONS).toContain('--max-http-header-size=32768');
    expect(env.NODE_ENV).toBe('production');
  });

  it('persists and reloads', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-rtune-'));
    try {
      saveRuntimeTuning(dir, {
        kind: 'go',
        version: '1.22',
        values: { ...defaultTuningValues('go'), gomaxprocs: 4, gogc: 50 },
        env: { APP_MODE: 'api' },
      });
      const loaded = loadRuntimeTuning(dir, 'go', '1.22');
      expect(loaded.values.gomaxprocs).toBe(4);
      const env = tuningToEnv(loaded);
      expect(env.GOMAXPROCS).toBe('4');
      expect(env.GOGC).toBe('50');
      expect(env.APP_MODE).toBe('api');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
