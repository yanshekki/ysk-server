import { Link } from 'react-router-dom';
import type { FeatureItem } from '../../nav/features';
import { Badge, type BadgeTone } from './Badge';

export type FeatureTileBadge = {
  label: string;
  tone?: BadgeTone;
};

export interface FeatureIconGridProps {
  items: Array<
    FeatureItem & {
      title: string;
      description?: string;
      badge?: FeatureTileBadge;
    }
  >;
}

export function FeatureIconGrid({ items }: FeatureIconGridProps) {
  return (
    <div className="feature-grid" role="navigation" aria-label="Features">
      {items.map((item) => (
        <Link key={item.to} to={item.to} className="feature-tile">
          <span className="feature-tile__top">
            <span className="feature-tile__icon" aria-hidden>
              {item.icon}
            </span>
            {item.badge ? (
              <Badge tone={item.badge.tone ?? 'neutral'} className="feature-tile__badge">
                {item.badge.label}
              </Badge>
            ) : null}
          </span>
          <span className="feature-tile__title">{item.title}</span>
          {item.description ? (
            <span className="feature-tile__desc">{item.description}</span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
