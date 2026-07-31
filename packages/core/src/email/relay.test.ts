import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { JsonStore } from '../db/store.js';
import { applySmtpRelay, loadSmtpRelaySettings } from './relay.js';

function empty(): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false };
}

describe('smtp relay', () => {
  it('writes snippets and refuses system apply without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-relay-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      const db = new JsonStore(join(dir, 'ysk.json'));
      const r = await applySmtpRelay({
        dataDir: dir,
        host,
        relay: {
          host: 'smtp.example.com',
          port: 587,
          username: 'u',
          password: 'secretpass',
          security: 'starttls',
        },
        applySystem: true,
        db,
        actor: 'test',
      });
      expect(r.ok).toBe(false);
      expect(r.requiresExecute).toBe(true);
      expect(r.appliedToSystem).toBe(false);
      expect(existsSync(r.written[0])).toBe(true);
      expect(readFileSync(r.written[0], 'utf8')).toContain('relayhost');
      expect(readFileSync(r.written[0], 'utf8')).toContain('smtp_tls_security_level = may');
      expect(db.snapshot.settings['email.smtp_relay']).toBeTruthy();
      expect(loadSmtpRelaySettings(dir)).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates host/port and security variants; dataDir-only ok without system', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-relay-'));
    try {
      const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
      await expect(
        applySmtpRelay({
          dataDir: dir,
          host,
          relay: { host: '', port: 25, security: 'none' },
        }),
      ).rejects.toThrow();
      await expect(
        applySmtpRelay({
          dataDir: dir,
          host,
          relay: { host: 'smtp.x', port: 99999, security: 'tls' },
        }),
      ).rejects.toThrow();

      const r = await applySmtpRelay({
        dataDir: dir,
        host,
        relay: {
          host: 'smtp.tls.example',
          port: 465,
          security: 'tls',
        },
        applySystem: false,
      });
      expect(r.ok).toBe(true);
      expect(r.appliedToSystem).toBe(false);
      expect(r.config.passwordSet).toBe(false);
      expect(readFileSync(r.written[0], 'utf8')).toContain('encrypt');
      expect(loadSmtpRelaySettings(join(dir, 'nope'))).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applySystem with execute+root runs install steps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-relay-'));
    try {
      const calls: string[][] = [];
      const host: HostExecutor = {
        executeEnabled: () => true,
        isRoot: () => true,
        pathExists: () => true,
        readFile: async () => '',
        listDir: async () => [],
        writeFile: async () => {},
        deletePath: async () => {},
        mkdirp: async () => {},
        sysInfo: async () => ({}),
        serviceStatus: async () => empty(),
        runCommand: async (argv) => {
          calls.push(argv);
          return { ...empty(), argv };
        },
      };
      const r = await applySmtpRelay({
        dataDir: dir,
        host,
        relay: {
          host: 'relay.example',
          port: 587,
          username: 'u',
          password: 'p',
          security: 'starttls',
        },
        applySystem: true,
      });
      expect(r.ok).toBe(true);
      expect(r.appliedToSystem).toBe(true);
      expect(calls.some((c) => c[0] === 'postmap' || c.includes('postmap'))).toBe(true);
      expect(calls.some((c) => c.includes('postfix') || c[0] === 'systemctl')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
