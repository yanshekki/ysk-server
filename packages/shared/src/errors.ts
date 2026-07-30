/**
 * Shared errors for API / core (Node). Uses request locale + catalogs.
 */

import { getLocale, tl } from './i18n/request-locale.js';
import { t } from './i18n/t.js';
import { ErrorCodes, type ErrorCode } from './errors-codes.js';

export { ErrorCodes, type ErrorCode };

export type YskErrorOptions = {
  details?: unknown;
  httpStatus?: number;
  cause?: unknown;
  /** i18n key (e.g. errors.auth.badCredentials); message may be re-translated */
  messageKey?: string;
  messageParams?: Record<string, string | number | boolean | null | undefined>;
  /** Locale used when constructing message (defaults to request locale) */
  locale?: string;
};

export class YskError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly httpStatus: number;
  readonly messageKey?: string;
  readonly messageParams?: Record<
    string,
    string | number | boolean | null | undefined
  >;

  constructor(code: ErrorCode, message: string, options?: YskErrorOptions) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = 'YskError';
    this.code = code;
    this.details = options?.details;
    this.httpStatus = options?.httpStatus ?? 500;
    this.messageKey = options?.messageKey;
    this.messageParams = options?.messageParams;
  }

  /** Localized message for the given (or current) locale. */
  localize(locale?: string | null): string {
    if (this.messageKey) {
      return t(locale ?? getLocale(), this.messageKey, this.messageParams);
    }
    // Fallback: errors.<CODE> if present, else original message
    const byCode = t(locale ?? getLocale(), `errors.${this.code}`);
    if (byCode !== `errors.${this.code}`) return byCode;
    return this.message;
  }
}

/**
 * Build a YskError with catalog message.
 * Default key: `errors.<CODE>` unless messageKey provided.
 */
export function yskError(
  code: ErrorCode,
  options?: YskErrorOptions & {
    /** Override default errors.<CODE> */
    messageKey?: string;
  },
): YskError {
  const messageKey = options?.messageKey ?? `errors.${code}`;
  const locale = options?.locale ?? getLocale();
  const message = t(locale, messageKey, options?.messageParams);
  return new YskError(code, message, {
    ...options,
    messageKey,
  });
}

/** Convenience: validation error with custom key under errors.* */
export function yskValidation(
  messageKey: string,
  options?: Omit<YskErrorOptions, 'messageKey'> & {
    messageParams?: Record<string, string | number | boolean | null | undefined>;
  },
): YskError {
  return yskError(ErrorCodes.VALIDATION, {
    httpStatus: 400,
    ...options,
    messageKey,
  });
}

/** Re-export tl for callers that only need a localized string without throwing. */
export { tl };
