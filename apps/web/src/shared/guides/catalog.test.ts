import { describe, expect, it } from 'vitest';
import { getPageGuide, listPageGuideIds } from './catalog';

describe('page guide catalog', () => {
  it('lists ids for en and zh-HK', () => {
    const en = listPageGuideIds('en');
    const hk = listPageGuideIds('zh-HK');
    expect(en.length).toBeGreaterThan(0);
    expect(hk.length).toBeGreaterThan(0);
  });

  it('resolves a known guide with slim canDo/notes', () => {
    const ids = listPageGuideIds('en');
    const id = ids[0];
    const doc = getPageGuide(id, 'en');
    expect(doc).not.toBeNull();
    expect(doc!.id).toBeTruthy();
    expect(doc!.title.length).toBeGreaterThan(0);
    expect(doc!.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(doc!.canDo)).toBe(true);
    expect(doc!.canDo.length).toBeGreaterThan(0);
    expect(doc!.canDo.length).toBeLessThanOrEqual(5);
    expect(Array.isArray(doc!.notes)).toBe(true);
  });

  it('normalizes legacy features into canDo', async () => {
    const { normalizePageGuideDoc } = await import('./catalog');
    const doc = normalizePageGuideDoc({
      id: 'x',
      title: 'T',
      summary: 'S',
      features: [{ name: 'A', purpose: 'does A' }],
      caveats: ['watch out'],
    });
    expect(doc.canDo.some((c) => c.includes('does A'))).toBe(true);
    expect(doc.notes).toContain('watch out');
  });

  it('returns null for missing id', () => {
    expect(getPageGuide('definitely-not-a-guide-id-xyz', 'en')).toBeNull();
  });

  it('falls back locale via normalize', () => {
    const ids = listPageGuideIds('en-US');
    expect(ids.length).toBeGreaterThan(0);
  });
});
