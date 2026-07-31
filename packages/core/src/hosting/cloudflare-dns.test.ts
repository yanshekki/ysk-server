import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonStore } from '../db/store.js';
import {
  applyCloudflareDns,
  planToCloudflareRecords,
  persistDnsZoneApply,
  type CfFetch,
} from './cloudflare-dns.js';
import { planDnsZone } from './extras.js';

describe('cloudflare dns', () => {
  it('plans records from zone plan', () => {
    const plan = planDnsZone({ zone: 'example.com', serverIp: '1.2.3.4' });
    const recs = planToCloudflareRecords(plan, 'example.com');
    expect(recs.some((r) => r.type === 'A')).toBe(true);
    expect(recs.every((r) => r.proxied === false)).toBe(true);
  });

  it('refuses live apply without token (ok=false, not fake success)', async () => {
    const r = await applyCloudflareDns({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      dryRun: false,
      token: '',
    });
    expect(r.ok).toBe(false);
    expect(r.requiresToken).toBe(true);
    expect(r.planned.length).toBeGreaterThan(0);
  });

  it('dryRun without token is plan success (requiresToken, not fake live apply)', async () => {
    const r = await applyCloudflareDns({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      dryRun: true,
      token: '',
    });
    expect(r.ok).toBe(true);
    expect(r.requiresToken).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.planned.length).toBeGreaterThan(0);
    expect(r.created.length).toBe(0);
  });

  it('dryRun with token returns ok without API create', async () => {
    const r = await applyCloudflareDns({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      token: 'fake-token',
      dryRun: true,
    });
    expect(r.ok).toBe(true);
    expect(r.dryRun).toBe(true);
    expect(r.created.length).toBe(0);
  });

  it('applies via injected fetch and persists zone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-cf-'));
    try {
      const calls: string[] = [];
      const fetchImpl: CfFetch = async (url, init) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/zones?name=')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              result: [{ id: 'zone-1', name: 'example.com' }],
            }),
          };
        }
        if (url.includes('/dns_records') && init?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              result: { id: `rec-${calls.length}` },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };
      const r = await applyCloudflareDns({
        zone: 'example.com',
        serverIp: '203.0.113.10',
        token: 'tok',
        dryRun: false,
        fetchImpl,
      });
      expect(r.ok).toBe(true);
      expect(r.zoneId).toBe('zone-1');
      expect(r.created.length).toBeGreaterThan(0);
      const db = new JsonStore(join(dir, 'ysk.json'));
      persistDnsZoneApply(db, r, 'admin');
      expect(db.snapshot.dns_zones.length).toBe(1);
      expect(db.snapshot.dns_zones[0].zone).toBe('example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
