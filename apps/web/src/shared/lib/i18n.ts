/**
 * Web i18n — catalogs from ysk-server-shared/locales (SSOT).
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
} from 'ysk-server-shared';

type Catalog = Record<string, unknown>;

/** Dynamic import map — each locale becomes its own Vite chunk. */
const CATALOG_LOADERS: Record<string, () => Promise<{ default: Catalog }>> = {
  en: () => import('ysk-server-shared/locales/en/translation.json'),
  'zh-HK': () => import('ysk-server-shared/locales/zh-HK/translation.json'),
  'zh-CN': () => import('ysk-server-shared/locales/zh-CN/translation.json'),
  ja: () => import('ysk-server-shared/locales/ja/translation.json'),
  ko: () => import('ysk-server-shared/locales/ko/translation.json'),
  hi: () => import('ysk-server-shared/locales/hi/translation.json'),
  es: () => import('ysk-server-shared/locales/es/translation.json'),
  ar: () => import('ysk-server-shared/locales/ar/translation.json'),
  fr: () => import('ysk-server-shared/locales/fr/translation.json'),
  bn: () => import('ysk-server-shared/locales/bn/translation.json'),
  pt: () => import('ysk-server-shared/locales/pt/translation.json'),
  id: () => import('ysk-server-shared/locales/id/translation.json'),
  ur: () => import('ysk-server-shared/locales/ur/translation.json'),
};

/**
 * Dedicated namespace loaders — always merged after the big catalog.
 * Prevents raw keys when translation.json is stale (deploy cache / rebuild skip)
 * or an older chunk was already registered without serviceExposure.
 */
const SERVICE_EXPOSURE_LOADERS: Record<string, () => Promise<{ default: Catalog } | Catalog>> = {
  en: () => import('ysk-server-shared/locales/en/serviceExposure.json'),
  'zh-HK': () => import('ysk-server-shared/locales/zh-HK/serviceExposure.json'),
  'zh-CN': () => import('ysk-server-shared/locales/zh-CN/serviceExposure.json'),
  ja: () => import('ysk-server-shared/locales/ja/serviceExposure.json'),
  ko: () => import('ysk-server-shared/locales/ko/serviceExposure.json'),
  hi: () => import('ysk-server-shared/locales/hi/serviceExposure.json'),
  es: () => import('ysk-server-shared/locales/es/serviceExposure.json'),
  ar: () => import('ysk-server-shared/locales/ar/serviceExposure.json'),
  fr: () => import('ysk-server-shared/locales/fr/serviceExposure.json'),
  bn: () => import('ysk-server-shared/locales/bn/serviceExposure.json'),
  pt: () => import('ysk-server-shared/locales/pt/serviceExposure.json'),
  id: () => import('ysk-server-shared/locales/id/serviceExposure.json'),
  ur: () => import('ysk-server-shared/locales/ur/serviceExposure.json'),
};

const loading = new Map<string, Promise<void>>();
/** Locales that already received the dedicated serviceExposure merge this session */
const serviceExposurePatched = new Set<string>();

/** Shell / login only — first paint must not wait for the 400–900 KB catalog. */
const BOOT_NAMESPACES = [
  'common',
  'nav',
  'login',
  'errors',
  'dialogs',
  'roles',
  'tabs',
  'applyStatus',
] as const;

const NS_MODULES = import.meta.glob<{ default: Catalog }>(
  '../../../../../packages/shared/locales/*/*.json',
);

function isTestRuntime(): boolean {
  return Boolean(import.meta.env?.MODE === 'test' || import.meta.env?.VITEST);
}

async function loadNamespaceFile(locale: string, ns: string): Promise<Catalog | null> {
  const suffix = `/locales/${locale}/${ns}.json`;
  const key = Object.keys(NS_MODULES).find((p) => p.endsWith(suffix));
  if (!key) return null;
  const loader = NS_MODULES[key];
  if (!loader) return null;
  const mod = await loader();
  return asCatalog(mod);
}

/** Merge selected namespace JSON files into i18n `translation` (same shape as translation.json). */
export async function loadLocaleNamespaces(
  lng: string,
  namespaces: readonly string[],
): Promise<void> {
  const key = catalogKey(lng);
  const parts = await Promise.all(
    namespaces.map(async (ns) => {
      const data = await loadNamespaceFile(key, ns);
      return data ? ([ns, data] as const) : null;
    }),
  );
  const bundle: Catalog = {};
  for (const row of parts) {
    if (!row) continue;
    bundle[row[0]] = row[1];
  }
  if (Object.keys(bundle).length) {
    i18n.addResourceBundle(key, 'translation', bundle, true, true);
    if (key === 'zh-HK') {
      i18n.addResourceBundle('zh-TW', 'translation', bundle, true, true);
    }
  }
}

function catalogKey(code: string): string {
  const n = String(normalizeLocale(code));
  // historical alias still used in storage / Accept-Language
  if (n === 'zh-TW' || code === 'zh-TW') return 'zh-HK';
  return n;
}

function asCatalog(mod: { default?: Catalog } | Catalog): Catalog {
  if (mod && typeof mod === 'object' && 'default' in mod && mod.default) {
    return mod.default as Catalog;
  }
  return mod as Catalog;
}

/** Merge serviceExposure namespace (overwrite) so UI never shows raw keys. */
async function patchServiceExposureNs(key: string): Promise<void> {
  if (serviceExposurePatched.has(key)) return;
  try {
    const loader = SERVICE_EXPOSURE_LOADERS[key] ?? SERVICE_EXPOSURE_LOADERS.en!;
    const mod = await loader();
    const se = asCatalog(mod);
    if (!se || typeof se !== 'object') return;
    i18n.addResourceBundle(key, 'translation', { serviceExposure: se }, true, true);
    if (key === 'zh-HK') {
      i18n.addResourceBundle('zh-TW', 'translation', { serviceExposure: se }, true, true);
    }
    serviceExposurePatched.add(key);
  } catch {
    /* en fallback below */
    if (key !== 'en') {
      try {
        const mod = await SERVICE_EXPOSURE_LOADERS.en!();
        const se = asCatalog(mod);
        i18n.addResourceBundle(key, 'translation', { serviceExposure: se }, true, true);
        serviceExposurePatched.add(key);
      } catch {
        /* leave missing — rare */
      }
    }
  }
}

/** Ensure a locale catalog is registered (idempotent). */
export async function ensureLocaleLoaded(lng: string): Promise<void> {
  const key = catalogKey(lng);
  if (i18n.hasResourceBundle(key, 'translation')) {
    // Still patch serviceExposure — catalog may be a cached chunk without it
    await patchServiceExposureNs(key);
    if ((lng === 'zh-TW' || String(normalizeLocale(lng)) === 'zh-TW') && !i18n.hasResourceBundle('zh-TW', 'translation')) {
      const bundle = i18n.getResourceBundle(key, 'translation') as Catalog;
      i18n.addResourceBundle('zh-TW', 'translation', bundle, true, true);
    }
    return;
  }
  const existing = loading.get(key);
  if (existing) {
    await existing;
    await patchServiceExposureNs(key);
    return;
  }
  const loader = CATALOG_LOADERS[key] ?? CATALOG_LOADERS.en!;
  const p = loader()
    .then(async (mod) => {
      const data = asCatalog(mod);
      i18n.addResourceBundle(key, 'translation', data, true, true);
      if (key === 'zh-HK') {
        i18n.addResourceBundle('zh-TW', 'translation', data, true, true);
      }
      await patchServiceExposureNs(key);
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

  // Tests need the full catalog immediately (pages assert on any key).
  if (isTestRuntime()) {
    await Promise.all([ensureLocaleLoaded('en'), ensureLocaleLoaded(lng)]);
  } else {
    await Promise.all([
      loadLocaleNamespaces('en', BOOT_NAMESPACES),
      loadLocaleNamespaces(lng, BOOT_NAMESPACES),
    ]);
    // Full catalogs after first paint (do not block login / shell).
    void Promise.all([ensureLocaleLoaded('en'), ensureLocaleLoaded(lng)]);
  }
  if (i18n.language !== lng) {
    await i18n.changeLanguage(lng);
  }
  applyDocumentLocale(i18n.language);
  i18n.on('languageChanged', (code) => {
    applyDocumentLocale(code);
    if (!isTestRuntime()) void ensureLocaleLoaded(code);
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
