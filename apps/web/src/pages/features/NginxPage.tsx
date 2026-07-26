import { FormEvent, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormGrid,
  Modal,
  SoftwareInstallBanner,
} from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { ResourceTable } from '../../shared/components/resource/ResourceTable';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import type { ResourceRow } from '../../features/resources/api';
import { systemApi } from '../../features/system';

export function NginxPage() {
  const { items, error, busy, msg, setMsg, create, update, remove, apply } =
    useResourceCrud('nginx/sites');
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [purgeMsg, setPurgeMsg] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<ResourceRow | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [serverName, setServerName] = useState('');
  const [kind, setKind] = useState<'proxy' | 'static' | 'php'>('proxy');
  const [upstream, setUpstream] = useState('http://127.0.0.1:3000');
  const [root, setRoot] = useState('');
  const [ssl, setSsl] = useState(false);

  function resetForm() {
    setServerName('');
    setKind('proxy');
    setUpstream('http://127.0.0.1:3000');
    setRoot('');
    setSsl(false);
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await create({
      serverName,
      kind,
      upstream: kind === 'proxy' ? upstream : undefined,
      root: kind !== 'proxy' ? root || undefined : undefined,
      ssl,
    });
    setCreateOpen(false);
    resetForm();
  }

  async function onEdit(e: FormEvent) {
    e.preventDefault();
    if (!edit) return;
    await update(edit.id, {
      serverName,
      kind,
      upstream: kind === 'proxy' ? upstream : undefined,
      root: kind !== 'proxy' ? root || undefined : undefined,
      ssl,
    });
    setEdit(null);
    resetForm();
  }

  function openEdit(row: ResourceRow) {
    setEdit(row);
    setServerName(String(row.serverName ?? ''));
    setKind((row.kind as 'proxy' | 'static' | 'php') || 'proxy');
    setUpstream(String(row.upstream ?? 'http://127.0.0.1:3000'));
    setRoot(String(row.root ?? ''));
    setSsl(Boolean(row.ssl));
  }

  return (
    <FeaturePageLayout
      title="Nginx 站點"
      subtitle="管理反向代理與網站站點"
      actions={
        <div className="btn-row">
          <Button
            variant="secondary"
            size="md"
            loading={purgeBusy}
            onClick={() => {
              setPurgeBusy(true);
              setPurgeMsg(null);
              void systemApi
                .nginxPurgeCache()
                .then((r) => {
                  const notes = (r as { notes?: string[] }).notes;
                  setPurgeMsg(notes?.[0] ?? '已 purge');
                })
                .catch((e: Error) => setPurgeMsg(e.message))
                .finally(() => setPurgeBusy(false));
            }}
          >
            清除 Cache + Reload
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => {
              resetForm();
              setCreateOpen(true);
            }}
          >
            + 建立站點
          </Button>
        </div>
      }
    >
      <SoftwareInstallBanner feature="nginx" title="Nginx 尚未安裝" />
      {error ? <Alert variant="error">{error}</Alert> : null}
      {purgeMsg ? <Alert variant="info">{purgeMsg}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <Card>
        <CardSection title={`站點列表 (${items.length})`}>
          <ResourceTable
            columns={[
              {
                key: 'serverName',
                header: 'Server name',
                render: (r) => <strong>{String(r.serverName ?? '—')}</strong>,
              },
              {
                key: 'kind',
                header: '類型',
                render: (r) => String(r.kind ?? 'proxy'),
              },
              {
                key: 'target',
                header: 'Upstream / Root',
                render: (r) => (
                  <code className="inline u-break-all">
                    {String(r.upstream ?? r.root ?? '—')}
                  </code>
                ),
              },
              {
                key: 'ssl',
                header: 'SSL',
                render: (r) => (r.ssl ? '是' : '否'),
              },
              {
                key: 'status',
                header: '狀態',
                render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
              },
            ]}
            rows={items}
            empty={
              <EmptyState
                title="尚未有 Nginx 站點"
                description="尚未有站點"
                action={
                  <Button variant="primary" size="md" onClick={() => { resetForm(); setCreateOpen(true); }}>
                    + 建立站點
                  </Button>
                }
              />
            }
            rowActions={(r) => (
              <div className="btn-row">
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => void apply(r.id)}
                  title="寫入管理檔並嘗試同步到系統 + nginx -t + reload"
                >
                  同步到系統
                </Button>
                <Button variant="secondary" size="sm" loading={busy} onClick={() => openEdit(r)}>
                  編輯
                </Button>
                <Button variant="danger" size="sm" loading={busy} onClick={() => setDelId(r.id)}>
                  刪除
                </Button>
              </div>
            )}
          />
        </CardSection>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="建立 Nginx 站點"
        description="填寫站點參數後建立"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="ngx-create" variant="primary" size="md" loading={busy}>
              建立
            </Button>
          </>
        }
      >
        <form id="ngx-create" onSubmit={(e) => void onCreate(e)}>
          <SiteForm
            serverName={serverName}
            setServerName={setServerName}
            kind={kind}
            setKind={setKind}
            upstream={upstream}
            setUpstream={setUpstream}
            root={root}
            setRoot={setRoot}
            ssl={ssl}
            setSsl={setSsl}
          />
        </form>
      </Modal>

      <Modal
        open={Boolean(edit)}
        onClose={() => setEdit(null)}
        title="編輯 Nginx 站點"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setEdit(null)}>
              取消
            </Button>
            <Button type="submit" form="ngx-edit" variant="primary" size="md" loading={busy}>
              儲存
            </Button>
          </>
        }
      >
        <form id="ngx-edit" onSubmit={(e) => void onEdit(e)}>
          <SiteForm
            serverName={serverName}
            setServerName={setServerName}
            kind={kind}
            setKind={setKind}
            upstream={upstream}
            setUpstream={setUpstream}
            root={root}
            setRoot={setRoot}
            ssl={ssl}
            setSsl={setSsl}
          />
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(delId)}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId) void remove(delId).then(() => setDelId(null));
        }}
        title="刪除站點？"
        description="確定刪除此站點？"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}

function SiteForm(props: {
  serverName: string;
  setServerName: (v: string) => void;
  kind: 'proxy' | 'static' | 'php';
  setKind: (v: 'proxy' | 'static' | 'php') => void;
  upstream: string;
  setUpstream: (v: string) => void;
  root: string;
  setRoot: (v: string) => void;
  ssl: boolean;
  setSsl: (v: boolean) => void;
}) {
  return (
    <div className="feature-form">
      <FormGrid>
        <Field label="伺服器名稱" techKey="server_name" htmlFor="sn">
          <input
            id="sn"
            value={props.serverName}
            onChange={(e) => props.setServerName(e.target.value)}
            required
            placeholder="app.example.com"
          />
        </Field>
        <Field label="類型" techKey="kind" htmlFor="kd">
          <select
            id="kd"
            value={props.kind}
            onChange={(e) => props.setKind(e.target.value as 'proxy' | 'static' | 'php')}
          >
            <option value="proxy">反向代理</option>
            <option value="static">靜態</option>
            <option value="php">PHP-FPM</option>
          </select>
        </Field>
      </FormGrid>
      {props.kind === 'proxy' ? (
        <Field label="上游位址" techKey="upstream" htmlFor="up">
          <input
            id="up"
            value={props.upstream}
            onChange={(e) => props.setUpstream(e.target.value)}
          />
        </Field>
      ) : (
        <Field label="網站根目錄" techKey="root" htmlFor="rt">
          <input id="rt" value={props.root} onChange={(e) => props.setRoot(e.target.value)} />
        </Field>
      )}
      <label className="field">
        <span>
          <input
            type="checkbox"
            checked={props.ssl}
            onChange={(e) => props.setSsl(e.target.checked)}
          />{' '}
          啟用 SSL block
        </span>
      </label>
    </div>
  );
}
