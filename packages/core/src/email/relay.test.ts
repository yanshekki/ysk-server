import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { JsonStore } from '../db/store.js';
import { applySmtpRelay, loadSmtpRelaySettings } from './relay.js';

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
      expect(existsSync(r.written[0])).toBe(true);
      expect(readFileSync(r.written[0], 'utf8')).toContain('relayhost');
      expect(db.snapshot.settings['email.smtp_relay']).toBeTruthy();
      expect(loadSmtpRelaySettings(dir)).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
