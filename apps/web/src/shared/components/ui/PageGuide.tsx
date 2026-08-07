/**
 * Slim product help panel for the trailing About / 說明 tab.
 * Structure: title · summary · canDo · notes · related.
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
        <p className="muted">{t('pageGuide.missing')}</p>
      </div>
    );
  }

  return (
    <div className="page-guide tab-panel" data-guide-id={doc.id}>
      <header className="page-guide__hero">
        <h2 className="page-guide__title">{doc.title}</h2>
        <p className="page-guide__summary">{doc.summary}</p>
      </header>

      {doc.canDo.length > 0 ? (
        <section className="page-guide__section" aria-labelledby={`pg-can-${doc.id}`}>
          <h3 id={`pg-can-${doc.id}`} className="page-guide__section-title">
            {t('pageGuide.canDoTitle')}
          </h3>
          <ul className="page-guide__list">
            {doc.canDo.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {doc.notes.length > 0 ? (
        <section
          className="page-guide__section page-guide__section--notes"
          aria-labelledby={`pg-notes-${doc.id}`}
        >
          <h3 id={`pg-notes-${doc.id}`} className="page-guide__section-title">
            {t('pageGuide.notesTitle')}
          </h3>
          <ul className="page-guide__list">
            {doc.notes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {doc.related?.length ? (
        <section className="page-guide__section" aria-labelledby={`pg-rel-${doc.id}`}>
          <h3 id={`pg-rel-${doc.id}`} className="page-guide__section-title">
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
