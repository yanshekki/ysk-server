import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  renderBindZoneFile,
  writeManagedDnsZone,
  listManagedDnsZones,
} from './dns-zone.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

function mockHost(run: (argv: string[]) => Partial<RunResult>, execute = true): HostExecutor {
  return {
    executeEnabled: () => execute,
    isRoot: () => false,
    pathExists: () => true,
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => {},
    deletePath: async () => {},
    mkdirp: async () => {},
    sysInfo: async () => ({}),
    serviceStatus: async () => empty(),
    runCommand: async (argv) => ({ ...empty(), argv, ...run(argv) }),
  };
}

describe('dns-zone depth', () => {
  it('renderBindZoneFile templates and custom records', () => {
    const full = renderBindZoneFile({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      template: 'full',
      mailHost: 'mail.example.com',
      serial: 2026010101,
    });
    expect(full.body).toMatch(/SOA|IN\s+A|MX|NS/i);
    expect(full.serial).toBe(2026010101);

    const min = renderBindZoneFile({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      template: 'minimal',
    });
    expect(min.body).not.toMatch(/IN\tMX/);

    const custom = renderBindZoneFile({
      zone: 'example.com',
      serverIp: '203.0.113.10',
      serverIpv6: '2001:db8::1',
      records: [
        { name: '@', type: 'A', value: '1.2.3.4' },
        { name: 'www', type: 'CNAME', value: 'example.com.' },
        { name: '@', type: 'TXT', value: 'v=spf1 -all' },
        { name: '_sip._tcp', type: 'SRV', value: '10 5 5060 sip.example.com.' },
      ],
    });
    expect(custom.records.length).toBeGreaterThanOrEqual(3);
    expect(custom.body).toContain('AAAA');
  });

  it('writeManagedDnsZone validate+reload paths with mock host', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dz-'));
    try {
      const blocked = await writeManagedDnsZone({
        dataDir: dir,
        zone: 'a.example',
        serverIp: '10.0.0.1',
        validate: true,
        tryReload: true,
        host: mockHost(() => ({}), false),
      });
      expect(blocked.requiresExecute).toBe(true);
      expect(blocked.applyStatus).toBe('written');

      const validated = await writeManagedDnsZone({
        dataDir: dir,
        zone: 'b.example',
        serverIp: '10.0.0.2',
        validate: true,
        tryReload: true,
        host: mockHost((argv) => {
          const j = argv.join(' ');
          if (j.includes('named-checkzone') && argv[0] === 'bash') {
            return { stdout: '/usr/sbin/named-checkzone\n' };
          }
          if (argv[0] === 'named-checkzone') return { exitCode: 0, stdout: 'OK' };
          if (j.includes('command -v rndc')) return { stdout: 'ok\n' };
          if (argv[0] === 'rndc') return { exitCode: 0, stdout: 'reload success' };
          return {};
        }),
      });
      expect(validated.ok).toBe(true);
      expect(validated.validated).toBe(true);
      expect(validated.reloaded).toBe(true);
      expect(validated.applyStatus).toBe('applied');
      expect(existsSync(validated.zonePath)).toBe(true);

      const failValidate = await writeManagedDnsZone({
        dataDir: dir,
        zone: 'c.example',
        serverIp: '10.0.0.3',
        validate: true,
        tryReload: true,
        host: mockHost((argv) => {
          if (argv[0] === 'bash' && argv.join(' ').includes('named-checkzone')) {
            return { stdout: '/usr/sbin/named-checkzone\n' };
          }
          if (argv[0] === 'named-checkzone') {
            return { exitCode: 1, stderr: 'bad zone' };
          }
          return {};
        }),
      });
      expect(failValidate.ok).toBe(false);
      expect(failValidate.validated).toBe(false);
      expect(failValidate.reloaded).toBe(false);
      expect(failValidate.applyStatus).toBe('failed');

      const noCheckzone = await writeManagedDnsZone({
        dataDir: dir,
        zone: 'd.example',
        serverIp: '10.0.0.4',
        validate: true,
        tryReload: true,
        host: mockHost((argv) => {
          if (argv[0] === 'bash' && argv.join(' ').includes('named-checkzone')) {
            return { stdout: '' };
          }
          // reload via systemctl bind9
          if (argv[0] === 'bash' && argv.join(' ').includes('rndc')) {
            return { stdout: '' };
          }
          if (argv[0] === 'systemctl' && argv.includes('is-active')) {
            if (argv.includes('bind9')) return { stdout: 'active\n' };
            return { stdout: 'inactive\n' };
          }
          if (argv[0] === 'systemctl' && argv[1] === 'reload' && argv[2] === 'bind9') {
            return { exitCode: 0 };
          }
          return {};
        }),
      });
      expect(noCheckzone.validated).toBeUndefined();
      // may reload via bind9
      expect(typeof noCheckzone.reloaded).toBe('boolean');

      const listed = listManagedDnsZones(dir);
      expect(listed.length).toBeGreaterThanOrEqual(2);
      expect(listed.some((z) => z.zone.includes('example'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('listManagedDnsZones handles empty and meta parse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-dz-l-'));
    try {
      expect(listManagedDnsZones(dir)).toEqual([]);
      const zdir = join(dir, 'dns', 'zones');
      mkdirSync(zdir, { recursive: true });
      writeFileSync(join(zdir, 'x.example.zone'), '$ORIGIN x.example.\n', 'utf8');
      writeFileSync(
        join(zdir, 'x.example.json'),
        JSON.stringify({ serial: 9, serverIp: '1.1.1.1', updatedAt: '2020-01-01' }),
        'utf8',
      );
      writeFileSync(join(zdir, 'y.example.zone'), '$ORIGIN y.example.\n', 'utf8');
      writeFileSync(join(zdir, 'y.example.json'), '{', 'utf8');
      const list = listManagedDnsZones(dir);
      expect(list.some((z) => z.zone === 'x.example' && z.serial === 9)).toBe(true);
      expect(list.some((z) => z.zone === 'y.example')).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
