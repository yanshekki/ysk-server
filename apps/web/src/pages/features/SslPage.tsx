import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  FormGrid,
  Modal,
  SoftwareInstallBanner,
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
      title="SSL 憑證"
      subtitle="在面板上傳或申請憑證"
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

      <Card>
        <CardSection title={`憑證 (${items.length})`}>
          <ResourceTable
            columns={[
              {
                key: 'domain',
                header: 'Domain',
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
                description="上傳 PEM 或在面板申請 Let’s Encrypt"
                action={
                  <Button variant="primary" size="md" onClick={() => setUploadOpen(true)}>
                    + 上傳憑證
                  </Button>
                }
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
        description="由管理面板寫入伺服器"
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
          <Field label="Domain" htmlFor="ud">
            <input id="ud" value={domain} onChange={(e) => setDomain(e.target.value)} required />
          </Field>
          <Field label="fullchain.pem" htmlFor="uf">
            <textarea
              id="uf"
              rows={5}
              value={fullchain}
              onChange={(e) => setFullchain(e.target.value)}
              required
            />
          </Field>
          <Field label="privkey.pem" htmlFor="up">
            <textarea
              id="up"
              rows={5}
              value={privkey}
              onChange={(e) => setPrivkey(e.target.value)}
              required
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={leOpen}
        onClose={() => setLeOpen(false)}
        title="申請 Let’s Encrypt"
        description="由管理面板在伺服器上申請，無需手動執行指令"
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
          <FormGrid>
            <Field label="Domain" htmlFor="ld">
              <input id="ld" value={domain} onChange={(e) => setDomain(e.target.value)} required />
            </Field>
            <Field label="Email" htmlFor="le">
              <input
                id="le"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </Field>
          </FormGrid>
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
