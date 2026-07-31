import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { applyPm2Start, pm2AppName, writePm2Ecosystem } from './pm2-apply.js';

describe('pm2-apply', () => {
  it('writes ecosystem config with app name and port', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pm2-'));
    const home = join(dir, 'home');
    const r = writePm2Ecosystem({
      homeDir: home,
      linuxUser: 'ysk_demo',
      appDir: join(home, 'app'),
      entry: 'server.js',
      port: 3210,
      nodeBinary: process.execPath,
    });
    expect(r.appName).toBe(pm2AppName('ysk_demo'));
    expect(existsSync(r.ecosystemPath)).toBe(true);
    const body = readFileSync(r.ecosystemPath, 'utf8');
    expect(body).toContain('ysk-ysk_demo');
    expect(body).toContain('3210');
    expect(body).toContain(process.execPath);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses start without YSK_EXECUTE (writes config only)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pm2-'));
    const home = join(dir, 'home');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyPm2Start({
      host,
      homeDir: home,
      linuxUser: 'ysk_demo',
      appDir: join(home, 'app'),
      entry: 'server.js',
      port: 3211,
      nodeBinary: process.execPath,
      execute: true,
    });
    expect(r.ok).toBe(false);
    expect(r.requiresExecute).toBe(true);
    expect(existsSync(r.ecosystemPath)).toBe(true);
    // Notes are locale-dependent (zh-HK / en); assert honesty structure, not copy.
    expect(r.notes.length).toBeGreaterThan(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports missing pm2 when execute on and binary absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pm2-'));
    const home = join(dir, 'home');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: true });
    // Shadow PATH so pm2 is never found
    const prev = process.env.PATH;
    process.env.PATH = '/nonexistent-bin-path';
    try {
      const r = await applyPm2Start({
        host,
        homeDir: home,
        linuxUser: 'ysk_x',
        appDir: join(home, 'app'),
        entry: 'server.js',
        port: 3212,
        nodeBinary: process.execPath,
        execute: true,
      });
      expect(r.ok).toBe(false);
      expect(r.pm2Available).toBe(false);
      expect(existsSync(r.ecosystemPath)).toBe(true);
    } finally {
      process.env.PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
