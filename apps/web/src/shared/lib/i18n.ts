/**
 * Web i18n — loads catalogs from @ysk/shared/locales (single source of truth).
 * Default: zh-HK (香港書面語). Aliases zh-TW → zh-HK via normalizeLocale.
 * Tier-1: zh-HK, zh-CN, en (quality bar).
 * Tier-2: ja, ko, hi, es, ar, fr, bn, pt, id, ur (full catalogs; ar/ur RTL).
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

import zhHK from '@ysk/shared/locales/zh-HK/translation.json';
import zhCN from '@ysk/shared/locales/zh-CN/translation.json';
import en from '@ysk/shared/locales/en/translation.json';
import ja from '@ysk/shared/locales/ja/translation.json';
import ko from '@ysk/shared/locales/ko/translation.json';
import hi from '@ysk/shared/locales/hi/translation.json';
import es from '@ysk/shared/locales/es/translation.json';
import ar from '@ysk/shared/locales/ar/translation.json';
import fr from '@ysk/shared/locales/fr/translation.json';
import bn from '@ysk/shared/locales/bn/translation.json';
import pt from '@ysk/shared/locales/pt/translation.json';
import id from '@ysk/shared/locales/id/translation.json';
import ur from '@ysk/shared/locales/ur/translation.json';

const resources = {
  'zh-HK': { translation: zhHK },
  'zh-CN': { translation: zhCN },
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },
  hi: { translation: hi },
  es: { translation: es },
  ar: { translation: ar },
  fr: { translation: fr },
  bn: { translation: bn },
  pt: { translation: pt },
  id: { translation: id },
  ur: { translation: ur },
  /** Compat: historical locale code */
  'zh-TW': { translation: zhHK },
} as const;

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

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLng(),
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
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDocumentLocale(i18n.language);

i18n.on('languageChanged', (lng) => {
  applyDocumentLocale(lng);
});

/**
 * Persist + normalize language changes (localStorage + i18next).
 * When authenticated, also PATCH /api/v1/auth/locale (fire-and-forget).
 */
export function setAppLocale(lng: string, opts?: { syncServer?: boolean }): void {
  const code = normalizeLocale(lng);
  void i18n.changeLanguage(code);
  applyDocumentLocale(code);
  try {
    localStorage.setItem('ysk.locale', code);
  } catch {
    /* ignore */
  }
  if (opts?.syncServer === false) return;

  void Promise.all([
    import('../stores/auth-store'),
    import('../services/api'),
  ])
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
