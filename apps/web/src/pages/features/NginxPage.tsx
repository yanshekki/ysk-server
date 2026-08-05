import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  WithPageGuide,
  DataTable,
  ActionBar,
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  ServerListFilters,
  SoftwareInstallBanner,
  FormHint,
  CheckboxField,
  SegRadio,
  buttonClassName,
} from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import type { ResourceRow } from '../../features/resources/api';
import { systemApi } from '../../features/system';
import { bindSet, bindCall1 } from '../bind-handlers';

export function NginxPage() {
  const { t } = useTranslation();
  const {
    items,
    error,
    busy,
    msg,
    setMsg,
    create,
    update,
    remove,
    apply,
    q,
    setQ,
    searching,
    listLoading,
    total,
    activeFilterCount,
    clearSearch,
  } = useResourceCrud('nginx/sites');
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

  function kindLabel(k: string): string {
    if (k === 'proxy') return t('nginx.kindProxy');
    if (k === 'static') return t('nginx.kindStatic');
    if (k === 'php') return t('nginx.kindPhp');
    return k;
  }

  return (
    <FeaturePageLayout
      title={t('nav.nginx')}
      status={{
        pill: {
          label: t('nginx.pillSites', { count: items.length }),
          tone: items.length ? 'ok' : 'warn',
        },
        items: [
          { label: t('nginx.statSites'), value: items.length },
          {
            label: t('nginx.kindProxy'),
            value: items.filter((r) => r.kind === 'proxy').length,
          },
          {
            label: 'Static/PHP',
            value: items.filter((r) => r.kind !== 'proxy').length,
          },
          {
            label: t('nginx.statSslFlag'),
            value: items.filter((r) => r.ssl).length,
          },
        ],
      }}
      actions={
        <ActionBar>
          <Button
            variant="secondary"
            size="sm"
            loading={purgeBusy}
            onClick={() => {
              setPurgeBusy(true);
              setPurgeMsg(null);
              void systemApi
                .nginxPurgeCache()
                .then((r) => {
                  const notes = (r as { notes?: string[] }).notes;
                  setPurgeMsg(notes?.[0] ?? t('nginx.purgeOk'));
                })
                .catch((e: Error) => setPurgeMsg(e.message))
                .finally(() => setPurgeBusy(false));
            }}
          >
            {t('nginx.purgeCache')}
          </Button>

          <Link to="/ssl" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
            SSL
          </Link>
        </ActionBar>
      }
    >
      <WithPageGuide guideId="nginx">
        <SoftwareInstallBanner feature="nginx" title={t('nginx.notInstalled')} />
        {error ? <Alert variant="error">{error}</Alert> : null}
        {purgeMsg ? <Alert variant="info">{purgeMsg}</Alert> : null}
        <DataTable
          rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
          title={t('nginx.listTitle', { count: total })}
          description={t('nginx.listDesc')}
          toolbar={
            <ActionBar>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  resetForm();
                  setCreateOpen(true);
                }}
              >
                {t('nginx.createSite')}
              </Button>
            </ActionBar>
          }
          filters={
            <ServerListFilters
              q={q}
              setQ={setQ}
              searching={searching}
              loading={listLoading}
              total={total}
              shown={items.length}
              activeFilterCount={activeFilterCount}
              clear={clearSearch}
            />
          }
          columns={[
            {
              key: 'serverName',
              header: t('nginx.colServerName'),
              render: (r) => <strong>{String(r.serverName ?? '—')}</strong>,
            },
            {
              key: 'kind',
              header: t('nginx.colKind'),
              render: (r) => kindLabel(String(r.kind ?? 'proxy')),
            },
            {
              key: 'target',
              header: t('nginx.colTarget'),
              render: (r) => (
                <code className="inline u-break-all">
                  {String(r.upstream ?? r.root ?? '—')}
                </code>
              ),
            },
            {
              key: 'ssl',
              header: 'SSL',
              render: (r) => (r.ssl ? t('common.yes') : t('common.no')),
            },
            {
              key: 'status',
              header: t('nginx.colStatus'),
              render: (r) => (
                <ResourceStatusBadge status={String(r.apply_status)} />
              ),
            },
          ]}
          rows={items}
          empty={
            <EmptyState
              title={t('nginx.emptyTitle')}
              description={t('nginx.emptyDesc')}
            />
          }
          rowActions={(r) => (
            <ActionBar>
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={bindCall1(apply, r.id)}
                title={t('nginx.applyTitle')}
              >
                {t('nginx.applyToSystem')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                onClick={bindCall1(openEdit, r)}
              >
                {t('common.edit')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={busy}
                onClick={bindSet(setDelId, r.id)}
              >
                {t('common.delete')}
              </Button>
            </ActionBar>
          )}
        />

        <Modal
          open={createOpen}
          onClose={bindSet(setCreateOpen, false)}
          title={t('nginx.createTitle')}
          description={t('nginx.createDesc')}
          footer={
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={bindSet(setCreateOpen, false)}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form="ngx-create"
                variant="primary"
                size="md"
                loading={busy}
              >
                {t('common.create')}
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
          onClose={bindSet(setEdit, null)}
          title={t('nginx.editTitle')}
          description={t('nginx.editDesc')}
          footer={
            <>
              <Button variant="secondary" size="md" onClick={bindSet(setEdit, null)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form="ngx-edit"
                variant="primary"
                size="md"
                loading={busy}
              >
                {t('common.save')}
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
          onClose={bindSet(setDelId, null)}
          onConfirm={() => {
            if (delId) void remove(delId).then(() => setDelId(null));
          }}
          title={t('nginx.deleteTitle')}
          description={t('nginx.deleteDesc')}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          busy={busy}
        />
      </WithPageGuide>
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
  const { t } = useTranslation();
  return (
    <div className="feature-form">
      <FormLayout columns={2}>
        <Field
          label={t('nginx.colServerName')}
          htmlFor="sn"
          flush
          required
          hint={t('nginx.serverNameHint')}
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
        <Field label={t('nginx.kindLabel')} htmlFor="kd" flush required>
          <SegRadio
            name="kd"
            aria-label={t('nginx.kindLabel')}
            value={props.kind}
            onChange={(v) => props.setKind(v as 'proxy' | 'static' | 'php')}
            options={[
              { value: 'proxy', label: t('nginx.kindProxy') },
              { value: 'static', label: t('nginx.kindStatic') },
              { value: 'php', label: t('nginx.kindPhp') },
            ]}
          />
        </Field>
        {props.kind === 'proxy' ? (
          <Field
            label={t('nginx.upstreamLabel')}
            htmlFor="up"
            fullWidth
            flush
            hint={t('nginx.upstreamHint')}
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
            label={t('nginx.rootLabel')}
            htmlFor="rt"
            fullWidth
            flush
            hint={
              props.kind === 'php' ? t('nginx.rootHintPhp') : t('nginx.rootHintStatic')
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
          label={t('nginx.sslLabel')}
          description={t('nginx.sslDesc')}
          checked={props.ssl}
          onChange={props.setSsl}
        />
      </div>
      <FormHint>{t('nginx.saveThenApply')}</FormHint>
    </div>
  );
}
