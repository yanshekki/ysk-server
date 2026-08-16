/**
 * Support / Creator / YSK Limited — free product contact & donate.
 * No pricing. Issues → email@ysk.hk
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HealthResponse } from 'ysk-server-shared';
import { toast } from '../../shared/stores/toast-store';
import { api } from '../../shared/services/api';
import {
  FeaturePageLayout,
  Card,
  CardSection,
  CodeBlock,
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

type HostFacts = {
  os?: { platform?: string; kernel?: string };
  identity?: { hostname?: string };
};

export function formatSupportDiagnostic(
  h: Pick<
    HealthResponse,
    'version' | 'status' | 'mode' | 'executeEnabled' | 'isRoot' | 'protectionMode'
  >,
  host: HostFacts | null,
  tr?: (k: string) => string,
): string {
  const t = tr ?? ((k: string) => k);
  const on = t('common.on');
  const off = t('common.off');
  const yes = t('common.yes');
  const no = t('common.no');
  return [
    `YSK Server ${h.version}`,
    `${t('support.diagStatus')}: ${h.status}`,
    `${t('support.diagMode')}: ${h.mode ?? '—'}`,
    `${t('system.executeLabel')}: ${h.executeEnabled ? on : off}`,
    `${t('system.rootLabel')}: ${h.isRoot ? yes : no}`,
    `${t('support.diagProtection')}: ${h.protectionMode}`,
    host?.identity?.hostname
      ? `${t('support.diagHostname')}: ${host.identity.hostname}`
      : null,
    host?.os?.platform
      ? `${t('support.diagOs')}: ${host.os.platform} ${host.os.kernel ?? ''}`.trim()
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

export function SupportPage() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState<string | null>(null);
  const [diagText, setDiagText] = useState('');
  const [diagState, setDiagState] = useState<'loading' | 'ok' | 'err'>('loading');

  const copyAddress = useCallback(async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      toast.ok(
        t('support.copiedAddr', {
          addr: addr.length > 18 ? `${addr.slice(0, 10)}…${addr.slice(-6)}` : addr,
        }),
      );
      window.setTimeout(() => setCopied((c) => (c === addr ? null : c)), 1800);
    } catch {
      /* ignore — user can select manually */
    }
  }, [t]);

  const cryptoRows = useMemo(() => [...DONATE.crypto], []);

  useEffect(() => {
    let alive = true;
    setDiagState('loading');
    void Promise.all([
      api.health(),
      api.requestRaw<HostFacts>('/api/v1/system/host').catch(() => null),
    ])
      .then(([h, host]) => {
        if (!alive) return;
        setDiagText(formatSupportDiagnostic(h, host, t));
        setDiagState('ok');
      })
      .catch(() => {
        if (!alive) return;
        setDiagText('');
        setDiagState('err');
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const copyDiagnostic = useCallback(async () => {
    if (!diagText) return;
    try {
      await navigator.clipboard.writeText(diagText);
      toast.ok(t('support.diagCopied'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('support.diagLoadFailed'));
    }
  }, [diagText, t]);

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
                  mobile: 'actions',
                  render: (row) => (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      title={
                        copied === row.address
                          ? t('support.copied')
                          : t('support.copyTitle', { address: row.address })
                      }
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
          <CardSection title={t('support.diagTitle')}>
            <p className="u-text-sm u-mb-3">{t('support.diagBody')}</p>
            <details className="u-mb-3">
              <summary className="u-text-sm">{t('support.diagPreview')}</summary>
              {diagState === 'loading' ? (
                <p className="muted u-text-sm u-mb-0">{t('support.diagLoading')}</p>
              ) : diagState === 'err' || !diagText ? (
                <p className="muted u-text-sm u-mb-0">{t('support.diagLoadFailed')}</p>
              ) : (
                <CodeBlock>{diagText}</CodeBlock>
              )}
            </details>
            <Button
              type="button"
              size="md"
              variant="secondary"
              disabled={!diagText}
              title={
                diagState === 'loading'
                  ? t('support.diagLoading')
                  : !diagText
                    ? t('support.diagLoadFailed')
                    : t('support.diagCopyTitle')
              }
              onClick={() => void copyDiagnostic()}
            >
              {t('support.diagCopy')}
            </Button>
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
                {t('support.docsLink')}
              </a>
            </p>
          </CardSection>
        </Card>
      </div>
    </FeaturePageLayout>
  );
}
