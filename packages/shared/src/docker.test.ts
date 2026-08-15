import { describe, expect, it } from 'vitest';
import {
  isSafeDockerImageRef,
  isSafeDockerName,
  isSafeVolumeDest,
  isDockerPruneScope,
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
});
