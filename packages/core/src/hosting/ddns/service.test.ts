import { describe, expect, it, afterEach } from 'vitest';
import { join } from 'node:path';
import { openDatabase, closeDatabase } from '../../db/database.js';
import { makeHost } from '../../test/host.js';
import { createResource } from '../managed-resources.js';
import { upsertCloudflareAddressRecord, type CfFetch } from '../cloudflare-dns.js';
import {
  deleteDdnsRecord,
  getDdnsStatus,
  mergeDdnsSecrets,
  runDdnsTick,
  upsertDdnsRecord,
} from './service.js';
import { applyDdnsProvider, findLocalDnsConflict, resolveRfc2136KeyFile } from './providers.js';
import { loadDdnsRecords, loadDdnsSecrets, loadDdnsSettings, saveDdnsConfig } from './store.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function setup(executeEnabled = false) {
  const { host, dir, cleanup } = makeHost({ executeEnabled });
  cleanups.push(cleanup);
  const db = openDatabase(join(dir, 'db.json'));
  cleanups.push(() => closeDatabase(db));
  return { host, dir, db };
}

describe('ddns service', () => {
  it('refuses invalid fqdn', () => {
    const { dir } = setup();
    const r = upsertDdnsRecord(dir, { fqdn: 'nope', type: 'A', provider: 'cloudflare' });
    expect(r.ok).toBe(false);
  });

  it('does not publish without EXECUTE', async () => {
    const { host, dir } = setup(false);
    mergeDdnsSecrets(dir, { cloudflareToken: 'tok' });
    upsertDdnsRecord(dir, { fqdn: 'vpn.example.com', type: 'A', provider: 'cloudflare', zone: 'example.com' });
    const st = await runDdnsTick({
      dataDir: dir,
      host,
      execute: false,
      detect: { ipv4: async () => ({ ip: '203.0.113.10', error: null }) },
    });
    expect(st.requiresExecute).toBe(true);
    expect(loadDdnsRecords(dir)[0]?.lastPublished).toBeUndefined();
    expect(loadDdnsRecords(dir)[0]?.lastError).toBe('requiresExecute');
  });

  it('skips provider when IP is unchanged', async () => {
    const { host, dir } = setup(true);
    upsertDdnsRecord(dir, {
      fqdn: 'vpn.example.com',
      type: 'A',
      provider: 'cloudflare',
      zone: 'example.com',
    });
    const recs = loadDdnsRecords(dir);
    recs[0]!.lastPublished = '203.0.113.10';
    recs[0]!.lastError = null;
    const { saveDdnsConfig, loadDdnsSettings } = await import('./store.js');
    saveDdnsConfig(dir, loadDdnsSettings(dir), recs);
    let calls = 0;
    const fetchImpl: CfFetch = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ success: true, result: [] }) };
    };
    await runDdnsTick({
      dataDir: dir,
      host,
      execute: true,
      fetchImpl,
      detect: { ipv4: async () => ({ ip: '203.0.113.10', error: null }) },
    });
    expect(calls).toBe(0);
  });

  it('delete requires fqdn confirm', () => {
    const { dir } = setup();
    const created = upsertDdnsRecord(dir, {
      fqdn: 'vpn.example.com',
      type: 'A',
      provider: 'local',
    });
    expect(deleteDdnsRecord(dir, created.record!.id, 'wrong.com').ok).toBe(false);
    expect(deleteDdnsRecord(dir, created.record!.id, 'vpn.example.com').ok).toBe(true);
    expect(loadDdnsRecords(dir)).toHaveLength(0);
  });

  it('refuses local records owned by CDN', () => {
    const { db } = setup();
    const zone = createResource(db, 'dns_zones', { zone: 'example.com' });
    createResource(db, 'dns_records', {
      zoneId: zone.id,
      type: 'A',
      name: 'vpn',
      value: '203.0.113.1',
      managedBy: 'cdn',
    });
    const clash = findLocalDnsConflict({
      db,
      zoneId: String(zone.id),
      relName: 'vpn',
      type: 'A',
    });
    expect(clash?.managedBy).toBe('cdn');
  });

  it('force republishes when the address is unchanged', async () => {
    const { host, dir } = setup(true);
    mergeDdnsSecrets(dir, { cloudflareToken: 'tok' });
    upsertDdnsRecord(dir, {
      fqdn: 'vpn.example.com',
      type: 'A',
      provider: 'cloudflare',
      zone: 'example.com',
    });
    const recs = loadDdnsRecords(dir);
    recs[0]!.lastPublished = '203.0.113.10';
    recs[0]!.lastError = null;
    saveDdnsConfig(dir, loadDdnsSettings(dir), recs);
    let calls = 0;
    const fetchImpl: CfFetch = async (url, init) => {
      calls += 1;
      if (url.includes('/zones?name=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: [{ id: 'z1', name: 'example.com' }] }),
        };
      }
      if ((init?.method ?? 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [{ id: 'r1', content: '203.0.113.10', proxied: false, ttl: 300 }],
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ success: true, result: { id: 'r1' } }) };
    };
    await runDdnsTick({
      dataDir: dir,
      host,
      execute: true,
      force: true,
      fetchImpl,
      detect: { ipv4: async () => ({ ip: '203.0.113.10', error: null }) },
    });
    expect(calls).toBeGreaterThan(0);
  });

  it('probe detects WAN without calling a provider', async () => {
    const { dir } = setup(false);
    upsertDdnsRecord(dir, {
      fqdn: 'vpn.example.com',
      type: 'A',
      provider: 'cloudflare',
      zone: 'example.com',
    });
    const st = await getDdnsStatus({
      dataDir: dir,
      executeEnabled: false,
      probe: true,
      detect: {
        ipv4: async () => ({ ip: '203.0.113.44', error: null }),
        ipv6: async () => ({ ip: null, error: null }),
      },
    });
    expect(st.detected.ipv4).toBe('203.0.113.44');
    expect(loadDdnsRecords(dir)[0]?.lastPublished).toBeUndefined();
    expect(st.hasCloudflareToken).toBe(false);
  });

  it('refuses remote RFC 2136 without a key file under dataDir', async () => {
    const { host, dir } = setup(true);
    mergeDdnsSecrets(dir, { rfc2136: { server: '203.0.113.9' } });
    const r = await applyDdnsProvider({
      record: {
        id: '1',
        fqdn: 'vpn.example.com',
        type: 'A',
        provider: 'rfc2136',
        ttl: 300,
        enabled: true,
      },
      content: '203.0.113.10',
      secrets: loadDdnsSecrets(dir),
      dataDir: dir,
      host,
      execute: true,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('rfc2136NeedKey');
    expect(resolveRfc2136KeyFile(dir, '/etc/passwd')).toBeNull();
  });

  it('applies a local zone once for two records in the same zone', async () => {
    const { host, dir, db } = setup(true);
    const zone = createResource(db, 'dns_zones', { zone: 'example.com', serverIp: '203.0.113.1' });
    upsertDdnsRecord(dir, { fqdn: 'vpn.example.com', type: 'A', provider: 'local', zone: 'example.com' });
    upsertDdnsRecord(dir, { fqdn: 'wg.example.com', type: 'A', provider: 'local', zone: 'example.com' });
    let applies = 0;
    await runDdnsTick({
      dataDir: dir,
      host,
      db,
      execute: true,
      detect: { ipv4: async () => ({ ip: '203.0.113.10', error: null }) },
      applyLocalZone: async () => {
        applies += 1;
        return { ok: true, notes: ['once'], apply_status: 'applied' };
      },
    });
    expect(applies).toBe(1);
    const recs = loadDdnsRecords(dir);
    expect(recs.every((r) => r.lastPublished === '203.0.113.10')).toBe(true);
    expect(zone.id).toBeTruthy();
  });
});

describe('cloudflare upsert', () => {
  it('PATCHes an existing record instead of POSTing a duplicate', async () => {
    const methods: string[] = [];
    const fetchImpl: CfFetch = async (url, init) => {
      methods.push(`${init?.method ?? 'GET'}`);
      if (url.includes('/zones?name=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, result: [{ id: 'z1', name: 'example.com' }] }),
        };
      }
      if (url.includes('/dns_records') && (init?.method ?? 'GET') === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: [{ id: 'r1', content: '1.1.1.1', proxied: false, ttl: 300 }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, result: { id: 'r1' } }),
      };
    };
    const r = await upsertCloudflareAddressRecord({
      zone: 'example.com',
      fqdn: 'vpn.example.com',
      type: 'A',
      content: '203.0.113.10',
      token: 'tok',
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    expect(r.action).toBe('updated');
    expect(methods).toContain('PATCH');
    expect(methods).not.toContain('POST');
  });
});
