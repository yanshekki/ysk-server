import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { issueWebmailSso, consumeWebmailSso } from './webmail-sso.js';

describe('webmail-sso', () => {
  it('issues and consumes one-time token', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-sso-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      expect(issueWebmailSso({ db, email: 'bad', domain: '' }).ok).toBe(false);
      const issued = issueWebmailSso({
        db,
        email: 'u@example.com',
        domain: 'example.com',
        password: 'mailbox-pass',
        ttlMinutes: 10,
      });
      expect(issued.ok).toBe(true);
      expect(issued.token).toBeTruthy();
      const c1 = consumeWebmailSso(db, issued.token!);
      expect(c1.ok).toBe(true);
      expect(c1.email).toBe('u@example.com');
      expect(c1.password).toBe('mailbox-pass');
      const c2 = consumeWebmailSso(db, issued.token!);
      expect(c2.ok).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
