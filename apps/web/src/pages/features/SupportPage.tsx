/**
 * Support / Creator / YSK Limited — free product contact & donate.
 * No pricing. Issues → email@ysk.hk
 */
import { useTranslation } from 'react-i18next';
import { FeaturePageLayout, Card, CardSection } from '../../shared/components/ui';

const SUPPORT_EMAIL = 'email@ysk.hk';
const COMPANY_URL = 'https://ysk.hk/';
/** Central donate links — edit here only */
const DONATE = {
  github: 'https://github.com/sponsors/yanshekki',
  // Optional extras; leave empty string to hide
  other: '' as string,
};

export function SupportPage() {
  const { t } = useTranslation();

  return (
    <FeaturePageLayout
      title={t('support.title')}
      subtitle={t('support.sub')}
      showCapability={false}
    >
      <div className="u-stack u-gap-4" style={{ maxWidth: '48rem' }}>
        <Card>
          <CardSection title={t('support.creatorTitle')}>
            <p className="u-text-sm" style={{ margin: 0, lineHeight: 1.55 }}>
              {t('support.creatorBody')}
            </p>
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('support.donateTitle')}>
            <p className="u-text-sm" style={{ margin: '0 0 0.75rem', lineHeight: 1.55 }}>
              {t('support.donateBody')}
            </p>
            <div className="u-flex u-flex-wrap u-gap-2">
              <a
                className="btn btn--primary btn--md"
                href={DONATE.github}
                target="_blank"
                rel="noreferrer"
              >
                {t('support.donateGithub')}
              </a>
              {DONATE.other ? (
                <a
                  className="btn btn--secondary btn--md"
                  href={DONATE.other}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('support.donateOther')}
                </a>
              ) : null}
            </div>
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('support.yskTitle')}>
            <p className="u-text-sm" style={{ margin: '0 0 0.65rem', lineHeight: 1.55 }}>
              {t('support.yskIntro')}
            </p>
            <ul className="u-text-sm" style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem' }}>
              <li>{t('support.yskSvc1')}</li>
              <li>{t('support.yskSvc2')}</li>
              <li>{t('support.yskSvc3')}</li>
              <li>{t('support.yskSvc4')}</li>
            </ul>
            <p className="u-text-sm muted" style={{ margin: 0 }}>
              {t('support.yskNoPrice')}
            </p>
            <div className="u-flex u-flex-wrap u-gap-2 u-mt-3">
              <a className="btn btn--secondary btn--md" href={COMPANY_URL} target="_blank" rel="noreferrer">
                {t('support.yskWebsite')}
              </a>
            </div>
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('support.helpTitle')}>
            <p className="u-text-sm" style={{ margin: '0 0 0.75rem', lineHeight: 1.55 }}>
              {t('support.helpBody')}
            </p>
            <a className="btn btn--primary btn--md" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            <p className="u-text-sm muted u-mt-3" style={{ marginBottom: 0 }}>
              {t('support.docsHint')}{' '}
              <a href="https://github.com/yanshekki/ysk-server/tree/main/docs" target="_blank" rel="noreferrer">
                docs/
              </a>
            </p>
          </CardSection>
        </Card>
      </div>
    </FeaturePageLayout>
  );
}
