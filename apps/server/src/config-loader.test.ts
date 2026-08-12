import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfigFile } from './config-loader.js';
import { YskError, ErrorCodes } from 'ysk-server-shared';

describe('loadConfigFile', () => {
  it('throws on empty path', () => {
    expect(() => loadConfigFile('')).toThrow(YskError);
    try {
      loadConfigFile('');
    } catch (e) {
      expect(e).toBeInstanceOf(YskError);
      expect((e as YskError).code).toBe(ErrorCodes.CONFIG_INVALID);
    }
  });

  it('throws when file missing', () => {
    expect(() => loadConfigFile('/tmp/ysk-no-such-config-zzzz.json')).toThrow(YskError);
  });

  it('throws on invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cfg-'));
    try {
      const p = join(dir, 'bad.json');
      writeFileSync(p, '{not-json', 'utf8');
      expect(() => loadConfigFile(p)).toThrow(YskError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses valid config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cfg-ok-'));
    try {
      const p = join(dir, 'config.json');
      writeFileSync(
        p,
        JSON.stringify({
          version: 1,
          product: 'ysk-server',
          dataDir: dir,
          listenHost: '127.0.0.1',
          listenPort: 9287,
          adminUsername: 'admin',
          locale: 'en',
          setupCompleted: true,
          createdAt: new Date().toISOString(),
        }),
        'utf8',
      );
      const cfg = loadConfigFile(p);
      expect(cfg.dataDir).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
