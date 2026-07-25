import { useTranslation } from 'react-i18next';

export function EmailPage() {
  const { t } = useTranslation();
  return (
    <div className="card">
      <h1>{t('email.title')}</h1>
      <h3>{t('email.externalTodos')}</h3>
      <ul>
        <li>MX / SPF / DKIM / DMARC DNS records</li>
        <li>{t('email.ptr')}</li>
        <li>{t('email.port25')}</li>
        <li>IP/domain reputation & warm-up</li>
      </ul>
    </div>
  );
}
