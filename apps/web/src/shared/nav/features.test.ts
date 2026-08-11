import { describe, expect, it } from 'vitest';
import { FEATURE_SECTIONS, allFeatureTiles } from './features';

describe('FEATURE_SECTIONS', () => {
  it('has overview dashboard at root', () => {
    const overview = FEATURE_SECTIONS.find((s) => s.sectionKey === 'overview');
    expect(overview?.items.some((i) => i.to === '/' && i.key === 'dashboard')).toBe(
      true,
    );
  });

  it('has no software hub nav entry (merged into updates)', () => {
    const tiles = allFeatureTiles();
    expect(tiles.some((i) => i.to === '/software' || i.key === 'software')).toBe(false);
    expect(tiles.some((i) => i.to === '/updates' && i.key === 'updates')).toBe(true);
  });

  it('has single FTPS nav entry (accounts + service merged)', () => {
    const tiles = allFeatureTiles();
    expect(tiles.filter((i) => i.to === '/ftp' || i.key === 'ftp').length).toBe(1);
    expect(tiles.some((i) => i.to === '/ftp/service' || i.key === 'ftpService')).toBe(
      false,
    );
  });

  it('every item has to, key, icon', () => {
    for (const section of FEATURE_SECTIONS) {
      expect(section.sectionKey).toBeTruthy();
      for (const item of section.items) {
        expect(item.to.startsWith('/')).toBe(true);
        expect(item.key.length).toBeGreaterThan(0);
        expect(item.icon.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('allFeatureTiles', () => {
  it('flattens sections and excludes dashboard self-link', () => {
    const tiles = allFeatureTiles();
    expect(tiles.length).toBeGreaterThan(5);
    expect(tiles.every((t) => t.to !== '/')).toBe(true);
    expect(tiles.some((t) => t.key === 'projects')).toBe(true);
  });

  it('does not expose AI Tasks / Agents panel routes', () => {
    expect(FEATURE_SECTIONS.some((s) => s.sectionKey === 'ai')).toBe(false);
    const tiles = allFeatureTiles();
    expect(tiles.some((t) => t.to === '/ai' || t.to === '/agents')).toBe(false);
  });
});
