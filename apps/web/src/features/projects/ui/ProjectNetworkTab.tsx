/**
 * Project network tab — human-friendly form kit (domains · HTTPS · advanced).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto, OpsApplyResultDto } from '@ysk/shared';
import {
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
  buttonClassName,
} from '../../../shared/components/ui';
import { projectsApi } from '../api';
import { bindToggle, bindInput, bindCall1, bindCall2 } from '../../../pages/bind-handlers';

export interface ProjectNetworkTabProps {
  project: ProjectDto;
  busy?: boolean;
  onPublish: () => void;
  onPublishSsl: () => void;
  onSaved?: () => void | Promise<void>;
  onOpsResult?: (result: OpsApplyResultDto | null, message?: string) => void;
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
  const [realIpProvider, setRealIpProvider] = useState(
    project.realIpProvider ?? 'inherit',
  );
  const [saving, setSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => Boolean(project.docRoot || project.bindIp || project.realIpProvider),
  );

  useEffect(() => {
    setDomain(project.domain ?? '');
    setAliasesText((project.domainAliases ?? []).join('\n'));
    setForceHttps(Boolean(project.forceHttps));
    setHsts(Boolean(project.hsts));
    setRedirectUrl(project.siteRedirectUrl ?? '');
    setAuthUser(project.httpAuthUser ?? '');
    setDocRoot(project.docRoot ?? '');
    setBindIp(project.bindIp ?? '');
    setRealIpProvider(project.realIpProvider ?? 'inherit');
    if (project.docRoot || project.bindIp || project.realIpProvider) setAdvancedOpen(true);
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
    project.realIpProvider,
  ]);

  function parseAliases(): string[] {
    return aliasesText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async function saveNetwork(publish: boolean, ssl?: boolean) {
    setSaving(true);
    try {
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

  return (
    <div className="tab-panel">
      {suspended ? (
        <Alert variant="info">
          {t('projects.netSuspended')}
        </Alert>
      ) : null}

      {/* 1. Domain */}
      <Card>
        <CardSection
          title={t('common.domain')}
          description={t('projects.netDomainDesc')}
        >
          <FormLayout>
            <Field
              label={t('projects.netPrimaryDomain')}
              htmlFor="net-domain"
              required
              hint={t('projects.netPrimaryHint')}
              flush
            >
              <input
                id="net-domain"
                value={domain}
                onChange={bindInput(setDomain)}
                placeholder="app.example.com"
                disabled={suspended}
                autoComplete="off"
              />
            </Field>
            <Field
              label={t('projects.ovAliases')}
              htmlFor="net-aliases"
              hint={t('projects.netAliasesHint')}
              flush
              fullWidth
            >
              <textarea
                id="net-aliases"
                rows={3}
                value={aliasesText}
                onChange={bindInput(setAliasesText)}
                placeholder={'www.example.com'}
                disabled={suspended}
              />
            </Field>
          </FormLayout>
          <FormActions>
            <Button
              variant="secondary"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={bindCall1(saveNetwork, false)}
            >
              {t('projects.saveOnly')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              title={!hasDomain ? t('projects.netNeedPrimary') : undefined}
              onClick={bindCall2(saveNetwork, true, false)}
            >
              {t('projects.savePublishNginx')}
            </Button>
          </FormActions>
          {!hasDomain ? (
            <p className="muted u-text-sm u-mt-3 u-mb-0">{t('projects.needDomainToPublish')}</p>
          ) : null}
        </CardSection>
      </Card>

      {/* 2. HTTPS + whole-site redirect */}
      <Card>
        <CardSection
          title={t('projects.netHttpsTitle')}
          description={t('projects.netHttpsDesc')}
        >
          <div className="form-switches">
            <CheckboxField
              id="net-https"
              label={t('projects.netForceHttps')}
              description={t('projects.netForceHttpsDesc')}
              checked={forceHttps}
              onChange={setForceHttps}
              disabled={suspended}
            />
            <CheckboxField
              id="net-hsts"
              label={t('projects.netHsts')}
              description={t('projects.netHstsDesc')}
              checked={hsts}
              onChange={setHsts}
              disabled={suspended || !forceHttps}
            />
          </div>
          <FormLayout>
            <Field
              label={t('projects.netRedirectUrl')}
              htmlFor="net-redir"
              hint={t('projects.netRedirectHint')}
              flush
              fullWidth
            >
              <input
                id="net-redir"
                value={redirectUrl}
                onChange={bindInput(setRedirectUrl)}
                placeholder="https://www.example.com"
                disabled={suspended}
              />
            </Field>
          </FormLayout>
          <FormActions>
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
              onClick={bindCall2(saveNetwork, true, forceHttps)}
            >
              {t('projects.savePublish')}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      {/* 3. HTTP Basic Auth */}
      <Card>
        <CardSection
          title={t('projects.netBasicAuthTitle')}
          description={t('projects.netBasicAuthDesc')}
        >
          <FormLayout columns={2}>
            <Field label={t('common.username')} htmlFor="net-au" flush hint={t('projects.netAuthUserHint')}>
              <input
                id="net-au"
                value={authUser}
                onChange={bindInput(setAuthUser)}
                disabled={suspended}
                autoComplete="username"
                placeholder="admin"
              />
            </Field>
            <Field label={t('common.password')} htmlFor="net-ap" flush hint={t('projects.netAuthPassHint')}>
              <input
                id="net-ap"
                type="password"
                value={authPass}
                onChange={bindInput(setAuthPass)}
                disabled={suspended}
                autoComplete="new-password"
                placeholder={authUser ? t('projects.netAuthPassSet') : '—'}
              />
            </Field>
          </FormLayout>
          <FormActions>
            <Button
              variant="secondary"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={bindCall1(saveNetwork, false)}
            >
              {t('projects.saveAuth')}
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
          </FormActions>
        </CardSection>
      </Card>

      {/* 4. Cache */}
      <Card>
        <CardSection
          title={t('projects.netCacheTitle')}
          description={t('projects.netCacheNote')}
        >
          <FormHint>
            {t('projects.cacheZoneNote')}
          </FormHint>
          <FormActions>
            <Button
              variant="secondary"
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
                      r.ok ? t('projects.netPurgeOk') : r.notes?.join('；') ?? t('projects.netPurgeFailed'),
                    );
                  })
                  .catch((e: Error) => onOpsResult?.(null, e.message))
                  .finally(() => setSaving(false));
              }}
            >
              {t('projects.purgeNginxCache')}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      {/* 5. Document root (first-class) + publish */}
      <Card>
        <CardSection
          title={t('projects.netDocrootTitle')}
          description={t('projects.netDocrootDesc')}
        >
          <FormLayout columns={1}>
            <Field
              label={t('projects.ovDocroot')}
              htmlFor="net-doc"
              flush
              hint={t('projects.netDocrootFull', { path: `${project.homeDir}/${(docRoot.trim() || 'app/public').replace(/^\//, '')}` })}
            >
              <div className="u-mb-2">
                <PresetChips
                  options={[
                    { value: 'app/public', label: 'app/public' },
                    { value: 'app', label: 'app' },
                    { value: 'public', label: 'public' },
                    { value: 'web', label: 'web' },
                    { value: 'www', label: 'www' },
                    { value: 'dist', label: 'dist' },
                  ]}
                  value={docRoot || 'app/public'}
                  onChange={setDocRoot}
                  allowCustom
                  customPlaceholder={t('projects.netDocrootCustom')}
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

      {/* 5b. Real IP / CDN per site */}
      <Card>
        <CardSection
          title={t('projects.netRealIpTitle', { defaultValue: 'Real IP / CDN' })}
          description={t('projects.netRealIpDesc', {
            defaultValue:
              'Restore visitor IP behind CDN. Inherit system default or override for this site. Re-publish Nginx after change.',
          })}
        >
          <FormLayout>
            <Field
              label={t('projects.netRealIpProvider', { defaultValue: 'Provider' })}
              htmlFor="net-rip"
              flush
              hint={t('projects.netRealIpHint', {
                defaultValue: 'System default is set under Network → Real IP / CDN',
              })}
            >
              <select
                id="net-rip"
                className="input"
                value={realIpProvider}
                onChange={(e) => setRealIpProvider(e.target.value)}
                disabled={suspended}
              >
                <option value="inherit">
                  {t('projects.netRealIpInherit', { defaultValue: 'Inherit system default' })}
                </option>
                <option value="none">none (direct)</option>
                <option value="cloudflare">Cloudflare</option>
                <option value="fastly">Fastly</option>
                <option value="bunny">Bunny CDN</option>
                <option value="cloudfront">AWS CloudFront</option>
                <option value="azure_frontdoor">Azure Front Door</option>
                <option value="gcore">Gcore</option>
                <option value="custom">Custom CIDRs</option>
              </select>
            </Field>
          </FormLayout>
          <FormActions>
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
              onClick={bindCall2(saveNetwork, true, forceHttps)}
            >
              {t('projects.savePublish')}
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('projects.netAdvancedTitle')} description={t('projects.netAdvancedDesc')}>
          <FormHint>
            {t('projects.nginxManageFile')}{' '}
            {project.nginxConfigPath ? (
              <code className="inline">{project.nginxConfigPath}</code>
            ) : (
              <span className="muted">{t('projects.nginxNone')}</span>
            )}
            {' · '}
            {t('projects.publishRuntimeNote')}
          </FormHint>

          <button
            type="button"
            className={`${buttonClassName({ variant: 'ghost', size: 'sm' })} u-mb-4`}
            onClick={bindToggle(setAdvancedOpen)}
          >
            {advancedOpen ? t('projects.netCollapseBind') : t('projects.netExpandBind')}
          </button>

          {advancedOpen ? (
            <FormLayout columns={2}>
              <Field label={t('projects.netBindIp')} htmlFor="net-ip" hint={t('projects.netBindHint')} flush>
                <input
                  id="net-ip"
                  value={bindIp}
                  onChange={bindInput(setBindIp)}
                  placeholder={t('projects.netBindPh')}
                  disabled={suspended}
                  spellCheck={false}
                />
              </Field>
            </FormLayout>
          ) : null}

          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              title={!hasDomain ? t('projects.netNeedDomainSave') : undefined}
              onClick={bindCall2(saveNetwork, true, false)}
            >
              {t('projects.ovPublishNginx')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              onClick={bindCall2(saveNetwork, true, true)}
            >
              {t('projects.ovPublishSsl')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={onPublish}
            >
              {t('projects.publishStored')}
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              onClick={onPublishSsl}
            >
              {t('projects.publishStoredSsl')}
            </Button>
          </FormActions>
          <p className="muted u-text-sm u-mt-3 u-mb-0">
            {t('projects.publishNote')}
          </p>
        </CardSection>
      </Card>
    </div>
  );
}
