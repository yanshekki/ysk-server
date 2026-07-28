import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import {
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
  OpsHero,
  SoftwareInstallBanner,
  FormHint,
  CheckboxField,
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

      <OpsHero
        eyebrow="Nginx"
        title="站點與反向代理"
        pill={`${items.length} 站點`}
        pillTone={items.length ? 'ok' : 'warn'}
        tone={items.length ? 'ok' : 'warn'}
        hint="管理 conf 寫入 dataDir；套用／reload 成功才算對外生效。written ≠ 已上線。"
        cta={
          <>
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
            <Link to="/ssl" className="btn btn--secondary btn--md">
              SSL
            </Link>
            <Link to="/projects" className="btn btn--ghost btn--md">
              專案
            </Link>
          </>
        }
        stats={[
          { label: '站點', value: items.length },
          {
            label: 'Proxy',
            value: items.filter((r) => r.kind === 'proxy').length,
          },
          {
            label: 'Static/PHP',
            value: items.filter((r) => r.kind !== 'proxy').length,
          },
          {
            label: 'SSL 標記',
            value: items.filter((r) => r.ssl).length,
          },
        ]}
        rail={
          <li>
            <span className="ops-rail__k">Cache</span>
            <Badge tone="neutral">purge 可重載</Badge>
          </li>
        }
      />

      <Card>
        <CardSection title={`站點列表 (${items.length})`}>
          <ResourceTable
            columns={[
              {
                key: 'serverName',
                header: '伺服器名稱',
                render: (r) => <strong>{String(r.serverName ?? '—')}</strong>,
              },
              {
                key: 'kind',
                header: '類型',
                render: (r) => {
                  const k = String(r.kind ?? 'proxy');
                  if (k === 'proxy') return '反向代理';
                  if (k === 'static') return '靜態';
                  if (k === 'php') return 'PHP-FPM';
                  return k;
                },
              },
              {
                key: 'target',
                header: '上游／根目錄',
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
                description="用右上角「建立站點」新增；建立後請再按「套用」"
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
        description="建立控制面登記；需再「套用」才寫入 sites-available 並 reload"
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
        description="儲存後請再套用，written ≠ nginx 已 reload"
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
      <FormLayout columns={2}>
        <Field
          label="伺服器名稱"
          htmlFor="sn"
          flush
          required
          hint="server_name，例如 app.example.com"
        >
          <input
            id="sn"
            value={props.serverName}
            onChange={(e) => props.setServerName(e.target.value)}
            required
            placeholder="app.example.com"
            spellCheck={false}
          />
        </Field>
        <Field label="站點類型" htmlFor="kd" flush required>
          <select
            id="kd"
            value={props.kind}
            onChange={(e) => props.setKind(e.target.value as 'proxy' | 'static' | 'php')}
          >
            <option value="proxy">反向代理</option>
            <option value="static">靜態檔案</option>
            <option value="php">PHP-FPM</option>
          </select>
        </Field>
        {props.kind === 'proxy' ? (
          <Field
            label="上游位址"
            htmlFor="up"
            fullWidth
            flush
            hint="例如 127.0.0.1:3000 或 http://backend:8080"
          >
            <input
              id="up"
              value={props.upstream}
              onChange={(e) => props.setUpstream(e.target.value)}
              placeholder="127.0.0.1:3000"
              spellCheck={false}
            />
          </Field>
        ) : (
          <Field
            label="網站根目錄"
            htmlFor="rt"
            fullWidth
            flush
            hint={
              props.kind === 'php'
                ? 'PHP 專案 document root，例如 /var/www/app/public'
                : '靜態檔案目錄絕對路徑'
            }
          >
            <input
              id="rt"
              value={props.root}
              onChange={(e) => props.setRoot(e.target.value)}
              placeholder="/var/www/html"
              spellCheck={false}
            />
          </Field>
        )}
      </FormLayout>
      <div className="form-check-row u-mt-4">
        <CheckboxField
          id="ngx-ssl"
          label="啟用 SSL 區塊"
          description="產生 listen 443 ssl；憑證需於 SSL 頁就緒後綁定"
          checked={props.ssl}
          onChange={props.setSsl}
        />
      </div>
      <FormHint>
        建立／儲存只更新控制面；列表按「套用」後才寫入 nginx 設定並嘗試 reload。
      </FormHint>
    </div>
  );
}
