import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../shared/hooks/useAuth';

const NAV: Array<{ to: string; end?: boolean; key: string; icon: string }> = [
  { to: '/', end: true, key: 'dashboard', icon: '◉' },
  { to: '/projects', key: 'projects', icon: '▣' },
  { to: '/security', key: 'security', icon: '⛨' },
  { to: '/email', key: 'email', icon: '✉' },
  { to: '/updates', key: 'updates', icon: '↻' },
  { to: '/agents', key: 'agents', icon: '⚡' },
];

export function AppShell() {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `shell__link${isActive ? ' active' : ''}`}
              onClick={() => setOpen(false)}
            >
              <span className="shell__link-icon" aria-hidden>
                {item.icon}
              </span>
              {t(`nav.${item.key}`)}
            </NavLink>
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
          <span className="muted" style={{ fontSize: '0.9rem', fontWeight: 600 }}>
            {user?.username ?? '—'}
            {user?.roles?.[0] ? (
              <span className="badge" style={{ marginLeft: 8 }}>
                {user.roles[0]}
              </span>
            ) : null}
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
