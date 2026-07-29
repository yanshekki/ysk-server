/**
 * Shared ops-console hero used across product pages.
 */
import type { ReactNode } from 'react';

export type OpsHeroTone = 'ok' | 'warn' | 'danger' | 'neutral';

export type OpsHeroStat = {
  label: string;
  value: ReactNode;
};

export type OpsHeroProps = {
  /** Optional small label above title — omit when same as page title */
  eyebrow?: string;
  /** Main heading; omit when FeaturePageLayout already shows the same title */
  title?: ReactNode;
  pill?: string;
  pillTone?: OpsHeroTone;
  /** Prefer omit; keep only critical one-line fact */
  hint?: ReactNode;
  meta?: ReactNode;
  cta?: ReactNode;
  stats?: OpsHeroStat[];
  rail?: ReactNode;
  tone?: OpsHeroTone;
  className?: string;
};

export function OpsHero({
  eyebrow,
  title,
  pill,
  pillTone = 'ok',
  hint,
  meta,
  cta,
  stats,
  rail,
  tone = 'ok',
  className,
}: OpsHeroProps) {
  const toneCls = tone === 'neutral' ? 'ok' : tone;
  const hasCopy = Boolean(eyebrow || title || pill || hint || meta || cta);
  return (
    <section
      className={['ops-hero', `ops-hero--${toneCls}`, className].filter(Boolean).join(' ')}
      aria-label={typeof title === 'string' ? title : eyebrow || '概覽'}
    >
      <div className="ops-hero__main">
        {hasCopy ? (
        <div className="ops-hero__copy">
          {eyebrow ? <div className="ops-hero__eyebrow">{eyebrow}</div> : null}
          {title || pill ? (
          <h2 className="ops-hero__title">
            {pill ? (
              <span className={`ops-hero__pill ops-hero__pill--${pillTone}`}>{pill}</span>
            ) : null}
            {title}
          </h2>
          ) : null}
          {hint ? <p className="ops-hero__hint">{hint}</p> : null}
          {meta ? <div className="ops-hero__meta">{meta}</div> : null}
          {cta ? <div className="ops-hero__cta">{cta}</div> : null}
        </div>
        ) : null}
        {stats && stats.length > 0 ? (
          <div className="ops-hero__stats" aria-label="關鍵指標">
            {stats.map((s) => (
              <div key={s.label} className="ops-stat">
                <span className="ops-stat__lab">{s.label}</span>
                <span className="ops-stat__val">{s.value}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {rail ? <ul className="ops-rail">{rail}</ul> : null}
    </section>
  );
}
