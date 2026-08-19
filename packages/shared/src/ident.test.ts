import { describe, expect, it } from 'vitest';
import {
  isCidr,
  isFtpUsername,
  isIpAddress,
  isMailDomain,
  isMailboxLocalPart,
  isNginxServerNameToken,
  isProjectName,
  isSqlIdent,
  parseDockerArgvLine,
} from './ident.js';

describe('ident guards', () => {
  it('rejects project names with spaces and punctuation', () => {
    expect(isProjectName('hello')).toBe(true);
    expect(isProjectName('qa36tmp')).toBe(true);
    expect(isProjectName('Bad Name!!')).toBe(false);
    expect(isProjectName('Hello')).toBe(false);
  });

  it('rejects FTP usernames with space or !', () => {
    expect(isFtpUsername('qa-ftp.1')).toBe(true);
    expect(isFtpUsername('qa ftp!')).toBe(false);
  });

  it('rejects SQL names with capitals, space, or !', () => {
    expect(isSqlIdent('qa113_tmp')).toBe(true);
    expect(isSqlIdent('QA Bad-Name!')).toBe(false);
  });

  it('validates IPs and CIDR', () => {
    expect(isIpAddress('127.0.0.1')).toBe(true);
    expect(isIpAddress('not.an.ip.999')).toBe(false);
    expect(isIpAddress('999.999.999.999')).toBe(false);
    expect(isCidr('10.0.0.0/24')).toBe(true);
    expect(isCidr('not-a-cidr/99')).toBe(false);
    expect(isCidr('')).toBe(false);
    expect(isCidr('999.999.999.999/24')).toBe(false);
  });

  it('validates mailbox local-part and mail domains', () => {
    expect(isMailboxLocalPart('info')).toBe(true);
    expect(isMailboxLocalPart('sales+list')).toBe(true);
    expect(isMailboxLocalPart('BAD SPACE')).toBe(false);
    expect(isMailboxLocalPart('')).toBe(false);
    expect(isMailDomain('example.com')).toBe(true);
    expect(isMailDomain('mail-http-test.local')).toBe(true);
    expect(isMailDomain('')).toBe(false);
    expect(isMailDomain('not a domain')).toBe(false);
    expect(isMailDomain('127.0.0.1')).toBe(false);
  });

  it('rejects illegal nginx server_name tokens', () => {
    expect(isNginxServerNameToken('dock.demo-server.ysk.hk')).toBe(true);
    expect(isNginxServerNameToken('not a valid host!!')).toBe(false);
    expect(isNginxServerNameToken('localhost')).toBe(true);
    expect(isNginxServerNameToken('*.example.com')).toBe(true);
  });

  it('parses docker command tokens fail-closed', () => {
    expect(parseDockerArgvLine('nginx -g daemon-off;')).toBeNull();
    expect(parseDockerArgvLine('nginx -g daemon-off')).toEqual(['nginx', '-g', 'daemon-off']);
    expect(parseDockerArgvLine('')).toEqual([]);
  });
});
