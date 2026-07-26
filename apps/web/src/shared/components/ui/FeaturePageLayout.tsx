import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { buttonClassName } from './Button';

export interface FeaturePageLayoutProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** @deprecated Banner removed — kept for call-site compatibility */
  showCapability?: boolean;
  backTo?: string;
  backLabel?: string;
  children: ReactNode;
}

export function FeaturePageLayout({
  title,
  subtitle,
  actions,
  backTo,
  backLabel = '返回',
  children,
}: FeaturePageLayoutProps) {
  return (
    <div className="feature-page">
      {backTo ? (
        <div className="feature-page__back">
          <Link to={backTo} className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            ← {backLabel}
          </Link>
        </div>
      ) : null}
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="feature-page__body stack">{children}</div>
    </div>
  );
}
