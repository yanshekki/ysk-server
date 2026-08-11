import { describe, expect, it } from 'vitest';
import { buildSsUri, parseSsEndpoint } from './outline-ops.js';

describe('outline/ss helpers', () => {
  it('builds ss:// URI', () => {
    const uri = buildSsUri({
      method: 'chacha20-ietf-poly1305',
      password: 'secret',
      host: '1.2.3.4',
      port: 8388,
      name: 'phone',
    });
    expect(uri.startsWith('ss://')).toBe(true);
    expect(uri).toContain('@1.2.3.4:8388');
    expect(uri).toContain('phone');
  });

  it('parseSsEndpoint accepts host:port', () => {
    expect(parseSsEndpoint('1.2.3.4:8388', 8388)).toEqual({
      host: '1.2.3.4',
      port: 8388,
      ok: true,
    });
  });

  it('parseSsEndpoint rejects WG-port-as-host typo', () => {
    expect(parseSsEndpoint('51820:8388', 8388).ok).toBe(false);
  });
});
