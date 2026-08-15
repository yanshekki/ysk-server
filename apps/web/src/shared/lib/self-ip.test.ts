import { describe, expect, it } from 'vitest';
import {
  classifySelfIp,
  collectHostIps,
  collectLoginIps,
  isProtectedSelfIp,
} from './self-ip';

describe('self-ip', () => {
  it('classifies loopback, host, login, and ignore', () => {
    expect(classifySelfIp('127.0.0.1', {})).toBe('loopback');
    expect(classifySelfIp('88.216.68.28', { hostIps: ['88.216.68.28'] })).toBe('host');
    expect(classifySelfIp('203.0.113.9', { loginIps: ['203.0.113.9'] })).toBe('login');
    expect(classifySelfIp('10.0.0.2', { ignoreIps: ['10.0.0.2'] })).toBe('ignore');
    expect(classifySelfIp('198.51.100.1', { hostIps: ['88.216.68.28'] })).toBeNull();
  });

  it('collects host and login IPs', () => {
    expect(collectHostIps({ network: { ips: ['1.1.1.1', '1.1.1.1'] } })).toEqual(['1.1.1.1']);
    expect(
      collectLoginIps([
        { ip: '9.9.9.9', current: false },
        { ip: '8.8.8.8', current: true },
      ]),
    ).toEqual(['8.8.8.8']);
    expect(isProtectedSelfIp('127.0.0.1', {})).toBe(true);
  });
});
