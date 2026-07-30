/**
 * Web i18n — loads catalogs from @ysk/shared/locales (single source of truth).
 * Default: zh-HK (香港書面語). Aliases zh-TW → zh-HK via normalizeLocale.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_LABELS,
  normalizeLocale,
  type LocaleCode,
} from '@ysk/shared';

import zhHK from '@ysk/shared/locales/zh-HK/translation.json';
import zhCN from '@ysk/shared/locales/zh-CN/translation.json';
import en from '@ysk/shared/locales/en/translation.json';

const resources = {
  'zh-HK': { translation: zhHK },
  'zh-CN': { translation: zhCN },
  en: { translation: en },
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

void i18n.use(initReactI18next).init({
  resources,
  lng: detectInitialLng(),
  fallbackLng: {
    'zh-TW': ['zh-HK', 'en'],
    'zh-HK': ['en'],
    'zh-CN': ['zh-HK', 'en'],
    default: ['en'],
  },
  supportedLngs: [...LOCALES, 'zh-TW'],
  interpolation: { escapeValue: false },
  // Prefer explicit keys; avoid silent English fallback masking missing HK keys in dev
  returnNull: false,
});

/**
 * Persist + normalize language changes (localStorage + i18next).
 * When authenticated, also PATCH /api/v1/auth/locale (fire-and-forget).
 */
export function setAppLocale(lng: string, opts?: { syncServer?: boolean }): void {
  const code = normalizeLocale(lng);
  void i18n.changeLanguage(code);
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

export { LOCALE_LABELS, LOCALES, DEFAULT_LOCALE, normalizeLocale };
export type { LocaleCode };

export default i18n;
