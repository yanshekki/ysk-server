/**
 * Public legal documents — no panel session.
 * Binding body: English + Hong Kong written Chinese (English controls).
 */
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LEGAL_ARTICLE_IDS,
  LEGAL_COMPANY,
  LEGAL_EMAIL,
  LEGAL_PATHS,
  LEGAL_PRODUCT,
  LEGAL_SITE,
  formatLegalDate,
  getLegalDocument,
  isLegalArticleId,
  isLegalBodyLocale,
  resolveLegalBodyLocale,
  type LegalArticleId,
  type LegalBlock,
  type LegalBodyLocale,
  type LegalDocId,
} from 'ysk-server-shared';
import {
  LOCALES,
  LOCALE_LABELS,
  normalizeLocale,
  setAppLocale,
  type LocaleCode,
} from '../shared/lib/i18n';

function BlockView({ block }: { block: LegalBlock }) {
  if (block.kind === 'ul') {
    return (
      <ul className="legal-page__list">
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  return (
    <p className={block.tone === 'warranty' ? 'legal-page__warranty' : undefined}>{block.text}</p>
  );
}

export function LegalPage() {
  const { t, i18n } = useTranslation();
  const { docId: rawDoc } = useParams<{ docId?: string }>();
  const [params, setParams] = useSearchParams();
  const uiLocale = normalizeLocale(i18n.language);

  if (rawDoc && !isLegalArticleId(rawDoc)) {
    return <Navigate to="/legal" replace />;
  }

  const articleId: LegalDocId = rawDoc && isLegalArticleId(rawDoc) ? rawDoc : 'index';
  const override = params.get('lang');
  const bodyLocale = resolveLegalBodyLocale(uiLocale, override);
  const doc = getLegalDocument(bodyLocale, articleId);
  const officialUi = isLegalBodyLocale(uiLocale);
  const dateLabel = formatLegalDate(doc.updated, bodyLocale);

  function setOfficialLang(next: LegalBodyLocale) {
    const nextParams = new URLSearchParams(params);
    nextParams.set('lang', next);
    setParams(nextParams, { replace: true });
  }

  return (
    <div className="legal-page" data-legal-doc={articleId} data-legal-lang={bodyLocale}>
      <header className="legal-page__top">
        <Link to="/legal" className="legal-page__brand">
          <img src="/logo.svg" alt="" width={32} height={32} />
          <span>{LEGAL_PRODUCT}</span>
        </Link>
        <div className="legal-page__top-actions">
          <label className="legal-page__lang">
            <span className="sr-only">{t('common.language')}</span>
            <select
              className="shell__lang-select"
              value={uiLocale}
              onChange={(e) => setAppLocale(e.target.value as LocaleCode, { syncServer: false })}
              title={t('common.switchLanguage')}
              aria-label={t('common.language')}
            >
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <Link to="/login" className="legal-page__signin">
            {t('legal.signIn')}
          </Link>
        </div>
      </header>

      <nav className="legal-page__tabs" aria-label={t('legal.hubTitle')}>
        <Link to="/legal" className={articleId === 'index' ? 'is-active' : undefined}>
          {t('legal.hubTitle')}
        </Link>
        {LEGAL_ARTICLE_IDS.map((id) => (
          <Link
            key={id}
            to={LEGAL_PATHS[id]}
            className={articleId === id ? 'is-active' : undefined}
          >
            {t(`legal.${id}` as const)}
          </Link>
        ))}
      </nav>

      <main className="legal-page__main">
        <p className="legal-page__notice">{t('legal.englishPrevails')}</p>
        {!officialUi ? <p className="legal-page__notice legal-page__notice--muted">{t('legal.notOfficialLocale')}</p> : null}

        <div className="legal-page__official" role="group" aria-label={t('legal.officialLang')}>
          <span className="legal-page__official-label">{t('legal.officialLang')}</span>
          <button
            type="button"
            className={bodyLocale === 'en' ? 'is-active' : undefined}
            onClick={() => setOfficialLang('en')}
          >
            {t('legal.officialEn')}
          </button>
          <button
            type="button"
            className={bodyLocale === 'zh-HK' ? 'is-active' : undefined}
            onClick={() => setOfficialLang('zh-HK')}
          >
            {t('legal.officialZh')}
          </button>
        </div>

        {articleId === 'index' ? (
          <HubCards />
        ) : (
          <article>
            <header className="legal-page__article-head">
              <p className="legal-page__kicker">{LEGAL_COMPANY}</p>
              <h1>{doc.title}</h1>
              <p className="legal-page__meta">{t('legal.updated', { date: dateLabel })}</p>
            </header>
            {doc.sections.map((section) => (
              <section key={section.id} id={section.id}>
                <h2>{section.heading}</h2>
                {section.blocks.map((block, i) => (
                  <BlockView key={`${section.id}-${i}`} block={block} />
                ))}
              </section>
            ))}
          </article>
        )}
      </main>

      <footer className="legal-page__foot">
        <p>
          <a href={LEGAL_SITE} target="_blank" rel="noreferrer">
            {LEGAL_COMPANY}
          </a>
          {' · '}
          <a href={`mailto:${LEGAL_EMAIL}`}>{LEGAL_EMAIL}</a>
        </p>
        <p className="legal-page__mit">{t('legal.mitNote')}</p>
        <p>
          <Link to="/legal">{t('legal.backToIndex')}</Link>
        </p>
      </footer>
    </div>
  );
}

function HubCards() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const bodyLocale = resolveLegalBodyLocale(normalizeLocale(i18n.language), params.get('lang'));
  const dateLabel = formatLegalDate(
    getLegalDocument(bodyLocale, 'terms').updated,
    bodyLocale,
  );

  return (
    <div className="legal-page__hub">
      <header className="legal-page__article-head">
        <p className="legal-page__kicker">{LEGAL_COMPANY}</p>
        <h1>{t('legal.hubTitle')}</h1>
        <p className="legal-page__lead">{t('legal.hubSub')}</p>
        <p className="legal-page__meta">{t('legal.updated', { date: dateLabel })}</p>
      </header>
      <ul className="legal-page__cards">
        {LEGAL_ARTICLE_IDS.map((id: LegalArticleId) => {
          const item = getLegalDocument(bodyLocale, id);
          return (
            <li key={id}>
              <Link to={LEGAL_PATHS[id]} className="legal-page__card">
                <strong>{t(`legal.${id}` as const)}</strong>
                <span>{item.summary}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
