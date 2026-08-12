/**
 * Support / Creator / YSK Limited — free product contact & donate.
 * No pricing. Issues → email@ysk.hk
 */
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeaturePageLayout, Card, CardSection } from '../../shared/components/ui';

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
            <div className="u-flex u-flex-wrap u-gap-2" style={{ marginBottom: '1rem' }}>
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

            <p className="u-text-sm" style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>
              {t('support.cryptoTitle')}
            </p>
            <p className="u-text-sm muted" style={{ margin: '0 0 0.65rem', lineHeight: 1.5 }}>
              {t('support.cryptoHint')}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table
                className="u-text-sm"
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  margin: 0,
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '0.45rem 0.6rem',
                        borderBottom: '1px solid var(--border, #333)',
                        fontWeight: 600,
                      }}
                    >
                      {t('support.cryptoNetwork')}
                    </th>
                    <th
                      style={{
                        textAlign: 'left',
                        padding: '0.45rem 0.6rem',
                        borderBottom: '1px solid var(--border, #333)',
                        fontWeight: 600,
                      }}
                    >
                      {t('support.cryptoAddress')}
                    </th>
                    <th
                      style={{
                        textAlign: 'right',
                        padding: '0.45rem 0.6rem',
                        borderBottom: '1px solid var(--border, #333)',
                        width: '5.5rem',
                      }}
                    />
                  </tr>
                </thead>
                <tbody>
                  {DONATE.crypto.map((row) => (
                    <tr key={row.network}>
                      <td
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderBottom: '1px solid var(--border, #2a2a2a)',
                          verticalAlign: 'middle',
                        }}
                      >
                        {row.network}
                      </td>
                      <td
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderBottom: '1px solid var(--border, #2a2a2a)',
                          verticalAlign: 'middle',
                        }}
                      >
                        <code
                          style={{
                            display: 'inline-block',
                            padding: '0.2rem 0.45rem',
                            borderRadius: '0.35rem',
                            background: 'var(--surface-2, #1e1e24)',
                            fontSize: '0.9em',
                          }}
                        >
                          {row.address}
                        </code>
                      </td>
                      <td
                        style={{
                          padding: '0.5rem 0.6rem',
                          borderBottom: '1px solid var(--border, #2a2a2a)',
                          textAlign: 'right',
                          verticalAlign: 'middle',
                        }}
                      >
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          onClick={() => void copyAddress(row.address)}
                        >
                          {copied === row.address ? t('support.copied') : t('support.copy')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
