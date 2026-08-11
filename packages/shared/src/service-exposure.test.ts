import { describe, expect, it } from 'vitest';
import {
  yskSvcComment,
  yskSvcCommentPrefix,
  sanitizeSvcToken,
  defaultExposureMode,
  defaultPortsForService,
  normalizePortBinding,
  normalizeExposureMode,
  isValidServiceId,
} from './service-exposure.js';

describe('service-exposure', () => {
  it('sanitizes tokens and builds comments', () => {
    expect(sanitizeSvcToken('MySQL')).toBe('mysql');
    expect(sanitizeSvcToken('a b!')).toBe('a-b');
    expect(yskSvcComment('vsftpd', 'ftp')).toBe('ysk-svc:vsftpd:ftp');
    expect(yskSvcCommentPrefix('redis')).toBe('ysk-svc:redis:');
  });

  it('defaults mode from catalog privateRecommended', () => {
    expect(defaultExposureMode('mysql')).toBe('private');
    expect(defaultExposureMode('redis')).toBe('private');
    expect(defaultExposureMode('nginx')).toBe('public');
    expect(defaultExposureMode('vsftpd')).toBe('public');
  });

  it('default ports for known services', () => {
    expect(defaultPortsForService('nginx').map((p) => p.port)).toEqual(
      expect.arrayContaining(['80', '443']),
    );
    expect(defaultPortsForService('unknown-svc')).toEqual([]);
  });

  it('normalizes bindings and modes', () => {
    expect(normalizePortBinding({ role: 'Listen', port: '3306', proto: 'TCP' })).toEqual({
      role: 'listen',
      port: '3306',
      proto: 'tcp',
    });
    expect(normalizePortBinding({ port: '' })).toBeNull();
    expect(normalizeExposureMode('restricted')).toBe('restricted');
    expect(normalizeExposureMode('nope')).toBe('public');
    expect(isValidServiceId('mysql')).toBe(true);
    expect(isValidServiceId('')).toBe(false);
  });
});
