import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildLocalAProbeNames,
  digLocalAuthoritative,
  digPublicNs,
  probeDnsServiceHealth,
  publicNsLooksInZone,
} from './dns-health.js';

function host(run: (argv: string[]) => { exitCode: number; stdout: string; stderr?: string }) {
  return {
    executeEnabled: () => true,
    isRoot: () => true,
    runCommand: async (argv: string[]) => {
      const joined = argv.map(String).join(' ');
      if (/command -v\s+dig/.test(joined)) {
        return {
          exitCode: 0,
          stdout: '/usr/bin/dig\n',
          stderr: '',
          argv,
          dryRun: false,
        };
      }
      const r = run(argv.map(String));
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr ?? '', argv, dryRun: false };
    },
  };
}

describe('dns-health', () => {
  it('buildLocalAProbeNames is zone-generic (apex + www + relative A)', () => {
    const names = buildLocalAProbeNames('example.test', ['@', 'mail', 'api']);
    expect(names[0]).toBe('example.test');
    expect(names).toContain('www.example.test');
    expect(names).toContain('mail.example.test');
    expect(names).toContain('api.example.test');
    expect(names.join(' ')).not.toMatch(/ftp\.|ysk/i);
  });

  it('publicNsLooksInZone only matches in-zone NS names', () => {
    expect(publicNsLooksInZone('example.test', ['ns1.example.test'])).toBe(true);
    expect(publicNsLooksInZone('example.test', ['ns2.example.test'])).toBe(true);
    expect(publicNsLooksInZone('example.test', ['a.ns.cloudflare.com'])).toBe(false);
    expect(publicNsLooksInZone('example.test', ['ysk.example.net'])).toBe(false);
  });

  it('reports service down and closed 53', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dns-h-'));
    const h = host((argv) => {
      const s = argv.join(' ');
      if (s.includes('is-active')) return { exitCode: 0, stdout: 'inactive\n' };
      if (s.includes('ss -')) return { exitCode: 1, stdout: '' };
      return { exitCode: 0, stdout: '' };
    });
    const r = await probeDnsServiceHealth({ dataDir, host: h as never });
    expect(r.unitActive).toBe(false);
    expect(r.listenUdp53).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.states.service).toBe('danger');
  });

  it('detects active named and open 53 + zone files', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dns-h2-'));
    const zdir = join(dataDir, 'dns', 'zones');
    mkdirSync(zdir, { recursive: true });
    writeFileSync(join(zdir, 'example.test.zone'), '$TTL 300\n');
    writeFileSync(
      join(zdir, 'example.test.json'),
      JSON.stringify({
        zone: 'example.test',
        updatedAt: '2026-01-01T00:00:00.000Z',
        serial: 1,
        records: [{ type: 'A', name: 'www', value: '203.0.113.10' }],
      }) + '\n',
    );
    const h = host((argv) => {
      const s = argv.join(' ');
      if (s.includes('is-active named')) return { exitCode: 0, stdout: 'active\n' };
      if (s.includes('is-active')) return { exitCode: 0, stdout: 'inactive\n' };
      if (s.includes('ss -uln') || s.includes(':53'))
        return { exitCode: 0, stdout: 'UNCONN 0 0 0.0.0.0:53 *:*\n' };
      if (s.includes('ss -tln'))
        return { exitCode: 0, stdout: 'LISTEN 0 0 0.0.0.0:53 *:*\n' };
      if (s.includes('@8.8.8.8') && s.includes('NS'))
        return { exitCode: 0, stdout: 'ns1.example.test.\n' };
      if (s.includes(' A ') || s.includes('"A"') || /\bA\b/.test(s))
        return { exitCode: 0, stdout: '203.0.113.10\n' };
      if (s.includes('dig') || s.includes('@127.0.0.1') || s.includes('SOA'))
        return { exitCode: 0, stdout: 'ns1.example.test.\n' };
      return { exitCode: 0, stdout: '' };
    });
    const r = await probeDnsServiceHealth({
      dataDir,
      host: h as never,
      digName: 'example.test',
    });
    expect(r.unit).toBe('named');
    expect(r.unitActive).toBe(true);
    expect(r.zoneFiles).toBe(1);
    expect(r.latestZone).toBe('example.test');
    expect(r.states.written).toBe('ok');
    expect(r.publicNs?.some((n) => n.includes('example.test'))).toBe(true);
    expect(r.publicNsPointsHere).toBe(true);
  });

  it('digLocalAuthoritative surfaces connection refused', async () => {
    const h = host(() => ({
      exitCode: 9,
      stdout: '',
      stderr: ';; communications error to 127.0.0.1#53: connection refused',
    }));
    const r = await digLocalAuthoritative({ host: h as never, name: 'example.test' });
    expect(r.ok).toBe(false);
    expect(r.notes.some((n) => /refused|failed/i.test(n))).toBe(true);
  });

  it('detects REFUSED when +short empty and status comments say REFUSED', async () => {
    const h = host((argv) => {
      const s = argv.join(' ');
      if (s.includes('+short')) {
        return { exitCode: 0, stdout: '' };
      }
      if (s.includes('+comments') || s.includes('noall')) {
        return {
          exitCode: 0,
          stdout: ';; ->>HEADER<<- opcode: QUERY, status: REFUSED, id: 1\n',
        };
      }
      return { exitCode: 0, stdout: '' };
    });
    const r = await digLocalAuthoritative({
      host: h as never,
      name: 'www.example.test',
      type: 'A',
    });
    expect(r.ok).toBe(false);
    expect(r.notes.some((x) => /REFUSED/i.test(x))).toBe(true);
  });

  it('pdns active with zone files but 0 list-zones → loaded danger; CF NS not pointsHere', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-dns-h3-'));
    const zdir = join(dataDir, 'dns', 'zones');
    mkdirSync(zdir, { recursive: true });
    writeFileSync(join(zdir, 'example.test.zone'), '$TTL 300\n');
    writeFileSync(
      join(zdir, 'example.test.json'),
      JSON.stringify({ zone: 'example.test', updatedAt: '2026-01-01T00:00:00.000Z' }) + '\n',
    );
    const h = host((argv) => {
      const s = argv.join(' ');
      if (s.includes('is-active pdns')) return { exitCode: 0, stdout: 'active\n' };
      if (s.includes('is-active')) return { exitCode: 0, stdout: 'inactive\n' };
      if (s.includes('ss -')) return { exitCode: 0, stdout: 'UNCONN 0 0 203.0.113.10:53\n' };
      if (s.includes('list-zones')) return { exitCode: 0, stdout: 'All zonecount: 0\n' };
      if (s.includes('@8.8.8.8') || s.includes('NS'))
        return {
          exitCode: 0,
          stdout: 'ada.ns.cloudflare.com.\nbob.ns.cloudflare.com.\n',
        };
      if (s.includes('+short')) return { exitCode: 0, stdout: '' };
      if (s.includes('+comments')) {
        return { exitCode: 0, stdout: 'status: REFUSED\n' };
      }
      return { exitCode: 0, stdout: '' };
    });
    const r = await probeDnsServiceHealth({
      dataDir,
      host: h as never,
      digName: 'example.test',
    });
    expect(r.unit).toBe('pdns');
    expect(r.zoneFiles).toBe(1);
    expect(r.pdnsZoneCount).toBe(0);
    expect(r.states.loaded).toBe('danger');
    expect(r.ok).toBe(false);
    expect(r.publicNsPointsHere).not.toBe(true);
    expect(r.notes.some((n) => /Cloudflare|third-party|not this host|公網|公网/i.test(n))).toBe(
      true,
    );
  });

  it('digPublicNs respects custom resolver and omits brand heuristics', async () => {
    const h = host((argv) => {
      const s = argv.join(' ');
      expect(s).toContain('@1.1.1.1');
      return { exitCode: 0, stdout: 'ns1.example.test.\n' };
    });
    const r = await digPublicNs({
      host: h as never,
      zone: 'example.test',
      publicResolver: '1.1.1.1',
    });
    expect(r.resolver).toBe('1.1.1.1');
    expect(r.pointsHere).toBe(true);
    expect(r.ns).toContain('ns1.example.test');
  });
});
