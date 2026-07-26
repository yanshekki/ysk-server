import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../shared/hooks/useAuth';
import { FEATURE_SECTIONS } from '../../shared/nav/features';

/** All nav paths — used so /ftp does not stay active on /ftp/service */
const NAV_PATHS = FEATURE_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

/**
 * Active only for exact match, or for nested routes when no longer sibling nav path matches.
 * Prevents both「FTPS 帳戶」and「vsftpd 服務」highlighting on /ftp/service.
 */
function isNavActive(to: string, pathname: string): boolean {
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
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  function cycleLang() {
    const order = ['zh-TW', 'en', 'zh-CN'] as const;
    const i = order.indexOf(i18n.language as (typeof order)[number]);
    void i18n.changeLanguage(order[(i + 1) % order.length]);
  }

  return (
    <div className="shell">
      {open && <div className="shell__backdrop" onClick={() => setOpen(false)} aria-hidden />}
      <aside className={`shell__sidebar${open ? ' is-open' : ''}`}>
        <div className="shell__brand">
          <img src="/logo.svg" alt="YSK Limited" width={32} height={32} />
          <span className="gradient-text">YSK Server</span>
        </div>
        <nav className="shell__nav" aria-label="Main">
          {FEATURE_SECTIONS.map((section) => (
            <div key={section.sectionKey} className="shell__nav-section">
              {section.sectionKey !== 'overview' ? (
                <span className="shell__nav-section-title">
                  {t(`nav.sections.${section.sectionKey}`, {
                    defaultValue: section.sectionKey,
                  })}
                </span>
              ) : null}
              {section.items.map((item) => (
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
                  {t(`nav.${item.key}`, { defaultValue: item.key })}
                </NavLink>
              ))}
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
            className="btn btn--secondary btn--sm shell__menu-btn"
            onClick={() => setOpen(true)}
            aria-label="Menu"
          >
            ☰
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={cycleLang}>
            {i18n.language}
          </button>
          <span className="shell__user">
            {user?.username ?? '—'}
            {user?.roles?.[0] ? <span className="badge badge--beside">{user.roles[0]}</span> : null}
          </span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void onLogout()}>
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
