import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../shared/hooks/useAuth';
import { FEATURE_SECTIONS } from '../../shared/nav/features';
import { api } from '../../shared/services/api';
import { buttonClassName } from '../../shared/components/ui';

/** All nav paths — used so /ftp does not stay active on /ftp/service */
const NAV_PATHS = FEATURE_SECTIONS.flatMap((s) => s.items.map((i) => i.to));

const LANG_ORDER = ['zh-TW', 'en', 'zh-CN'] as const;

/** Human-readable language names (not locale codes like zh-TW). */
const LANG_LABEL: Record<string, string> = {
  'zh-TW': '繁體中文',
  'zh-CN': '简体中文',
  en: 'English',
};

function langDisplayName(code: string): string {
  const base = code.split('-')[0];
  if (LANG_LABEL[code]) return LANG_LABEL[code];
  if (base === 'zh') return LANG_LABEL['zh-TW']!;
  if (base === 'en') return LANG_LABEL.en!;
  return code;
}

function roleDisplayName(role: string): string {
  if (role === 'admin') return '管理員';
  if (role === 'operator') return '操作員';
  if (role === 'viewer') return '檢視者';
  return role;
}

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
  const [searchQ, setSearchQ] = useState('');
  const [searchHits, setSearchHits] = useState<
    Array<{ kind: string; title: string; subtitle?: string; href: string }>
  >([]);

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

  function cycleLang() {
    const cur = i18n.language?.startsWith('zh-CN')
      ? 'zh-CN'
      : i18n.language?.startsWith('zh')
        ? 'zh-TW'
        : i18n.language?.startsWith('en')
          ? 'en'
          : 'zh-TW';
    const i = LANG_ORDER.indexOf(cur as (typeof LANG_ORDER)[number]);
    void i18n.changeLanguage(LANG_ORDER[(i + 1) % LANG_ORDER.length]);
  }

  const primaryRole = user?.roles?.[0];
  const roleLabel = primaryRole ? roleDisplayName(primaryRole) : null;

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
            className={`${buttonClassName({ variant: 'secondary', size: 'sm' })} shell__menu-btn`}
            onClick={() => setOpen(true)}
            aria-label="Menu"
          >
            ☰
          </button>
          <div className="shell__search" style={{ position: 'relative', flex: '1 1 12rem', maxWidth: 320 }}>
            <input
              type="search"
              placeholder="全域搜尋…"
              value={searchQ}
              onChange={(e) => void onSearch(e.target.value)}
              aria-label="全域搜尋"
              style={{ width: '100%' }}
            />
            {searchHits.length > 0 ? (
              <div
                className="card"
                style={{
                  position: 'absolute',
                  zIndex: 50,
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: 4,
                  maxHeight: 280,
                  overflow: 'auto',
                }}
              >
                <ul className="list-plain" style={{ margin: 0, padding: '0.5rem' }}>
                  {searchHits.map((h, i) => (
                    <li key={`${h.kind}-${h.href}-${i}`}>
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        style={{ width: '100%', justifyContent: 'flex-start' }}
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
            onClick={cycleLang}
            title="切換語言"
            aria-label={`語言：${langDisplayName(i18n.language)}`}
          >
            {langDisplayName(i18n.language)}
          </button>
          <span className="shell__user">
            {user?.username ?? '—'}
            {roleLabel && roleLabel !== user?.username ? (
              <span className="badge badge--beside">{roleLabel}</span>
            ) : null}
          </span>
          <button type="button" className={buttonClassName({ variant: 'secondary', size: 'sm' })} onClick={() => void onLogout()}>
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
