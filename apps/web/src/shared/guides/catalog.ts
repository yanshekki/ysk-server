/**
 * Product help catalog — locale-aware.
 * Data: ./data/{zh-HK,zh-CN,en}.json
 * Normalizes legacy guide shapes → slim canDo / notes.
 */
import { normalizeLocale, type LocaleCode } from '@ysk/shared';
import type { PageGuideDoc, PageGuideRaw } from './types';

import zhHK from './data/zh-HK.json';
import zhCN from './data/zh-CN.json';
import en from './data/en.json';

type GuideMap = Record<string, PageGuideRaw>;

const CATALOGS: Record<LocaleCode, GuideMap> = {
  'zh-HK': zhHK as GuideMap,
  'zh-CN': zhCN as GuideMap,
  en: en as GuideMap,
};

function mapFor(locale?: string | null): GuideMap {
  const code = normalizeLocale(locale);
  return CATALOGS[code] ?? CATALOGS['zh-HK'];
}

function uniqTrimmed(items: string[], max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const s = String(raw ?? '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Map any stored guide (new or legacy) to the slim About-tab shape.
 */
export function normalizePageGuideDoc(raw: PageGuideRaw): PageGuideDoc {
  const fromFeatures = (raw.features ?? []).map((f) => {
    const name = String(f?.name ?? '').trim();
    const purpose = String(f?.purpose ?? '').trim();
    if (name && purpose) return `${name}：${purpose}`;
    return purpose || name;
  });
  const canDo = uniqTrimmed(
    [
      ...(raw.canDo ?? []),
      ...fromFeatures,
      ...(raw.useCases ?? []),
      ...(raw.workflow ?? []),
    ],
    5,
  );
  const notes = uniqTrimmed([...(raw.notes ?? []), ...(raw.caveats ?? [])], 4);

  return {
    id: raw.id,
    title: raw.title,
    summary: raw.summary,
    canDo: canDo.length ? canDo : [raw.summary].filter(Boolean),
    notes,
    related: raw.related,
  };
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
  if (primary) return normalizePageGuideDoc(primary);
  const hk = CATALOGS['zh-HK'][id];
  return hk ? normalizePageGuideDoc(hk) : null;
}

export function listPageGuideIds(locale?: string | null): string[] {
  return Object.keys(mapFor(locale));
}
