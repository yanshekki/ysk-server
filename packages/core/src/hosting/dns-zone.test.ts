import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import { YskError } from '@ysk-server/shared';
import {
  listManagedDnsZones,
  renderBindZoneFile,
  writeManagedDnsZone,
} from './dns-zone.js';

describe('dns-zone', () => {
  it('renders SOA/NS + template records', () => {
    const r = renderBindZoneFile({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      template: 'full',
    });
    expect(r.body).toContain('IN\tSOA');
    expect(r.body).toContain('203.0.113.10');
    expect(r.body).toContain('IN\tMX');
    expect(r.body).toContain('v=spf1');
    expect(r.body).toContain('www');
    expect(r.body).toContain('ftp');
    expect(r.serial).toBeGreaterThan(2020010100);
  });

  it('minimal template has no MX', () => {
    const r = renderBindZoneFile({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      template: 'minimal',
    });
    expect(r.body).toContain('IN\tA');
    expect(r.body).not.toContain('IN\tMX');
  });

  it('renders custom SOA timings, hostmaster and secondary NS', () => {
    const r = renderBindZoneFile({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      nsName: 'ns1.example.com',
      ns2Name: 'ns2.example.com',
      hostmaster: 'admin.example.com',
      ttl: 600,
      soaRefresh: 3600,
      soaRetry: 900,
      soaExpire: 604800,
      soaMinimum: 120,
      template: 'minimal',
    });
    expect(r.body).toMatch(/SOA\tns1\.example\.com\.\tadmin\.example\.com\./);
    expect(r.body).toContain('3600');
    expect(r.body).toContain('900');
    expect(r.body).toContain('604800');
    expect(r.body).toContain('120');
    expect(r.body).toMatch(/IN\tNS\tns2\.example\.com\./);
  });

  it('rejects bad zone and IP', () => {
    expect(() => renderBindZoneFile({ zone: '', serverIp: '1.2.3.4' })).toThrow(YskError);
    expect(() =>
      renderBindZoneFile({ zone: 'ok.com', serverIp: '999.1.1.1' }),
    ).toThrow(YskError);
  });

  it('writes zone + meta under dataDir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dns-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await writeManagedDnsZone({
      dataDir: dir,
      zone: 'demo.local',
      serverIp: '10.0.0.5',
      host,
      validate: true,
    });
    expect(r.ok).toBe(true);
    expect(r.requiresExecute).toBe(true);
    expect(r.applyStatus).toBe('written');
    expect(r.reloaded).toBe(false);
    expect(existsSync(r.zonePath)).toBe(true);
    expect(readFileSync(r.zonePath, 'utf8')).toContain('demo.local.');
    const listed = listManagedDnsZones(dir);
    expect(listed.some((z) => z.zone === 'demo.local')).toBe(true);
    expect(listed[0].serverIp).toBe('10.0.0.5');
    rmSync(dir, { recursive: true, force: true });
  });
});
