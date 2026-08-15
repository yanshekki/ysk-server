import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { collectStaleCliNotes, probeHostLeftovers } from './leftover-probe.js';

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
  });

  it('is clean when leftover paths are absent', async () => {
    const r = await probeHostLeftovers({ host: host({}), currentVersion: '1.0.38' });
    expect(r.ok).toBe(true);
    expect(r.findings).toEqual([]);
  });
});
