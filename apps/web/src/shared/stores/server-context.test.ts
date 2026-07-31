import { afterEach, describe, expect, it } from 'vitest';
import { getServerContext, setServerContext } from './server-context';

const KEY = 'ysk_server_context_v2';

describe('server-context', () => {
  afterEach(() => {
    localStorage.removeItem(KEY);
  });

  it('returns empty defaults when unset', () => {
    localStorage.removeItem(KEY);
    const ctx = getServerContext();
    expect(ctx.domain).toBe('');
    expect(ctx.serverIp).toBe('');
  });

  it('merges patches and persists', () => {
    const next = setServerContext({ domain: 'example.com', serverIp: '1.2.3.4' });
    expect(next.domain).toBe('example.com');
    expect(getServerContext().serverIp).toBe('1.2.3.4');
    setServerContext({ serverIpv6: '::1' });
    expect(getServerContext().domain).toBe('example.com');
    expect(getServerContext().serverIpv6).toBe('::1');
  });

  it('recovers from corrupt JSON', () => {
    localStorage.setItem(KEY, '{not-json');
    const ctx = getServerContext();
    expect(ctx.domain).toBe('');
    expect(ctx.serverIp).toBe('');
  });
});
