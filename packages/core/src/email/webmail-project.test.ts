import { describe, expect, it } from 'vitest';
import {
  buildRoundcubeConfigInc,
  defaultImapHostForWebmail,
  defaultWebmailHostname,
  defaultWebmailProjectName,
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
    });
    expect(cfg).toContain("default_host'] = 'ssl://mail.example.com'");
    expect(cfg).toContain("smtp_server'] = 'tls://mail.example.com'");
    expect(cfg).toContain("smtp_port'] = 587");
    expect(cfg).toContain("enable_installer'] = false");
    expect(cfg).toContain('product_name');
    expect(cfg).toContain('managesieve');
    expect(cfg).toContain('sqlite:');
    expect(cfg).toContain('abcdefghijklmnopqrstuvwx');
  });
});
