import { describe, expect, it } from 'vitest';
import { getPageGuide, listPageGuideIds, normalizePageGuideDoc } from './catalog';

describe('page guide catalog', () => {
  it('lists guides for Tier-1 locales', () => {
    for (const loc of ['zh-HK', 'zh-CN', 'en'] as const) {
      const ids = listPageGuideIds(loc);
      expect(ids.length).toBeGreaterThanOrEqual(40);
      expect(ids).toContain('files');
      expect(ids).toContain('email');
      expect(ids).toContain('projects');
    }
  });

  it('returns structured docs with title summary canDo notes for core pages', () => {
    for (const loc of ['zh-HK', 'zh-CN', 'en'] as const) {
      for (const id of ['files', 'email', 'projects', 'security', 'dashboard']) {
        const g = getPageGuide(id, loc);
        expect(g, `${loc}/${id}`).toBeTruthy();
        expect(g!.title.trim().length).toBeGreaterThan(0);
        expect(g!.summary.trim().length).toBeGreaterThan(0);
        expect(g!.canDo.length).toBeGreaterThan(0);
        expect(Array.isArray(g!.notes)).toBe(true);
      }
    }
  });

  it('normalizes workflow and cliHints when present', () => {
    const n = normalizePageGuideDoc({
      id: 'demo',
      title: 'Demo',
      summary: 'Summary line',
      canDo: ['A'],
      workflow: ['Step 1', 'Step 2'],
      notes: ['Note'],
      cliHints: ['ysk-server health --json'],
    });
    expect(n.workflow).toEqual(['Step 1', 'Step 2']);
    expect(n.cliHints).toEqual(['ysk-server health --json']);
  });

  it('files guide includes CLI hints after enrichment', () => {
    const g = getPageGuide('files', 'en');
    expect(g?.cliHints?.some((c) => c.includes('ysk-server files'))).toBe(true);
    expect(g?.workflow?.length).toBeGreaterThan(0);
  });
});
