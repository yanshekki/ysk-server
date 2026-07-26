import { useTranslation } from 'react-i18next';
import { Badge } from '../../../shared/components/ui';
import { formatHealthFacts } from '../model/status';

export function HealthSummary({
  lastHealth,
}: {
  lastHealth?: Record<string, unknown> | null;
}) {
  const { t } = useTranslation();
  const facts = formatHealthFacts(lastHealth ?? null);

  if (facts.length === 0) {
    return <p className="muted">{t('projects.healthDetail.none')}</p>;
  }

  return (
    <div className="fact-grid">
      {facts.map((f) => (
        <div key={f.labelKey || f.labelFallback} className="fact-card">
          <span className="fact-card__label">
            {f.labelKey
              ? t(f.labelKey, { defaultValue: f.labelFallback })
              : f.labelFallback}
          </span>
          <div className="fact-card__value">
            {f.tone ? <Badge tone={f.tone}>{f.value}</Badge> : f.value}
          </div>
          {f.hint ? <div className="fact-card__hint">{f.hint}</div> : null}
        </div>
      ))}
    </div>
  );
}
