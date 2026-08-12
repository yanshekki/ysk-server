/**
 * Support / Creator / YSK Limited — free product contact & donate.
 * No pricing. Issues → email@ysk.hk
 */
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FeaturePageLayout,
  Card,
  CardSection,
  DataTable,
  Button,
} from '../../shared/components/ui';

const SUPPORT_EMAIL = 'email@ysk.hk';
const COMPANY_URL = 'https://ysk.hk/';

/** Central donate links & crypto handles — edit here only */
const DONATE = {
  github: 'https://github.com/sponsors/yanshekki',
  linktree: 'https://linktr.ee/yanshekki',
  crypto: [
    { network: 'EVM (ETH/BSC/AVAX)', address: 'yanshekki.eth' },
    { network: 'NEAR', address: 'yanshekki.near' },
    { network: 'ADA (Cardano)', address: '$yanshekki' },
  ] as const,
};

type CryptoRow = (typeof DONATE.crypto)[number];

export function SupportPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);

  const copyAddress = useCallback(async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      window.setTimeout(() => setCopied((c) => (c === addr ? null : c)), 1800);
    } catch {
      /* ignore — user can select manually */
    }
  }, []);

  const cryptoRows = useMemo(() => [...DONATE.crypto], []);

  return (
    <FeaturePageLayout
      title={t('support.title')}
      subtitle={t('support.sub')}
      showCapability={false}
      status={{
        pill: { label: t('support.title'), tone: 'ok' },
        items: [
          { label: t('support.donateTitle'), value: 'Linktree' },
          { label: t('support.helpTitle'), value: SUPPORT_EMAIL },
        ],
      }}
    >
      <div className="u-stack u-gap-4 support-page">
        <Card>
          <CardSection title={t('support.creatorTitle')}>
            <p className="u-text-sm u-mb-0 support-page__prose">{t('support.creatorBody')}</p>
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('support.donateTitle')}>
            <p className="u-text-sm u-mb-3 support-page__prose">{t('support.donateBody')}</p>
            <div className="u-flex u-flex-wrap u-gap-2 u-mb-3">
              <a
                className="btn btn--primary btn--md"
                href={DONATE.github}
                target="_blank"
                rel="noreferrer"
              >
                {t('support.donateGithub')}
              </a>
              <a
                className="btn btn--secondary btn--md"
                href={DONATE.linktree}
                target="_blank"
                rel="noreferrer"
              >
                {t('support.donateLinktree')}
              </a>
            </div>

            <DataTable<CryptoRow>
              title={t('support.cryptoTitle')}
              description={t('support.cryptoHint')}
              columns={[
                {
                  key: 'network',
                  header: t('support.cryptoNetwork'),
                  render: (row) => row.network,
                },
                {
                  key: 'address',
                  header: t('support.cryptoAddress'),
                  render: (row) => <code className="support-page__code">{row.address}</code>,
                },
                {
                  key: 'copy',
                  header: '',
                  nowrap: true,
                  render: (row) => (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void copyAddress(row.address)}
                    >
                      {copied === row.address ? t('support.copied') : t('support.copy')}
                    </Button>
                  ),
                },
              ]}
              rows={cryptoRows}
              rowKey={(row) => row.network}
            />
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('support.yskTitle')}>
            <p className="u-text-sm u-mb-2 support-page__prose">{t('support.yskIntro')}</p>
            <ul className="u-text-sm list-plain u-mb-3 support-page__list">
              <li>{t('support.yskSvc1')}</li>
              <li>{t('support.yskSvc2')}</li>
              <li>{t('support.yskSvc3')}</li>
              <li>{t('support.yskSvc4')}</li>
            </ul>
            <p className="u-text-sm muted u-mb-0">{t('support.yskNoPrice')}</p>
            <div className="u-flex u-flex-wrap u-gap-2 u-mt-3">
              <a className="btn btn--secondary btn--md" href={COMPANY_URL} target="_blank" rel="noreferrer">
                {t('support.yskWebsite')}
              </a>
            </div>
          </CardSection>
        </Card>

        <Card>
          <CardSection title={t('support.helpTitle')}>
            <p className="u-text-sm u-mb-3 support-page__prose">{t('support.helpBody')}</p>
            <a className="btn btn--primary btn--md" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
            <p className="u-text-sm muted u-mt-3 u-mb-0">
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
