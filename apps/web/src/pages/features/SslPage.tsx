import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  ExecutionResultPanel,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  OpsHero,
  SoftwareInstallBanner,
  FormActions,
  FormHint,
} from '../../shared/components/ui';
import { ResourceTable } from '../../shared/components/resource/ResourceTable';
import { useSslCertificates } from '../../features/ssl/useSslCertificates';
import type { CertificateView } from '../../features/ssl/api';

function statusBadge(status: string, filesExist: boolean) {
  const s = (status || '').toLowerCase();
  if (filesExist || s === 'uploaded') return <Badge tone="ok">已上傳</Badge>;
  if (s === 'issued') return <Badge tone="ok">已簽發</Badge>;
  if (s === 'planned') return <Badge tone="warn">處理中</Badge>;
  if (s === 'failed') return <Badge tone="danger">失敗</Badge>;
  if (s === 'missing') return <Badge tone="danger">檔案缺失</Badge>;
  if (s === 'applied') return filesExist ? <Badge tone="ok">已就緒</Badge> : <Badge tone="warn">處理中</Badge>;
  return <Badge tone="neutral">{status || '—'}</Badge>;
}

export function SslPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    items,
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
    clearResult,
  } = useSslCertificates();

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
      setEmail(`admin@${d}`);
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
    await requestCertificate(d, email.trim() || `admin@${d}`);
    setLeOpen(false);
    setDomain('');
    setEmail('');
  }

  return (
    <FeaturePageLayout
      title={t('nav.ssl', { defaultValue: 'SSL 憑證' })}
      actions={
        <div className="btn-row">
          <Button variant="secondary" size="md" onClick={() => setLeOpen(true)}>
            申請 Let’s Encrypt
          </Button>
          <Button variant="primary" size="md" onClick={() => setUploadOpen(true)}>
            + 上傳憑證
          </Button>
        </div>
      }
    >
      <SoftwareInstallBanner feature="ssl" title="Certbot 尚未安裝" />
      {error ? <Alert variant="error">{error}</Alert> : null}

      <OpsHero
        pill={`${items.length} 張`}
        pillTone={items.length ? 'ok' : 'warn'}
        tone={items.length ? 'ok' : 'warn'}
        cta={
          <>
            <Button variant="primary" size="md" onClick={() => setLeOpen(true)}>
              申請 Let’s Encrypt
            </Button>
            <Button variant="secondary" size="md" onClick={() => setUploadOpen(true)}>
              + 上傳憑證
            </Button>
            <Link to="/nginx" className="btn btn--ghost btn--md">
              Nginx
            </Link>
            <Link to="/dns" className="btn btn--ghost btn--md">
              DNS
            </Link>
          </>
        }
        stats={[
          { label: '憑證', value: items.length },
          {
            label: '有檔案',
            value: items.filter((c) => c.files_exist).length,
          },
          { label: '綁定', value: bindings.length },
          {
            label: '失敗',
            value: (
              <Badge
                tone={
                  items.some((c) => (c.status || '').toLowerCase() === 'failed')
                    ? 'danger'
                    : 'ok'
                }
              >
                {items.filter((c) => (c.status || '').toLowerCase() === 'failed').length}
              </Badge>
            ),
          },
        ]}
      />

      <ExecutionResultPanel
        message={msg}
        ok={ok}
        blocked={blocked}
        blockMessage={blockMessage}
        notes={notes}
        steps={steps}
        onRetry={blocked ? () => void retryLast() : undefined}
        onDismiss={clearResult}
        busy={busy}
      />

      {renewNotes.length || bindings.length ? (
        <Card>
          <CardSection title="綁定與續期">
            {renewNotes.map((n) => (
              <p key={n} className="muted u-text-sm">
                {n}
              </p>
            ))}
            {bindings.filter((b) => (b.projects?.length ?? 0) + (b.mailDomains?.length ?? 0) > 0)
              .length > 0 ? (
              <ul className="list-plain list-spaced u-mt-2">
                {bindings
                  .filter((b) => (b.projects?.length ?? 0) + (b.mailDomains?.length ?? 0) > 0)
                  .map((b) => (
                    <li key={b.domain}>
                      <strong>{b.domain}</strong>
                      {b.expires_at
                        ? ` · 到期 ${new Date(b.expires_at).toLocaleDateString()}`
                        : ''}
                      {b.projects?.length
                        ? ` · 專案: ${b.projects.map((p) => p.name).join(', ')}`
                        : ''}
                      {b.mailDomains?.length
                        ? ` · 郵件: ${b.mailDomains.map((m) => m.domain).join(', ')}`
                        : ''}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="muted u-text-sm">尚未偵測到專案／郵件綁定</p>
            )}
          </CardSection>
        </Card>
      ) : null}

      <Card>
        <CardSection title={`憑證 (${items.length})`}>
          <ResourceTable
            columns={[
              {
                key: 'domain',
                header: '域名',
                render: (r) => <strong>{r.domain}</strong>,
              },
              {
                key: 'provider',
                header: '來源',
                render: (r) =>
                  r.provider === 'letsencrypt'
                    ? 'Let’s Encrypt'
                    : r.provider === 'upload'
                      ? '上傳'
                      : r.provider,
              },
              {
                key: 'files',
                header: '本地檔案',
                render: (r) =>
                  r.files_exist ? <Badge tone="ok">有</Badge> : <Badge tone="neutral">無</Badge>,
              },
              {
                key: 'expires',
                header: '到期',
                render: (r) =>
                  r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—',
              },
              {
                key: 'status',
                header: '狀態',
                render: (r) => statusBadge(r.status, r.files_exist),
              },
            ]}
            rows={items}
            empty={
              <EmptyState
                title="尚未有憑證"
                description="用右上角「上傳憑證」或「申請 Let’s Encrypt」"
              />
            }
            rowActions={(r) => (
              <div className="btn-row">
                <Button variant="danger" size="sm" loading={busy} onClick={() => setDel(r)}>
                  刪除
                </Button>
              </div>
            )}
          />
        </CardSection>
      </Card>

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="上傳憑證"
        description="貼上 PEM 內容，由管理面板寫入伺服器"
        size="lg"
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setUploadOpen(false)}>
              取消
            </button>
            <button type="submit" form="ssl-up" className="btn btn--primary" disabled={busy}>
              儲存
            </button>
          </>
        }
      >
        <form id="ssl-up" onSubmit={(e) => void onUpload(e)}>
          <FormLayout>
            <Field
              label="域名"
              htmlFor="ud"
              flush
              required
              hint="憑證對應的主域名，例如 example.com"
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
              label="憑證鏈（fullchain）"
              htmlFor="uf"
              fullWidth
              flush
              required
              hint="含伺服器憑證與中繼 CA 的 PEM"
            >
              <textarea
                id="uf"
                rows={6}
                value={fullchain}
                onChange={(e) => setFullchain(e.target.value)}
                required
                placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
                spellCheck={false}
              />
            </Field>
            <Field
              label="私鑰（privkey）"
              htmlFor="up"
              fullWidth
              flush
              required
              hint="與憑證配對的私鑰 PEM，請妥善保管"
            >
              <textarea
                id="up"
                rows={5}
                value={privkey}
                onChange={(e) => setPrivkey(e.target.value)}
                required
                placeholder={'-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'}
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <FormHint>上傳成功只代表檔案已寫入；請到對應專案／郵件域名綁定後才會生效。</FormHint>
        </form>
      </Modal>

      <Modal
        open={leOpen}
        onClose={() => setLeOpen(false)}
        title="申請 Let’s Encrypt"
        description="由管理面板在伺服器上申請，無需手動執行 certbot"
        footer={
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setLeOpen(false)}>
              取消
            </button>
            <button type="submit" form="ssl-le" className="btn btn--primary" disabled={busy}>
              申請憑證
            </button>
          </>
        }
      >
        <form id="ssl-le" onSubmit={(e) => void onLe(e)}>
          <FormLayout columns={2}>
            <Field
              label="域名"
              htmlFor="ld"
              flush
              required
              hint="一般域名或 *.example.com 萬用字元"
            >
              <input
                id="ld"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                required
                placeholder="example.com 或 *.example.com"
                spellCheck={false}
              />
            </Field>
            <Field
              label="聯絡電郵"
              htmlFor="le"
              flush
              hint="Let’s Encrypt 到期通知用；可留空則用 admin@域名"
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
            <FormHint>
              萬用字元使用 dns-01：面板會啟動 certbot manual challenge，需於 DNS
              提供商完成 TXT 驗證。執行完成 ≠ 憑證已上線。
            </FormHint>
          ) : (
            <FormHint>
              一般域名使用 http-01（nginx 外掛）。申請成功後請確認專案／郵件已綁定此域名。
            </FormHint>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(del)}
        onClose={() => setDel(null)}
        onConfirm={() => {
          if (del) void remove(del.domain || del.id).then(() => setDel(null));
        }}
        title="刪除憑證？"
        description={`將刪除 ${del?.domain ?? ''} 的憑證檔與登記。`}
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
