import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import {
  DataTable,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  OpsResultPanel,
  ServerListFilters,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  FormHint,
  WithPageGuide,
  buttonClassName,
} from '../../shared/components/ui';
import { useServerList } from '../../shared/hooks/useServerList';
import { useSslCertificates } from '../../features/ssl/useSslCertificates';
import type { CertificateView } from '../../features/ssl/api';
import { bindSet, bindInput } from '../bind-handlers';

export function statusBadge(
  status: string,
  filesExist: boolean,
  t: (key: string) => string,
) {
  const s = (status || '').toLowerCase();
  if (filesExist || s === 'uploaded')
    return <Badge tone="ok">{t('ssl.status.uploaded')}</Badge>;
  if (s === 'issued') return <Badge tone="ok">{t('ssl.status.issued')}</Badge>;
  if (s === 'planned') return <Badge tone="warn">{t('ssl.status.planned')}</Badge>;
  if (s === 'failed') return <Badge tone="danger">{t('ssl.status.failed')}</Badge>;
  if (s === 'missing') return <Badge tone="danger">{t('ssl.status.missing')}</Badge>;
  if (s === 'applied')
    return filesExist ? (
      <Badge tone="ok">{t('ssl.status.ready')}</Badge>
    ) : (
      <Badge tone="warn">{t('ssl.status.processing')}</Badge>
    );
  return <Badge tone="neutral">{status || '—'}</Badge>;
}

export function defaultLeEmail(domain: string): string {
  return `admin@${domain}`;
}

export function countFailedCerts(
  items: Array<{ status?: string }>,
): number {
  return items.filter((c) => (c.status || '').toLowerCase() === 'failed')
    .length;
}

export function stepStatusLabel(
  status: string,
  t: (key: string) => string,
): string {
  if (status === 'ok') return t('ssl.step.ok');
  if (status === 'blocked') return t('ssl.step.blocked');
  if (status === 'failed') return t('ssl.step.failed');
  return t('ssl.step.skipped');
}

export function formatStepLine(
  s: { name: string; status: string; detail?: string },
  t: (key: string) => string,
): string {
  const st = stepStatusLabel(s.status, t);
  return s.detail ? `${s.name}: ${st} — ${s.detail}` : `${s.name}: ${st}`;
}

export function SslPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    error,
    msg,
    notes,
    steps,
    blocked,
    blockMessage,
    ok,
    busy,
    lastLe,
    upload,
    requestCertificate,
    remove,
  } = useSslCertificates();
  const certList = useServerList<CertificateView>({
    path: '/api/v1/ssl/certificates',
    debounceMs: 300,
  });
  const items = certList.items;
  const refreshTable = certList.refresh;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [leOpen, setLeOpen] = useState(false);
  const [del, setDel] = useState<CertificateView | null>(null);
  const [domain, setDomain] = useState('');
  const [fullchain, setFullchain] = useState('');
  const [privkey, setPrivkey] = useState('');
  const [email, setEmail] = useState('');

  // Preset from other pages: ?domain=example.com&action=le
  useEffect(() => {
    const d = searchParams.get('domain');
    const action = searchParams.get('action');
    if (d) {
      setDomain(d);
      setEmail(defaultLeEmail(d));
      if (action === 'le') setLeOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    try {
      await upload(domain, fullchain, privkey);
      setUploadOpen(false);
      setDomain('');
      setFullchain('');
      setPrivkey('');
    } finally {
      await refreshTable().catch(() => undefined);
    }
  }

  async function onLe(e: FormEvent) {
    e.preventDefault();
    const d = domain.trim();
    const em = email.trim() || defaultLeEmail(d);
    try {
      const r = await requestCertificate(d, em);
      // Close dialog so user sees result + retry on the page (success or explained fail)
      setLeOpen(false);
      if (r?.ok) {
        setDomain('');
        setEmail('');
      }
    } catch {
      setLeOpen(false);
    } finally {
      await refreshTable().catch(() => undefined);
    }
  }

  /** Retry LE for a failed row domain (table action). */
  async function onRetryDomain(r: CertificateView) {
    const d = String(r.domain || '').trim();
    if (!d) return;
    const em =
      (r.email && String(r.email).trim()) ||
      (lastLe?.domain === d ? lastLe.email : '') ||
      defaultLeEmail(d);
    try {
      await requestCertificate(d, em);
    } catch {
      /* error surface via hook state */
    } finally {
      await refreshTable().catch(() => undefined);
    }
  }

  function isFailedLeRow(r: CertificateView): boolean {
    const st = (r.status || '').toLowerCase();
    if (r.provider !== 'letsencrypt') return false;
    return st === 'failed' || st === 'planned' || (st === 'missing' && !r.files_exist);
  }

  const failedCount = countFailedCerts(items);

  return (
    <FeaturePageLayout
      title={t('nav.ssl')}
      status={{
        pill: {
          label: t('ssl.pillCount', { count: items.length }),
          tone: items.length ? 'ok' : 'warn',
        },
        items: [
          { label: t('ssl.statCerts'), value: items.length },
          {
            label: t('ssl.statWithFiles'),
            value: items.filter((c) => c.files_exist).length,
          },
          {
            label: t('ssl.statFailed'),
            value: failedCount,
            tone: failedCount > 0 ? 'danger' : 'ok',
          },
        ],
      }}
      actions={
        <ActionBar>
          <Button variant="secondary" size="sm" onClick={bindSet(setLeOpen, true)}>
            {t('ssl.requestLe')}
          </Button>
          <Button variant="primary" size="sm" onClick={bindSet(setUploadOpen, true)}>
            {t('ssl.uploadCert')}
          </Button>
          <Link to="/nginx" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            Nginx
          </Link>
        </ActionBar>
      }
    >
      <WithPageGuide guideId="ssl">
        <SoftwareInstallBanner feature="ssl" title={t('ssl.certbotNotInstalled')} />
        <SoftwareVersionBar softwareId="certbot" />
        {error ? (
          <Alert variant="error" className="u-mb-3">
            <strong className="u-block u-mb-1">{t('ssl.requestFailedWhy')}</strong>
            {error}
            {notes.length > 1 ? (
              <span className="u-block u-mt-2 muted u-text-sm">
                <strong>{t('ssl.requestFailedNext')}：</strong>
                {notes[1]}
              </span>
            ) : null}
            <ActionBar className="u-mt-3">
              <Link
                to="/logs?tab=explore&source=file:letsencrypt"
                className={buttonClassName({ variant: 'ghost', size: 'sm' })}
              >
                {t('ssl.openLetsEncryptLog')}
              </Link>
              <span className="muted u-text-sm">{t('ssl.retryInTableHint')}</span>
            </ActionBar>
          </Alert>
        ) : null}

        <OpsResultPanel
          message={msg && !error ? msg : null}
          result={
            // Avoid dumping raw certbot twice when error alert already shows the reason
            !error && (ok != null || blocked || notes.length || steps.length)
              ? {
                  ok: blocked ? false : ok !== false,
                  blocked: Boolean(blocked),
                  blockMessage: blockMessage ?? undefined,
                  notes: [
                    ...steps.map((s) => formatStepLine(s, t)),
                    ...notes,
                  ],
                }
              : error && steps.length
                ? {
                    ok: false,
                    notes: steps.map((s) => formatStepLine(s, t)),
                  }
                : null
          }
          busy={busy}
        />

        <Card>
          <CardSection title={t('ssl.certsTitle', { count: items.length })}>
            <DataTable
              filters={
                <ServerListFilters
                  q={certList.q}
                  setQ={certList.setQ}
                  searching={certList.searching}
                  loading={certList.loading}
                  total={certList.meta?.total ?? items.length}
                  shown={items.length}
                  activeFilterCount={certList.activeFilterCount}
                  clear={certList.clear}
                />
              }
              columns={[
                {
                  key: 'domain',
                  header: t('ssl.colDomain'),
                  render: (r) => <strong>{r.domain}</strong>,
                },
                {
                  key: 'provider',
                  header: t('ssl.colProvider'),
                  render: (r) =>
                    r.provider === 'letsencrypt'
                      ? 'Let’s Encrypt'
                      : r.provider === 'upload'
                        ? t('ssl.providerUpload')
                        : r.provider,
                },
                {
                  key: 'files',
                  header: t('ssl.colLocalFiles'),
                  render: (r) =>
                    r.files_exist ? (
                      <Badge tone="ok">{t('ssl.filesYes')}</Badge>
                    ) : (
                      <Badge tone="neutral">{t('ssl.filesNo')}</Badge>
                    ),
                },
                {
                  key: 'expires',
                  header: t('ssl.colExpires'),
                  render: (r) => {
                    if (!r.expires_at) {
                      return (
                        <span className="muted" title={t('ssl.expiresUnknownHint')}>
                          {t('ssl.expiresUnknown')}
                        </span>
                      );
                    }
                    const d = new Date(r.expires_at);
                    const days = Math.ceil(
                      (d.getTime() - Date.now()) / (24 * 3600 * 1000),
                    );
                    const soon = days >= 0 && days <= 30;
                    return (
                      <span title={d.toISOString()}>
                        {d.toLocaleDateString()}
                        {Number.isFinite(days) ? (
                          <span className={`u-text-sm ${soon ? '' : 'muted'}`}>
                            {' '}
                            ({t('ssl.expiresInDays', { n: days })})
                          </span>
                        ) : null}
                      </span>
                    );
                  },
                },
                {
                  key: 'status',
                  header: t('ssl.colStatus'),
                  render: (r) => statusBadge(r.status, r.files_exist, t),
                },
              ]}
              rows={items}
              rowKey={(r) => String(r.id ?? r.domain)}
              empty={
                <EmptyState
                  title={t('ssl.emptyTitle')}
                  description={t('ssl.emptyDesc')}
                />
              }
              rowActions={(r) => (
                <ActionBar>
                  {isFailedLeRow(r) ? (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      onClick={() => void onRetryDomain(r)}
                      title={t('ssl.retryRequestFor', { domain: r.domain })}
                    >
                      {t('ssl.retryRequest')}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy}
                    onClick={bindSet(setDel, r)}
                  >
                    {t('common.delete')}
                  </Button>
                </ActionBar>
              )}
            />
          </CardSection>
        </Card>

        <Modal
          open={uploadOpen}
          onClose={bindSet(setUploadOpen, false)}
          title={t('ssl.uploadTitle')}
          description={t('ssl.uploadDesc')}
          size="lg"
          footer={
            <>
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary', size: 'md' })}
                onClick={bindSet(setUploadOpen, false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                form="ssl-up"
                className={buttonClassName({ variant: 'primary', size: 'md' })}
                disabled={busy}
              >
                {t('common.save')}
              </button>
            </>
          }
        >
          <form id="ssl-up" onSubmit={(e) => void onUpload(e)}>
            <FormLayout>
              <Field
                label={t('common.domain')}
                htmlFor="ud"
                flush
                required
                hint={t('ssl.domainHint')}
              >
                <input
                  id="ud"
                  value={domain}
                  onChange={bindInput(setDomain)}
                  required
                  placeholder="example.com"
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t('ssl.fullchainLabel')}
                htmlFor="uf"
                fullWidth
                flush
                required
                hint={t('ssl.fullchainHint')}
              >
                <textarea
                  id="uf"
                  rows={6}
                  value={fullchain}
                  onChange={bindInput(setFullchain)}
                  required
                  placeholder={
                    '-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'
                  }
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t('ssl.privkeyLabel')}
                htmlFor="up"
                fullWidth
                flush
                required
                hint={t('ssl.privkeyHint')}
              >
                <textarea
                  id="up"
                  rows={5}
                  value={privkey}
                  onChange={bindInput(setPrivkey)}
                  required
                  placeholder={
                    '-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'
                  }
                  spellCheck={false}
                />
              </Field>
            </FormLayout>
            <FormHint>{t('ssl.uploadHint')}</FormHint>
          </form>
        </Modal>

        <Modal
          open={leOpen}
          onClose={bindSet(setLeOpen, false)}
          title={t('ssl.leTitle')}
          description={t('ssl.leDesc')}
          footer={
            <>
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary', size: 'md' })}
                onClick={bindSet(setLeOpen, false)}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                form="ssl-le"
                className={buttonClassName({ variant: 'primary', size: 'md' })}
                disabled={busy}
              >
                {t('ssl.requestCert')}
              </button>
            </>
          }
        >
          <form id="ssl-le" onSubmit={(e) => void onLe(e)}>
            <FormLayout columns={2}>
              <Field
                label={t('common.domain')}
                htmlFor="ld"
                flush
                required
                hint={t('ssl.domainLeHint')}
              >
                <input
                  id="ld"
                  value={domain}
                  onChange={bindInput(setDomain)}
                  required
                  placeholder={t('ssl.domainLePlaceholder')}
                  spellCheck={false}
                />
              </Field>
              <Field
                label={t('ssl.emailLabel')}
                htmlFor="le"
                flush
                hint={t('ssl.emailHint')}
              >
                <input
                  id="le"
                  type="email"
                  value={email}
                  onChange={bindInput(setEmail)}
                  placeholder="admin@example.com"
                  spellCheck={false}
                />
              </Field>
            </FormLayout>
            {domain.trim().startsWith('*.') ? (
              <FormHint>{t('ssl.leDns01Hint')}</FormHint>
            ) : (
              <FormHint>{t('ssl.leHttp01Hint')}</FormHint>
            )}
          </form>
        </Modal>

        <ConfirmDialog
          open={Boolean(del)}
          onClose={bindSet(setDel, null)}
          onConfirm={() => {
            if (!del) return;
            const key = del.domain || del.id;
            void remove(key)
              .then(() => setDel(null))
              .finally(() => {
                void refreshTable().catch(() => undefined);
              });
          }}
          title={t('ssl.deleteTitle')}
          description={t('ssl.deleteDesc', { domain: del?.domain ?? '' })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          busy={busy}
        />
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
