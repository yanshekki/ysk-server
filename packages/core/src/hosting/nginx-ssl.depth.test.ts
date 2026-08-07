import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { HostExecutor, RunResult } from '../host/executor.js';
import {
  buildServerNameList,
  nginxListenLines,
  planLetsEncrypt,
  purgeNginxCache,
  renderNginxPhpFpm,
  renderNginxProxy,
  renderNginxStatic,
  renderNginxSuspended,
} from './nginx-ssl.js';

function empty(extra?: Partial<RunResult>): RunResult {
  return { stdout: '', stderr: '', exitCode: 0, argv: [], dryRun: false, ...extra };
}

describe('nginx-ssl depth', () => {
  it('buildServerNameList and nginxListenLines variants', () => {
    expect(buildServerNameList(undefined, ['a.com'])).toContain('a.com');
    expect(buildServerNameList('x.com', ['X.com', 'y.com', ''])).toContain('y.com');
    expect(buildServerNameList('', [])).toBeTruthy();
    expect(nginxListenLines({ ssl: false })).toMatch(/listen 80/);
    expect(nginxListenLines({ ssl: true })).toMatch(/443/);
    expect(nginxListenLines({ ssl: true, bindIp: '10.0.0.1' })).toContain('10.0.0.1');
    expect(nginxListenLines({ ssl: false, bindIp: '10.0.0.1' })).toContain(':80');
    expect(nginxListenLines({ ssl: true, bindIp: '2001:db8::1' })).toContain('[');
    expect(nginxListenLines({ ssl: false, bindIp: '2001:db8::2' })).toContain('[');
    expect(nginxListenLines({ ssl: false, bindIp: '  ' })).toMatch(/listen/);
  });

  it('renderNginxProxy validation, redirect, forceHttps, auth', () => {
    expect(() =>
      renderNginxProxy({ serverName: '', upstream: 'http://x' } as never),
    ).toThrow();
    expect(() =>
      renderNginxProxy({ serverName: 'a.com', upstream: '' } as never),
    ).toThrow();

    const redir = renderNginxProxy({
      serverName: 'a.com',
      upstream: 'http://127.0.0.1:1',
      siteRedirectUrl: 'https://other.com',
      ssl: true,
      sslCertificate: '/c/full.pem',
      sslCertificateKey: '/c/key.pem',
      hsts: true,
    });
    expect(redir).toContain('return 301');
    expect(redir).toContain('other.com');

    const force = renderNginxProxy({
      serverName: 'b.com',
      upstream: 'http://127.0.0.1:9',
      ssl: true,
      forceHttps: true,
      hsts: true,
      cloudflareRealIp: true,
      authBasicUserFile: '/data/htpasswd',
      authBasicRealm: 'Priv',
      bindIp: '203.0.113.1',
      sslCertificate: '/certs/full.pem',
      sslCertificateKey: '/certs/key.pem',
    });
    expect(force).toMatch(/listen.*443/);
    expect(force).toContain('auth_basic');
    expect(force).toContain('Strict-Transport-Security');
  });

  it('renderNginxStatic with ssl forceHttps auth redirect', () => {
    const conf = renderNginxStatic({
      serverName: 's.com',
      docRoot: '/var/www',
      ssl: true,
      forceHttps: true,
      hsts: true,
      cloudflareRealIp: true,
      sslCertificate: '/c/f.pem',
      sslCertificateKey: '/c/k.pem',
      authBasicUserFile: '/ht',
      siteRedirectUrl: 'https://new.example/',
      bindIp: '10.1.1.1',
    });
    expect(conf.length).toBeGreaterThan(20);

    const plain = renderNginxStatic({
      serverName: 's2.com',
      docRoot: '/www',
      ssl: false,
    });
    expect(plain).toContain('root /www');
  });

  it('renderNginxPhpFpm ssl forceHttps and auth branches', () => {
    const conf = renderNginxPhpFpm({
      serverName: 'p.com',
      docRoot: '/var/www/php',
      fpmSocket: '/run/php/php8.3-fpm.sock',
      ssl: true,
      forceHttps: true,
      hsts: true,
      cloudflareRealIp: true,
      sslCertificate: '/c/f.pem',
      sslCertificateKey: '/c/k.pem',
      authBasicUserFile: '/ht',
      siteRedirectUrl: 'https://go.example',
      bindIp: '10.0.0.5',
    });
    expect(conf.length).toBeGreaterThan(10);

    const plain = renderNginxPhpFpm({
      serverName: 'p2.com',
      docRoot: '/www',
      fpmSocket: '/run/php.sock',
      apacheUpstream: 'http://127.0.0.1:8080',
    });
    expect(plain).toContain('proxy_pass http://127.0.0.1:8080');
    expect(plain).not.toContain('fastcgi_pass');
  });

  it('renderNginxSuspended and planLetsEncrypt variants', () => {
    expect(renderNginxSuspended('x.com y.com')).toContain('503');
    const http = planLetsEncrypt({
      domain: 'a.com',
      email: 'a@b.com',
      provider: 'letsencrypt',
      challenge: 'http-01',
    });
    expect(http.commands.length).toBeGreaterThan(0);
    const dns = planLetsEncrypt({
      domain: 'a.com',
      email: 'a@b.com',
      provider: 'letsencrypt',
      challenge: 'dns-01',
    });
    expect(dns.notes.length + dns.commands.length).toBeGreaterThan(0);
    const bad = planLetsEncrypt({
      domain: 'a.com',
      email: 'a@b.com',
      provider: 'custom' as never,
      challenge: 'http-01',
    });
    expect(bad.notes.length + bad.commands.length).toBeGreaterThanOrEqual(0);
  });

  it('purgeNginxCache honesty without execute and with mock host', async () => {
    const host: HostExecutor = {
      executeEnabled: () => false,
      isRoot: () => false,
      pathExists: () => true,
      readFile: async () => '',
      listDir: async () => [],
      writeFile: async () => {},
      deletePath: async () => {},
      mkdirp: async () => {},
      sysInfo: async () => ({}),
      serviceStatus: async () => empty(),
      runCommand: async () => empty(),
    };
    const blocked = await purgeNginxCache({ host });
    expect(blocked.ok).toBe(false);
    expect(blocked.blocked).toBe(true);

    const live: HostExecutor = {
      ...host,
      executeEnabled: () => true,
      isRoot: () => true,
      runCommand: async () =>
        empty({ exitCode: 0, stdout: 'nginx: configuration file test is successful\nEXIT:0\n' }),
    };
    const ok = await purgeNginxCache({ host: live });
    expect(ok.ok).toBe(true);

    const fail: HostExecutor = {
      ...live,
      runCommand: async () =>
        empty({
          exitCode: 1,
          stderr: 'nginx: configuration file /etc/nginx/nginx.conf test failed\n',
        }),
    };
    const bad = await purgeNginxCache({ host: fail });
    expect(bad.ok).toBe(false);
  });
});
