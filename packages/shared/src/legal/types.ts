/**
 * Official legal pack for YSK Server.
 * Binding body text is English + Hong Kong written Chinese only.
 * UI chrome (titles, nav) lives in locale namespace legal.json.
 */

export const LEGAL_COMPANY = 'YSK Limited' as const;
export const LEGAL_PRODUCT = 'YSK Server' as const;
export const LEGAL_SITE = 'https://ysk.hk/' as const;
export const LEGAL_EMAIL = 'email@ysk.hk' as const;
export const LEGAL_UPDATED = '2026-08-20' as const;
export const LEGAL_LICENSE = 'MIT' as const;

export const LEGAL_BODY_LOCALES = ['en', 'zh-HK'] as const;
export type LegalBodyLocale = (typeof LEGAL_BODY_LOCALES)[number];

export const LEGAL_ARTICLE_IDS = ['terms', 'privacy', 'disclaimer'] as const;
export type LegalArticleId = (typeof LEGAL_ARTICLE_IDS)[number];

export type LegalDocId = LegalArticleId | 'index';

export const LEGAL_PATHS: Record<LegalDocId, string> = {
  index: '/legal',
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  disclaimer: '/legal/disclaimer',
};

export type LegalBlock =
  | { kind: 'p'; text: string; tone?: 'warranty' }
  | { kind: 'ul'; items: readonly string[] };

export type LegalSection = {
  id: string;
  heading: string;
  blocks: readonly LegalBlock[];
};

export type LegalDocument = {
  id: LegalDocId;
  title: string;
  summary: string;
  updated: string;
  sections: readonly LegalSection[];
};

export type LegalPack = Record<LegalDocId, LegalDocument>;

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function isLegalBodyLocale(value: string | null | undefined): value is LegalBodyLocale {
  return value === 'en' || value === 'zh-HK';
}

export function isLegalArticleId(value: string | null | undefined): value is LegalArticleId {
  return value === 'terms' || value === 'privacy' || value === 'disclaimer';
}

export function isLegalDocId(value: string | null | undefined): value is LegalDocId {
  return value === 'index' || isLegalArticleId(value);
}

/** Official body language: query override, else zh-HK UI → Chinese, otherwise English. */
export function resolveLegalBodyLocale(
  uiLocale: string,
  override?: string | null,
): LegalBodyLocale {
  if (isLegalBodyLocale(override)) return override;
  const ui = String(uiLocale || '');
  if (ui === 'zh-HK' || ui.startsWith('zh-HK') || ui === 'zh-TW' || ui === 'zh') {
    return 'zh-HK';
  }
  return 'en';
}

export function formatLegalDate(iso: string, locale: LegalBodyLocale): string {
  const parts = iso.split('-').map((n) => Number(n));
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return iso;
  if (locale === 'zh-HK') return `${y}年${m}月${d}日`;
  const month = MONTHS_EN[m - 1];
  return month ? `${d} ${month} ${y}` : iso;
}

export function legalDocumentToMarkdown(
  doc: LegalDocument,
  opts: { locale: LegalBodyLocale; siblingHref: string },
): string {
  const langLine =
    opts.locale === 'zh-HK'
      ? `> 語言：中文 | [English](${opts.siblingHref})`
      : `> Language: English | [中文](${opts.siblingHref})`;
  const prevails =
    opts.locale === 'zh-HK'
      ? '正式語言為英文及香港書面中文。如有歧義，**以英文為準**。'
      : 'Official languages: English and Hong Kong written Chinese. If they differ, **English controls**.';
  const contact =
    opts.locale === 'zh-HK'
      ? `聯絡：[${LEGAL_EMAIL}](mailto:${LEGAL_EMAIL}) · [${LEGAL_SITE}](${LEGAL_SITE})`
      : `Contact: [${LEGAL_EMAIL}](mailto:${LEGAL_EMAIL}) · [${LEGAL_SITE}](${LEGAL_SITE})`;
  const lines: string[] = [
    `# ${doc.title}`,
    '',
    langLine,
    '',
    `**${LEGAL_COMPANY}** · ${formatLegalDate(doc.updated, opts.locale)}`,
    '',
    prevails,
    '',
    contact,
    '',
  ];
  for (const section of doc.sections) {
    lines.push(`## ${section.heading}`, '');
    for (const block of section.blocks) {
      if (block.kind === 'p') {
        lines.push(block.text, '');
      } else {
        for (const item of block.items) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }
    }
  }
  return lines.join('\n').trimEnd() + '\n';
}
