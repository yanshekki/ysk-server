/**
 * Web i18n — catalogs from @ysk/shared/locales (SSOT).
 * Tier-1 defaults: zh-HK / zh-CN / en.
 * Other locales load on demand (keeps main bundle small; avoids blank-page wait).
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  isRtlLocale,
  normalizeLocale,
  type LocaleCode,
} from '@ysk/shared';

type Catalog = Record<string, unknown>;

/** Dynamic import map — each locale becomes its own Vite chunk. */
const CATALOG_LOADERS: Record<string, () => Promise<{ default: Catalog }>> = {
  en: () => import('@ysk/shared/locales/en/translation.json'),
  'zh-HK': () => import('@ysk/shared/locales/zh-HK/translation.json'),
  'zh-CN': () => import('@ysk/shared/locales/zh-CN/translation.json'),
  ja: () => import('@ysk/shared/locales/ja/translation.json'),
  ko: () => import('@ysk/shared/locales/ko/translation.json'),
  hi: () => import('@ysk/shared/locales/hi/translation.json'),
  es: () => import('@ysk/shared/locales/es/translation.json'),
  ar: () => import('@ysk/shared/locales/ar/translation.json'),
  fr: () => import('@ysk/shared/locales/fr/translation.json'),
  bn: () => import('@ysk/shared/locales/bn/translation.json'),
  pt: () => import('@ysk/shared/locales/pt/translation.json'),
  id: () => import('@ysk/shared/locales/id/translation.json'),
  ur: () => import('@ysk/shared/locales/ur/translation.json'),
};

const loading = new Map<string, Promise<void>>();

function catalogKey(code: string): string {
  const n = String(normalizeLocale(code));
  // historical alias still used in storage / Accept-Language
  if (n === 'zh-TW' || code === 'zh-TW') return 'zh-HK';
  return n;
}

/** Ensure a locale catalog is registered (idempotent). */
export async function ensureLocaleLoaded(lng: string): Promise<void> {
  const key = catalogKey(lng);
  if (i18n.hasResourceBundle(key, 'translation')) {
    if ((lng === 'zh-TW' || String(normalizeLocale(lng)) === 'zh-TW') && !i18n.hasResourceBundle('zh-TW', 'translation')) {
      const bundle = i18n.getResourceBundle(key, 'translation') as Catalog;
      i18n.addResourceBundle('zh-TW', 'translation', bundle, true, true);
    }
    return;
  }
  const existing = loading.get(key);
  if (existing) {
    await existing;
    return;
  }
  const loader = CATALOG_LOADERS[key] ?? CATALOG_LOADERS.en!;
  const p = loader()
    .then((mod) => {
      const data = mod.default ?? mod;
      i18n.addResourceBundle(key, 'translation', data, true, true);
      if (key === 'zh-HK') {
        i18n.addResourceBundle('zh-TW', 'translation', data, true, true);
      }
    })
    .finally(() => {
      loading.delete(key);
    });
  loading.set(key, p);
  await p;
}

function detectInitialLng(): LocaleCode {
  try {
    const stored = localStorage.getItem('ysk.locale');
    if (stored) return normalizeLocale(stored);
  } catch {
    /* ignore */
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return normalizeLocale(navigator.language);
  }
  return DEFAULT_LOCALE;
}

/** Sync <html lang> + dir for accessibility and RTL (ar, ur). */
export function applyDocumentLocale(lng: string): void {
  if (typeof document === 'undefined') return;
  const code = normalizeLocale(lng);
  const root = document.documentElement;
  root.lang = code;
  root.dir = isRtlLocale(code) ? 'rtl' : 'ltr';
  root.dataset.locale = code;
  root.dataset.rtl = isRtlLocale(code) ? 'true' : 'false';
}

let bootstrapped = false;

/**
 * Call once before first React render.
 * Loads en (fallback) + initial locale only — not all 13 catalogs.
 */
export async function bootstrapI18n(): Promise<void> {
  if (bootstrapped) return;
  const lng = detectInitialLng();

  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      resources: {},
      lng,
      fallbackLng: {
        'zh-TW': ['zh-HK', 'en'],
        'zh-HK': ['en'],
        'zh-CN': ['zh-HK', 'en'],
        ja: ['en'],
        ko: ['en'],
        hi: ['en'],
        es: ['en'],
        ar: ['en'],
        fr: ['en'],
        bn: ['en'],
        pt: ['en'],
        id: ['en'],
        ur: ['en'],
        default: ['en'],
      },
      supportedLngs: [...LOCALES, 'zh-TW'],
      partialBundledLanguages: true,
      interpolation: { escapeValue: false },
      returnNull: false,
      initImmediate: false,
    });
  }

  // Always load English fallback + chosen locale in parallel
  await Promise.all([ensureLocaleLoaded('en'), ensureLocaleLoaded(lng)]);
  if (i18n.language !== lng) {
    await i18n.changeLanguage(lng);
  }
  applyDocumentLocale(i18n.language);
  i18n.on('languageChanged', (code) => {
    applyDocumentLocale(code);
  });
  bootstrapped = true;
}

/**
 * Persist + normalize language changes (localStorage + i18next).
 * When authenticated, also PATCH /api/v1/auth/locale (fire-and-forget).
 */
export function setAppLocale(lng: string, opts?: { syncServer?: boolean }): void {
  const code = normalizeLocale(lng);
  void (async () => {
    await ensureLocaleLoaded(code);
    await ensureLocaleLoaded('en');
    await i18n.changeLanguage(code);
    applyDocumentLocale(code);
  })();
  try {
    localStorage.setItem('ysk.locale', code);
  } catch {
    /* ignore */
  }
  if (opts?.syncServer === false) return;

  void Promise.all([import('../stores/auth-store'), import('../services/api')])
    .then(([{ authStore }, { api }]) => {
      if (!authStore.isAuthenticated()) return;
      return api.setLocale(code).then((r) => {
        const u = authStore.getUser();
        if (u && r.user) {
          authStore.setSession(authStore.getToken()!, {
            ...u,
            locale: r.user.locale,
          });
        }
      });
    })
    .catch(() => {
      /* unauthenticated / offline — local preference still applies */
    });
}

export function cycleAppLocale(): LocaleCode {
  const cur = normalizeLocale(i18n.language);
  const i = LOCALES.indexOf(cur);
  const next = LOCALES[(i + 1) % LOCALES.length]!;
  setAppLocale(next, { syncServer: true });
  return next;
}

/** Apply server user.locale after login (does not re-PATCH server). */
export function applyUserLocale(locale?: string | null): void {
  if (!locale) return;
  setAppLocale(locale, { syncServer: false });
}

export { LOCALE_LABELS, LOCALES, DEFAULT_LOCALE, normalizeLocale, isRtlLocale };
export type { LocaleCode };

export default i18n;
