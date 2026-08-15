import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadRemoteClientTags,
  normalizeGithubTag,
  pickAllowedNextTag,
  refreshRemoteClientTags,
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
          return { ok: true, json: async () => ({ tag_name: 'v1.5.1' }) };
        }
        if (String(url).includes('nimbus-eth2')) {
          return { ok: true, json: async () => ({ tag_name: 'v25.5.0' }) };
        }
        return { ok: false, json: async () => ({}) };
      }) as typeof fetch;
      const cache = await refreshRemoteClientTags({ dataDir, fetchFn });
      expect(cache.tags.reth).toBe('v1.5.1');
      expect(cache.tags.nimbus).toBe('multiarch-v25.5.0');
      expect(loadRemoteClientTags(dataDir).reth).toBe('v1.5.1');
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
