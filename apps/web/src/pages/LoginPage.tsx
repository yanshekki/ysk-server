import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../shared/services/api';
import { authStore } from '../shared/stores/auth-store';

export function LoginPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.login(username, password);
      authStore.setToken(res.token);
      nav('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('login.failed'));
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420 }}>
      <h1>{t('login.title')}</h1>
      <form onSubmit={onSubmit}>
        <label className="muted">{t('login.username')}</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        <label className="muted">{t('login.password')}</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit">{t('login.submit')}</button>
      </form>
    </div>
  );
}
