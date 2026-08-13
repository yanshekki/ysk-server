import { afterEach, describe, expect, it } from 'vitest';
import i18n, {
  ensureLocaleLoaded,
  loadLocaleNamespaces,
  resetFullCatalogLoadStateForTests,
} from './i18n';

describe('i18n full catalog after boot namespaces', () => {
  afterEach(async () => {
    resetFullCatalogLoadStateForTests();
    await ensureLocaleLoaded('zh-HK');
    await ensureLocaleLoaded('en');
  });

  it('does not leave readiness/systemd keys raw after boot-only namespaces', async () => {
    i18n.removeResourceBundle('zh-HK', 'translation');
    i18n.removeResourceBundle('en', 'translation');
    resetFullCatalogLoadStateForTests();
    await loadLocaleNamespaces('en', ['common', 'nav', 'search', 'updates']);
    await loadLocaleNamespaces('zh-HK', ['common', 'nav', 'search', 'updates']);
    expect(i18n.t('nav.readiness', { lng: 'zh-HK' })).not.toBe('nav.readiness');
    expect(i18n.t('updates.tabOverview', { lng: 'zh-HK' })).toBe('總覽');
    expect(i18n.t('common.searchGlobal', { lng: 'zh-HK' })).toMatch(/搜尋/);
    expect(i18n.t('readiness.reprobe', { lng: 'zh-HK' })).toBe('readiness.reprobe');
    expect(i18n.t('systemd.installAndEnable', { lng: 'zh-HK' })).toBe(
      'systemd.installAndEnable',
    );

    await ensureLocaleLoaded('zh-HK');
    expect(i18n.t('readiness.reprobe', { lng: 'zh-HK' })).toBe('重新探測');
    expect(i18n.t('systemd.installAndEnable', { lng: 'zh-HK' })).not.toBe(
      'systemd.installAndEnable',
    );
  });
});
