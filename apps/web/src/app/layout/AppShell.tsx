import { useId, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { canSeeFeature } from '@ysk/shared';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCapabilities } from '../../shared/hooks/useCapabilities';
import { useUpdatesNavBadge } from '../../shared/hooks/useUpdatesNavBadge';
import { useNavBookmarks } from '../../shared/hooks/useNavBookmarks';
import { FEATURE_SECTIONS } from '../../shared/nav/features';
import { api } from '../../shared/services/api';
import { buttonClassName, ToastViewport } from '../../shared/components/ui';
import {
  LOCALES,
  LOCALE_LABELS,
  normalizeLocale,
  setAppLocale,
  type LocaleCode,
} from '../../shared/lib/i18n';

/** All nav paths — used so parent routes do not stay active on longer sibling paths (e.g. mysql vs mysql/service). */
const NAV_PATHS = FEATURE_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

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
  const globalSearchId = useId();
  const [open, setOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<
    Array<{ kind: string; title: string; subtitle?: string; href: string }>
  >([]);

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

  async function onSearch(q: string) {
    setSearchQ(q);
    if (q.trim().length < 1) {
      setSearchHits([]);
      return;
    }
    try {
      const r = await api.requestRaw<{
        items: Array<{ kind: string; title: string; subtitle?: string; href: string }>;
      }>(`/api/v1/search?q=${encodeURIComponent(q.trim())}`);
      setSearchHits(r.items ?? []);
    } catch {
      setSearchHits([]);
    }
  }

  const primaryRole = user?.roles?.[0];
  const roleLabel = primaryRole
    ? t(`roles.${primaryRole}`, { defaultValue: primaryRole })
    : null;
  const locale = normalizeLocale(i18n.language);

  return (
    <div className="shell">
      <ToastViewport />
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
                <span className="shell__nav-section-title">
                  {t(`nav.sections.${section.sectionKey}`, {
                    defaultValue: section.sectionKey })}
                </span>
              ) : null}
              {section.items.map((item) => {
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
        <div className="shell__footer">
          <p className="shell__powered">
            {t('files.publicSharePoweredPrefix', { defaultValue: 'Powered by ' })}
            <a href="https://ysk.hk/" target="_blank" rel="noreferrer">
              {t('company', { defaultValue: 'YSK Limited' })}
            </a>
            {t('files.publicSharePoweredSuffix', { defaultValue: '' })}
          </p>
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
          <div className="shell__search shell-search">
            <input
              id={globalSearchId}
              name="global-search"
              type="search"
              placeholder={t('common.searchGlobal')}
              value={searchQ}
              onChange={(e) => void onSearch(e.target.value)}
              aria-label={t('common.searchGlobal')}
              className="shell-search__input"
              autoComplete="off"
            />
            {searchHits.length > 0 ? (
              <div className="card shell-search__menu">
                <ul className="list-plain shell-search__list">
                  {searchHits.map((h, i) => (
                    <li key={`${h.kind}-${h.href}-${i}`}>
                      <button
                        type="button"
                        className={`${buttonClassName({ variant: 'ghost', size: 'sm' })} shell-search__item`}
                        onClick={() => {
                          setSearchHits([]);
                          setSearchQ('');
                          navigate(h.href);
                        }}
                      >
                        <span className="badge">{h.kind}</span>{' '}
                        {h.title}
                        {h.subtitle ? (
                          <span className="muted u-text-sm"> · {h.subtitle}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
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
        </header>
        <main className="shell__content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
