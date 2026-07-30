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
  const [advancedOpen, setAdvancedOpen] = useState(
    () => Boolean(project.docRoot || project.bindIp),
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
    if (project.docRoot || project.bindIp) setAdvancedOpen(true);
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

      {/* 2. HTTPS + whole-site redirect */}
      <Card>
        <CardSection
          title="HTTPS 與整站重新導向"
          description="儲存後請發布 Nginx。整站 301 會蓋過 proxy／PHP／static 內容"
        >
          <div className="form-switches">
            <CheckboxField
              id="net-https"
              label="強制使用 HTTPS"
              description="HTTP → HTTPS（301）；需已有 SSL 憑證並用 SSL 發布"
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
              hint="可留空。填寫後整站 301 到此網址（例如搬站／apex→www）"
              flush
              fullWidth
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
              儲存
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              onClick={() => void saveNetwork(true, forceHttps)}
            >
              儲存並發布
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      {/* 3. HTTP Basic Auth */}
      <Card>
        <CardSection
          title="HTTP 基本認證（瀏覽器登入保護）"
          description="發布時寫入 htpasswd；用戶名留空 = 關閉。密碼留空 = 沿用已存密碼"
        >
          <FormLayout columns={2}>
            <Field label="用戶名" htmlFor="net-au" flush hint="留空關閉認證">
              <input
                id="net-au"
                value={authUser}
                onChange={(e) => setAuthUser(e.target.value)}
                disabled={suspended}
                autoComplete="username"
                placeholder="admin"
              />
            </Field>
            <Field label="密碼" htmlFor="net-ap" flush hint="首次設定必填；之後不改可留空">
              <input
                id="net-ap"
                type="password"
                value={authPass}
                onChange={(e) => setAuthPass(e.target.value)}
                disabled={suspended}
                autoComplete="new-password"
                placeholder={authUser ? '設定或更新密碼' : '—'}
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
              儲存認證
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={localBusy}
              disabled={suspended || !hasDomain}
              onClick={() => void saveNetwork(true, false)}
            >
              儲存並發布 Nginx
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      {/* 4. Cache */}
      <Card>
        <CardSection
          title="Cache"
          description="靜態／PHP 靜態資源預設 Cache-Control 7d；purge 清主機 nginx cache 目錄（需 YSK_EXECUTE）"
        >
          <FormHint>
            完整 FastCGI／proxy_cache zone 需主機 nginx.conf 先定義 keys_zone；面板提供 best-effort 清除。
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
                      r.ok ? '已嘗試 purge cache' : r.notes?.join('；') ?? 'purge 失敗',
                    );
                  })
                  .catch((e: Error) => onOpsResult?.(null, e.message))
                  .finally(() => setSaving(false));
              }}
            >
              清除 Nginx cache
            </Button>
          </FormActions>
        </CardSection>
      </Card>

      {/* 5. Document root (first-class) + publish */}
      <Card>
        <CardSection
          title="網站目錄（docroot）"
          description="相對專案 home；發布 Nginx 時會用此路徑作為 root（預設 app/public）"
        >
          <FormLayout columns={1}>
            <Field
              label="文件根目錄"
              htmlFor="net-doc"
              flush
              hint={`完整路徑：${project.homeDir}/${(docRoot.trim() || 'app/public').replace(/^\//, '')}`}
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
                  customPlaceholder="自訂相對路徑…"
                  disabled={suspended || localBusy}
                />
              </div>
              <input
                id="net-doc"
                value={docRoot}
                onChange={(e) => setDocRoot(e.target.value)}
                placeholder="app/public"
                disabled={suspended}
                spellCheck={false}
              />
            </Field>
          </FormLayout>
        </CardSection>
      </Card>

      <Card>
        <CardSection title="進階與發布" description="綁定 IP、發布到系統 Nginx">
          <FormHint>
            Nginx 管理檔：{' '}
            {project.nginxConfigPath ? (
              <code className="inline">{project.nginxConfigPath}</code>
            ) : (
              <span className="muted">{t('projects.nginxNone')}</span>
            )}
            {' · '}
            發布會依 runtime 產生 proxy／PHP-FPM／static conf（含認證、導向與 docroot）
          </FormHint>

          <button
            type="button"
            className={`${buttonClassName({ variant: 'ghost', size: 'sm' })} u-mb-4`}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            {advancedOpen ? '收起綁定 IP' : '展開綁定 IP'}
          </button>

          {advancedOpen ? (
            <FormLayout columns={2}>
              <Field label="綁定 IP" htmlFor="net-ip" hint="留空 = 聽全部網卡" flush>
                <input
                  id="net-ip"
                  value={bindIp}
                  onChange={(e) => setBindIp(e.target.value)}
                  placeholder="留空 = 聽全部；可填綁定 IP"
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
            「發布」寫入管理 conf；同步到 /etc/nginx 並 reload 需系統變更權限。
          </p>
        </CardSection>
      </Card>
    </div>
  );
}
