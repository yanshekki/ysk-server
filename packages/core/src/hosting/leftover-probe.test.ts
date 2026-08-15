import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  classifyManagedNginxName,
  collectStaleCliNotes,
  leftoverHrefForId,
  leftoverKindFromNote,
  probeHostLeftovers,
  splitLeftoverNotes,
} from './leftover-probe.js';
import { applyHostLeftovers } from './leftover-apply.js';

function host(opts: {
  files?: Record<string, string>;
  present?: string[];
  svc?: string;
}): HostExecutor {
  const present = new Set(opts.present ?? Object.keys(opts.files ?? {}));
  return {
    executeEnabled: () => false,
    isRoot: () => false,
    pathExists: (p) => present.has(p),
    readFile: async (p) => opts.files?.[p] ?? '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () =>
      ({
        stdout: opts.svc ?? 'active',
        stderr: '',
        exitCode: 0,
        argv: [],
        dryRun: false,
      }) satisfies RunResult,
    runCommand: async (argv) => ({
      stdout: '',
      stderr: '',
      exitCode: 0,
      argv,
      dryRun: false,
    }),
  };
}

describe('leftover-probe', () => {
  it('reports stale CLI, apache default, missing catch-all, vsftpd, dovecot ssl', async () => {
    const h = host({
      present: [
        '/root/.npm-global/bin/ysk-server',
        '/etc/apache2/sites-enabled/000-default.conf',
        '/etc/nginx/conf.d',
        '/usr/sbin/vsftpd',
        '/etc/dovecot/conf.d/99-ysk-mail-tls.conf',
      ],
      files: {
        '/etc/dovecot/conf.d/99-ysk-mail-tls.conf':
          'ssl = required\nssl_cert = </etc/letsencrypt/live/mail.example/fullchain.pem\n',
      },
      svc: 'failed (Result: exit-code)',
    });
    const r = await probeHostLeftovers({ host: h, currentVersion: '1.0.38' });
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.id).sort()).toEqual([
      'apache-default',
      'dovecot-ssl',
      'nginx-catchall',
      'stale-cli',
      'vsftpd-failed',
    ]);
    expect(collectStaleCliNotes({ host: h, currentVersion: '1.0.38' }).length).toBeGreaterThan(0);
    expect(r.findings.find((f) => f.id === 'apache-default')?.href).toBe('/apache');
    expect(r.findings.find((f) => f.id === 'vsftpd-failed')?.href).toBe('/ftp');
    expect(r.findings.find((f) => f.id === 'stale-cli')?.href).toBe('/updates');
  });

  it('classifies leftover display labels and splits overlay blob', () => {
    expect(classifyManagedNginxName('public-files-qa35web-example-com.conf')).toBe(
      'leftover',
    );
    expect(classifyManagedNginxName('ysk-public-files-qa35web-example-com.conf')).toBe(
      'leftover',
    );
    expect(classifyManagedNginxName('000-default.conf')).toBe('unused');
    expect(classifyManagedNginxName('ysk-000-default.conf')).toBe('unused');
    expect(classifyManagedNginxName('ysks_abc.conf')).toBe('managed');
    expect(leftoverKindFromNote('Apache 000-default is still enabled')).toBe('apache');
    expect(
      leftoverKindFromNote('ysk-000-default.conf is not in /etc/nginx/conf.d'),
    ).toBe('nginx');
    expect(leftoverKindFromNote('vsftpd is failed')).toBe('vsftpd');
    expect(leftoverKindFromNote('Remove with: rm -f /root/.npm-global/bin/ysk-server')).toBe(
      'cli',
    );
    expect(leftoverHrefForId('apache-default')).toBe('/apache');
    expect(splitLeftoverNotes('one · two · three')).toEqual(['one', 'two', 'three']);
  });

  it('is clean when leftover paths are absent', async () => {
    const r = await probeHostLeftovers({ host: host({}), currentVersion: '1.0.38' });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });

  it('leftover apply without execute is dry-run', async () => {
    const r = await applyHostLeftovers({ host: host({}), currentVersion: '1.0.39', execute: false });
    expect(r.dryRun).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.requiresExecute).toBe(true);
  });

  it('leftover apply with execute turns off vsftpd SSL when cert is missing', async () => {
    const files: Record<string, string> = {
      '/etc/vsftpd.conf': 'ssl_enable=YES\nrsa_cert_file=/no/such/cert.pem\n',
    };
    const present = new Set([
      '/etc/vsftpd.conf',
      '/usr/sbin/vsftpd',
    ]);
    const writes: string[] = [];
    const h = {
      ...host({ files, present: [...present], svc: 'failed' }),
      executeEnabled: () => true,
      isRoot: () => true,
      pathExists: (p: string) => present.has(p),
      readFile: async (p: string) => files[p] ?? '',
      writeFile: async (p: string, content: string) => {
        writes.push(p);
        files[p] = content;
      },
    };
    const r = await applyHostLeftovers({ host: h, currentVersion: '1.0.39', execute: true });
    expect(r.executed).toBe(true);
    expect(writes).toContain('/etc/vsftpd.conf');
    expect(files['/etc/vsftpd.conf']).toContain('ssl_enable=NO');
  });
});
