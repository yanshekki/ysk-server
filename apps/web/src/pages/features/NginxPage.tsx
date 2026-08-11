/**
 * Nginx — single table for project + standalone sites (SSOT).
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import {
  WithPageGuide,
  DataTable,
  ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  LogViewer,
  Modal,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  FormHint,
  CheckboxField,
  SegRadio,
  buttonClassName,
} from '../../shared/components/ui';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import { systemApi } from '../../features/system';
import {
  nginxHostingApi,
  type NginxAccessLog,
  type NginxBodySize,
  type NginxGlobalSettings,
  type NginxKeepalive,
  type NginxSiteRow,
} from '../../features/nginx/api';
import { bindSet } from '../bind-handlers';
import { notifyOk, notifyWarn } from '../../shared/lib/notify';

const BODY_OPTS: NginxBodySize[] = ['1m', '10m', '50m', '100m', '500m'];
const KA_OPTS: NginxKeepalive[] = ['15', '65', '120'];

export function NginxPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') ?? '';
  const {
    items: standalone,
    error: crudError,
    busy: crudBusy,
    create,
    update,
    remove,
    apply: applyStandalone,
  } = useResourceCrud('nginx/sites');

  const [sites, setSites] = useState<NginxSiteRow[]>([]);
  const [listErr, setListErr] = useState<string | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [q, setQ] = useState('');
  const [source, setSource] = useState<'all' | 'project' | 'standalone'>('all');
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<NginxSiteRow | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    path: string | null;
    content: string;
  } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [opsBusy, setOpsBusy] = useState(false);

  const [serverName, setServerName] = useState('');
  const [kind, setKind] = useState<'proxy' | 'static' | 'php'>('proxy');
  const [upstream, setUpstream] = useState('http://127.0.0.1:3000');
  const [root, setRoot] = useState('');
  const [ssl, setSsl] = useState(false);

  // Global settings
  const [globalOpen, setGlobalOpen] = useState(false);
  const [gGzip, setGGzip] = useState(true);
  const [gTokens, setGTokens] = useState(false);
  const [gBody, setGBody] = useState<NginxBodySize>('10m');
  const [gKa, setGKa] = useState<NginxKeepalive>('65');
  const [gHttp2, setGHttp2] = useState(true);
  const [gLog, setGLog] = useState<NginxAccessLog>('on');

  // Site settings
  const [siteCfg, setSiteCfg] = useState<NginxSiteRow | null>(null);
  const [sSsl, setSSsl] = useState(false);
  const [sForce, setSForce] = useState(false);
  const [sHsts, setSHsts] = useState(false);
  const [sBody, setSBody] = useState<NginxBodySize | 'inherit'>('inherit');
  const [sCf, setSCf] = useState(false);
  const [sIdx, setSIdx] = useState(false);

  const refresh = useCallback(async () => {
    setListBusy(true);
    setListErr(null);
    try {
      const r = await nginxHostingApi.listSites({
        q: q.trim() || undefined,
        source: source === 'all' ? undefined : source,
        projectId: projectFilter || undefined,
      });
      setSites(r.items ?? []);
    } catch (e) {
      setListErr(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setListBusy(false);
    }
  }, [q, source, projectFilter, t]);

  useEffect(() => {
    void refresh();
  }, [refresh, standalone.length]);

  const busy = crudBusy || opsBusy || listBusy;

  const openCreate = () => {
    setServerName('');
    setKind('proxy');
    setUpstream('http://127.0.0.1:3000');
    setRoot('');
    setSsl(false);
    setCreateOpen(true);
  };

  const openEditStandalone = (row: NginxSiteRow) => {
    if (row.source !== 'standalone') return;
    setEdit(row);
    setServerName(row.serverName === '—' ? '' : row.serverName);
    setKind(row.kind);
    setUpstream(row.kind === 'proxy' ? row.target : 'http://127.0.0.1:3000');
    setRoot(row.kind !== 'proxy' ? row.target : '');
    setSsl(row.ssl);
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    await create({
      serverName: serverName.trim(),
      kind,
      upstream: kind === 'proxy' ? upstream : undefined,
      root: kind !== 'proxy' ? root : undefined,
      ssl,
    });
    setCreateOpen(false);
    await refresh();
  };

  const onEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit || edit.source !== 'standalone') return;
    await update(edit.id, {
      serverName: serverName.trim(),
      kind,
      upstream: kind === 'proxy' ? upstream : undefined,
      root: kind !== 'proxy' ? root : undefined,
      ssl,
    });
    setEdit(null);
    await refresh();
  };

  const onApply = async (row: NginxSiteRow) => {
    setOpsBusy(true);
    try {
      if (row.source === 'project') {
        const r = await nginxHostingApi.applySite(row.id, { ssl: row.ssl });
        if (r.ok) notifyOk(String((r.notes as string[] | undefined)?.[0] ?? t('common.completed')));
        else notifyWarn(String((r.notes as string[] | undefined)?.[0] ?? t('common.opFailed')));
      } else {
        await applyStandalone(row.id);
      }
      await refresh();
    } catch (err) {
      notifyWarn(err instanceof Error ? err.message : t('common.opFailed'));
    } finally {
      setOpsBusy(false);
    }
  };

  const onPreview = async (row: NginxSiteRow) => {
    setPreviewBusy(true);
    try {
      const r = await nginxHostingApi.siteConf(row.id);
      setPreview({
        title: row.serverName,
        path: r.path,
        content: r.content || t('nginx.projectConfEmpty'),
      });
    } catch (e) {
      setListErr(e instanceof Error ? e.message : t('nginx.projectConfReadFail'));
    } finally {
      setPreviewBusy(false);
    }
  };

  const kindLabel = (k: string) => {
    if (k === 'proxy') return t('nginx.kindProxy');
    if (k === 'static') return t('nginx.kindStatic');
    if (k === 'php') return t('nginx.kindPhp');
    return k;
  };

  const filteredHint = useMemo(() => {
    if (projectFilter) return t('nginx.filterProject');
    return null;
  }, [projectFilter, t]);

  const openGlobal = async () => {
    try {
      const r = await nginxHostingApi.getSettings();
      const s = r.settings;
      setGGzip(s.gzip);
      setGTokens(s.serverTokens);
      setGBody(s.clientMaxBody);
      setGKa(s.keepalive);
      setGHttp2(s.http2);
      setGLog(s.accessLog);
      setGlobalOpen(true);
    } catch (e) {
      notifyWarn(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  };

  const openSiteSettings = (row: NginxSiteRow) => {
    setSiteCfg(row);
    setSSsl(row.ssl);
    setSForce(Boolean(row.forceHttps));
    setSHsts(Boolean(row.hsts));
    setSBody('inherit');
    setSCf(false);
    setSIdx(false);
  };

  const saveGlobal = async (apply: boolean) => {
    setOpsBusy(true);
    try {
      const body: Partial<NginxGlobalSettings> = {
        gzip: gGzip,
        serverTokens: gTokens,
        clientMaxBody: gBody,
        keepalive: gKa,
        http2: gHttp2,
        accessLog: gLog,
      };
      if (apply) {
        const r = await nginxHostingApi.applySettings(body);
        if (r.ok) notifyOk(String((r.notes as string[] | undefined)?.[0] ?? t('common.completed')));
        else notifyWarn(String((r.notes as string[] | undefined)?.[0] ?? t('common.opFailed')));
      } else {
        await nginxHostingApi.patchSettings(body);
        notifyOk(t('nginx.settingsSaved'));
      }
      setGlobalOpen(false);
    } catch (e) {
      notifyWarn(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setOpsBusy(false);
    }
  };

  const saveSiteSettings = async () => {
    if (!siteCfg) return;
    setOpsBusy(true);
    try {
      const r = await nginxHostingApi.patchSiteSettings(siteCfg.id, {
        ssl: sSsl,
        forceHttps: sForce,
        hsts: sHsts,
        clientMaxBody: sBody,
        cloudflareRealIp: sCf,
        indexes: sIdx,
      });
      if (r.ok !== false)
        notifyOk(String((r.notes as string[] | undefined)?.[0] ?? t('common.completed')));
      else notifyWarn(String((r.notes as string[] | undefined)?.[0] ?? t('common.opFailed')));
      setSiteCfg(null);
      await refresh();
    } catch (e) {
      notifyWarn(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setOpsBusy(false);
    }
  };

  return (
    <FeaturePageLayout
      title={t('nav.nginx')}
      subtitle={t('nginx.pageDesc')}
      status={{
        pill: {
          label: t('nginx.pillSites', { count: sites.length }),
          tone: sites.length ? 'ok' : 'warn',
        },
      }}
      actions={
        <ActionBar>
          <Button variant="secondary" size="sm" loading={listBusy} onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void openGlobal()}>
            {t('nginx.globalSettings')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={purgeBusy}
            onClick={() => {
              setPurgeBusy(true);
              void systemApi
                .nginxPurgeCache()
                .then((r) => {
                  const notes = (r as { notes?: string[] }).notes;
                  notifyOk(notes?.[0] ?? t('nginx.purgeOk'));
                })
                .catch((e: Error) => notifyWarn(e.message))
                .finally(() => setPurgeBusy(false));
            }}
          >
            {t('nginx.purgeCache')}
          </Button>
          <Button variant="primary" size="sm" onClick={openCreate}>
            {t('nginx.createSite')}
          </Button>
        </ActionBar>
      }
    >
      <WithPageGuide
        guideId="nginx"
        stackContent={
          <>
            <SoftwareInstallBanner feature="nginx" title={t('nginx.notInstalled')} showReadyActions={false} />
            <SoftwareVersionBar softwareId="nginx" />
          </>
        }
      >
        {crudError ? <Alert variant="error">{crudError}</Alert> : null}
        {listErr ? <Alert variant="error">{listErr}</Alert> : null}
        {filteredHint ? <Alert variant="info">{filteredHint}</Alert> : null}

        <div className="u-flex-gap u-flex-wrap u-mb-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('common.search')}
            className="u-input"
            style={{ maxWidth: 220 }}
          />
          <SegRadio
            name="ngx-src"
            aria-label={t('nginx.filterSource')}
            value={source}
            onChange={(v) => setSource(v as 'all' | 'project' | 'standalone')}
            options={[
              { value: 'all', label: t('nginx.sourceAll') },
              { value: 'project', label: t('nginx.sourceProject') },
              { value: 'standalone', label: t('nginx.sourceStandalone') },
            ]}
          />
        </div>

        <DataTable
          rowKey={(r) => r.id}
          title={t('nginx.listTitle', { count: sites.length })}
          columns={[
            {
              key: 'server',
              header: t('nginx.colServerName'),
              render: (r) => <code className="inline">{r.serverName}</code>,
            },
            {
              key: 'source',
              header: t('nginx.colSource'),
              nowrap: true,
              render: (r) =>
                r.source === 'project' ? (
                  <Link
                    to={`/projects/${r.projectId}`}
                    className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                  >
                    {r.projectName ?? t('nginx.sourceProject')}
                  </Link>
                ) : (
                  <Badge tone="neutral">{t('nginx.sourceStandalone')}</Badge>
                ),
            },
            {
              key: 'kind',
              header: t('nginx.colKind'),
              render: (r) => kindLabel(r.kind),
            },
            {
              key: 'target',
              header: t('nginx.colTarget'),
              render: (r) => <code className="inline">{r.target}</code>,
            },
            {
              key: 'ssl',
              header: 'SSL',
              nowrap: true,
              render: (r) =>
                r.ssl ? <Badge tone="ok">SSL</Badge> : <span className="muted">—</span>,
            },
            {
              key: 'status',
              header: t('nginx.colStatus'),
              nowrap: true,
              render: (r) => (
                <Badge tone={r.confPath || r.apply_status === 'applied' ? 'ok' : 'warn'}>
                  {r.apply_status || (r.confPath ? 'written' : 'draft')}
                </Badge>
              ),
            },
          ]}
          rows={sites}
          empty={<EmptyState title={t('nginx.emptyTitle')} />}
          rowActions={(r) => (
            <ActionBar>
              <Button
                variant="primary"
                size="sm"
                loading={busy}
                onClick={() => void onApply(r)}
              >
                {t('nginx.applyToSystem')}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => openSiteSettings(r)}>
                {t('nginx.siteSettings')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={previewBusy}
                onClick={() => void onPreview(r)}
              >
                {t('nginx.preview')}
              </Button>
              {r.source === 'standalone' ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditStandalone(r)}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy}
                    onClick={() => setDelId(r.id)}
                  >
                    {t('common.delete')}
                  </Button>
                </>
              ) : (
                <Link
                  to={`/projects/${r.projectId}?tab=network`}
                  className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                >
                  {t('nginx.openProject')}
                </Link>
              )}
            </ActionBar>
          )}
        />

        <Modal
          open={Boolean(preview)}
          onClose={() => setPreview(null)}
          title={preview?.title ?? t('nginx.preview')}
          description={preview?.path ?? undefined}
          size="xl"
          footer={
            <Button variant="secondary" size="md" onClick={() => setPreview(null)}>
              {t('common.close')}
            </Button>
          }
        >
          <LogViewer text={preview?.content ?? ''} maxHeight={420} />
        </Modal>

        <Modal
          open={createOpen}
          onClose={bindSet(setCreateOpen, false)}
          title={t('nginx.createTitle')}
          footer={
            <>
              <Button variant="secondary" size="md" onClick={bindSet(setCreateOpen, false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="ngx-create" variant="primary" size="md" loading={busy}>
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
          footer={
            <>
              <Button variant="secondary" size="md" onClick={bindSet(setEdit, null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" form="ngx-edit" variant="primary" size="md" loading={busy}>
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
            if (delId)
              void remove(delId).then(() => {
                setDelId(null);
                void refresh();
              });
          }}
          title={t('nginx.deleteTitle')}
          description={t('nginx.deleteDesc')}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          busy={busy}
        />

        <Modal
          open={globalOpen}
          onClose={() => !opsBusy && setGlobalOpen(false)}
          title={t('nginx.globalSettings')}
          footer={
            <>
              <Button variant="secondary" size="md" disabled={opsBusy} onClick={() => setGlobalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="secondary" size="md" loading={opsBusy} onClick={() => void saveGlobal(false)}>
                {t('common.save')}
              </Button>
              <Button variant="primary" size="md" loading={opsBusy} onClick={() => void saveGlobal(true)}>
                {t('nginx.saveApply')}
              </Button>
            </>
          }
        >
          <div className="stack">
            <CheckboxField id="g-gzip" label={t('nginx.setGzip')} checked={gGzip} onChange={setGGzip} />
            <CheckboxField
              id="g-tok"
              label={t('nginx.setShowVersion')}
              description={t('nginx.setShowVersionDesc')}
              checked={gTokens}
              onChange={setGTokens}
            />
            <CheckboxField id="g-h2" label={t('nginx.setHttp2')} checked={gHttp2} onChange={setGHttp2} />
            <Field label={t('nginx.setBody')} htmlFor="g-body" flush>
              <SegRadio
                name="g-body"
                aria-label={t('nginx.setBody')}
                value={gBody}
                onChange={(v) => setGBody(v as NginxBodySize)}
                options={BODY_OPTS.map((v) => ({ value: v, label: v }))}
              />
            </Field>
            <Field label={t('nginx.setKeepalive')} htmlFor="g-ka" flush>
              <SegRadio
                name="g-ka"
                aria-label={t('nginx.setKeepalive')}
                value={gKa}
                onChange={(v) => setGKa(v as NginxKeepalive)}
                options={KA_OPTS.map((v) => ({ value: v, label: `${v}s` }))}
              />
            </Field>
            <Field label={t('nginx.setAccessLog')} htmlFor="g-log" flush>
              <SegRadio
                name="g-log"
                aria-label={t('nginx.setAccessLog')}
                value={gLog}
                onChange={(v) => setGLog(v as NginxAccessLog)}
                options={[
                  { value: 'on', label: t('nginx.logOn') },
                  { value: 'buffered', label: t('nginx.logBuffered') },
                  { value: 'off', label: t('nginx.logOff') },
                ]}
              />
            </Field>
          </div>
        </Modal>

        <Modal
          open={Boolean(siteCfg)}
          onClose={() => !opsBusy && setSiteCfg(null)}
          title={t('nginx.siteSettings')}
          description={siteCfg?.serverName}
          footer={
            <>
              <Button variant="secondary" size="md" disabled={opsBusy} onClick={() => setSiteCfg(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="md" loading={opsBusy} onClick={() => void saveSiteSettings()}>
                {t('nginx.saveApply')}
              </Button>
            </>
          }
        >
          <div className="stack">
            <CheckboxField id="s-ssl" label={t('nginx.sslLabel')} checked={sSsl} onChange={setSSsl} />
            <CheckboxField
              id="s-force"
              label={t('nginx.setForceHttps')}
              checked={sForce}
              onChange={setSForce}
              disabled={!sSsl}
            />
            <CheckboxField
              id="s-hsts"
              label={t('nginx.setHsts')}
              checked={sHsts}
              onChange={setSHsts}
              disabled={!sSsl}
            />
            {siteCfg?.kind === 'proxy' ? (
              <CheckboxField id="s-cf" label={t('nginx.setCfRealIp')} checked={sCf} onChange={setSCf} />
            ) : null}
            {siteCfg?.kind === 'static' ? (
              <CheckboxField id="s-idx" label={t('nginx.setIndexes')} checked={sIdx} onChange={setSIdx} />
            ) : null}
            <Field label={t('nginx.setBody')} htmlFor="s-body" flush>
              <SegRadio
                name="s-body"
                aria-label={t('nginx.setBody')}
                value={sBody}
                onChange={(v) => setSBody(v as NginxBodySize | 'inherit')}
                options={[
                  { value: 'inherit', label: t('nginx.bodyInherit') },
                  ...BODY_OPTS.map((v) => ({ value: v, label: v })),
                ]}
              />
            </Field>
          </div>
        </Modal>
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
        <Field label={t('nginx.colServerName')} htmlFor="sn" flush required>
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
          <Field label={t('nginx.upstreamLabel')} htmlFor="up" fullWidth flush>
            <input
              id="up"
              value={props.upstream}
              onChange={(e) => props.setUpstream(e.target.value)}
              placeholder="127.0.0.1:3000"
              spellCheck={false}
            />
          </Field>
        ) : (
          <Field label={t('nginx.rootLabel')} htmlFor="rt" fullWidth flush>
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
          checked={props.ssl}
          onChange={props.setSsl}
        />
      </div>
      <FormHint>{t('nginx.saveThenApply')}</FormHint>
    </div>
  );
}
