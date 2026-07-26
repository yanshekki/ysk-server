import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/hooks/useAuth';
import { Alert } from '../shared/components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password, totp || undefined);
      nav(from === '/login' ? '/' : from, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('login.failed');
      if (msg.includes('雙重驗證') || msg.includes('TOTP') || msg.includes('2FA')) {
        setNeedsTotp(true);
      }
      // raw API may return needsTotp in message body
      if (String(msg).includes('needsTotp') || String(msg).includes('驗證碼')) {
        setNeedsTotp(true);
      }
      setError(msg);
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

        {error ? <Alert variant="error">{error}</Alert> : null}
        {needsTotp ? <Alert variant="info">此帳戶已開啟 2FA，請輸入 6 位驗證碼</Alert> : null}

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
          {(needsTotp || totp) && (
            <div className="field">
              <label htmlFor="totp">雙重驗證碼</label>
              <input
                id="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={totp}
                onChange={(e) => setTotp(e.target.value)}
                placeholder="6 位數字"
                maxLength={6}
              />
            </div>
          )}
          <button type="submit" className="btn btn--primary btn--block" disabled={loading}>
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
