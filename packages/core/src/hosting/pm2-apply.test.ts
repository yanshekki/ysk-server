import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import {
  applyPm2AppAction,
  applyPm2Save,
  applyPm2Start,
  normalizePm2MaxMemoryRestart,
  pm2AppName,
  probePm2Startup,
  syncPm2EcosystemMemory,
  writePm2Ecosystem,
} from './pm2-apply.js';

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
    expect(body).toMatch(/max_memory_restart:\s*["']512M["']/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes max_memory_restart from maxMemoryRestart / normalizes bad input', () => {
    expect(normalizePm2MaxMemoryRestart('256M')).toBe('256M');
    expect(normalizePm2MaxMemoryRestart('1g')).toBe('1G');
    expect(normalizePm2MaxMemoryRestart('not-valid')).toBe('512M');
    expect(normalizePm2MaxMemoryRestart('')).toBe('512M');

    const dir = mkdtempSync(join(tmpdir(), 'ysk-pm2-'));
    const home = join(dir, 'home');
    const r = writePm2Ecosystem({
      homeDir: home,
      linuxUser: 'ysk_demo',
      appDir: join(home, 'app'),
      entry: 'server.js',
      port: 3210,
      nodeBinary: process.execPath,
      maxMemoryRestart: '256M',
    });
    const body = readFileSync(r.ecosystemPath, 'utf8');
    expect(body).toMatch(/max_memory_restart:\s*["']256M["']/);
    expect(r.notes.some((n) => n.includes('256M'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('syncPm2EcosystemMemory patches file without execute', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pm2-'));
    const home = join(dir, 'home');
    writePm2Ecosystem({
      homeDir: home,
      linuxUser: 'ysk_demo',
      appDir: join(home, 'app'),
      entry: 'server.js',
      port: 3210,
      nodeBinary: process.execPath,
      maxMemoryRestart: '512M',
    });
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await syncPm2EcosystemMemory({
      host,
      homeDir: home,
      linuxUser: 'ysk_demo',
      memoryMax: '1G',
    });
    expect(r.written).toBe(true);
    expect(r.reloaded).toBe(false);
    expect(r.ok).toBe(true);
    const body = readFileSync(join(home, 'ecosystem.config.cjs'), 'utf8');
    expect(body).toMatch(/max_memory_restart:\s*["']1G["']/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('syncPm2EcosystemMemory skips when ecosystem missing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pm2-'));
    const home = join(dir, 'home');
    writeFileSync(join(dir, 'keep'), 'x');
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await syncPm2EcosystemMemory({
      host,
      homeDir: home,
      linuxUser: 'ysk_x',
      memoryMax: '256M',
    });
    expect(r.written).toBe(false);
    expect(r.notes.some((n) => /absent|skip/i.test(n))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('probePm2Startup and applyPm2Save honesty without execute', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const prev = process.env.PATH;
    process.env.PATH = '/nonexistent-bin-path';
    try {
      const p = await probePm2Startup(host);
      expect(p.pm2Available).toBe(false);
      expect(p.readyForBoot).toBe(false);
    } finally {
      process.env.PATH = prev;
    }
    const save = await applyPm2Save(host);
    expect(save.ok).toBe(false);
    expect(save.requiresExecute).toBe(true);
  });

  it('applyPm2AppAction refuses without execute and invalid name', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const bad = await applyPm2AppAction({
      host,
      appName: 'ysk-demo',
      action: 'restart',
    });
    expect(bad.ok).toBe(false);
    expect(bad.requiresExecute).toBe(true);

    const inv = await applyPm2AppAction({
      host: new LocalHostExecutor({ executeEnabled: true }),
      appName: 'bad name!',
      action: 'stop',
    });
    expect(inv.ok).toBe(false);
    expect(inv.notes.some((n) => /invalid/i.test(n))).toBe(true);
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
