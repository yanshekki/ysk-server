/**
 * Project network — domain / port meta. Nginx edge ops live on /nginx.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { ProjectDto, OpsApplyResultDto } from '@ysk-server/shared';
import {
  ActionBar,
  Alert,
  Button,
  Card,
  CardSection,
  CheckboxField,
  Field,
  FormLayout,
  PresetChips,
  buttonClassName,
} from '../../../shared/components/ui';
import { projectsApi } from '../api';
import { bindInput } from '../../../pages/bind-handlers';

export interface ProjectNetworkTabProps {
  project: ProjectDto;
  busy?: boolean;
  /** @deprecated edge publish moved to /nginx — kept optional for callers */
  onPublish?: () => void;
  onPublishSsl?: () => void;
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
    return t('projects.nginxValueNone');
  }
  if (lh.nginxReloaded || lh.nginxStatus === 'reloaded') {
    return t('projects.nginxLive');
  }
  if (lh.nginxStatus === 'managed_only' || lh.nginxStatus === 'synced') {
    return t('projects.nginxWritten');
  }
  if (lh.nginxStatus === 'needs_deploy') {
    return t('projects.nginxNeedsDeploy');
  }
  if (lh.nginxStatus?.startsWith('reload_failed') || lh.nginxStatus === 'nginx_t_failed') {
    return t('projects.nginxFailed');
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
  onSaved,
  onOpsResult }: ProjectNetworkTabProps) {
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

  async function saveNetwork() {
    setSaving(true);
    try {
      const portVal = preferredPortPayload();
      await projectsApi.updateNetwork(project.id, {
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
        publish: false,
      });
      onOpsResult?.(null, t('projects.netSavedOnly'));
      await onSaved?.();
    } catch (e) {
      onOpsResult?.(null, e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const localBusy = busy || saving;
  const suspended = project.status === 'suspended';
  const showPort =
    project.runtime !== 'static' &&
    !(project.runtime === 'php' && !project.port);

  return (
    <div className="tab-panel stack">
      {suspended ? <Alert variant="info">{t('projects.netSuspended')}</Alert> : null}

      <Card>
        <CardSection title={t('projects.netEdgeStatus')}>
          <FormLayout columns={2}>
            <Field label="Nginx" htmlFor="net-st" flush>
              <code id="net-st" className="inline">
                {edgeStatus(project, t)}
              </code>
            </Field>
            <Field label={t('projects.netUpstream')} htmlFor="net-up" flush>
              <code id="net-up" className="inline">
                {upstreamLabel(project)}
              </code>
            </Field>
          </FormLayout>
          <ActionBar className="u-mt-3">
            <Link
              to={`/nginx?projectId=${encodeURIComponent(project.id)}`}
              className={buttonClassName({ variant: 'primary', size: 'md' })}
            >
              {t('projects.manageInNginx')}
            </Link>
          </ActionBar>
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
          <CardSection title={t('projects.netPortTitle')}>
            <FormLayout columns={2}>
              <Field
                label={t('projects.createPreferredPort')}
                htmlFor="net-pref-port"
                hint={t('projects.preferredPortRedeployHint', { })}
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
              <Field label={t('projects.netCurrentPort')} htmlFor="net-cur-port" flush>
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

      <ActionBar>
        <Button
          variant="primary"
          size="md"
          loading={localBusy}
          disabled={suspended}
          onClick={() => void saveNetwork()}
        >
          {t('common.save')}
        </Button>
      </ActionBar>
    </div>
  );
}
