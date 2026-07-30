import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../shared/hooks/useAuth';
import {
  Alert,
  Field,
  FormActions,
  FormLayout,
  buttonClassName,
} from '../shared/components/ui';

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

        <form className="login-card__form" onSubmit={(e) => void onSubmit(e)}>
          <FormLayout>
            <Field label={t('login.username')} htmlFor="username" flush required>
              <input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
              />
            </Field>
            <Field label={t('login.password')} htmlFor="password" flush required>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            {needsTotp || totp ? (
              <Field
                label="雙重驗證碼"
                htmlFor="totp"
                hint="Authenticator 應用程式中的 6 位數字"
                flush
              >
                <input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={(e) => setTotp(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                />
              </Field>
            ) : null}
          </FormLayout>
          <FormActions>
            <button
              type="submit"
              className={buttonClassName({ variant: 'primary', fullWidth: true })}
              disabled={loading}
            >
              {loading ? '登入中…' : t('login.submit')}
            </button>
          </FormActions>
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
