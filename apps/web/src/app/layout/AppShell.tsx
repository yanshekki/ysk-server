import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { canSeeFeature } from 'ysk-server-shared';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCapabilities } from '../../shared/hooks/useCapabilities';
import { useUpdatesNavBadge } from '../../shared/hooks/useUpdatesNavBadge';
import { useNavBookmarks } from '../../shared/hooks/useNavBookmarks';
import { FEATURE_SECTIONS } from '../../shared/nav/features';
import { buttonClassName } from '../../shared/components/ui';
import { GlobalSearch } from '../../shared/components/GlobalSearch';
import { api } from '../../shared/services/api';
import { setHostTimeZone } from '../../shared/lib/host-timezone';
import { systemApi } from '../../features/system';
import {
  LOCALES,
  LOCALE_LABELS,
  ensureLocaleLoaded,
  isFullCatalogReady,
  normalizeLocale,
  setAppLocale,
  type LocaleCode,
} from '../../shared/lib/i18n';

/** All nav paths — used so parent routes do not stay active on longer sibling paths (e.g. mysql vs mysql/service). */
const NAV_PATHS = FEATURE_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

const NAV_COLLAPSE_KEY = 'ysk.nav.collapsed';

function loadNavCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(NAV_COLLAPSE_KEY) || 'null');
    if (Array.isArray(raw)) return new Set(raw.filter((x) => typeof x === 'string'));
  } catch {
    /* ignore */
  }
  return new Set(['runtimes']);
}

/**
 * Active only for exact match, or for nested routes when no longer sibling nav path matches.
 * Example: `/databases/mysql` must not highlight when on `/databases/mysql/service`.
 */
export function isNavActive(to: string, pathname: string): boolean {
  if (to === '/') return pathname === '/';
  if (pathname === to) return true;
  if (!pathname.startsWith(`${to}/`)) return false;
  const hasLongerSibling = NAV_PATHS.some(
    (other) =>
      other !== to &&
      other.startsWith(`${to}/`) &&
      (pathname === other || pathname.startsWith(`${other}/`)),
  );
  return !hasLongerSibling;
}

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { capabilities } = useCapabilities();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [collapsedNav, setCollapsedNav] = useState<Set<string>>(loadNavCollapsed);
  const [compactChrome, setCompactChrome] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 900px)').matches
      : false,
  );
  const [catalogReady, setCatalogReady] = useState(() => isFullCatalogReady(i18n.language));

  useEffect(() => {
    let cancelled = false;
    if (isFullCatalogReady(i18n.language)) {
      setCatalogReady(true);
      return;
    }
    setCatalogReady(false);
    void ensureLocaleLoaded(i18n.language).then(() => {
      if (!cancelled) setCatalogReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setCompactChrome(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  const isAdmin = Boolean(user?.roles?.includes('admin'));
  const updatesBadge = useUpdatesNavBadge();
  const { bookmarks } = useNavBookmarks();
  const navSections = useMemo(
    () =>
      FEATURE_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter(
          (item) => isAdmin || canSeeFeature(item.key, capabilities),
        ) })).filter((section) => section.items.length > 0),
    [capabilities, isAdmin],
  );

  function navBadgeFor(to: string): number | undefined {
    if (to === '/updates' && updatesBadge.count > 0) return updatesBadge.count;
    return undefined;
  }

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const primaryRole = user?.roles?.[0];
  const roleLabel = primaryRole
    ? t(`roles.${primaryRole}`, { defaultValue: primaryRole })
    : null;
  const locale = normalizeLocale(i18n.language);
  const [panelVersion, setPanelVersion] = useState('');
  useEffect(() => {
    let cancelled = false;
    void api
      .health()
      .then((h) => {
        if (!cancelled && h.version) setPanelVersion(String(h.version));
      })
      .catch(() => undefined);
    void systemApi
      .hostIdentity()
      .then((id) => {
        if (!cancelled) setHostTimeZone(id.timezone);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const accountControls = (
    <>
      <label className="shell__lang">
        <select
          className="shell__lang-select"
          value={locale}
          onChange={(e) => setAppLocale(e.target.value as LocaleCode, { syncServer: true })}
          title={t('common.switchLanguage', { defaultValue: 'Switch language' })}
          aria-label={t('common.language', { defaultValue: 'Language' })}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {LOCALE_LABELS[code]}
            </option>
          ))}
        </select>
      </label>
      <span className="shell__user">
        {user?.username ?? '—'}
        {roleLabel && roleLabel !== user?.username ? (
          <span className="badge badge--beside">{roleLabel}</span>
        ) : null}
      </span>
      <button type="button" className={buttonClassName({ variant: 'secondary', size: 'sm' })} onClick={onLogout}>
        {t('nav.logout')}
      </button>
    </>
  );

  return (
    <div className="shell">
      {open && <div className="shell__backdrop" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={`shell__sidebar${open ? ' is-open' : ''}`}>
        <div className="shell__brand">
          <img src="/logo.svg" alt="YSK Limited" width={32} height={32} />
          <span className="gradient-text">YSK Server</span>
        </div>
        <nav className="shell__nav" aria-label="Main">
          {navSections.map((section) => (
            <div key={section.sectionKey} className="shell__nav-section">
              {section.sectionKey !== 'overview' ? (
                <button
                  type="button"
                  className="shell__nav-section-title"
                  aria-expanded={!collapsedNav.has(section.sectionKey)}
                  onClick={() => {
                    setCollapsedNav((prev) => {
                      const next = new Set(prev);
                      if (next.has(section.sectionKey)) next.delete(section.sectionKey);
                      else next.add(section.sectionKey);
                      try {
                        localStorage.setItem(NAV_COLLAPSE_KEY, JSON.stringify([...next]));
                      } catch {
                        /* ignore */
                      }
                      return next;
                    });
                  }}
                >
                  <span className="shell__nav-section-label">
                    {t(`nav.sections.${section.sectionKey}`, {
                      defaultValue: section.sectionKey })}
                  </span>
                  <span
                    className="shell__nav-section-caret"
                    aria-hidden
                  >
                    {collapsedNav.has(section.sectionKey) ? '▸' : '▾'}
                  </span>
                </button>
              ) : null}
              {(!collapsedNav.has(section.sectionKey) ||
                section.items.some((it) => isNavActive(it.to, location.pathname))) &&
                section.items.map((item) => {
                const badgeN = navBadgeFor(item.to);
                const showProjectPins =
                  item.to === '/projects' && bookmarks.projects.length > 0;
                const showEmailPins =
                  item.to === '/email' && bookmarks.emailDomains.length > 0;
                return (
                  <div key={item.to} className="shell__nav-item">
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      className={() =>
                        `shell__link${isNavActive(item.to, location.pathname) ? ' active' : ''}`
                      }
                      onClick={() => setOpen(false)}
                    >
                      <span className="shell__link-icon" aria-hidden>
                        {item.icon}
                      </span>
                      <span className="shell__link-label">
                        {t(`nav.${item.key}`, { defaultValue: item.key })}
                      </span>
                      {badgeN != null ? (
                        <span
                          className="shell__link-badge"
                          title={t('updates.navBadgeTitle', { n: badgeN })}
                        >
                          {badgeN > 99 ? '99+' : badgeN}
                        </span>
                      ) : null}
                    </NavLink>
                    {showProjectPins ? (
                      <div
                        className="shell__nav-sub"
                        aria-label={t('nav.bookmarkedProjects')}
                      >
                        {bookmarks.projects.map((p) => (
                          <NavLink
                            key={p.id}
                            to={`/projects/${p.id}`}
                            className={({ isActive }) =>
                              `shell__link shell__link--sub${isActive ? ' active' : ''}`
                            }
                            onClick={() => setOpen(false)}
                            title={p.domain || p.label}
                          >
                            <span className="shell__link-icon" aria-hidden>
                              ★
                            </span>
                            <span className="shell__link-label">
                              {p.domain || p.label}
                            </span>
                          </NavLink>
                        ))}
                      </div>
                    ) : null}
                    {showEmailPins ? (
                      <div
                        className="shell__nav-sub"
                        aria-label={t('nav.bookmarkedEmailDomains')}
                      >
                        {bookmarks.emailDomains.map((e) => (
                          <NavLink
                            key={e.id}
                            to={`/email/domains/${encodeURIComponent(e.id)}`}
                            className={({ isActive }) =>
                              `shell__link shell__link--sub${isActive ? ' active' : ''}`
                            }
                            onClick={() => setOpen(false)}
                            title={e.domain}
                          >
                            <span className="shell__link-icon" aria-hidden>
                              ★
                            </span>
                            <span className="shell__link-label">{e.domain}</span>
                          </NavLink>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        {compactChrome ? (
          <div className="shell__account-drawer">
            <div className="shell__account-id">
              <span className="shell__account-name">{user?.username ?? '—'}</span>
              {roleLabel && roleLabel !== user?.username ? (
                <span className="shell__account-role">{roleLabel}</span>
              ) : null}
            </div>
            <div className="shell__account-tools">
              <label className="shell__lang">
                <select
                  className="shell__lang-select"
                  value={locale}
                  onChange={(e) =>
                    setAppLocale(e.target.value as LocaleCode, { syncServer: true })
                  }
                  title={t('common.switchLanguage', { defaultValue: 'Switch language' })}
                  aria-label={t('common.language', { defaultValue: 'Language' })}
                >
                  {LOCALES.map((code) => (
                    <option key={code} value={code}>
                      {LOCALE_LABELS[code]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className={`${buttonClassName({ variant: 'ghost', size: 'sm' })} shell__account-logout`}
                onClick={onLogout}
              >
                {t('nav.logout')}
              </button>
            </div>
          </div>
        ) : null}
        <div className="shell__footer">
          <p className="shell__powered">
            {t('files.publicSharePoweredPrefix', { defaultValue: 'Powered by ' })}
            <a href="https://ysk.hk/" target="_blank" rel="noreferrer">
              {t('company', { defaultValue: 'YSK Limited' })}
            </a>
            {t('files.publicSharePoweredSuffix', { defaultValue: '' })}
            {panelVersion ? (
              <span className="shell__version muted"> v{panelVersion}</span>
            ) : null}
          </p>
          {updatesBadge.panelUpdateAvailable && updatesBadge.panelLatest ? (
            <NavLink to="/updates" className="shell__update">
              {t('updates.footerNewVersion', { version: updatesBadge.panelLatest })}
            </NavLink>
          ) : null}
        </div>
      </aside>

      <div className="shell__main">
        <header className="shell__top">
          <button
            type="button"
            className={`${buttonClassName({ variant: 'secondary', size: 'sm' })} shell__menu-btn`}
            onClick={() => setOpen(true)}
            aria-label={t('common.menu')}
          >
            ☰
          </button>
          <div className="shell__search">
            <GlobalSearch />
          </div>
          {!compactChrome ? <div className="shell__account-bar">{accountControls}</div> : null}
        </header>
        <main className="shell__content">
          {catalogReady ? (
            <Outlet key={normalizeLocale(i18n.language)} />
          ) : (
            <div className="u-pad-panel muted u-text-sm">{t('common.loading')}</div>
          )}
        </main>
      </div>
    </div>
  );
}
