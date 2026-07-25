import { useTranslation } from 'react-i18next';

export function UpdatesPage() {
  const { t } = useTranslation();
  return (
    <div>
      <header className="page-header">
        <h1>{t('updates.title')}</h1>
        <p>{t('updates.body')}</p>
      </header>
      <div className="card">
        <div className="empty">
          <div className="empty__title">Coming online</div>
          <p className="muted" style={{ margin: 0 }}>
            Inventory scheduler and approval-gated package updates wire into this panel.
          </p>
        </div>
      </div>
    </div>
  );
}
