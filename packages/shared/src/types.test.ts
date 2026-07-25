import { describe, expect, it } from 'vitest';
import { CLI_NAME, PACKAGE_NAME, PRODUCT_NAME } from './types.js';
import { ErrorCodes, YskError } from './errors.js';

describe('product naming', () => {
  it('uses YSK Server surface names', () => {
    expect(PRODUCT_NAME).toBe('YSK Server');
    expect(CLI_NAME).toBe('ysk-server');
    expect(PACKAGE_NAME).toBe('ysk-server');
  });
});

describe('YskError', () => {
  it('carries code and http status', () => {
    const err = new YskError(ErrorCodes.ALLOWLIST_DENIED, 'denied', {
      httpStatus: 403,
      details: { tool: 'rm' },
    });
    expect(err.code).toBe(ErrorCodes.ALLOWLIST_DENIED);
    expect(err.httpStatus).toBe(403);
    expect(err.details).toEqual({ tool: 'rm' });
  });
});
