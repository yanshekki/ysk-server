import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/hooks/useAuth';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      nav(from === '/login' ? '/' : from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-card__brand">
          <img src="/logo.svg" alt="YSK Limited" width={56} height={56} />
          <h1>
            <span className="gradient-text">{t('product')}</span>
          </h1>
          <p>{t('login.subtitle')}</p>
        </div>

        {error && <div className="alert alert--error">{error}</div>}

        <form onSubmit={(e) => void onSubmit(e)}>
          <div className="field">
            <label htmlFor="username">{t('login.username')}</label>
            <input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">{t('login.password')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn btn--primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? '…' : t('login.submit')}
          </button>
        </form>

        <div className="login-card__footer">
          {t('login.footer')} ·{' '}
          <a href="https://ysk.hk" target="_blank" rel="noreferrer">
            ysk.hk
          </a>
        </div>
      </div>
    </div>
  );
}
