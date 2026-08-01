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
  FormHint,
  WithPageGuide,
  buttonClassName,
} from '../../shared/components/ui';
import { useServerList } from '../../shared/hooks/useServerList';
import { useSslCertificates } from '../../features/ssl/useSslCertificates';
import type { CertificateView } from '../../features/ssl/api';

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

export function bindingHasTargets(b: {
  projects?: unknown[];
  mailDomains?: unknown[];
}): boolean {
  return (b.projects?.length ?? 0) + (b.mailDomains?.length ?? 0) > 0;
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
    upload,
    requestCertificate,
    remove,
    retryLast,
  } = useSslCertificates();
  const certList = useServerList<CertificateView>({
    path: '/api/v1/ssl/certificates',
    debounceMs: 300,
  });
  const items = certList.items;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [leOpen, setLeOpen] = useState(false);
  const [del, setDel] = useState<CertificateView | null>(null);
  const [domain, setDomain] = useState('');
  const [fullchain, setFullchain] = useState('');
  const [privkey, setPrivkey] = useState('');
  const [email, setEmail] = useState('');
  const [bindings, setBindings] = useState<
    Array<{
      domain: string;
      expires_at?: string | null;
      projects?: Array<{ name: string }>;
      mailDomains?: Array<{ domain: string }>;
    }>
  >([]);
  const [renewNotes, setRenewNotes] = useState<string[]>([]);

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

  useEffect(() => {
    void import('../../features/ssl/api').then(({ sslApi }) =>
      sslApi
        .bindings()
        .then((r) => {
          setBindings(r.items ?? []);
          setRenewNotes(r.notes ?? []);
        })
        .catch(() => undefined),
    );
  }, [items.length]);

  async function onUpload(e: FormEvent) {
    e.preventDefault();
    await upload(domain, fullchain, privkey);
    setUploadOpen(false);
    setDomain('');
    setFullchain('');
    setPrivkey('');
  }

  async function onLe(e: FormEvent) {
    e.preventDefault();
    const d = domain.trim();
    await requestCertificate(d, email.trim() || defaultLeEmail(d));
    setLeOpen(false);
    setDomain('');
    setEmail('');
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
          { label: t('ssl.statBindings'), value: bindings.length },
          {
            label: t('ssl.statFailed'),
            value: failedCount,
            tone: failedCount > 0 ? 'danger' : 'ok',
          },
        ],
      }}
      actions={
        <ActionBar>
          <Button variant="secondary" size="sm" onClick={() => setLeOpen(true)}>
            {t('ssl.requestLe')}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setUploadOpen(true)}>
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
        {error ? <Alert variant="error">{error}</Alert> : null}

        <OpsResultPanel
          message={msg}
          result={
            ok != null || blocked || notes.length || steps.length
              ? {
                  ok: blocked ? false : ok !== false,
                  blocked: Boolean(blocked),
                  blockMessage: blockMessage ?? undefined,
                  notes: [
                    ...steps.map((s) => formatStepLine(s, t)),
                    ...notes,
                  ],
                }
              : null
          }
          onRetry={blocked ? () => void retryLast() : undefined}
          busy={busy}
        />

        {renewNotes.length || bindings.length ? (
          <Card>
            <CardSection title={t('ssl.bindingsTitle')}>
              {renewNotes.map((n) => (
                <p key={n} className="muted u-text-sm">
                  {n}
                </p>
              ))}
              {bindings.filter(bindingHasTargets).length > 0 ? (
                <ul className="list-plain list-spaced u-mt-2">
                  {bindings
                    .filter(bindingHasTargets)
                    .map((b) => (
                      <li key={b.domain}>
                        <strong>{b.domain}</strong>
                        {b.expires_at
                          ? t('ssl.expiresAt', {
                              date: new Date(b.expires_at).toLocaleDateString(),
                            })
                          : ''}
                        {b.projects?.length
                          ? t('ssl.projectsAt', {
                              names: b.projects.map((p) => p.name).join(', '),
                            })
                          : ''}
                        {b.mailDomains?.length
                          ? t('ssl.mailAt', {
                              domains: b.mailDomains.map((m) => m.domain).join(', '),
                            })
                          : ''}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="muted u-text-sm">{t('ssl.noBindings')}</p>
              )}
            </CardSection>
          </Card>
        ) : null}

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
                  render: (r) =>
                    r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—',
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
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy}
                    onClick={() => setDel(r)}
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
          onClose={() => setUploadOpen(false)}
          title={t('ssl.uploadTitle')}
          description={t('ssl.uploadDesc')}
          size="lg"
          footer={
            <>
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary', size: 'md' })}
                onClick={() => setUploadOpen(false)}
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
                  onChange={(e) => setDomain(e.target.value)}
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
                  onChange={(e) => setFullchain(e.target.value)}
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
                  onChange={(e) => setPrivkey(e.target.value)}
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
          onClose={() => setLeOpen(false)}
          title={t('ssl.leTitle')}
          description={t('ssl.leDesc')}
          footer={
            <>
              <button
                type="button"
                className={buttonClassName({ variant: 'secondary', size: 'md' })}
                onClick={() => setLeOpen(false)}
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
                  onChange={(e) => setDomain(e.target.value)}
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
                  onChange={(e) => setEmail(e.target.value)}
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
          onClose={() => setDel(null)}
          onConfirm={() => {
            if (del) void remove(del.domain || del.id).then(() => setDel(null));
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
