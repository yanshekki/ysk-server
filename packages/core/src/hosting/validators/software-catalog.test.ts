import { describe, expect, it } from 'vitest';
import {
  isAllowedValidatorImage,
  isPinnedValidatorImage,
  listPinnedValidatorImages,
  parseValidatorImageRef,
  pinnedValidatorImageRefs,
} from './software-catalog.js';
import { saveRemoteReleases } from './releases.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('validator software catalog', () => {
  it('lists unique pinned client images from the registry', () => {
    const pins = listPinnedValidatorImages();
    expect(pins.length).toBeGreaterThan(8);
    expect(pins.every((p) => p.image && p.tag && p.ref === `${p.image}:${p.tag}`)).toBe(true);
    expect(pins.some((p) => p.chain === 'eth' && p.clientId === 'reth')).toBe(true);
  });

  it('allowlists only registry pins', () => {
    const refs = pinnedValidatorImageRefs();
    const sample = [...refs][0];
    expect(sample).toBeTruthy();
    expect(isPinnedValidatorImage(sample!)).toBe(true);
    expect(isPinnedValidatorImage('mysten/sui-node:testnet-v1.78.0')).toBe(true);
    expect(isPinnedValidatorImage('mysten/sui-node:mainnet-v1.77.2')).toBe(true);
    expect(isPinnedValidatorImage('mysten/sui-node:mainnet-v1.44.2')).toBe(false);
    expect(isPinnedValidatorImage('evil/image:latest')).toBe(false);
    expect(isPinnedValidatorImage('not-a-ref')).toBe(false);
    expect(parseValidatorImageRef('ghcr.io/foo/bar:v1')).toEqual({
      image: 'ghcr.io/foo/bar',
      tag: 'v1',
    });
  });

  it('allowlists cached official tags for the same image repo only', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-sw-'));
    try {
      saveRemoteReleases(dataDir, {
        at: new Date().toISOString(),
        clients: {
          avalanchego: {
            at: new Date().toISOString(),
            items: [
              {
                gitTag: 'v1.15.0',
                dockerTag: 'v1.15.0',
                prerelease: false,
                htmlUrl: '',
              },
            ],
          },
        },
      });
      expect(isAllowedValidatorImage('avaplatform/avalanchego:v1.15.0', dataDir)).toBe(true);
      expect(isAllowedValidatorImage('avaplatform/avalanchego:latest', dataDir)).toBe(false);
      expect(isAllowedValidatorImage('evil/avalanchego:v1.14.1', dataDir)).toBe(false);
      expect(listPinnedValidatorImages().every((p) => p.registryHost && p.staleInstances)).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
