import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalHostExecutor } from '../host/executor.js';
import {
  applyPowerDnsZone,
  installPowerDnsPackages,
  probePowerDns,
} from './powerdns-apply.js';

describe('powerdns-apply', () => {
  it('writes zone + helper without load (plan mode)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pdns-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyPowerDnsZone({
      dataDir: dir,
      host,
      zone: 'pdns.example',
      serverIp: '203.0.113.50',
      load: false,
    });
    expect(r.ok).toBe(true);
    expect(r.mode).toBe('plan');
    expect(existsSync(r.zonePath)).toBe(true);
    expect(r.written.some((p) => p.includes('load-pdns.example.sh'))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses load without YSK_EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pdns-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyPowerDnsZone({
      dataDir: dir,
      host,
      zone: 'deny.example',
      serverIp: '10.0.0.1',
      load: true,
    });
    expect(r.ok).toBe(false);
    expect(r.mode).toBe('refused');
    expect(r.requiresExecute).toBe(true);
    expect(r.notes.some((n) => /YSK_EXECUTE|系統變更|權限/i.test(n))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses load when tools missing / no root even with EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pdns-'));
    // execute without root → bind named.conf sync refused; no pdnsutil on empty PATH
    const host = new LocalHostExecutor({
      allowedWriteRoots: [dir],
      executeEnabled: true,
    });
    const prev = process.env.PATH;
    process.env.PATH = '/nonexistent-bin-path';
    try {
      const r = await applyPowerDnsZone({
        dataDir: dir,
        host,
        zone: 'miss.example',
        serverIp: '10.0.0.2',
        load: true,
      });
      expect(r.ok).toBe(false);
      expect(r.mode).toBe('refused');
      // Either no probe tools, or bind path refused for non-root
      expect(r.probe.available === false || r.requiresRoot || r.loadMethod === 'none').toBe(true);
    } finally {
      process.env.PATH = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('plan mode writes named-zones.conf for BIND backend (runtime paths)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pdns-nz-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const r = await applyPowerDnsZone({
      dataDir: dir,
      host,
      zone: 'bind.example',
      serverIp: '203.0.113.60',
      load: false,
    });
    expect(r.ok).toBe(true);
    expect(existsSync(join(dir, 'dns', 'powerdns', 'named-zones.conf'))).toBe(true);
    const body = (await import('node:fs')).readFileSync(
      join(dir, 'dns', 'powerdns', 'named-zones.conf'),
      'utf8',
    );
    expect(body).toContain('zone "bind.example"');
    expect(body).toContain('/var/lib/powerdns/zones/bind.example.zone');
    rmSync(dir, { recursive: true, force: true });
  });

  it('probePowerDns returns structure', async () => {
    const host = new LocalHostExecutor({ executeEnabled: false });
    const p = await probePowerDns(host);
    expect(typeof p.available).toBe('boolean');
    expect(Array.isArray(p.notes)).toBe(true);
  });

  it('writes install helper and refuses install without EXECUTE', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-pdns-i-'));
    const host = new LocalHostExecutor({ allowedWriteRoots: [dir], executeEnabled: false });
    const plan = await installPowerDnsPackages({ dataDir: dir, host, install: false });
    expect(plan.ok).toBe(true);
    expect(existsSync(plan.written[0])).toBe(true);
    const refused = await installPowerDnsPackages({ dataDir: dir, host, install: true });
    expect(refused.ok).toBe(false);
    expect(refused.requiresExecute).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});