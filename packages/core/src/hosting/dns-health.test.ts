import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { digLocalAuthoritative, probeDnsServiceHealth } from './dns-health.js';

function host(run: (argv: string[]) => { exitCode: number; stdout: string; stderr?: string }) {
  return {
    executeEnabled: () => true,
    isRoot: () => true,
    runCommand: async (argv: string[]) => {
      const r = run(argv.map(String));
      return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr ?? '', argv, dryRun: false };
    },
  };
}

describe('dns-health', () => {
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
    writeFileSync(join(zdir, 'ysk.cc.zone'), '$TTL 300\n');
    writeFileSync(
      join(zdir, 'ysk.cc.json'),
      JSON.stringify({ zone: 'ysk.cc', updatedAt: '2026-01-01T00:00:00.000Z', serial: 1 }) + '\n',
    );
    const h = host((argv) => {
      const s = argv.join(' ');
      if (s.includes('is-active named')) return { exitCode: 0, stdout: 'active\n' };
      if (s.includes('is-active')) return { exitCode: 0, stdout: 'inactive\n' };
      if (s.includes('ss -uln') || s.includes(':53'))
        return { exitCode: 0, stdout: 'UNCONN 0 0 0.0.0.0:53 *:*\n' };
      if (s.includes('ss -tln'))
        return { exitCode: 0, stdout: 'LISTEN 0 0 0.0.0.0:53 *:*\n' };
      if (s.includes('dig') || s.includes('@127.0.0.1'))
        return { exitCode: 0, stdout: 'ns1.ysk.cc.\n' };
      return { exitCode: 0, stdout: '' };
    });
    const r = await probeDnsServiceHealth({ dataDir, host: h as never, digName: 'ysk.cc' });
    expect(r.unit).toBe('named');
    expect(r.unitActive).toBe(true);
    expect(r.zoneFiles).toBe(1);
    expect(r.latestZone).toBe('ysk.cc');
    expect(r.states.written).toBe('ok');
  });

  it('digLocalAuthoritative surfaces connection refused', async () => {
    const h = host(() => ({
      exitCode: 9,
      stdout: '',
      stderr: ';; communications error to 127.0.0.1#53: connection refused',
    }));
    const r = await digLocalAuthoritative({ host: h as never, name: 'ysk.cc' });
    expect(r.ok).toBe(false);
    expect(r.notes.some((n) => /refused|failed/i.test(n))).toBe(true);
  });
});
