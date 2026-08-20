export {
  LEGAL_ARTICLE_IDS,
  LEGAL_BODY_LOCALES,
  LEGAL_COMPANY,
  LEGAL_EMAIL,
  LEGAL_LICENSE,
  LEGAL_PATHS,
  LEGAL_PRODUCT,
  LEGAL_SITE,
  LEGAL_UPDATED,
  formatLegalDate,
  isLegalArticleId,
  isLegalBodyLocale,
  isLegalDocId,
  legalDocumentToMarkdown,
  resolveLegalBodyLocale,
  type LegalArticleId,
  type LegalBlock,
  type LegalBodyLocale,
  type LegalDocId,
  type LegalDocument,
  type LegalPack,
  type LegalSection,
} from './types.js';

import { LEGAL_EN } from './en.js';
import { LEGAL_ZH_HK } from './zh-HK.js';
import type { LegalBodyLocale, LegalDocId, LegalDocument, LegalPack } from './types.js';

const PACKS: Record<LegalBodyLocale, LegalPack> = {
  en: LEGAL_EN,
  'zh-HK': LEGAL_ZH_HK,
};

export function getLegalPack(locale: LegalBodyLocale): LegalPack {
  return PACKS[locale] ?? PACKS.en;
}

export function getLegalDocument(locale: LegalBodyLocale, id: LegalDocId): LegalDocument {
  const pack = getLegalPack(locale);
  return pack[id] ?? pack.index;
}

export { LEGAL_EN, LEGAL_ZH_HK };
