/**
 * Product help catalog — locale-aware (L2.1).
 * Data: ./data/{zh-HK,zh-CN,en}.json
 * Operator-facing only; no PR / roadmap language.
 */
import { normalizeLocale, type LocaleCode } from '@ysk/shared';
import type { PageGuideDoc } from './types';

import zhHK from './data/zh-HK.json';
import zhCN from './data/zh-CN.json';
import en from './data/en.json';

type GuideMap = Record<string, PageGuideDoc>;

const CATALOGS: Record<LocaleCode, GuideMap> = {
  'zh-HK': zhHK as GuideMap,
  'zh-CN': zhCN as GuideMap,
  en: en as GuideMap,
};

function mapFor(locale?: string | null): GuideMap {
  const code = normalizeLocale(locale);
  return CATALOGS[code] ?? CATALOGS['zh-HK'];
}

/**
 * Resolve a page guide by id for the given locale.
 * Falls back: requested → zh-HK → null.
 */
export function getPageGuide(
  id: string,
  locale?: string | null,
): PageGuideDoc | null {
  const primary = mapFor(locale)[id];
  if (primary) return primary;
  const hk = CATALOGS['zh-HK'][id];
  return hk ?? null;
}

export function listPageGuideIds(locale?: string | null): string[] {
  return Object.keys(mapFor(locale));
}
