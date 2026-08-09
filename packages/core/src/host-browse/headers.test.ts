import { describe, expect, it } from 'vitest';
import {
  buildOutboundHeaders,
  isForbiddenOutboundHeader,
} from './headers.js';
import { HOST_BROWSE_DEFAULT_UA } from './types.js';

describe('host-browse headers', () => {
  it('blocks client identity headers', () => {
    expect(isForbiddenOutboundHeader('Authorization')).toBe(true);
    expect(isForbiddenOutboundHeader('Cookie')).toBe(true);
    expect(isForbiddenOutboundHeader('Sec-CH-UA')).toBe(true);
    expect(isForbiddenOutboundHeader('X-Forwarded-For')).toBe(true);
    expect(isForbiddenOutboundHeader('CF-Connecting-IP')).toBe(true);
  });

  it('buildOutboundHeaders uses fixed UA and never panel origin', () => {
    const h = buildOutboundHeaders({
      cookie: 'a=1',
      referer: 'https://panel.example/browse',
    });
    // panel-looking referer still set if http(s) — callers must pass target only
    expect(h['User-Agent']).toBe(HOST_BROWSE_DEFAULT_UA);
    expect(h.Cookie).toBe('a=1');
    expect(h.Authorization).toBeUndefined();
    expect(h['Sec-CH-UA']).toBeUndefined();
  });

  it('omits forbidden extras', () => {
    const h = buildOutboundHeaders({
      extraSafe: {
        Authorization: 'Bearer leaked',
        'X-Custom-Ok': 'yes',
      },
    });
    expect(h.Authorization).toBeUndefined();
    expect(h['X-Custom-Ok']).toBe('yes');
  });
});
