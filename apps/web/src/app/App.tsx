import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';
import { SecurityPage } from '../pages/SecurityPage';
import { EmailPage } from '../pages/EmailPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { UpdatesPage } from '../pages/UpdatesPage';
import { AgentsPage } from '../pages/AgentsPage';

export function App() {
  const { t, i18n } = useTranslation();

  return (
    <BrowserRouter>
      <div className="layout">
        <header className="nav">
          <strong>{t('product')}</strong>
          <NavLink to="/">{t('nav.dashboard')}</NavLink>
          <NavLink to="/projects">{t('nav.projects')}</NavLink>
          <NavLink to="/security">{t('nav.security')}</NavLink>
          <NavLink to="/email">{t('nav.email')}</NavLink>
          <NavLink to="/updates">{t('nav.updates')}</NavLink>
          <NavLink to="/agents">{t('nav.agents')}</NavLink>
          <NavLink to="/login">{t('nav.login')}</NavLink>
          <span style={{ marginLeft: 'auto' }} className="muted">
            <button
              type="button"
              className="secondary"
              onClick={() => i18n.changeLanguage(i18n.language === 'zh-TW' ? 'en' : i18n.language === 'en' ? 'zh-CN' : 'zh-TW')}
            >
              {i18n.language}
            </button>
          </span>
        </header>
        <p className="muted">{t('tagline')}</p>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/email" element={<EmailPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/updates" element={<UpdatesPage />} />
          <Route path="/agents" element={<AgentsPage />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
