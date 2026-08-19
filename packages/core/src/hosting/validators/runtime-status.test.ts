import { describe, expect, it } from 'vitest';
import {
  deriveValidatorRuntimeStatus,
  isTransientValidatorProbeError,
  pickValidatorContainerHint,
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

describe('pickValidatorContainerHint', () => {
  it('prefers a fatal compose line', () => {
    expect(
      pickValidatorContainerHint([
        'Starting…',
        "Error: Command line contains unexpected token 'bitcoind'",
        'restarting',
      ]),
    ).toMatch(/unexpected token/);
  });
});

describe('isTransientValidatorProbeError', () => {
  it('matches bootstrap probe noise', () => {
    expect(isTransientValidatorProbeError('Failed to fetch')).toBe(true);
    expect(isTransientValidatorProbeError('ECONNREFUSED')).toBe(true);
    expect(isTransientValidatorProbeError('disk full')).toBe(false);
  });
});
