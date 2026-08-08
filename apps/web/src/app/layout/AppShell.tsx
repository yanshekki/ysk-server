import { useId, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { canSeeFeature } from '@ysk/shared';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCapabilities } from '../../shared/hooks/useCapabilities';
import { useSoftwareNavBadges } from '../../shared/hooks/useSoftwareNavBadges';
import { FEATURE_SECTIONS } from '../../shared/nav/features';
import { api } from '../../shared/services/api';
import { buttonClassName, ToastViewport } from '../../shared/components/ui';
import {
  cycleAppLocale,
  LOCALE_LABELS,
  normalizeLocale } from '../../shared/lib/i18n';
import { bindVoid } from '../../pages/bind-handlers';

/** All nav paths — used so /ftp does not stay active on /ftp/service */
const NAV_PATHS = FEATURE_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

/**
 * Active only for exact match, or for nested routes when no longer sibling nav path matches.
 * Prevents both「FTPS 帳戶」and「vsftpd 服務」highlighting on /ftp/service.
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
  const navBadges = useSoftwareNavBadges();
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
    if (to === '/software' && navBadges.software > 0) return navBadges.software;
    if (to === '/updates' && navBadges.updates > 0) return navBadges.updates;
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
  const langLabel =
    LOCALE_LABELS[normalizeLocale(i18n.language)] ??
    t('common.languageName', { defaultValue: 'Language' });

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
                return (
                  <NavLink
                    key={item.to}
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
                        title={
                          item.to === '/software'
                            ? t('software.navBadgeTitle', {
                                n: badgeN })
                            : t('updates.navBadgeTitle', {
                                n: badgeN })
                        }
                      >
                        {badgeN > 99 ? '99+' : badgeN}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="shell__footer">
          YSK Limited ·{' '}
          <a href="https://ysk.hk" target="_blank" rel="noreferrer">
            ysk.hk
          </a>
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
          <button
            type="button"
            className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            onClick={bindVoid(cycleAppLocale)}
            title={t('common.switchLanguage')}
            aria-label={`${t('common.language')}: ${langLabel}`}
          >
            {langLabel}
          </button>
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
