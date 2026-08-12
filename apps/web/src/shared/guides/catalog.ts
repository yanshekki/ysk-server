/**
 * Product help catalog — locale-aware.
 * Data: ./data/{zh-HK,zh-CN,en}.json (+ Tier-2 when present)
 * Normalizes legacy guide shapes → professional About sections.
 */
import { normalizeLocale, type LocaleCode } from '@yanshekki/shared';
import type { PageGuideDoc, PageGuideRaw } from './types';

import zhHK from './data/zh-HK.json';
import zhCN from './data/zh-CN.json';
import en from './data/en.json';

type GuideMap = Record<string, PageGuideRaw>;

const CATALOGS: Partial<Record<LocaleCode, GuideMap>> = {
  'zh-HK': zhHK as GuideMap,
  'zh-CN': zhCN as GuideMap,
  en: en as GuideMap,
};

function mapFor(locale?: string | null): GuideMap {
  const code = normalizeLocale(locale);
  // Tier-1 has native catalogs; Tier-2 falls back to English (scaffold quality bar).
  return (
    (CATALOGS[code] as GuideMap | undefined) ??
    (CATALOGS.en as GuideMap) ??
    (CATALOGS['zh-HK'] as GuideMap)
  );
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
 * Map any stored guide (new or legacy) to the About-tab shape.
 */
export function normalizePageGuideDoc(raw: PageGuideRaw): PageGuideDoc {
  const fromFeatures = (raw.features ?? []).map((f) => {
    const name = String(f?.name ?? '').trim();
    const purpose = String(f?.purpose ?? '').trim();
    if (name && purpose) return `${name}：${purpose}`;
    return purpose || name;
  });
  const canDo = uniqTrimmed(
    [...(raw.canDo ?? []), ...fromFeatures, ...(raw.useCases ?? [])],
    6,
  );
  const workflow = uniqTrimmed(
    [...(raw.workflow ?? []), ...(raw.steps ?? []), ...(raw.workflowLegacy ?? [])],
    5,
  );
  const notes = uniqTrimmed([...(raw.notes ?? []), ...(raw.caveats ?? [])], 5);
  const cliHints = uniqTrimmed([...(raw.cliHints ?? [])], 6);

  return {
    id: raw.id,
    title: raw.title,
    summary: raw.summary,
    canDo: canDo.length ? canDo : [raw.summary].filter(Boolean),
    workflow: workflow.length ? workflow : undefined,
    notes,
    cliHints: cliHints.length ? cliHints : undefined,
    related: raw.related,
  };
}

/**
 * Resolve a page guide by id for the given locale.
 * Falls back: requested → en → zh-HK → null.
 */
export function getPageGuide(
  id: string,
  locale?: string | null,
): PageGuideDoc | null {
  const code = normalizeLocale(locale);
  const primary = (CATALOGS[code] as GuideMap | undefined)?.[id];
  if (primary) return normalizePageGuideDoc(primary);
  const enDoc = CATALOGS.en?.[id];
  if (enDoc) return normalizePageGuideDoc(enDoc);
  const hk = CATALOGS['zh-HK']?.[id];
  return hk ? normalizePageGuideDoc(hk) : null;
}

export function listPageGuideIds(locale?: string | null): string[] {
  return Object.keys(mapFor(locale));
}

/** Register extra locale catalogs at runtime (Tier-2 expansion). */
export function registerGuideCatalog(locale: LocaleCode, map: GuideMap): void {
  CATALOGS[locale] = map;
}
