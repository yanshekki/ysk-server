import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectDto, OpsApplyResultDto } from '@ysk/shared';
import { Button, Card, CardSection, Field, FormGrid } from '../../../shared/components/ui';
import { projectsApi } from '../api';

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
        publish,
        ssl,
      });
      if (res.publish) {
        onOpsResult?.(res.publish, publish ? '網絡已儲存並發布 Nginx' : undefined);
      } else {
        onOpsResult?.(null, '網絡設定已儲存（未發布）');
      }
      await onSaved?.();
    } catch (e) {
      onOpsResult?.(null, e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  const localBusy = busy || saving;
  const suspended = project.status === 'suspended';

  return (
    <div className="stack">
      <Card>
        <CardSection title="域名與別名">
          <FormGrid>
            <Field label={t('projects.domain')} htmlFor="net-domain" flush>
              <input
                id="net-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="app.example.com"
                disabled={suspended}
              />
            </Field>
            <Field
              label="別名（每行一個）"
              htmlFor="net-aliases"
              flush
              hint="例如 www.example.com 或 blog.example.com"
            >
              <textarea
                id="net-aliases"
                rows={3}
                value={aliasesText}
                onChange={(e) => setAliasesText(e.target.value)}
                placeholder={'www.example.com'}
                disabled={suspended}
              />
            </Field>
          </FormGrid>
          <div className="btn-row u-mt-3">
            <Button
              variant="secondary"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={() => void saveNetwork(false)}
            >
              儲存
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended || !domain.trim()}
              onClick={() => void saveNetwork(true, false)}
            >
              儲存並同步 Nginx
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title={t('projects.sectionNginx')}
          description="寫入管理 conf 並嘗試同步／reload"
        >
          <p className="meta-block">
            <span className="muted">{t('projects.railNginx')}: </span>
            {project.nginxConfigPath ? (
              <code className="inline">{project.nginxConfigPath}</code>
            ) : (
              <span className="muted">{t('projects.nginxNone')}</span>
            )}
          </p>
          {suspended ? (
            <p className="muted u-text-sm">已暫停 — 目前 vhost 回 503。恢復後再發布。</p>
          ) : null}
          <div className="form-check-row u-mt-2">
            <label className="field field--check">
              <input
                type="checkbox"
                checked={forceHttps}
                onChange={(e) => setForceHttps(e.target.checked)}
                disabled={suspended}
              />
              <span>強制 HTTPS（HTTP → 301）</span>
            </label>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={hsts}
                onChange={(e) => setHsts(e.target.checked)}
                disabled={suspended}
              />
              <span>HSTS</span>
            </label>
          </div>
          <FormGrid>
            <Field label="整站 301 目標 URL（可空）" htmlFor="net-redir" flush>
              <input
                id="net-redir"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
                placeholder="https://www.example.com"
                disabled={suspended}
              />
            </Field>
            <Field label="Document root（相對 home，可空）" htmlFor="net-doc" flush>
              <input
                id="net-doc"
                value={docRoot}
                onChange={(e) => setDocRoot(e.target.value)}
                placeholder="app/public"
                disabled={suspended}
              />
            </Field>
            <Field label="Bind IP（可空=全部）" htmlFor="net-ip" flush>
              <input
                id="net-ip"
                value={bindIp}
                onChange={(e) => setBindIp(e.target.value)}
                placeholder="203.0.113.10"
                disabled={suspended}
              />
            </Field>
            <Field label="HTTP Auth 用戶（可空）" htmlFor="net-au" flush>
              <input
                id="net-au"
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
                disabled={suspended}
              />
            </Field>
            <Field label="HTTP Auth 密碼" htmlFor="net-ap" flush>
              <input
                id="net-ap"
                type="password"
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                disabled={suspended}
                autoComplete="new-password"
              />
            </Field>
          </FormGrid>
          <p className="muted u-text-sm u-mt-2">
            HTTPS / HSTS / Auth / Redirect 於發布 Nginx 時寫入。Redirect 會取代 reverse proxy。
          </p>
          <div className="btn-row u-mt-3">
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={() => void saveNetwork(true, false)}
            >
              同步到系統 Nginx
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={localBusy}
              disabled={suspended || !domain.trim()}
              onClick={() => void saveNetwork(true, true)}
            >
              同步 Nginx + SSL
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={onPublish}
            >
              只發布（用已存設定）
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={localBusy}
              disabled={suspended || !domain.trim()}
              onClick={onPublishSsl}
            >
              只發布 + SSL
            </Button>
          </div>
        </CardSection>
      </Card>
    </div>
  );
}
