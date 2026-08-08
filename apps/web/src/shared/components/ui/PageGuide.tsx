/**
 * Professional About / 說明 tab — unified product help layout.
 * Structure: hero · canDo · workflow · notes · cliHints · related.
 */
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { PageGuideDoc } from '../../guides/types';
import { getPageGuide, normalizePageGuideDoc } from '../../guides/catalog';

export type PageGuideProps = {
  guideId?: string;
  /** Inline doc — legacy shapes are normalized */
  doc?: PageGuideDoc;
};

export function PageGuide({ guideId, doc: docProp }: PageGuideProps) {
  const { t, i18n } = useTranslation();
  const doc = docProp
    ? normalizePageGuideDoc(docProp)
    : guideId
      ? getPageGuide(guideId, i18n.language)
      : null;

  if (!doc) {
    return (
      <div className="page-guide page-guide--missing tab-panel">
        <div className="page-guide__missing-card">
          <h2 className="page-guide__title">{t('pageGuide.missingTitle')}</h2>
          <p className="page-guide__summary muted">{t('pageGuide.missing')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-guide tab-panel" data-guide-id={doc.id}>
      <header className="page-guide__hero">
        <div className="page-guide__hero-badge" aria-hidden>
          ?
        </div>
        <div className="page-guide__hero-text">
          <p className="page-guide__eyebrow">{t('pageGuide.eyebrow')}</p>
          <h2 className="page-guide__title">{doc.title}</h2>
          <p className="page-guide__summary">{doc.summary}</p>
        </div>
      </header>

      <div className="page-guide__grid">
        {doc.canDo.length > 0 ? (
          <section
            className="page-guide__section page-guide__section--can"
            aria-labelledby={`pg-can-${doc.id}`}
          >
            <h3 id={`pg-can-${doc.id}`} className="page-guide__section-title">
              <span className="page-guide__icon" aria-hidden>
                ✓
              </span>
              {t('pageGuide.canDoTitle')}
            </h3>
            <ol className="page-guide__list page-guide__list--check">
              {doc.canDo.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </section>
        ) : null}

        {doc.workflow && doc.workflow.length > 0 ? (
          <section
            className="page-guide__section page-guide__section--flow"
            aria-labelledby={`pg-flow-${doc.id}`}
          >
            <h3 id={`pg-flow-${doc.id}`} className="page-guide__section-title">
              <span className="page-guide__icon" aria-hidden>
                →
              </span>
              {t('pageGuide.workflowTitle')}
            </h3>
            <ol className="page-guide__list page-guide__list--steps">
              {doc.workflow.map((item, i) => (
                <li key={item}>
                  <span className="page-guide__step-n">{i + 1}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {doc.notes.length > 0 ? (
          <section
            className="page-guide__section page-guide__section--notes"
            aria-labelledby={`pg-notes-${doc.id}`}
          >
            <h3 id={`pg-notes-${doc.id}`} className="page-guide__section-title">
              <span className="page-guide__icon" aria-hidden>
                !
              </span>
              {t('pageGuide.notesTitle')}
            </h3>
            <ul className="page-guide__list">
              {doc.notes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {doc.cliHints && doc.cliHints.length > 0 ? (
          <section
            className="page-guide__section page-guide__section--cli"
            aria-labelledby={`pg-cli-${doc.id}`}
          >
            <h3 id={`pg-cli-${doc.id}`} className="page-guide__section-title">
              <span className="page-guide__icon" aria-hidden>
                $
              </span>
              {t('pageGuide.cliTitle')}
            </h3>
            <ul className="page-guide__cli-list">
              {doc.cliHints.map((item) => (
                <li key={item}>
                  <code className="page-guide__cli">{item}</code>
                </li>
              ))}
            </ul>
            <p className="page-guide__cli-foot muted">
              {t('pageGuide.cliFoot')}
            </p>
          </section>
        ) : null}
      </div>

      {doc.related?.length ? (
        <section
          className="page-guide__section page-guide__section--related"
          aria-labelledby={`pg-rel-${doc.id}`}
        >
          <h3 id={`pg-rel-${doc.id}`} className="page-guide__section-title">
            <span className="page-guide__icon" aria-hidden>
              ↗
            </span>
            {t('pageGuide.relatedTitle')}
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
