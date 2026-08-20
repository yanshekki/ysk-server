import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dockerTagFromGit,
  ensureClientOfficialReleases,
  listOfficialClientVersions,
  loadRemoteClientTags,
  mergeOfficialVersions,
  normalizeGithubTag,
  pickAllowedNextTag,
  refreshRemoteClientTags,
  saveRemoteReleases,
} from './releases.js';
import { parseVersionParts, tagIsNewer } from './versions.js';

describe('validator release tags', () => {
  it('normalizes github tags and nimbus prefix', () => {
    expect(normalizeGithubTag('v1.5.0')).toBe('v1.5.0');
    expect(normalizeGithubTag('1.5.0')).toBe('1.5.0');
    expect(normalizeGithubTag('v25.5.0', 'multiarch-')).toBe('multiarch-v25.5.0');
    expect(normalizeGithubTag('latest')).toBeNull();
  });

  it('parses two-part and prefixed tags', () => {
    expect(parseVersionParts('v28.1')).toEqual({ major: 28, minor: 1, patch: 0 });
    expect(parseVersionParts('multiarch-v25.5.0')).toEqual({ major: 25, minor: 5, patch: 0 });
    expect(tagIsNewer('v28.0', 'v28.1')).toBe(true);
    expect(tagIsNewer('multiarch-v25.4.0', 'multiarch-v25.5.0')).toBe(true);
  });

  it('prefers remote when newer than pin and current, rejects huge major jumps', () => {
    expect(
      pickAllowedNextTag({ current: 'v1.4.0', pin: 'v1.4.8', remote: 'v1.5.1' }),
    ).toEqual({ next: 'v1.5.1', fromRemote: true });
    expect(
      pickAllowedNextTag({ current: 'v1.4.8', pin: 'v1.4.8', remote: 'v3.0.0' }),
    ).toEqual({ next: 'v1.4.8', fromRemote: false });
    expect(
      pickAllowedNextTag({ current: 'v1.4.8', pin: 'v1.4.8', remote: null }),
    ).toEqual({ next: 'v1.4.8', fromRemote: false });
  });

  it('refreshRemoteClientTags persists normalized tags from GitHub', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-rel-'));
    try {
      const fetchFn = (async (url: string) => {
        if (String(url).includes('paradigmxyz/reth')) {
          return {
            ok: true,
            json: async () => [{ tag_name: 'v1.5.1', html_url: 'https://github.com/paradigmxyz/reth/releases/tag/v1.5.1' }],
          };
        }
        if (String(url).includes('nimbus-eth2')) {
          return { ok: true, json: async () => [{ tag_name: 'v25.5.0' }] };
        }
        return { ok: true, json: async () => [] };
      }) as typeof fetch;
      const cache = await refreshRemoteClientTags({ dataDir, fetchFn });
      expect(cache.tags.reth).toBe('v1.5.1');
      expect(cache.tags.nimbus).toBe('multiarch-v25.5.0');
      expect(loadRemoteClientTags(dataDir).reth).toBe('v1.5.1');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('maps GitHub tags onto Docker tags for sui/aptos/nimbus', () => {
    expect(dockerTagFromGit('nimbus', 'v25.5.0')).toBe('multiarch-v25.5.0');
    expect(dockerTagFromGit('sui-node', 'v1.79.0', 'testnet')).toBe('testnet-v1.79.0');
    expect(dockerTagFromGit('sui-node', 'mainnet-v1.77.2', 'testnet')).toBeNull();
    expect(dockerTagFromGit('aptos-node', 'v1.28.0')).toBe('aptos-node-v1.28.0');
    expect(dockerTagFromGit('reth', 'latest')).toBeNull();
  });

  it('always includes the panel pin in the official list', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-rel-pin-'));
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
                htmlUrl: 'https://github.com/ava-labs/avalanchego/releases/tag/v1.15.0',
              },
            ],
          },
        },
      });
      const listed = listOfficialClientVersions({
        clientId: 'avalanchego',
        dataDir,
        extraTags: ['v1.13.5'],
      });
      expect(listed.pin).toBe('v1.14.1');
      expect(listed.latest).toBe('v1.15.0');
      expect(listed.github).toBe('ava-labs/avalanchego');
      expect(listed.versions.map((v) => v.dockerTag)).toEqual(['v1.15.0', 'v1.14.1', 'v1.13.5']);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('caps merged fetched tags and keeps extras', () => {
    const fetched = Array.from({ length: 20 }, (_, i) => ({
      gitTag: `v1.${i}.0`,
      dockerTag: `v1.${i}.0`,
      prerelease: false,
      htmlUrl: '',
    }));
    const merged = mergeOfficialVersions({ pin: 'v1.4.8', extraTags: ['v1.0.0'], fetched });
    expect(merged.some((v) => v.dockerTag === 'v1.4.8')).toBe(true);
    expect(merged.some((v) => v.dockerTag === 'v1.0.0')).toBe(true);
    expect(merged.length).toBeLessThanOrEqual(14);
    expect(merged[0]?.dockerTag).toBe('v1.12.0');
    expect(merged.some((v) => v.prerelease)).toBe(false);
  });

  it('ensureClientOfficialReleases fetches when the client cache is empty', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ysk-rel-ensure-'));
    try {
      const fetchFn = (async (url: string) => {
        if (String(url).includes('IntersectMBO/cardano-node')) {
          return {
            ok: true,
            json: async () => [
              { tag_name: '11.1.0', html_url: 'https://github.com/IntersectMBO/cardano-node/releases/tag/11.1.0' },
              { tag_name: '11.0.1', html_url: 'https://github.com/IntersectMBO/cardano-node/releases/tag/11.0.1' },
              { tag_name: '10.7.1' },
            ],
          };
        }
        return { ok: true, json: async () => [] };
      }) as typeof fetch;
      await ensureClientOfficialReleases({
        dataDir,
        clientId: 'cardano-node',
        fetchFn,
      });
      const listed = listOfficialClientVersions({ clientId: 'cardano-node', dataDir });
      expect(listed.pin).toBe('11.0.1');
      expect(listed.latest).toBe('11.1.0');
      expect(listed.versions.map((v) => v.dockerTag)).toEqual(['11.1.0', '11.0.1', '10.7.1']);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
