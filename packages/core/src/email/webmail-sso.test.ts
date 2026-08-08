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

  it('loginUrl uses webmailBaseUrl + _ysk_sso for Roundcube plugin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-sso-url-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const issued = issueWebmailSso({
        db,
        email: 'postmaster@example.com',
        domain: 'example.com',
        password: 'secret-pass',
        webmailBaseUrl: 'https://webmail.example.com/',
      });
      expect(issued.ok).toBe(true);
      expect(issued.loginUrl).toMatch(
        /^https:\/\/webmail\.example\.com\/\?_ysk_sso=/,
      );
      expect(issued.loginUrl).toContain(issued.token);
      const c = consumeWebmailSso(db, issued.token!);
      expect(c.ok).toBe(true);
      expect(c.password).toBe('secret-pass');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
