import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import { attachProjectCreateExtras } from './project-create-extras.js';

describe('attachProjectCreateExtras', () => {
  it('creates DNS zone and mail domain drafts when flags are set', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-extras-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const extras = attachProjectCreateExtras({
        db,
        email: {
          create: (opts) => ({ domain: { id: 'mail-1', domain: opts.domain } }),
        },
        projectId: 'proj-1',
        domain: 'Site.Example.TEST',
        actor: 'admin',
        createDnsZone: true,
        createMailDomain: true,
        serverIp: '203.0.113.10',
        serverIpv6: '2001:db8::10',
      });
      expect(extras.dnsZoneId).toBeTruthy();
      expect(extras.emailDomainId).toBe('mail-1');
      expect(extras.notes.length).toBeGreaterThanOrEqual(2);
      const zones = db.snapshot.dns_zones ?? [];
      expect(
        zones.some(
          (z) => String(z.zone) === 'site.example.test' && String(z.projectId) === 'proj-1',
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op without domain or flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-extras-empty-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const none = attachProjectCreateExtras({
        db,
        email: { create: () => ({ id: 'x' }) },
        projectId: 'p',
        createDnsZone: true,
        createMailDomain: true,
      });
      expect(none).toEqual({ notes: [] });
      const flagsOff = attachProjectCreateExtras({
        db,
        email: { create: () => ({ id: 'x' }) },
        projectId: 'p',
        domain: 'x.test',
      });
      expect(flagsOff).toEqual({ notes: [] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('records a note when mail create throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-extras-mail-'));
    try {
      const db = new JsonStore(join(dir, 'db.json'));
      const extras = attachProjectCreateExtras({
        db,
        email: {
          create: () => {
            throw new Error('mail boom');
          },
        },
        projectId: 'p',
        domain: 'boom.test',
        actor: 'cli',
        createMailDomain: true,
      });
      expect(extras.emailDomainId).toBeUndefined();
      expect(extras.notes.some((n) => n.includes('mail boom'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
