import { describe, expect, it } from 'vitest';
import { FEATURE_SECTIONS, allFeatureTiles } from './features';

describe('FEATURE_SECTIONS', () => {
  it('has overview dashboard at root', () => {
    const overview = FEATURE_SECTIONS.find((s) => s.sectionKey === 'overview');
    expect(overview?.items.some((i) => i.to === '/' && i.key === 'dashboard')).toBe(
      true,
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
});
