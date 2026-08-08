import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildRoundcubeConfigInc,
  defaultImapHostForWebmail,
  defaultWebmailHostname,
  defaultWebmailProjectName,
  ensureRoundcubeRuntime,
  ensureSnappyMailAdminBootstrap,
  installYskSsoIntoRoundcube,
  normalizeWebmailTool,
} from './webmail-project.js';

describe('webmail-project helpers', () => {
  it('normalizes tool ids', () => {
    expect(normalizeWebmailTool('roundcube')).toBe('roundcube');
    expect(normalizeWebmailTool('snappymail')).toBe('snappymail');
    expect(normalizeWebmailTool('snappy')).toBe('snappymail');
    expect(normalizeWebmailTool('rainloop')).toBe('snappymail');
    expect(normalizeWebmailTool('')).toBe('roundcube');
  });

  it('default project names and hostnames', () => {
    expect(defaultWebmailProjectName('roundcube', 'example.com')).toBe(
      'roundcube-example-com',
    );
    expect(defaultWebmailProjectName('snappymail', 'webmail.foo.test')).toBe(
      'snappymail-foo-test',
    );
    expect(defaultWebmailHostname('example.com')).toBe('webmail.example.com');
    expect(defaultWebmailHostname('webmail.example.com')).toBe('webmail.example.com');
  });

  it('derives IMAP host from webmail or apex', () => {
    expect(defaultImapHostForWebmail('webmail.example.com')).toBe('mail.example.com');
    expect(defaultImapHostForWebmail('example.com')).toBe('mail.example.com');
    expect(defaultImapHostForWebmail('mail.example.com')).toBe('mail.example.com');
  });

  it('Roundcube config is managed with SSL IMAP and submission SMTP', () => {
    const cfg = buildRoundcubeConfigInc({
      desKey: 'abcdefghijklmnopqrstuvwx',
      imapHost: 'mail.example.com',
      smtpHost: 'mail.example.com',
      dbPath: '/var/lib/ysk/roundcube.db',
      forceHttps: true,
      plugins: ['archive', 'ysk_sso'],
    });
    expect(cfg).toContain("default_host'] = 'ssl://mail.example.com'");
    expect(cfg).toContain("smtp_server'] = 'tls://mail.example.com'");
    expect(cfg).toContain("smtp_port'] = 587");
    expect(cfg).toContain("enable_installer'] = false");
    expect(cfg).toContain('product_name');
    expect(cfg).toContain('ysk_sso');
    expect(cfg).toContain('sqlite:');
    expect(cfg).toContain("force_https'] = true");
    expect(cfg).toContain('abcdefghijklmnopqrstuvwx');
  });

  it('writes SSO plugin and force_https runtime', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-wm-'));
    try {
      const sso = installYskSsoIntoRoundcube(dir, 'https://panel.example');
      expect(existsSync(join(sso.pluginDir, 'ysk_sso.php'))).toBe(true);
      const rt = ensureRoundcubeRuntime(dir, 'mail.ex.com', 'mail.ex.com', {
        forceHttps: true,
        installSsoPlugin: true,
        panelBaseUrl: 'https://panel.example',
      });
      expect(rt.written.some((p) => p.includes('config.inc.php'))).toBe(true);
      const cfg = readFileSync(join(dir, 'config', 'config.inc.php'), 'utf8');
      expect(cfg).toContain('ysk_sso');
      expect(cfg).toContain("force_https'] = true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('seeds SnappyMail admin once password', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ysk-sm-'));
    try {
      const r = ensureSnappyMailAdminBootstrap(dir, 'mail.ex.com', 'mail.ex.com', 'TestPass99aa');
      expect(r.adminPassword).toBe('TestPass99aa');
      expect(existsSync(join(dir, 'ysk-snappy-admin.php'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
