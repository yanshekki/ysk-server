/**
 * Request-scoped locale (AsyncLocalStorage).
 * HTTP sets this per request; CLI sets once at process start.
 * Core may call `tl(key)` without threading locale through every call.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  DEFAULT_LOCALE,
  localeFromAcceptLanguage,
  normalizeLocale,
  type LocaleCode,
} from './normalize-locale.js';
import { t } from './t.js';

const als = new AsyncLocalStorage<LocaleCode>();

/** Current locale, or DEFAULT_LOCALE outside a runWithLocale scope. */
export function getLocale(): LocaleCode {
  return als.getStore() ?? DEFAULT_LOCALE;
}

/** Run `fn` with a fixed locale (HTTP request / CLI session). */
export function runWithLocale<T>(locale: string | null | undefined, fn: () => T): T {
  return als.run(normalizeLocale(locale), fn);
}

export async function runWithLocaleAsync<T>(
  locale: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return als.run(normalizeLocale(locale), fn);
}

/**
 * Resolve locale for an HTTP request.
 * Priority: explicit user.locale → Accept-Language → default.
 */
export function resolveRequestLocale(input: {
  acceptLanguage?: string | null;
  userLocale?: string | null;
  queryLocale?: string | null;
}): LocaleCode {
  if (input.userLocale) return normalizeLocale(input.userLocale);
  if (input.queryLocale) return normalizeLocale(input.queryLocale);
  if (input.acceptLanguage) return localeFromAcceptLanguage(input.acceptLanguage);
  return DEFAULT_LOCALE;
}

/** Translate with request locale (or default). */
export function tl(
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>,
): string {
  return t(getLocale(), key, params);
}

/** CLI: YSK_LOCALE / --locale already parsed → set process default via ALS outer run. */
export function localeFromEnv(env: NodeJS.ProcessEnv = process.env): LocaleCode {
  return normalizeLocale(env.YSK_LOCALE ?? env.LANG ?? null);
}
