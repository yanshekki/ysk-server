import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  LEGAL_ARTICLE_IDS,
  LEGAL_COMPANY,
  LEGAL_EMAIL,
  LEGAL_EN,
  LEGAL_LICENSE,
  LEGAL_UPDATED,
  LEGAL_ZH_HK,
  formatLegalDate,
  getLegalDocument,
  isLegalArticleId,
  legalDocumentToMarkdown,
  resolveLegalBodyLocale,
} from './index.js';

const DOC_IDS = ['index', ...LEGAL_ARTICLE_IDS] as const;

describe('legal pack', () => {
  it('uses the same section ids in English and Hong Kong Chinese', () => {
    for (const id of DOC_IDS) {
      const enIds = LEGAL_EN[id].sections.map((s) => s.id);
      const zhIds = LEGAL_ZH_HK[id].sections.map((s) => s.id);
      expect(zhIds).toEqual(enIds);
      expect(LEGAL_EN[id].id).toBe(id);
      expect(LEGAL_ZH_HK[id].id).toBe(id);
      expect(LEGAL_EN[id].updated).toBe(LEGAL_UPDATED);
      expect(LEGAL_ZH_HK[id].updated).toBe(LEGAL_UPDATED);
    }
  });

  it('states English prevails, MIT, company, and contact', () => {
    const enTerms = getLegalDocument('en', 'terms');
    const zhTerms = getLegalDocument('zh-HK', 'terms');
    const enText = enTerms.sections.flatMap((s) =>
      s.blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : b.items)),
    ).join('\n');
    const zhText = zhTerms.sections.flatMap((s) =>
      s.blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : b.items)),
    ).join('\n');

    expect(enText).toContain('English version controls');
    expect(zhText).toContain('以英文為準');
    expect(enText).toContain(LEGAL_LICENSE);
    expect(enText).toContain(LEGAL_COMPANY);
    expect(enText).toContain(LEGAL_EMAIL);
    expect(enText).toContain('YSK_EXECUTE=1');
    expect(enText).toContain('non-custodial');
    expect(zhText).toContain('非託管');
    expect(enText).not.toMatch(/\$\{LEGAL_/);
    expect(zhText).not.toMatch(/\$\{LEGAL_/);
  });

  it('does not claim telemetry from a self-hosted install', () => {
    const privacy = getLegalDocument('en', 'privacy');
    const text = privacy.sections
      .flatMap((s) => s.blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : b.items)))
      .join('\n');
    expect(text).toMatch(/does not receive telemetry/i);
    expect(text).toMatch(/do not sell personal data/i);
    expect(text).not.toMatch(/we collect analytics from your host/i);
  });

  it('disclaimer is AS IS and keeps a Hong Kong law floor', () => {
    const d = getLegalDocument('en', 'disclaimer');
    const text = d.sections
      .flatMap((s) => s.blocks.flatMap((b) => (b.kind === 'p' ? [b.text] : [...b.items])))
      .join('\n');
    expect(text).toMatch(/AS IS/);
    expect(text).toMatch(/Cap\. 71/);
    expect(text).toMatch(/slashing/i);
    expect(text).toMatch(/dry-run/i);
  });

  it('resolves official body locale and formats dates', () => {
    expect(resolveLegalBodyLocale('zh-HK')).toBe('zh-HK');
    expect(resolveLegalBodyLocale('zh-TW')).toBe('zh-HK');
    expect(resolveLegalBodyLocale('zh-CN')).toBe('en');
    expect(resolveLegalBodyLocale('ja', 'zh-HK')).toBe('zh-HK');
    expect(resolveLegalBodyLocale('ja')).toBe('en');
    expect(formatLegalDate(LEGAL_UPDATED, 'en')).toBe('20 August 2026');
    expect(formatLegalDate(LEGAL_UPDATED, 'zh-HK')).toBe('2026年8月20日');
    expect(isLegalArticleId('terms')).toBe(true);
    expect(isLegalArticleId('index')).toBe(false);
  });

  it('committed docs/legal markdown includes every section heading', () => {
    const docs = join(dirname(fileURLToPath(import.meta.url)), '../../../../docs/legal');
    const files: Array<[string, typeof LEGAL_EN.terms]> = [
      ['terms.md', LEGAL_EN.terms],
      ['privacy.md', LEGAL_EN.privacy],
      ['disclaimer.md', LEGAL_EN.disclaimer],
      ['terms-ZH.md', LEGAL_ZH_HK.terms],
      ['privacy-ZH.md', LEGAL_ZH_HK.privacy],
      ['disclaimer-ZH.md', LEGAL_ZH_HK.disclaimer],
    ];
    for (const [name, doc] of files) {
      const text = readFileSync(join(docs, name), 'utf8');
      for (const section of doc.sections) {
        expect(text, name).toContain(`## ${section.heading}`);
      }
    }
  });

  it('renders markdown with matching headings', () => {
    const md = legalDocumentToMarkdown(LEGAL_EN.terms, {
      locale: 'en',
      siblingHref: './terms-ZH.md',
    });
    expect(md).toMatch(/^# Terms of Use/m);
    expect(md).toContain('English controls');
    expect(md).toContain('## 1. Agreement');
    expect(md.split('\n').filter((l) => l.startsWith('## '))).toHaveLength(
      LEGAL_EN.terms.sections.length,
    );
  });
});
