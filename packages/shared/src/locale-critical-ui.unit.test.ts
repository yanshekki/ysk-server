import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../locales');

function load(locale: string, ns: string) {
  return JSON.parse(readFileSync(join(root, locale, ns), 'utf8')) as Record<string, unknown>;
}

describe('critical UI locale strings', () => {
  it('software badges have no mixed Latest EN in zh-HK', () => {
    const sw = load('zh-HK', 'software.json') as any;
    expect(sw.badge.upToDate).toBe('已是最新');
    expect(sw.version.upToDate).toContain('最新');
    expect(sw.version.upToDate).not.toMatch(/Latest/);
    expect(sw.meta.aptCurrentLatest).toMatch(/倉庫最新|已是/);
    expect(sw.meta.aptCurrentLatest).not.toMatch(/Latest/);
    expect(sw.version.refresh).toBe('重新檢查最新');
  });

  it('software en badges are English', () => {
    const sw = load('en', 'software.json') as any;
    expect(sw.badge.upToDate).toBe('Up to date');
    expect(sw.version.refresh).toMatch(/[Rr]echeck|[Ll]atest/);
  });

  it('runtime nodePath keys exist in all locales', () => {
    for (const loc of ['zh-HK', 'zh-CN', 'en']) {
      const rt = load(loc, 'runtime.json') as any;
      expect(String(rt.nodePathYskMissingTitle).length).toBeGreaterThan(3);
      expect(String(rt.nodePathYskMissing)).toContain('{{version}}');
      expect(rt.nodePathYskMissingTitle).not.toMatch(/^runtime\./);
    }
  });

  it('audit actions cover dashboard samples', () => {
    for (const loc of ['zh-HK', 'zh-CN', 'en']) {
      const a = load(loc, 'audit.json') as any;
      expect(a.actions['protection.change']).toBeTruthy();
      expect(a.actions['auth.locale']).toBeTruthy();
      expect(a.actions['protection.change']).not.toBe('protection.change');
    }
  });
});
