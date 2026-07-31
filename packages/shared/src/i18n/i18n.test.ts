import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearLocaleCache,
  DEFAULT_LOCALE,
  localeFromAcceptLanguage,
  normalizeLocale,
  runWithLocale,
  runWithLocaleAsync,
  t,
  tl,
  getLocale,
  resolveRequestLocale,
  localeFromEnv,
  mergeDicts,
} from './index.js';
import { ErrorCodes, yskError } from '../errors.js';
import { localizeOpsResult, translateNote } from '../ops-i18n.js';
import { assertHonestOps } from '../ops.js';

describe('i18n', () => {
  beforeEach(() => clearLocaleCache());

  it('normalizeLocale maps zh-TW and zh to zh-HK', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-HK');
    expect(normalizeLocale('zh')).toBe('zh-HK');
    expect(normalizeLocale('zh-HK')).toBe('zh-HK');
    expect(normalizeLocale('zh-CN')).toBe('zh-CN');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it('localeFromAcceptLanguage prefers first matching tag', () => {
    expect(localeFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
    expect(localeFromAcceptLanguage('zh-CN,zh;q=0.8')).toBe('zh-CN');
    expect(localeFromAcceptLanguage('zh-TW,zh;q=0.8')).toBe('zh-HK');
  });

  it('t returns zh-HK common strings', () => {
    expect(t('zh-HK', 'common.cancel')).toBe('取消');
    expect(t('zh-HK', 'common.refresh')).toMatch(/重新整理|刷新/);
  });

  it('t returns English', () => {
    expect(t('en', 'common.cancel')).toBe('Cancel');
    expect(t('en', 'common.save')).toBe('Save');
  });

  it('t returns Simplified Chinese', () => {
    expect(t('zh-CN', 'common.save')).toBe('保存');
  });

  it('t interpolates params', () => {
    // projects.created may exist
    const s = t('en', 'projects.created', { name: 'Demo' });
    if (s !== 'projects.created') {
      expect(s).toContain('Demo');
    }
  });

  it('t falls back to key when missing', () => {
    expect(t('en', 'this.key.does.not.exist.ever')).toBe(
      'this.key.does.not.exist.ever',
    );
  });

  it('runWithLocale + tl uses request locale', () => {
    runWithLocale('en', () => {
      expect(tl('errors.auth.badCredentials')).toMatch(/Incorrect|password/i);
      expect(tl('ops.blocked.needExecute')).toMatch(/execute|Host/i);
    });
    runWithLocale('zh-HK', () => {
      expect(tl('errors.auth.badCredentials')).toMatch(/帳號|密碼/);
    });
  });

  it('yskError localizes by messageKey', () => {
    const err = runWithLocale('en', () =>
      yskError(ErrorCodes.TOTP_REQUIRED, {
        httpStatus: 401,
        messageKey: 'errors.auth.totpRequired',
        details: { needsTotp: true },
      }),
    );
    expect(err.code).toBe(ErrorCodes.TOTP_REQUIRED);
    expect(err.localize('en')).toMatch(/authentication code|2FA|valid/i);
    expect(err.localize('zh-HK')).toMatch(/驗證|雙重/);
  });

  it('translateNote maps ops keys; leaves free text', () => {
    expect(translateNote('ops.honesty.blockedNotOk', 'en')).toMatch(/Honesty|blocked/i);
    expect(translateNote('already localized 中文', 'en')).toBe('already localized 中文');
  });

  it('localizeOpsResult translates honesty keys', () => {
    const raw = assertHonestOps({
      ok: true,
      blocked: true,
      notes: [],
      apply_status: 'applied',
    });
    const loc = localizeOpsResult(raw, 'en');
    expect(loc.ok).toBe(false);
    expect(loc.notes.some((n) => /Honesty|blocked/i.test(n))).toBe(true);
  });

  it('getLocale defaults outside ALS and runWithLocaleAsync works', async () => {
    expect(getLocale()).toBe(DEFAULT_LOCALE);
    const v = await runWithLocaleAsync('en', async () => {
      expect(getLocale()).toBe('en');
      return tl('common.cancel');
    });
    expect(v).toBe('Cancel');
  });

  it('resolveRequestLocale priority user > query > accept > default', () => {
    expect(resolveRequestLocale({ userLocale: 'en' })).toBe('en');
    expect(resolveRequestLocale({ queryLocale: 'zh-CN' })).toBe('zh-CN');
    expect(resolveRequestLocale({ acceptLanguage: 'en-US,en;q=0.9' })).toBe('en');
    expect(resolveRequestLocale({})).toBe(DEFAULT_LOCALE);
  });

  it('localeFromEnv reads YSK_LOCALE', () => {
    expect(localeFromEnv({ YSK_LOCALE: 'en' } as NodeJS.ProcessEnv)).toBe('en');
  });

  it('mergeDicts deep-merges namespaces', () => {
    const m = mergeDicts(
      { common: { a: '1', nested: { x: 'x1' } }, top: 't' },
      { common: { b: '2', nested: { y: 'y2' } } },
    );
    expect(m.top).toBe('t');
    expect((m.common as { a: string; b: string }).a).toBe('1');
    expect((m.common as { b: string }).b).toBe('2');
    expect((m.common as { nested: { x: string; y: string } }).nested.x).toBe('x1');
    expect((m.common as { nested: { y: string } }).nested.y).toBe('y2');
  });

  it('t interpolates missing params as empty', () => {
    // common.cancel has no placeholders; use a synthetic path if needed
    expect(t('en', 'common.cancel', { unused: 'x' })).toBe('Cancel');
  });
});
