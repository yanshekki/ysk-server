import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../shared/services/api';
import type { HealthResponse } from '@ysk/shared';

export function DashboardPage() {
  const { t } = useTranslation();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>{t('dashboard.title')}</h1>
      <p>{t('dashboard.welcome')}</p>
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
      </div>
    </div>
  );
}
