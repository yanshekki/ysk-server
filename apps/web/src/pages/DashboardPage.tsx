import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';
import type { HealthResponse } from '@ysk/shared';
import { authStore } from '../shared/stores/auth-store';

export function DashboardPage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [audit, setAudit] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
    if (authStore.getToken()) {
      api
        .me()
        .then((r) => setUser(r.user.username))
        .catch(() => setUser(null));
      api
        .audit()
        .then((r) => setAudit(r.items.slice(0, 10)))
        .catch(() => setAudit([]));
    }
  }, []);

  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      <p>{t('dashboard.welcome')}</p>
      {user && <p className="muted">Logged in as <strong>{user}</strong></p>}
      <div className="grid">
        <div className="card">
          <h3>{t('dashboard.health')}</h3>
          {error && <p className="error">{error}</p>}
          {health && (
            <>
              <p>
                <span className="badge">{health.status}</span>
              </p>
              <p className="muted">
                {health.product} v{health.version}
              </p>
              <p>
                {t('dashboard.protection')}: {health.protectionMode}
              </p>
            </>
          )}
        </div>
        <div className="card">
          <h3>Recent audit</h3>
          {!authStore.getToken() && <p className="muted">Login to see audit log</p>}
          <ul>
            {audit.map((a) => (
              <li key={String(a.id)}>
                <code>{String(a.action)}</code> by {String(a.actor)}{' '}
                <span className="muted">{String(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
