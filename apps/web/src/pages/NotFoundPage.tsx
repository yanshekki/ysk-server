/**
 * Honest 404 — unknown paths must not silently land on the dashboard.
 */
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FeaturePageLayout, buttonClassName } from '../shared/components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  const loc = useLocation();
  return (
    <FeaturePageLayout
      title={t('notFound.title')}
      status={{
        pill: { label: t('notFound.title'), tone: 'warn' },
        items: [{ label: t('notFound.home'), value: loc.pathname || '/' }],
      }}
    >
      <p className="u-text-sm">
        {t('notFound.body', { path: loc.pathname || '/' })}
      </p>
      <p className="muted u-text-sm">{t('notFound.hint')}</p>
      <div className="u-mt-4 u-flex u-gap-2 u-flex-wrap">
        <Link to="/" className={buttonClassName({ variant: 'primary', size: 'md' })}>
          {t('notFound.home')}
        </Link>
        <Link to="/support" className={buttonClassName({ variant: 'secondary', size: 'md' })}>
          {t('nav.support')}
        </Link>
      </div>
    </FeaturePageLayout>
  );
}
