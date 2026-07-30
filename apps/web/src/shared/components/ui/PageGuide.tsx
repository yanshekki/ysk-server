/**
 * Professional product help panel for the trailing「說明」tab.
 */
import { Link } from 'react-router-dom';
import type { PageGuideDoc } from '../../guides/types';
import { getPageGuide } from '../../guides/catalog';
import { Badge } from './Badge';

export type PageGuideProps = {
  /** Catalog id */
  guideId?: string;
  /** Inline doc overrides catalog */
  doc?: PageGuideDoc;
};

export function PageGuide({ guideId, doc: docProp }: PageGuideProps) {
  const doc = docProp ?? (guideId ? getPageGuide(guideId) : null);
  if (!doc) {
    return (
      <div className="page-guide page-guide--missing tab-panel">
        <p className="muted">暫無此頁說明文件。</p>
      </div>
    );
  }

  return (
    <div className="page-guide tab-panel" data-guide-id={doc.id}>
      <header className="page-guide__hero">
        <div className="page-guide__hero-text">
          <p className="page-guide__kicker">功能說明</p>
          <h2 className="page-guide__title">{doc.title}</h2>
          <p className="page-guide__summary">{doc.summary}</p>
          {doc.audience ? (
            <p className="page-guide__audience">適用對象：{doc.audience}</p>
          ) : null}
          {doc.chips?.length ? (
            <div className="page-guide__chips">
              {doc.chips.map((c) => (
                <Badge key={c} tone="neutral">
                  {c}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <section className="page-guide__section" aria-labelledby={`pg-feat-${doc.id}`}>
        <h3 id={`pg-feat-${doc.id}`} className="page-guide__section-title">
          本頁能做什麼
        </h3>
        <div className="page-guide__feature-grid">
          {doc.features.map((f) => (
            <article key={f.name} className="page-guide__feature-card">
              <h4 className="page-guide__feature-name">{f.name}</h4>
              <p className="page-guide__feature-purpose">{f.purpose}</p>
              {f.how ? (
                <p className="page-guide__feature-how">
                  <span className="page-guide__label">用法</span>
                  {f.how}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <div className="page-guide__split">
        <section className="page-guide__section" aria-labelledby={`pg-uc-${doc.id}`}>
          <h3 id={`pg-uc-${doc.id}`} className="page-guide__section-title">
            典型應用
          </h3>
          <ul className="page-guide__list">
            {doc.useCases.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </section>

        <section className="page-guide__section" aria-labelledby={`pg-wf-${doc.id}`}>
          <h3 id={`pg-wf-${doc.id}`} className="page-guide__section-title">
            建議流程
          </h3>
          <ol className="page-guide__steps">
            {doc.workflow.map((step, i) => (
              <li key={step} className="page-guide__step">
                <span className="page-guide__step-num" aria-hidden>
                  {i + 1}
                </span>
                <span className="page-guide__step-text">{step}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section
        className="page-guide__section page-guide__section--caveats"
        aria-labelledby={`pg-cv-${doc.id}`}
      >
        <h3 id={`pg-cv-${doc.id}`} className="page-guide__section-title">
          注意與邊界
        </h3>
        <ul className="page-guide__caveats">
          {doc.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </section>

      {doc.related?.length ? (
        <section className="page-guide__section" aria-labelledby={`pg-rel-${doc.id}`}>
          <h3 id={`pg-rel-${doc.id}`} className="page-guide__section-title">
            相關功能
          </h3>
          <div className="page-guide__related">
            {doc.related.map((r) => (
              <Link key={r.to} to={r.to} className="page-guide__related-link">
                {r.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
