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
} from '../../../shared/components/ui';
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
  const [advancedOpen, setAdvancedOpen] = useState(false);

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
  const hasDomain = Boolean(domain.trim());

  return (
    <div className="tab-panel">
      {suspended ? (
        <Alert variant="info">
          專案已暫停 — 訪客會收到 503。恢復後再發布站點。
        </Alert>
      ) : null}

      {/* 1. Domain */}
      <Card>
        <CardSection
          title="域名"
          description="主要域名與別名；儲存後可一併寫入 Nginx 管理設定"
        >
          <FormLayout>
            <Field
              label="主要域名"
              htmlFor="net-domain"
              required
              hint="訪客用來開啟網站的域名，例如 app.example.com"
              flush
            >
              <input
                id="net-domain"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="app.example.com"
                disabled={suspended}
                autoComplete="off"
              />
            </Field>
            <Field
              label="別名"
              htmlFor="net-aliases"
              hint="每行一個，例如 www 或 blog 子域名"
              flush
              fullWidth
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
          </FormLayout>
          <FormActions>
            <Button
              variant="secondary"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={() => void saveNetwork(false)}
            >
              只儲存
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              title={!hasDomain ? '請先填寫主要域名' : undefined}
              onClick={() => void saveNetwork(true, false)}
            >
              儲存並發布 Nginx
            </Button>
          </FormActions>
          {!hasDomain ? (
            <p className="muted u-text-sm u-mt-3 u-mb-0">填寫主要域名後才可發布站點。</p>
          ) : null}
        </CardSection>
      </Card>

      {/* 2. HTTPS */}
      <Card>
        <CardSection
          title="HTTPS 與重新導向"
          description="於發布 Nginx 時寫入；需已有 SSL 憑證才生效"
        >
          <div className="form-switches">
            <CheckboxField
              id="net-https"
              label="強制使用 HTTPS"
              description="把 HTTP 自動轉到 HTTPS（301）"
              checked={forceHttps}
              onChange={setForceHttps}
              disabled={suspended}
            />
            <CheckboxField
              id="net-hsts"
              label="啟用 HSTS"
              description="瀏覽器記住只走 HTTPS（建議在強制 HTTPS 後開啟）"
              checked={hsts}
              onChange={setHsts}
              disabled={suspended || !forceHttps}
            />
          </div>
          <FormLayout>
            <Field
              label="整站重新導向網址"
              htmlFor="net-redir"
              hint="可留空。填寫後整站會 301 到此網址（會取代反向代理）"
              flush
            >
              <input
                id="net-redir"
                value={redirectUrl}
                onChange={(e) => setRedirectUrl(e.target.value)}
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
              onClick={() => void saveNetwork(false)}
            >
              儲存 HTTPS 設定
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      {/* 3. Advanced */}
      <Card>
        <CardSection
          title="進階"
          description="網站目錄、綁定 IP、瀏覽器登入保護"
        >
          <FormHint>
            Nginx 管理檔：{' '}
            {project.nginxConfigPath ? (
              <code className="inline">{project.nginxConfigPath}</code>
            ) : (
              <span className="muted">{t('projects.nginxNone')}</span>
            )}
          </FormHint>

          <button
            type="button"
            className="btn btn--ghost btn--sm u-mb-4"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? '收起進階選項' : '展開進階選項'}
          </button>

          {advancedOpen ? (
            <>
              <FormLayout columns={2}>
                <Field
                  label="網站目錄"
                  htmlFor="net-doc"
                  hint="相對專案 home，例如 app/public"
                  flush
                >
                  <input
                    id="net-doc"
                    value={docRoot}
                    onChange={(e) => setDocRoot(e.target.value)}
                    placeholder="app/public"
                    disabled={suspended}
                  />
                </Field>
                <Field
                  label="綁定 IP"
                  htmlFor="net-ip"
                  hint="留空 = 聽全部網卡"
                  flush
                >
                  <input
                    id="net-ip"
                    value={bindIp}
                    onChange={(e) => setBindIp(e.target.value)}
                    placeholder="留空或 203.0.113.10"
                    disabled={suspended}
                  />
                </Field>
                <Field
                  label="瀏覽器登入保護 · 用戶名"
                  htmlFor="net-au"
                  hint="可留空以關閉 HTTP Basic Auth"
                  flush
                >
                  <input
                    id="net-au"
                    value={authUser}
                    onChange={(e) => setAuthUser(e.target.value)}
                    disabled={suspended}
                    autoComplete="username"
                  />
                </Field>
                <Field label="瀏覽器登入保護 · 密碼" htmlFor="net-ap" flush>
                  <input
                    id="net-ap"
                    type="password"
                    value={authPass}
                    onChange={(e) => setAuthPass(e.target.value)}
                    disabled={suspended}
                    autoComplete="new-password"
                    placeholder="不改請留空"
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="secondary"
                  size="md"
                  loading={localBusy}
                  disabled={suspended}
                  onClick={() => void saveNetwork(false)}
                >
                  儲存進階設定
                </Button>
              </FormActions>
            </>
          ) : null}

          <FormActions>
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              title={!hasDomain ? '請先填寫並儲存主要域名' : undefined}
              onClick={() => void saveNetwork(true, false)}
            >
              發布 Nginx
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              onClick={() => void saveNetwork(true, true)}
            >
              發布 Nginx + SSL
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={localBusy}
              disabled={suspended}
              onClick={onPublish}
            >
              用已存設定發布
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              onClick={onPublishSsl}
            >
              用已存設定 + SSL
            </Button>
          </FormActions>
          <p className="muted u-text-sm u-mt-3 u-mb-0">
            「發布」會寫入管理 conf；真正同步到系統 Nginx 需系統變更權限。
          </p>
        </CardSection>
      </Card>
    </div>
  );
}
