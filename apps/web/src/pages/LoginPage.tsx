import { FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../shared/hooks/useAuth';
import { ApiError } from '../shared/services/api';
import { toast } from '../shared/stores/toast-store';
import { bindInput } from './bind-handlers';
import {
  Alert,
  Field,
  FormActions,
  FormLayout,
  buttonClassName } from '../shared/components/ui';

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const fromState = (location.state as { from?: string } | null)?.from;
  const fromQuery = searchParams.get('from');
  const from = fromState || fromQuery || '/';
  const sessionExpired = searchParams.get('reason') === 'session';

  // Never pre-fill credentials — empty fields for production login.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const sessionBanner = useMemo(
    () =>
      sessionExpired
        ? t('errors.auth.sessionExpired', {
            defaultValue: t('login.sessionExpired', {
              defaultValue: 'Session expired; sign in again' }) })
        : null,
    [sessionExpired, t],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password, totp || undefined);
      nav(from === '/login' ? '/' : from, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('login.failed');
      let totpRequired = false;
      if (err instanceof ApiError) {
        if (
          err.needsTotp ||
          err.code === 'YSK_TOTP_REQUIRED' ||
          (err.details &&
            typeof err.details === 'object' &&
            (err.details as { needsTotp?: boolean }).needsTotp)
        ) {
          totpRequired = true;
        }
      } else if (
        /needsTotp|TOTP|2FA|YSK_TOTP|authenticator/i.test(String(msg))
      ) {
        // Legacy backends without code field
        totpRequired = true;
      }
      if (totpRequired) {
        setNeedsTotp(true);
        // First step: only show the info hint + TOTP field — not a second red banner.
        // Wrong/missing code after the field is visible still shows a single error.
        if (!needsTotp && !totp.trim()) {
          setError(null);
          toast.info(t('login.totpRequired'));
        } else {
          setError(msg);
          toast.error(msg);
        }
      } else {
        setError(msg);
        toast.error(msg);
      }
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

        {sessionBanner ? <Alert variant="info">{sessionBanner}</Alert> : null}
        {/* One alert only: prefer error; otherwise TOTP prompt when field is revealed. */}
        {error ? (
          <Alert variant="error">{error}</Alert>
        ) : needsTotp ? (
          <Alert variant="info">{t('login.totpRequired')}</Alert>
        ) : null}

        <form className="login-card__form" onSubmit={(e) => void onSubmit(e)}>
          <FormLayout>
            <Field label={t('login.username')} htmlFor="username" flush required>
              <input
                id="username"
                value={username}
                onChange={bindInput(setUsername)}
                autoComplete="username"
                required
              />
            </Field>
            <Field label={t('login.password')} htmlFor="password" flush required>
              <input
                id="password"
                type="password"
                value={password}
                onChange={bindInput(setPassword)}
                autoComplete="current-password"
                required
              />
            </Field>
            {needsTotp || totp ? (
              <Field
                label={t('login.totpLabel')}
                htmlFor="totp"
                hint={t('login.totpHint')}
                flush
              >
                <input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={totp}
                  onChange={bindInput(setTotp)}
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
              {loading ? t('login.submitting') : t('login.submit')}
            </button>
          </FormActions>
        </form>

        <div className="login-card__footer">
          <p className="login-card__powered">
            {t('files.publicSharePoweredPrefix', { defaultValue: 'Powered by ' })}
            <a href="https://ysk.hk/" target="_blank" rel="noreferrer">
              {t('company', { defaultValue: 'YSK Limited' })}
            </a>
            {t('files.publicSharePoweredSuffix', { defaultValue: '' })}
          </p>
        </div>
      </div>
    </div>
  );
}
