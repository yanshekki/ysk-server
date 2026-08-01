import { describe, expect, it, beforeEach } from 'vitest';
import { YskError, yskError, yskValidation, tl } from './errors.js';
import { ErrorCodes, type ErrorCode } from './errors-codes.js';
import { clearLocaleCache, runWithLocale } from './i18n/index.js';

describe('YskError', () => {
  beforeEach(() => clearLocaleCache());

  it('stores code, httpStatus, details', () => {
    const err = new YskError(ErrorCodes.VALIDATION, 'bad', {
      httpStatus: 400,
      details: { field: 'x' },
      messageKey: 'errors.validation.generic',
    });
    expect(err.code).toBe(ErrorCodes.VALIDATION);
    expect(err.httpStatus).toBe(400);
    expect(err.details).toEqual({ field: 'x' });
    expect(err.name).toBe('YskError');
  });

  it('localize uses messageKey when present', () => {
    const err = runWithLocale('en', () =>
      yskError(ErrorCodes.UNAUTHORIZED, {
        httpStatus: 401,
        messageKey: 'errors.auth.badCredentials',
      }),
    );
    const msg = err.localize('en');
    expect(msg).not.toBe('errors.auth.badCredentials');
    expect(msg.length).toBeGreaterThan(2);
  });

  it('localize falls back to message when no key match', () => {
    const err = new YskError(ErrorCodes.INTERNAL, 'raw-fallback-message');
    expect(err.localize('en')).toMatch(/raw-fallback|INTERNAL|errors\./i);
  });

  it('localize returns original message when code and key are both missing', () => {
    const err = new YskError('YSK_NOT_A_REAL_CODE' as ErrorCode, 'raw-only-message');
    expect(err.localize('en')).toBe('raw-only-message');
    // no explicit locale → request locale / default path for byCode lookup
    expect(runWithLocale('en', () => err.localize())).toBe('raw-only-message');
    expect(err.localize(null)).toBe('raw-only-message');
  });

  it('accepts cause and uses request locale when localize arg omitted', () => {
    const cause = new Error('root');
    const err = new YskError(ErrorCodes.INTERNAL, 'with-cause', {
      cause,
      messageKey: 'errors.auth.badCredentials',
    });
    expect(err.cause).toBe(cause);
    const msg = runWithLocale('en', () => err.localize());
    expect(msg).toMatch(/Incorrect|password/i);
  });
});

describe('yskError / yskValidation', () => {
  beforeEach(() => clearLocaleCache());

  it('yskError defaults messageKey to errors.<CODE>', () => {
    const err = runWithLocale('en', () => yskError(ErrorCodes.NOT_FOUND, { httpStatus: 404 }));
    expect(err.messageKey).toBe(`errors.${ErrorCodes.NOT_FOUND}`);
    expect(err.httpStatus).toBe(404);
  });

  it('yskValidation is 400 VALIDATION with custom key', () => {
    const err = runWithLocale('en', () =>
      yskValidation('errors.validation.required', {
        messageParams: { field: 'name' },
      }),
    );
    expect(err.code).toBe(ErrorCodes.VALIDATION);
    expect(err.httpStatus).toBe(400);
  });

  it('re-exports tl for localized strings', () => {
    const s = runWithLocale('en', () => tl('common.cancel'));
    expect(s).toBe('Cancel');
  });
});
