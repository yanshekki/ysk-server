import { describe, expect, it } from 'vitest';
import {
  deriveValidatorRuntimeStatus,
  isTransientValidatorProbeError,
} from './runtime-status.js';

describe('deriveValidatorRuntimeStatus', () => {
  it('does not treat a fresh RPC miss as error', () => {
    expect(
      deriveValidatorRuntimeStatus({
        running: true,
        syncProgress: null,
        lastError: 'rpc unreachable',
      }),
    ).toBe('starting');
    expect(
      deriveValidatorRuntimeStatus({
        running: true,
        syncProgress: null,
        lastError: 'unhealthy',
      }),
    ).toBe('starting');
  });

  it('uses syncing when progress is reported', () => {
    expect(
      deriveValidatorRuntimeStatus({
        running: true,
        syncProgress: 0.2,
        lastError: null,
      }),
    ).toBe('syncing');
  });

  it('keeps a real probe failure as error', () => {
    expect(
      deriveValidatorRuntimeStatus({
        running: true,
        syncProgress: null,
        lastError: 'jwt secret missing',
      }),
    ).toBe('error');
  });

  it('marks a restart loop as error', () => {
    expect(
      deriveValidatorRuntimeStatus({
        running: true,
        restarting: true,
        lastError: null,
      }),
    ).toBe('error');
  });

  it('is stopped when compose is down', () => {
    expect(
      deriveValidatorRuntimeStatus({
        running: false,
        lastError: 'rpc unreachable',
      }),
    ).toBe('stopped');
  });
});

describe('isTransientValidatorProbeError', () => {
  it('matches bootstrap probe noise', () => {
    expect(isTransientValidatorProbeError('Failed to fetch')).toBe(true);
    expect(isTransientValidatorProbeError('ECONNREFUSED')).toBe(true);
    expect(isTransientValidatorProbeError('disk full')).toBe(false);
  });
});
