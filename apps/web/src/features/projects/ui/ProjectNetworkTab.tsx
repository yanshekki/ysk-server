/**
 * Project network / edge — domains, HTTPS, port, single publish strip.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ProjectDto, OpsApplyResultDto } from '@ysk/shared';
import {
  ActionBar,
  Alert,
  Button,
  Card,
  CardSection,
  CheckboxField,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  PresetChips,
} from '../../../shared/components/ui';
import { projectsApi } from '../api';
import { sslApi } from '../../ssl/api';
import { bindInput, bindCall1, bindCall2 } from '../../../pages/bind-handlers';

function parseAliasesSafe(text: string): string[] {
  return text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ProjectNetworkTabProps {
  project: ProjectDto;
  busy?: boolean;
  onPublish: () => void;
  onPublishSsl: () => void;
  onSaved?: () => void | Promise<void>;
  onOpsResult?: (result: OpsApplyResultDto | null, message?: string) => void;
}

function edgeStatus(project: ProjectDto, t: (k: string, o?: Record<string, string>) => string): string {
  const lh = (project.lastHealth ?? {}) as {
    nginxStatus?: string;
    nginxReloaded?: boolean;
    edgeKind?: string;
    deployMode?: string;
  };
  if (!project.nginxConfigPath) {
    return t('projects.nginxValueNone', { defaultValue: '未發佈' });
  }
  if (lh.nginxReloaded || lh.nginxStatus === 'reloaded') {
    return t('projects.nginxLive', { defaultValue: '已載入' });
  }
  if (lh.nginxStatus === 'managed_only' || lh.nginxStatus === 'synced') {
    return t('projects.nginxWritten', { defaultValue: '已寫入（未 reload）' });
  }
  if (lh.nginxStatus === 'needs_deploy') {
    return t('projects.nginxNeedsDeploy', { defaultValue: '需先部署' });
  }
  if (lh.nginxStatus?.startsWith('reload_failed') || lh.nginxStatus === 'nginx_t_failed') {
    return t('projects.nginxFailed', { defaultValue: '發佈失敗' });
  }
  return project.nginxConfigPath ? t('projects.status.published') : t('projects.nginxValueNone');
}

function upstreamLabel(project: ProjectDto): string {
  const rt = project.runtime;
  const lh = (project.lastHealth ?? {}) as { deployMode?: string; edgeKind?: string };
  if (rt === 'static') return `root ${project.homeDir}/${project.docRoot || 'app/public'}`;
  if (rt === 'php') {
    if (lh.deployMode === 'php_builtin' || lh.edgeKind === 'php-proxy') {
      return project.port != null ? `proxy 127.0.0.1:${project.port}` : 'php proxy (no port)';
    }
    const ver = project.runtimeVersion || '8.2';
    return `fpm unix:/run/php/php${ver}-fpm-${project.linuxUser}.sock`;
  }
  return project.port != null ? `proxy 127.0.0.1:${project.port}` : '—';
}

export function ProjectNetworkTab({
  project,
  busy,
  onPublish,
  onPublishSsl,
  onSaved,
  onOpsResult,
}: ProjectNetworkTabProps) {
  const { t } = useTranslation();
  const [domain, setDomain] = useState(project.domain ?? '');
  const [aliasesText, setAliasesText] = useState((project.domainAliases ?? []).join('\n'));
  const [forceHttps, setForceHttps] = useState(Boolean(project.forceHttps));
  const [hsts, setHsts] = useState(Boolean(project.hsts));
  const [redirectUrl, setRedirectUrl] = useState(project.siteRedirectUrl ?? '');
  const [authUser, setAuthUser] = useState(project.httpAuthUser ?? '');
  const [authPass, setAuthPass] = useState('');
  const [docRoot, setDocRoot] = useState(project.docRoot ?? '');
  const [bindIp, setBindIp] = useState(project.bindIp ?? '');
  const [preferredPort, setPreferredPort] = useState(
    project.preferredPort != null ? String(project.preferredPort) : '',
  );
  const [realIpProvider, setRealIpProvider] = useState(
    project.realIpProvider ?? 'inherit',
  );
  const [saving, setSaving] = useState(false);
  const [confPreview, setConfPreview] = useState<string | null>(null);
  /** Domain has fullchain+privkey on disk (managed / LE / store) */
  const [sslReady, setSslReady] = useState<boolean | null>(null);

  useEffect(() => {
    setDomain(project.domain ?? '');
    setAliasesText((project.domainAliases ?? []).join('\n'));
    setForceHttps(Boolean(project.forceHttps));
    setHsts(Boolean(project.hsts));
    setRedirectUrl(project.siteRedirectUrl ?? '');
    setAuthUser(project.httpAuthUser ?? '');
    setDocRoot(project.docRoot ?? '');
    setBindIp(project.bindIp ?? '');
    setPreferredPort(project.preferredPort != null ? String(project.preferredPort) : '');
    setRealIpProvider(project.realIpProvider ?? 'inherit');
  }, [
    project.id,
    project.domain,
    project.domainAliases,
    project.forceHttps,
    project.hsts,
    project.siteRedirectUrl,
    project.httpAuthUser,
    project.docRoot,
    project.bindIp,
    project.preferredPort,
    project.realIpProvider,
  ]);

  // Refresh cert readiness when domain (or aliases) change
  const domainKey = useMemo(
    () =>
      [domain.trim().toLowerCase(), ...parseAliasesSafe(aliasesText)]
        .filter(Boolean)
        .join('|'),
    [domain, aliasesText],
  );

  useEffect(() => {
    let cancelled = false;
    const primary = domain.trim().toLowerCase();
    if (!primary) {
      setSslReady(false);
      return;
    }
    setSslReady(null);
    void (async () => {
      try {
        const res = await sslApi.list();
        const items = res.items ?? [];
        const names = new Set(
          [primary, ...parseAliasesSafe(aliasesText).map((a) => a.toLowerCase())].filter(Boolean),
        );
        const hit = items.some(
          (c) =>
            names.has(String(c.domain || '').toLowerCase()) &&
            (c.files_exist === true ||
              String(c.status || '').toLowerCase() === 'issued' ||
              String(c.status || '').toLowerCase() === 'ready'),
        );
        if (!cancelled) setSslReady(hit);
      } catch {
        // If list fails, leave null → buttons stay gated (safer than enabling blind SSL)
        if (!cancelled) setSslReady(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [domainKey, aliasesText]);

  function parseAliases(): string[] {
    return aliasesText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function preferredPortPayload(): number | null | undefined {
    const raw = preferredPort.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n >= 65536) return undefined;
    return Math.floor(n);
  }

  async function saveNetwork(publish: boolean, ssl?: boolean) {
    if (ssl && !sslReady) {
      onOpsResult?.(
        null,
        t('projects.sslRequiredFirst', {
          defaultValue:
            '尚未有此網域的 SSL 證書。請先到「SSL 證書」申請／上載，再按發佈 + SSL。',
        }),
      );
      return;
    }
    setSaving(true);
    try {
      const portVal = preferredPortPayload();
      const res = await projectsApi.updateNetwork(project.id, {
        domain: domain.trim() || undefined,
        domainAliases: parseAliases(),
        forceHttps,
        hsts,
        siteRedirectUrl: redirectUrl.trim() || null,
        httpAuthUser: authUser.trim() || null,
        httpAuthPass: authPass || null,
        docRoot: docRoot.trim() || null,
        bindIp: bindIp.trim() || null,
        preferredPort: portVal === undefined ? undefined : portVal,
        realIpProvider:
          realIpProvider === 'inherit' ? null : realIpProvider || null,
        publish,
        ssl,
      });
      if (res.publish) {
        onOpsResult?.(res.publish, publish ? t('projects.netSavedPublished') : undefined);
      } else {
        onOpsResult?.(null, t('projects.netSavedOnly'));
      }
      await onSaved?.();
    } catch (e) {
      onOpsResult?.(null, e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const localBusy = busy || saving;
  const suspended = project.status === 'suspended';
  const hasDomain = Boolean(domain.trim());
  const canSsl = hasDomain && sslReady === true;
  const showPort =
    project.runtime !== 'static' &&
    !(project.runtime === 'php' && !project.port);

  return (
    <div className="tab-panel stack">
      {suspended ? <Alert variant="info">{t('projects.netSuspended')}</Alert> : null}

      <Card>
        <CardSection title={t('projects.netEdgeStatus', { defaultValue: '站點狀態' })}>
          <FormLayout columns={2}>
            <Field label="Nginx" htmlFor="net-st" flush>
              <code id="net-st" className="inline">
                {edgeStatus(project, t)}
              </code>
            </Field>
            <Field label={t('projects.netUpstream', { defaultValue: '上游' })} htmlFor="net-up" flush>
              <code id="net-up" className="inline">
                {upstreamLabel(project)}
              </code>
            </Field>
            <Field label={t('common.domain')} htmlFor="net-dom-ro" flush>
              <code id="net-dom-ro" className="inline">
                {project.domain || '—'}
              </code>
            </Field>
            <Field label={t('projects.nginxManageFile', { defaultValue: 'Conf' })} htmlFor="net-path" flush>
              <code id="net-path" className="inline">
                {project.nginxConfigPath || '—'}
              </code>
            </Field>
          </FormLayout>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('common.domain')}>
          <FormLayout>
            <Field label={t('projects.netPrimaryDomain')} htmlFor="net-domain" required flush>
              <input
                id="net-domain"
                value={domain}
                onChange={bindInput(setDomain)}
                placeholder="app.example.com"
                disabled={suspended}
                autoComplete="off"
              />
            </Field>
            <Field label={t('projects.ovAliases')} htmlFor="net-aliases" flush fullWidth>
              <textarea
                id="net-aliases"
                rows={2}
                value={aliasesText}
                onChange={bindInput(setAliasesText)}
                placeholder="www.example.com"
                disabled={suspended}
              />
            </Field>
          </FormLayout>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="HTTPS">
          <div className="form-switches">
            <CheckboxField
              id="net-https"
              label={t('projects.netForceHttps')}
              checked={forceHttps}
              onChange={setForceHttps}
              disabled={suspended}
            />
            <CheckboxField
              id="net-hsts"
              label={t('projects.netHsts')}
              checked={hsts}
              onChange={setHsts}
              disabled={suspended || !forceHttps}
            />
          </div>
          <FormLayout>
            <Field label={t('projects.netRedirectUrl')} htmlFor="net-redir" flush fullWidth>
              <input
                id="net-redir"
                value={redirectUrl}
                onChange={bindInput(setRedirectUrl)}
                placeholder="https://www.example.com"
                disabled={suspended}
              />
            </Field>
          </FormLayout>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('projects.netBasicAuthTitle')}>
          <FormLayout columns={2}>
            <Field label={t('common.username')} htmlFor="net-au" flush>
              <input
                id="net-au"
                value={authUser}
                onChange={bindInput(setAuthUser)}
                disabled={suspended}
                autoComplete="username"
              />
            </Field>
            <Field label={t('common.password')} htmlFor="net-ap" flush>
              <input
                id="net-ap"
                type="password"
                value={authPass}
                onChange={bindInput(setAuthPass)}
                disabled={suspended}
                autoComplete="new-password"
              />
            </Field>
          </FormLayout>
        </CardSection>
      </Card>

      {(project.runtime === 'static' || project.runtime === 'php') && (
        <Card>
          <CardSection title={t('projects.netDocrootTitle')}>
            <FormLayout>
              <Field label={t('projects.ovDocroot')} htmlFor="net-doc" flush>
                <div className="u-mb-2">
                  <PresetChips
                    options={[
                      { value: 'app/public', label: 'app/public' },
                      { value: 'app', label: 'app' },
                      { value: 'public', label: 'public' },
                      { value: 'dist', label: 'dist' },
                    ]}
                    value={docRoot || 'app/public'}
                    onChange={setDocRoot}
                    allowCustom
                    disabled={suspended || localBusy}
                  />
                </div>
                <input
                  id="net-doc"
                  value={docRoot}
                  onChange={bindInput(setDocRoot)}
                  placeholder="app/public"
                  disabled={suspended}
                  spellCheck={false}
                />
              </Field>
            </FormLayout>
          </CardSection>
        </Card>
      )}

      {showPort ? (
        <Card>
          <CardSection title={t('projects.netPortTitle', { defaultValue: '進程埠' })}>
            <FormLayout columns={2}>
              <Field
                label={t('projects.createPreferredPort', { defaultValue: '固定埠' })}
                htmlFor="net-pref-port"
                hint={t('projects.preferredPortRedeployHint', {
                  defaultValue: '儲存後需重新部署才會改進程埠',
                })}
                flush
              >
                <input
                  id="net-pref-port"
                  inputMode="numeric"
                  value={preferredPort}
                  onChange={bindInput(setPreferredPort)}
                  placeholder="auto"
                  disabled={suspended}
                />
              </Field>
              <Field label={t('projects.netCurrentPort', { defaultValue: '目前埠' })} htmlFor="net-cur-port" flush>
                <code id="net-cur-port" className="inline">
                  {project.port != null ? String(project.port) : '—'}
                </code>
              </Field>
              <Field label="bind_ip" htmlFor="net-bind" flush>
                <input
                  id="net-bind"
                  value={bindIp}
                  onChange={bindInput(setBindIp)}
                  placeholder="0.0.0.0 / empty"
                  disabled={suspended}
                />
              </Field>
              <Field label={t('projects.netRealIp', { defaultValue: 'Real IP' })} htmlFor="net-realip" flush>
                <select
                  id="net-realip"
                  value={realIpProvider}
                  onChange={bindInput(setRealIpProvider)}
                  disabled={suspended}
                >
                  <option value="inherit">inherit</option>
                  <option value="none">none</option>
                  <option value="cloudflare">cloudflare</option>
                  <option value="fastly">fastly</option>
                  <option value="bunny">bunny</option>
                  <option value="cloudfront">cloudfront</option>
                </select>
              </Field>
            </FormLayout>
          </CardSection>
        </Card>
      ) : (
        <Card>
          <CardSection title="bind_ip">
            <FormLayout>
              <Field label="bind_ip" htmlFor="net-bind-only" flush>
                <input
                  id="net-bind-only"
                  value={bindIp}
                  onChange={bindInput(setBindIp)}
                  placeholder="empty = all"
                  disabled={suspended}
                />
              </Field>
            </FormLayout>
          </CardSection>
        </Card>
      )}

      <Card>
        <CardSection title={t('projects.netPublishTitle', { defaultValue: '發佈' })}>
          <div className="stack" style={{ gap: '0.85rem' }}>
            {/* Primary: save meta + edge without SSL */}
            <div>
              <div className="u-text-muted u-text-sm u-mb-1">
                {t('projects.netPublishPrimary', { defaultValue: '基本' })}
              </div>
              <ActionBar size="md" wrap aria-label={t('projects.netPublishPrimary', { defaultValue: '基本' })}>
                <Button
                  variant="secondary"
                  size="md"
                  loading={localBusy}
                  disabled={suspended}
                  onClick={bindCall1(saveNetwork, false)}
                >
                  {t('common.save')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={localBusy}
                  disabled={suspended || !hasDomain}
                  onClick={bindCall2(saveNetwork, true, false)}
                >
                  {t('projects.savePublishNginx')}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  loading={localBusy}
                  disabled={suspended || !hasDomain}
                  onClick={onPublish}
                >
                  {t('projects.publishNginx')}
                </Button>
              </ActionBar>
            </div>

            {/* SSL row — gated until cert exists */}
            <div>
              <div className="u-text-muted u-text-sm u-mb-1">
                {t('projects.netPublishSsl', { defaultValue: 'HTTPS / SSL' })}
              </div>
              {!canSsl && hasDomain ? (
                <Alert variant="warn" className="u-mb-2">
                  {t('projects.sslGateHint', {
                    defaultValue: 'SSL 相關按鈕已鎖定：請先到',
                  })}{' '}
                  <Link to="/ssl">{t('nav.ssl', { defaultValue: 'SSL 證書' })}</Link>{' '}
                  {t('projects.sslGateHint2', {
                    defaultValue: '為網域申請／上載證書後再發佈 + SSL。',
                  })}
                  {sslReady === null
                    ? ` (${t('common.loading', { defaultValue: '檢查中…' })})`
                    : ''}
                </Alert>
              ) : null}
              {!hasDomain ? (
                <div className="u-mb-2">
                  <FormHint>
                    {t('projects.sslNeedDomain', {
                      defaultValue: '請先填寫網域，才能發佈 Nginx / SSL。',
                    })}
                  </FormHint>
                </div>
              ) : null}
              <ActionBar size="md" wrap aria-label={t('projects.netPublishSsl', { defaultValue: 'HTTPS / SSL' })}>
                <Button
                  variant="secondary"
                  size="md"
                  loading={localBusy}
                  disabled={suspended || !canSsl}
                  title={
                    !canSsl
                      ? t('projects.sslRequiredFirst', {
                          defaultValue: '請先為網域建立 SSL 證書',
                        })
                      : undefined
                  }
                  onClick={bindCall2(saveNetwork, true, true)}
                >
                  {t('projects.savePublishSsl', { defaultValue: '儲存並發佈 + SSL' })}
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  loading={localBusy}
                  disabled={suspended || !canSsl}
                  title={
                    !canSsl
                      ? t('projects.sslRequiredFirst', {
                          defaultValue: '請先為網域建立 SSL 證書',
                        })
                      : undefined
                  }
                  onClick={() => {
                    if (!canSsl) {
                      onOpsResult?.(
                        null,
                        t('projects.sslRequiredFirst', {
                          defaultValue:
                            '尚未有此網域的 SSL 證書。請先到「SSL 證書」申請／上載，再按發佈 + SSL。',
                        }),
                      );
                      return;
                    }
                    onPublishSsl();
                  }}
                >
                  {t('projects.publishNginxSsl', { defaultValue: '發佈 Nginx + SSL' })}
                </Button>
              </ActionBar>
            </div>

            {/* Maintenance */}
            <div>
              <div className="u-text-muted u-text-sm u-mb-1">
                {t('projects.netPublishMaint', { defaultValue: '維護' })}
              </div>
              <ActionBar size="md" wrap aria-label={t('projects.netPublishMaint', { defaultValue: '維護' })}>
                <Button
                  variant="ghost"
                  size="md"
                  loading={localBusy}
                  disabled={suspended}
                  onClick={() => {
                    setSaving(true);
                    void projectsApi
                      .purgeCache(project.id)
                      .then((r) => {
                        onOpsResult?.(
                          {
                            ok: r.ok,
                            notes: r.notes ?? [],
                            projectId: project.id,
                            processStatus: 'stopped',
                            listening: false,
                          } as OpsApplyResultDto,
                          r.ok
                            ? t('projects.netPurgeOk')
                            : r.notes?.join('；') ?? t('projects.netPurgeFailed'),
                        );
                      })
                      .catch((e: Error) => onOpsResult?.(null, e.message))
                      .finally(() => setSaving(false));
                  }}
                >
                  {t('projects.purgeNginxCache')}
                </Button>
              </ActionBar>
            </div>
          </div>
        </CardSection>
      </Card>

      {project.nginxConfigPath ? (
        <Card>
          <CardSection title={t('projects.netConfPreview', { defaultValue: 'Conf' })}>
            <FormActions>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfPreview((p) => (p != null ? null : ''));
                  if (confPreview != null) return;
                  void projectsApi
                    .nginxConf?.(project.id)
                    .then((r) => setConfPreview(r.content ?? r.conf ?? ''))
                    .catch(() =>
                      setConfPreview(
                        project.nginxConfigPath
                          ? `# ${project.nginxConfigPath}\n# preview API unavailable — open file on host`
                          : '',
                      ),
                    );
                }}
              >
                {confPreview != null
                  ? t('common.hide', { defaultValue: '隱藏' })
                  : t('common.show', { defaultValue: '顯示' })}
              </Button>
            </FormActions>
            {confPreview != null ? (
              <pre className="code-block u-mt-2" style={{ maxHeight: 320, overflow: 'auto' }}>
                {confPreview || '—'}
              </pre>
            ) : null}
          </CardSection>
        </Card>
      ) : null}
    </div>
  );
}
