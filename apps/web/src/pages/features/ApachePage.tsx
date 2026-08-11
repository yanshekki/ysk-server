/**
 * Apache — sites + global/site settings (mirrors Nginx page, concise).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
  Modal,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  CheckboxField,
  SegRadio,
  buttonClassName,
} from '../../shared/components/ui';
import {
  apacheApi,
  type ApacheBodySize,
  type ApacheGlobalSettings,
  type ApacheSite,
  type ApacheSiteKind,
  type ApacheSiteSource,
} from '../../features/apache/api';
import { notifyOk, notifyWarn } from '../../shared/lib/notify';

const BODY_OPTS: ApacheBodySize[] = ['1m', '10m', '50m', '100m', '500m'];

function isStandalone(s: ApacheSite): boolean {
  return !s.source || s.source === 'standalone';
}

export function ApachePage() {
  const { t } = useTranslation();
  const [sites, setSites] = useState<ApacheSite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [source, setSource] = useState<'all' | ApacheSiteSource>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<ApacheSite | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [serverName, setServerName] = useState('');
  const [kind, setKind] = useState<ApacheSiteKind>('proxy');
  const [upstream, setUpstream] = useState('http://127.0.0.1:3000');
  const [root, setRoot] = useState('');
  const [ssl, setSsl] = useState(false);

  const [globalOpen, setGlobalOpen] = useState(false);
  const [gGzip, setGGzip] = useState(true);
  const [gTokens, setGTokens] = useState(false);
  const [gBody, setGBody] = useState<ApacheBodySize>('10m');
  const [gKa, setGKa] = useState<'15' | '65' | '120'>('65');
  const [gHttp2, setGHttp2] = useState(true);
  const [gLog, setGLog] = useState<'off' | 'on'>('on');

  const [siteCfg, setSiteCfg] = useState<ApacheSite | null>(null);
  const [sSsl, setSSsl] = useState(false);
  const [sForce, setSForce] = useState(false);
  const [sHsts, setSHsts] = useState(false);
  const [sBody, setSBody] = useState<ApacheBodySize | 'inherit'>('inherit');
  const [sIdx, setSIdx] = useState(false);
  const [artifactDelId, setArtifactDelId] = useState<string | null>(null);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [preview, setPreview] = useState<{
    title: string;
    path: string | null;
    content: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const r = await apacheApi.listSites({
        q: q.trim() || undefined,
        source: source === 'all' ? undefined : source,
      });
      setSites(r.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t, q, source]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCreate = () => {
    setServerName('');
    setKind('proxy');
    setUpstream('http://127.0.0.1:3000');
    setRoot('');
    setSsl(false);
    setCreateOpen(true);
  };

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await apacheApi.createSite({
        serverName: serverName.trim(),
        kind,
        upstream: kind === 'proxy' ? upstream : undefined,
        root: kind !== 'proxy' ? root : undefined,
        ssl,
      });
      notifyOk(t('common.completed'));
      setCreateOpen(false);
      await refresh();
    } catch (err) {
      notifyWarn(err instanceof Error ? err.message : t('common.createFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    try {
      await apacheApi.updateSite(edit.id, {
        serverName: serverName.trim(),
        kind,
        upstream: kind === 'proxy' ? upstream : undefined,
        root: kind !== 'proxy' ? root : undefined,
        ssl,
      });
      notifyOk(t('common.completed'));
      setEdit(null);
      await refresh();
    } catch (err) {
      notifyWarn(err instanceof Error ? err.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onApply = async (id: string) => {
    setBusy(true);
    try {
      const r = await apacheApi.applySite(id);
      if (r.ok) notifyOk(String((r.notes as string[] | undefined)?.[0] ?? t('common.completed')));
      else notifyWarn(String((r.notes as string[] | undefined)?.[0] ?? t('common.opFailed')));
      await refresh();
    } catch (err) {
      notifyWarn(err instanceof Error ? err.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  };

  const openGlobal = async () => {
    try {
      const r = await apacheApi.getSettings();
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

  const saveGlobal = async (apply: boolean) => {
    setBusy(true);
    try {
      const body: Partial<ApacheGlobalSettings> = {
        gzip: gGzip,
        serverTokens: gTokens,
        clientMaxBody: gBody,
        keepalive: gKa,
        http2: gHttp2,
        accessLog: gLog,
      };
      if (apply) {
        const r = await apacheApi.applySettings(body);
        if (r.ok) notifyOk(String((r.notes as string[] | undefined)?.[0] ?? t('common.completed')));
        else notifyWarn(String((r.notes as string[] | undefined)?.[0] ?? t('common.opFailed')));
      } else {
        await apacheApi.patchSettings(body);
        notifyOk(t('apache.settingsSaved'));
      }
      setGlobalOpen(false);
    } catch (e) {
      notifyWarn(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  };

  const openSiteSettings = (s: ApacheSite) => {
    setSiteCfg(s);
    setSSsl(Boolean(s.ssl));
    setSForce(Boolean(s.forceHttps));
    setSHsts(Boolean(s.hsts));
    setSBody(s.clientMaxBody ?? 'inherit');
    setSIdx(Boolean(s.indexes));
  };

  const onPreviewConf = async (s: ApacheSite) => {
    setBusy(true);
    try {
      const r = await apacheApi.getConf(s.id);
      setPreview({
        title: s.serverName,
        path: r.path,
        content: r.content || '—',
      });
    } catch (e) {
      notifyWarn(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onRemoveArtifact = async (id: string) => {
    setBusy(true);
    try {
      const r = await apacheApi.removeArtifact(id);
      if (r.ok !== false) {
        notifyOk(
          String(
            (r.notes as string[] | undefined)?.[0] ?? t('apache.artifactRemovedOk'),
          ),
        );
      } else {
        notifyWarn(
          String((r.notes as string[] | undefined)?.[0] ?? t('common.opFailed')),
        );
      }
      setArtifactDelId(null);
      await refresh();
    } catch (e) {
      notifyWarn(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onCleanupConflicts = async () => {
    setBusy(true);
    try {
      const r = await apacheApi.cleanupConflicts();
      if (r.ok !== false) {
        notifyOk(
          String((r.notes as string[] | undefined)?.[0] ?? t('common.completed')),
        );
      } else {
        notifyWarn(
          String((r.notes as string[] | undefined)?.[0] ?? t('common.opFailed')),
        );
      }
      setCleanupOpen(false);
      await refresh();
    } catch (e) {
      notifyWarn(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  };

  const hasConflictArtifacts = sites.some(
    (s) => s.conflict && s.source === 'artifact',
  );

  const saveSiteSettings = async () => {
    if (!siteCfg) return;
    setBusy(true);
    try {
      const r = await apacheApi.patchSiteSettings(siteCfg.id, {
        ssl: sSsl,
        forceHttps: sForce,
        hsts: sHsts,
        clientMaxBody: sBody,
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
      setBusy(false);
    }
  };

  const kindLabel = (k: string) => {
    if (k === 'proxy') return t('apache.kindProxy');
    if (k === 'static') return t('apache.kindStatic');
    if (k === 'php') return t('apache.kindPhp');
    return k;
  };

  return (
    <FeaturePageLayout
      title={t('nav.apache')}
      subtitle={t('apache.pageDesc')}
      status={{
        pill: {
          label: t('apache.pillSites', { count: sites.length }),
          tone: sites.length ? 'ok' : 'warn',
        },
      }}
      actions={
        <ActionBar>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            {t('common.refresh')}
          </Button>
          {hasConflictArtifacts ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCleanupOpen(true)}
            >
              {t('apache.cleanupConflicts')}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => void openGlobal()}>
            {t('apache.globalSettings')}
          </Button>
          <Button variant="primary" size="sm" onClick={openCreate}>
            {t('apache.createSite')}
          </Button>
        </ActionBar>
      }
    >
      <WithPageGuide
        guideId="apache"
        stackContent={
          <>
            <SoftwareInstallBanner feature="apache" title={t('apache.notInstalled')} showReadyActions={false} />
            <SoftwareVersionBar softwareId="apache2" />
          </>
        }
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        {hasConflictArtifacts ? (
          <Alert variant="warn">
            <div className="u-flex u-flex-wrap u-gap-2 u-items-center">
              <span>{t('apache.conflictHint')}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setCleanupOpen(true)}
              >
                {t('apache.cleanupConflicts')}
              </Button>
            </div>
          </Alert>
        ) : null}

        <div className="u-flex u-gap-2 u-mb-3 u-flex-wrap" style={{ alignItems: 'center' }}>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('common.search')}
            className="u-input"
            style={{ maxWidth: 220 }}
          />
          <SegRadio
            name="ap-src"
            aria-label={t('apache.filterSource')}
            value={source}
            onChange={(v) => setSource(v as 'all' | ApacheSiteSource)}
            options={[
              { value: 'all', label: t('apache.sourceAll') },
              { value: 'project', label: t('apache.sourceProject') },
              { value: 'standalone', label: t('apache.sourceStandalone') },
              { value: 'artifact', label: t('apache.sourceArtifact') },
            ]}
          />
        </div>

        <DataTable
          rowKey={(r) => r.id}
          title={t('apache.listTitle', { count: sites.length })}
          columns={[
            {
              key: 'server',
              header: t('apache.colServerName'),
              render: (r) => (
                <span className="u-flex u-items-center u-gap-2 u-flex-wrap">
                  <code className="inline">{r.serverName}</code>
                  {r.conflict ? (
                    <span title={t('apache.conflictHint')}>
                      <Badge tone="danger">{t('apache.conflict')}</Badge>
                    </span>
                  ) : null}
                </span>
              ),
            },
            {
              key: 'source',
              header: t('apache.colSource'),
              nowrap: true,
              render: (r) =>
                r.source === 'project' ? (
                  <Link
                    to={`/projects/${r.projectId}`}
                    className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                  >
                    {r.projectName ?? t('apache.sourceProject')}
                  </Link>
                ) : r.source === 'artifact' ? (
                  <Badge tone="warn">{t('apache.sourceArtifact')}</Badge>
                ) : (
                  <Badge tone="neutral">{t('apache.sourceStandalone')}</Badge>
                ),
            },
            {
              key: 'kind',
              header: t('apache.colKind'),
              render: (r) => kindLabel(r.kind),
            },
            {
              key: 'target',
              header: t('apache.colTarget'),
              render: (r) => (
                <code className="inline">
                  {r.target ??
                    (r.kind === 'proxy' ? r.upstream ?? '—' : r.root ?? '—')}
                </code>
              ),
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
              header: t('apache.colStatus'),
              nowrap: true,
              render: (r) => (
                <Badge
                  tone={
                    r.apply_status === 'applied' || r.apply_status === 'written'
                      ? 'ok'
                      : 'warn'
                  }
                >
                  {r.apply_status || 'draft'}
                </Badge>
              ),
            },
          ]}
          rows={sites}
          empty={<EmptyState title={t('apache.emptyTitle')} />}
          rowActions={(r) => (
            <ActionBar>
              {r.source !== 'artifact' ? (
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={() => void onApply(r.id)}
                >
                  {t('apache.apply')}
                </Button>
              ) : null}
              {r.source === 'artifact' ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => void onPreviewConf(r)}
                  >
                    {t('apache.previewConf')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setArtifactDelId(r.id)}
                  >
                    {t('apache.removeArtifact')}
                  </Button>
                </>
              ) : null}
              {r.source === 'project' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => void onPreviewConf(r)}
                >
                  {t('apache.previewConf')}
                </Button>
              ) : null}
              {isStandalone(r) ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() => void onPreviewConf(r)}
                  >
                    {t('apache.previewConf')}
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openSiteSettings(r)}>
                    {t('apache.siteSettings')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setEdit(r);
                      setServerName(r.serverName);
                      setKind(r.kind);
                      setUpstream(r.upstream || 'http://127.0.0.1:3000');
                      setRoot(r.root || '');
                      setSsl(Boolean(r.ssl));
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => setDelId(r.id)}>
                    {t('common.delete')}
                  </Button>
                </>
              ) : r.source === 'project' && r.projectId ? (
                <Link
                  to={`/projects/${r.projectId}`}
                  className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                >
                  {t('apache.openProject')}
                </Link>
              ) : null}
            </ActionBar>
          )}
        />

        <Modal
          open={createOpen || Boolean(edit)}
          onClose={() => {
            setCreateOpen(false);
            setEdit(null);
          }}
          title={edit ? t('apache.editTitle') : t('apache.createTitle')}
          footer={
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setCreateOpen(false);
                  setEdit(null);
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                form="ap-form"
                variant="primary"
                size="md"
                loading={busy}
              >
                {edit ? t('common.save') : t('common.create')}
              </Button>
            </>
          }
        >
          <form id="ap-form" onSubmit={(e) => void (edit ? onEdit(e) : onCreate(e))}>
            <FormLayout columns={2}>
              <Field label={t('apache.colServerName')} htmlFor="ap-sn" flush required>
                <input
                  id="ap-sn"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  required
                  placeholder="app.example.com"
                />
              </Field>
              <Field label={t('apache.kindLabel')} htmlFor="ap-kd" flush>
                <SegRadio
                  name="ap-kd"
                  aria-label={t('apache.kindLabel')}
                  value={kind}
                  onChange={(v) => setKind(v as ApacheSiteKind)}
                  options={[
                    { value: 'proxy', label: t('apache.kindProxy') },
                    { value: 'static', label: t('apache.kindStatic') },
                    { value: 'php', label: t('apache.kindPhp') },
                  ]}
                />
              </Field>
              {kind === 'proxy' ? (
                <Field label={t('apache.upstreamLabel')} htmlFor="ap-up" fullWidth flush>
                  <input
                    id="ap-up"
                    value={upstream}
                    onChange={(e) => setUpstream(e.target.value)}
                  />
                </Field>
              ) : (
                <Field label={t('apache.rootLabel')} htmlFor="ap-rt" fullWidth flush>
                  <input id="ap-rt" value={root} onChange={(e) => setRoot(e.target.value)} />
                </Field>
              )}
            </FormLayout>
            <div className="u-mt-3">
              <CheckboxField id="ap-ssl" label={t('apache.sslLabel')} checked={ssl} onChange={setSsl} />
            </div>
          </form>
        </Modal>

        <Modal
          open={globalOpen}
          onClose={() => !busy && setGlobalOpen(false)}
          title={t('apache.globalSettings')}
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setGlobalOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button variant="secondary" size="md" loading={busy} onClick={() => void saveGlobal(false)}>
                {t('common.save')}
              </Button>
              <Button variant="primary" size="md" loading={busy} onClick={() => void saveGlobal(true)}>
                {t('apache.saveApply')}
              </Button>
            </>
          }
        >
          <div className="stack">
            <CheckboxField id="ag-gzip" label={t('apache.setGzip')} checked={gGzip} onChange={setGGzip} />
            <CheckboxField
              id="ag-tok"
              label={t('apache.setShowVersion')}
              checked={gTokens}
              onChange={setGTokens}
            />
            <CheckboxField id="ag-h2" label={t('apache.setHttp2')} checked={gHttp2} onChange={setGHttp2} />
            <Field label={t('apache.setBody')} htmlFor="ag-body" flush>
              <SegRadio
                name="ag-body"
                aria-label={t('apache.setBody')}
                value={gBody}
                onChange={(v) => setGBody(v as ApacheBodySize)}
                options={BODY_OPTS.map((v) => ({ value: v, label: v }))}
              />
            </Field>
            <Field label={t('apache.setKeepalive')} htmlFor="ag-ka" flush>
              <SegRadio
                name="ag-ka"
                aria-label={t('apache.setKeepalive')}
                value={gKa}
                onChange={(v) => setGKa(v as '15' | '65' | '120')}
                options={[
                  { value: '15', label: '15s' },
                  { value: '65', label: '65s' },
                  { value: '120', label: '120s' },
                ]}
              />
            </Field>
            <Field label={t('apache.setAccessLog')} htmlFor="ag-log" flush>
              <SegRadio
                name="ag-log"
                aria-label={t('apache.setAccessLog')}
                value={gLog}
                onChange={(v) => setGLog(v as 'off' | 'on')}
                options={[
                  { value: 'on', label: t('apache.logOn') },
                  { value: 'off', label: t('apache.logOff') },
                ]}
              />
            </Field>
          </div>
        </Modal>

        <Modal
          open={Boolean(siteCfg)}
          onClose={() => !busy && setSiteCfg(null)}
          title={t('apache.siteSettings')}
          description={siteCfg?.serverName}
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setSiteCfg(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="primary" size="md" loading={busy} onClick={() => void saveSiteSettings()}>
                {t('apache.saveApply')}
              </Button>
            </>
          }
        >
          <div className="stack">
            <CheckboxField id="as-ssl" label={t('apache.sslLabel')} checked={sSsl} onChange={setSSsl} />
            <CheckboxField
              id="as-force"
              label={t('apache.setForceHttps')}
              checked={sForce}
              onChange={setSForce}
              disabled={!sSsl}
            />
            <CheckboxField
              id="as-hsts"
              label={t('apache.setHsts')}
              checked={sHsts}
              onChange={setSHsts}
              disabled={!sSsl}
            />
            {siteCfg?.kind === 'static' ? (
              <CheckboxField id="as-idx" label={t('apache.setIndexes')} checked={sIdx} onChange={setSIdx} />
            ) : null}
            <Field label={t('apache.setBody')} htmlFor="as-body" flush>
              <SegRadio
                name="as-body"
                aria-label={t('apache.setBody')}
                value={sBody}
                onChange={(v) => setSBody(v as ApacheBodySize | 'inherit')}
                options={[
                  { value: 'inherit', label: t('apache.bodyInherit') },
                  ...BODY_OPTS.map((v) => ({ value: v, label: v })),
                ]}
              />
            </Field>
          </div>
        </Modal>

        <ConfirmDialog
          open={Boolean(delId)}
          onClose={() => setDelId(null)}
          onConfirm={() => {
            if (!delId) return;
            const id = delId;
            setDelId(null);
            setBusy(true);
            void apacheApi
              .deleteSite(id)
              .then(() => {
                notifyOk(t('common.completed'));
                return refresh();
              })
              .catch((e: Error) => notifyWarn(e.message))
              .finally(() => setBusy(false));
          }}
          title={t('apache.deleteTitle')}
          description={t('apache.deleteDesc')}
          confirmLabel={t('common.delete')}
          danger
          busy={busy}
        />

        <ConfirmDialog
          open={Boolean(artifactDelId)}
          onClose={() => setArtifactDelId(null)}
          onConfirm={() => {
            if (!artifactDelId) return;
            void onRemoveArtifact(artifactDelId);
          }}
          title={t('apache.removeArtifactTitle')}
          description={t('apache.removeArtifactDesc')}
          confirmLabel={t('apache.removeArtifact')}
          danger
          busy={busy}
        />

        <ConfirmDialog
          open={cleanupOpen}
          onClose={() => setCleanupOpen(false)}
          onConfirm={() => void onCleanupConflicts()}
          title={t('apache.cleanupConflictsTitle')}
          description={t('apache.cleanupConflictsDesc')}
          confirmLabel={t('apache.cleanupConflicts')}
          danger
          busy={busy}
        />

        <Modal
          open={Boolean(preview)}
          onClose={() => setPreview(null)}
          title={preview?.title ?? t('apache.previewConf')}
          description={preview?.path ?? undefined}
          size="xl"
          footer={
            <Button variant="secondary" size="md" onClick={() => setPreview(null)}>
              {t('common.close')}
            </Button>
          }
        >
          <pre
            className="u-code-block"
            style={{ maxHeight: '60vh', overflow: 'auto', fontSize: 12 }}
          >
            {preview?.content ?? ''}
          </pre>
        </Modal>
      </WithPageGuide>
    </FeaturePageLayout>
  );
}
