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
    ).toBe('rpc_wait');
    expect(
      deriveValidatorRuntimeStatus({
        running: true,
        syncProgress: null,
        lastError: 'Unexpected end of JSON input',
      }),
    ).toBe('rpc_wait');
    expect(
      deriveValidatorRuntimeStatus({
        running: true,
        syncProgress: null,
        lastError: 'unhealthy',
      }),
    ).toBe('rpc_wait');
  });

  it('does not call Created or missing containers stopped', () => {
    expect(
      deriveValidatorRuntimeStatus({
        running: false,
        created: true,
        lastError: null,
      }),
    ).toBe('created');
    expect(
      deriveValidatorRuntimeStatus({
        running: false,
        missing: true,
        lastError: null,
      }),
    ).toBe('missing');
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
  it('prefers OOM over a later log line', () => {
    expect(pickValidatorContainerHint(['Starting…', 'Killed', 'restarting'])).toMatch(/Killed/i);
  });

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
    expect(isTransientValidatorProbeError('Unexpected end of JSON input')).toBe(true);
    expect(isTransientValidatorProbeError('rpc unauthorized')).toBe(true);
    expect(isTransientValidatorProbeError('disk full')).toBe(false);
  });
});
