import { describe, expect, it } from 'vitest';
import { hostsLineFor } from './hostname-hosts.js';

describe('hostsLineFor', () => {
  it('uses Debian 127.0.1.1 and optional FQDN', () => {
    expect(hostsLineFor('demo-server')).toBe('127.0.1.1 demo-server');
    expect(hostsLineFor('demo-server', 'demo-server.ysk.hk')).toBe(
      '127.0.1.1 demo-server demo-server.ysk.hk',
    );
    expect(hostsLineFor('demo-server', 'demo-server')).toBe('127.0.1.1 demo-server');
  });
});
