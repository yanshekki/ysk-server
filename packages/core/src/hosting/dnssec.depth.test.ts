import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { generateDnssecKeys, listDnssecMaterial } from './dnssec.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(
  run: (argv: string[]) => Partial<RunResult> | Promise<Partial<RunResult>>,
  execute = true,
): HostExecutor {
  return {
    pathExists: () => false,
    isRoot: () => true,
    executeEnabled: () => execute,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...(await run(argv)) }),
  } as HostExecutor;
}

describe('dnssec depth', () => {
  it('execute path generates keys and DS when tools present', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnssec-d-'));
    try {
      const keyName = 'Kexample.com.+013+12345';
      const host = mockHost(async (argv) => {
        const j = argv.join(' ');
        if (j.includes('command -v dnssec-keygen')) {
          return { exitCode: 0, stdout: '/usr/bin/dnssec-keygen' };
        }
        if (j.includes('dnssec-keygen')) {
          const d = join(dir, 'dns', 'dnssec', 'example.com');
          mkdirSync(d, { recursive: true });
          writeFileSync(
            join(d, `${keyName}.key`),
            'example.com. IN DNSKEY 257 3 13 AAAA\n',
          );
          writeFileSync(join(d, `${keyName}.private`), 'Private-key-format: v1.3\n');
          return { exitCode: 0, stdout: keyName };
        }
        if (j.includes('dnssec-dsfromkey')) {
          return {
            exitCode: 0,
            stdout: 'example.com. IN DS 12345 13 2 DEADBEEF',
          };
        }
        if (j.includes('command -v dnssec-signzone')) {
          return { exitCode: 1, stdout: '' };
        }
        return { exitCode: 1 };
      });

      const r = await generateDnssecKeys({
        dataDir: dir,
        zone: 'Example.COM.',
        host,
        signZone: true,
      });
      expect(r.ok).toBe(true);
      expect(r.dsRecord).toMatch(/DS/);
      expect(r.publicKey).toBeTruthy();
      expect(r.apply_status).toBe('written');
      expect(r.written.some((p) => p.endsWith('DS.txt'))).toBe(true);
      const list = listDnssecMaterial(dir, 'example.com');
      expect(list.files.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reuses existing keys and signs zone when tools ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnssec-s-'));
    try {
      const zoneDir = join(dir, 'dns', 'dnssec', 'ex.com');
      mkdirSync(zoneDir, { recursive: true });
      writeFileSync(join(zoneDir, 'Kex.com.+013+1.key'), 'ex.com. IN DNSKEY 257 3 13 XX\n');
      mkdirSync(join(dir, 'dns', 'zones'), { recursive: true });
      writeFileSync(
        join(dir, 'dns', 'zones', 'ex.com.zone'),
        '$ORIGIN ex.com.\n@ 300 IN SOA ns1 host 1 3600 600 86400 300\n',
      );

      const host = mockHost(async (argv) => {
        const j = argv.join(' ');
        if (j.includes('command -v dnssec-keygen')) {
          return { exitCode: 0, stdout: '/usr/bin/dnssec-keygen' };
        }
        if (j.includes('dnssec-dsfromkey')) {
          return { exitCode: 0, stdout: 'ex.com. IN DS 1 13 2 AA' };
        }
        if (j.includes('command -v dnssec-signzone')) {
          return { exitCode: 0, stdout: '/usr/bin/dnssec-signzone' };
        }
        if (j.includes('dnssec-signzone')) {
          writeFileSync(join(zoneDir, 'ex.com.zone.signed'), 'signed zone\n');
          return { exitCode: 0, stdout: 'sign ok' };
        }
        return { exitCode: 0, stdout: '' };
      });

      const r = await generateDnssecKeys({
        dataDir: dir,
        zone: 'ex.com',
        host,
        signZone: true,
      });
      expect(r.ok).toBe(true);
      expect(r.signedZonePath).toBeTruthy();
      expect(r.apply_status).toBe('applied');
      expect(existsSync(r.signedZonePath!)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing dnssec-keygen is not ok', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnssec-m-'));
    try {
      const host = mockHost(async () => ({ exitCode: 1, stdout: '' }));
      const r = await generateDnssecKeys({
        dataDir: dir,
        zone: 'no-tools.test',
        host,
      });
      expect(r.ok).toBe(false);
      expect(r.apply_status).toBe('written');
      expect(r.written.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sign skipped when no zone file; list empty zone notes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dnssec-z-'));
    try {
      const host = mockHost(async (argv) => {
        const j = argv.join(' ');
        if (j.includes('command -v dnssec-keygen')) {
          return { exitCode: 0, stdout: '/bin/dnssec-keygen' };
        }
        if (j.includes('dnssec-keygen')) {
          const d = join(dir, 'dns', 'dnssec', 'empty.zone');
          mkdirSync(d, { recursive: true });
          writeFileSync(join(d, 'Kempty.zone.+013+9.key'), 'empty.zone. IN DNSKEY 257 3 13 Y\n');
          return { exitCode: 0, stdout: 'ok' };
        }
        if (j.includes('dnssec-dsfromkey')) {
          return { exitCode: 1, stderr: 'ds fail' };
        }
        return { exitCode: 0 };
      });
      const r = await generateDnssecKeys({
        dataDir: dir,
        zone: 'empty.zone',
        host,
        signZone: true,
      });
      expect(r.ok).toBe(true);
      expect(r.signedZonePath).toBeUndefined();
      expect(listDnssecMaterial(dir, 'missing.zone').files).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
