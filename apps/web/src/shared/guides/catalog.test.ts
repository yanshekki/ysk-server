import { describe, expect, it } from 'vitest';
import { getPageGuide, listPageGuideIds } from './catalog';

describe('page guide catalog', () => {
  it('lists ids for en and zh-HK', () => {
    const en = listPageGuideIds('en');
    const hk = listPageGuideIds('zh-HK');
    expect(en.length).toBeGreaterThan(0);
    expect(hk.length).toBeGreaterThan(0);
  });

  it('resolves a known guide with features', () => {
    const ids = listPageGuideIds('en');
    const id = ids[0];
    const doc = getPageGuide(id, 'en');
    expect(doc).not.toBeNull();
    expect(doc!.id).toBeTruthy();
    expect(doc!.title.length).toBeGreaterThan(0);
    expect(Array.isArray(doc!.features)).toBe(true);
  });

  it('returns null for missing id', () => {
    expect(getPageGuide('definitely-not-a-guide-id-xyz', 'en')).toBeNull();
  });

  it('falls back locale via normalize', () => {
    const ids = listPageGuideIds('en-US');
    expect(ids.length).toBeGreaterThan(0);
  });
});
