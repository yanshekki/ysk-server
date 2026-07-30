import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyAdminer } from './adminer.js';
import type { HostExecutor } from '../host/executor.js';

function host(execute: boolean): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => false,
    pathExists: () => false,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async () => ({
      stdout: 'fail',
      stderr: '',
      exitCode: 1,
      argv: [],
      dryRun: false,
    }),
  };
}

describe('adminer', () => {
  it('blocks download without EXECUTE and writes placeholder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-adminer-'));
    try {
      const r = await applyAdminer({
        dataDir: dir,
        host: host(false),
        domain: 'db.local',
        download: true,
      });
      expect(r.blocked).toBe(true);
      expect(r.requiresExecute).toBe(true);
      expect(r.apply_status).toBe('blocked');
      expect(r.path && existsSync(r.path)).toBe(true);
      expect(r.nginxPath && existsSync(r.nginxPath)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes nginx plan without applySystem (written)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-adminer-w-'));
    try {
      // Pretend file already exists by download=false after seeding
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(join(dir, 'db', 'adminer'), { recursive: true });
      writeFileSync(join(dir, 'db', 'adminer', 'adminer.php'), '<?php //t\n');
      const r = await applyAdminer({
        dataDir: dir,
        host: host(false),
        domain: 'adminer.example.com',
        download: false,
        applySystem: false,
      });
      expect(r.ok).toBe(true);
      expect(r.apply_status).toBe('written');
      expect(r.urlHint).toContain('adminer.example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('blocks applySystem without root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-adminer-sys-'));
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      mkdirSync(join(dir, 'db', 'adminer'), { recursive: true });
      writeFileSync(join(dir, 'db', 'adminer', 'adminer.php'), '<?php //t\n');
      const r = await applyAdminer({
        dataDir: dir,
        host: {
          ...host(true),
          executeEnabled: () => true,
          isRoot: () => false,
        },
        domain: 'db.local',
        download: false,
        applySystem: true,
      });
      expect(r.blocked).toBe(true);
      expect(r.apply_status).toBe('blocked');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
