import { describe, expect, it } from 'vitest';
import type { HostExecutor, RunResult } from '../host/executor.js';
import { applyMailTlsPaths } from './mail-tls-apply.js';

function host(opts: { root?: boolean; exec?: boolean; pathExists?: (p: string) => boolean; run?: (a: string[]) => RunResult }): HostExecutor {
  return {
    executeEnabled: () => opts.exec !== false,
    isRoot: () => opts.root !== false,
    pathExists: opts.pathExists ?? (() => false),
    readFile: async () => '',
    listDir: async () => [],
    writeFile: async () => undefined,
    deletePath: async () => undefined,
    mkdirp: async () => undefined,
    sysInfo: async () => ({}),
    serviceStatus: async () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
    runCommand: async (argv) =>
      opts.run?.(argv) ?? { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false },
  };
}

describe('applyMailTlsPaths', () => {
  it('blocks without execute/root', async () => {
    const r = await applyMailTlsPaths({ host: host({ exec: false }), domain: 'ex.test' });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('blocks without root when execute on', async () => {
    const r = await applyMailTlsPaths({ host: host({ root: false, exec: true }), domain: 'ex.test' });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBe(true);
  });

  it('fails when domain empty', async () => {
    const r = await applyMailTlsPaths({ host: host({}), domain: '  ' });
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
  });

  it('fails when cert missing', async () => {
    const r = await applyMailTlsPaths({ host: host({}), domain: 'ex.test' });
    expect(r.ok).toBe(false);
    expect(r.applied).toBe(false);
  });

  it('applies postfix + dovecot when cert present', async () => {
    const base = '/etc/letsencrypt/live/mail.ex.test';
    const r = await applyMailTlsPaths({
      domain: 'ex.test',
      host: host({
        pathExists: (p) => p === `${base}/fullchain.pem` || p === `${base}/privkey.pem`,
        run: (argv) => {
          const j = argv.join(' ');
          if (j.includes('postconf')) {
            return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (j.includes('reload postfix') || j.includes('service postfix')) {
            return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (j.includes('doveconf') || j.includes('dove_')) {
            return { stdout: 'dove_ok\n', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      }),
    });
    expect(r.applied).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.certBase).toBe(base);
    expect(r.steps.some((s) => s.name === 'postfix-postconf' && s.status === 'ok')).toBe(true);
    expect(r.steps.some((s) => s.name === 'dovecot-tls' && s.status === 'ok')).toBe(true);
  });

  it('fails when postconf fails; skips dovecot when absent', async () => {
    const base = '/etc/letsencrypt/live/mail.ex.test';
    const failConf = await applyMailTlsPaths({
      domain: 'ex.test',
      host: host({
        pathExists: (p) => p.includes('fullchain') || p.includes('privkey'),
        run: () => ({ stdout: '', stderr: 'postconf boom', exitCode: 1, argv: [], dryRun: false }),
      }),
    });
    expect(failConf.ok).toBe(false);
    expect(failConf.steps.some((s) => s.name === 'postfix-postconf' && s.status === 'failed')).toBe(
      true,
    );

    const softReload = await applyMailTlsPaths({
      domain: 'ex.test',
      applyDovecot: true,
      host: host({
        pathExists: (p) => p === `${base}/fullchain.pem` || p === `${base}/privkey.pem`,
        run: (argv) => {
          const j = argv.join(' ');
          if (j.includes('postconf -e')) {
            return { stdout: '', stderr: '', exitCode: 0, argv, dryRun: false };
          }
          if (j.includes('reload postfix') || j.includes('service postfix')) {
            return { stdout: '', stderr: 'reload fail', exitCode: 1, argv, dryRun: false };
          }
          return { stdout: 'dove_skip\n', stderr: '', exitCode: 0, argv, dryRun: false };
        },
      }),
    });
    expect(softReload.applied).toBe(true);
    expect(softReload.ok).toBe(false); // reload failed
    expect(softReload.steps.some((s) => s.name === 'postfix-reload' && s.status === 'failed')).toBe(
      true,
    );
    expect(softReload.steps.some((s) => s.name === 'dovecot-tls' && s.status === 'skipped')).toBe(
      true,
    );
  });

  it('can skip dovecot apply when applyDovecot=false', async () => {
    const base = '/etc/letsencrypt/live/custom.mail';
    const r = await applyMailTlsPaths({
      domain: 'ex.test',
      mailHost: 'custom.mail',
      applyDovecot: false,
      host: host({
        pathExists: (p) => p.startsWith(base),
        run: () => ({ stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false }),
      }),
    });
    expect(r.applied).toBe(true);
    expect(r.steps.some((s) => s.name === 'dovecot-tls')).toBe(false);
  });
});
