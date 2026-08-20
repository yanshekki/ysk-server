import { describe, expect, it } from 'vitest';
import {
  dockerNetIoRate,
  isSafeDockerImageRef,
  isSafeDockerName,
  isSafeVolumeDest,
  isDockerPruneScope,
  parseDockerNetIo,
  parseDockerStatsSize,
  parseLabelMap,
  validatorIdFromComposeProject,
} from './docker.js';

describe('docker shared guards', () => {
  it('accepts normal image refs and rejects urls / traversal', () => {
    expect(isSafeDockerImageRef('alpine:3.20')).toBe(true);
    expect(isSafeDockerImageRef('ghcr.io/paradigmxyz/reth:v1.4.8')).toBe(true);
    expect(isSafeDockerImageRef('http://evil')).toBe(false);
    expect(isSafeDockerImageRef('../alpine')).toBe(false);
    expect(isSafeDockerImageRef('')).toBe(false);
  });

  it('validates names, volume dests, prune scopes', () => {
    expect(isSafeDockerName('ysk-demo')).toBe(true);
    expect(isSafeDockerName('../x')).toBe(false);
    expect(isSafeVolumeDest('/data/app')).toBe(true);
    expect(isSafeVolumeDest('/')).toBe(false);
    expect(isSafeVolumeDest('/etc')).toBe(false);
    expect(isSafeVolumeDest('/var/lib/ysk-server')).toBe(false);
    expect(isDockerPruneScope('images')).toBe(true);
    expect(isDockerPruneScope('all')).toBe(false);
  });

  it('parses labels and validator compose names', () => {
    const labels = parseLabelMap('com.ysk-server.managed=true,com.docker.compose.project=yskval-eth-hoodi-1');
    expect(labels['com.ysk-server.managed']).toBe('true');
    expect(validatorIdFromComposeProject('yskval-eth-hoodi-1')).toBe('eth-hoodi-1');
    expect(validatorIdFromComposeProject('other')).toBeNull();
  });

  it('parses docker stats sizes and NetIO', () => {
    expect(parseDockerStatsSize('0B')).toBe(0);
    expect(parseDockerStatsSize('796B')).toBe(796);
    expect(parseDockerStatsSize('1.187kB')).toBeCloseTo(1187);
    expect(parseDockerStatsSize('2.5MB')).toBe(2.5e6);
    expect(parseDockerStatsSize('12.34MiB')).toBeCloseTo(12.34 * 1024 ** 2);
    expect(parseDockerStatsSize('--')).toBeNull();
    expect(parseDockerNetIo('1.187kB / 796B')).toEqual({
      rxBytes: 1.187 * 1000,
      txBytes: 796,
    });
    expect(parseDockerNetIo('-- / --')).toBeNull();
  });

  it('computes NetIO rates and treats counter reset as a fresh sample', () => {
    expect(
      dockerNetIoRate({
        prevRx: 1000,
        prevTx: 200,
        prevAt: 0,
        rx: 6000,
        tx: 1200,
        at: 5000,
      }),
    ).toEqual({ rxRateBps: 1000, txRateBps: 200 });
    expect(
      dockerNetIoRate({
        prevRx: 9_000_000,
        prevTx: 1_000_000,
        prevAt: 0,
        rx: 50_000,
        tx: 10_000,
        at: 1000,
      }),
    ).toEqual({ rxRateBps: 50_000, txRateBps: 10_000 });
    expect(
      dockerNetIoRate({
        prevRx: 1,
        prevTx: 1,
        prevAt: 1000,
        rx: 2,
        tx: 2,
        at: 1100,
      }),
    ).toBeNull();
  });
});
