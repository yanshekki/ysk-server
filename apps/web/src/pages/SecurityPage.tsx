/**
 * Security — 2FA · API Keys · SSH 工作台 · 審批 · Allowlist
 * SSH UX lives in features/security/ssh (job-to-be-done workspace).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useSecurity } from '../features/security';
import { SshWorkspace } from '../features/security/ssh';
import { api } from '../shared/services/api';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DataTable,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  PromptDialog,
  PageTabs,
} from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';

const TAB_IDS = ['account', 'keys', 'ssh', 'approvals', 'allowlist', 'about'] as const;

export function SecurityPage() {
  const { t } = useTranslation();
  const { tools, approvals, error, result, busy, runSysInfo, approve } = useSecurity();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = usePageTab(TAB_IDS, 'account');
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [totpStatus, setTotpStatus] = useState<{ enabled: boolean; enrolled: boolean } | null>(
    null,
  );
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpUrl, setTotpUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpMsg, setTotpMsg] = useState<string | null>(null);
  const [totpErr, setTotpErr] = useState<string | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [reauthPassword, setReauthPassword] = useState('');
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      created_at: string;
      last_seen_at?: string;
      ip?: string;
      user_agent?: string;
      current?: boolean;
    }>
  >([]);
  const [requireAdminTotp, setRequireAdminTotp] = useState(false);
  const [requireStrict, setRequireStrict] = useState(false);
  const [policyTotp, setPolicyTotp] = useState('');
  const [apiKeys, setApiKeys] = useState<
    Array<{ id: string; name: string; prefix: string; created_at: string }>
  >([]);
  const [newKeyName, setNewKeyName] = useState('panel-api');
  const [newKeyToken, setNewKeyToken] = useState<string | null>(null);
  const [totpPrompt, setTotpPrompt] = useState<
    null | { kind: 'backup' } | { kind: 'apiKey' }
  >(null);
  const [sshCounts, setSshCounts] = useState({ identities: 0, loginKeys: 0 });

  // Legacy ?tab=identities|sftp → ssh workspace
  useEffect(() => {
    const legacy = searchParams.get('tab');
    if (legacy === 'identities' || legacy === 'sftp') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'ssh');
      next.set('ssh', legacy === 'sftp' ? 'login' : 'outbound');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const refreshTotp = useCallback(async () => {
    setTotpStatus(await api.totpStatus());
  }, []);

  const refreshKeys = useCallback(async () => {
    const r = await api.listApiKeys();
    setApiKeys(r.items ?? []);
  }, []);

  const refreshSessions = useCallback(async () => {
    const r = await api.listSessions();
    setSessions(r.items ?? []);
  }, []);

  const refreshPolicy = useCallback(async () => {
    try {
      const r = await api.getSecuritySettings();
      setRequireAdminTotp(Boolean(r.requireAdminTotp));
      setRequireStrict(Boolean(r.requireAdminTotpStrict));
    } catch {
      /* non-admin */
    }
  }, []);

  useEffect(() => {
    void refreshTotp().catch(() => undefined);
    void refreshKeys().catch(() => undefined);
    void refreshSessions().catch(() => undefined);
    void refreshPolicy().catch(() => undefined);
  }, [refreshTotp, refreshKeys, refreshSessions, refreshPolicy]);

  const allowed = tools.filter((tool) => tool.allowed).length;
  const needsApproval = tools.filter((tool) => tool.requiresApproval).length;

  const probeItems = (() => {
    if (!result) return [];
    try {
      const o = JSON.parse(result) as Record<string, unknown>;
      return Object.entries(o)
        .filter(([, v]) => v == null || typeof v !== 'object')
        .slice(0, 16)
        .map(([k, v]) => ({ label: k, value: String(v) }));
    } catch {
      return [{ label: '輸出', value: result.slice(0, 500) }];
    }
  })();

  return (
    <FeaturePageLayout
      title={t('nav.security', { defaultValue: '帳號安全' })}
      showCapability={false}
      status={{
        pill: {
          label:
            approvals.length > 0
              ? `${approvals.length} 待批`
              : totpStatus?.enabled
                ? '就緒'
                : '2FA 未啟用',
          tone: approvals.length > 0 ? 'warn' : totpStatus?.enabled ? 'ok' : 'warn',
        },
        items: [
          {
            label: '2FA',
            value: totpStatus?.enabled ? '開' : '關',
            tone: totpStatus?.enabled ? 'ok' : 'warn',
          },
          { label: 'API', value: apiKeys.length },
          {
            label: 'SSH',
            value: `${sshCounts.identities}/${sshCounts.loginKeys}`,
          },
          {
            label: '待批',
            value: approvals.length,
            tone: approvals.length > 0 ? 'danger' : 'ok',
          },
        ],
      }}
      actions={<Button variant="secondary" size="sm" loading={busy} onClick={() => void runSysInfo()}>
          {t('security.runSysInfo')}
        </Button>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {totpErr ? <Alert variant="error">{totpErr}</Alert> : null}
      {totpMsg ? <Alert variant="ok">{totpMsg}</Alert> : null}
      {newKeyToken ? (
        <Alert variant="ok">
          API token（只顯示一次）：<code className="inline u-break-all">{newKeyToken}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(newKeyToken);
              setTotpMsg('已複製 token');
            }}
          >
            複製
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNewKeyToken(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'account', label: '帳戶安全' },
          { id: 'keys', label: 'API 金鑰', badge: apiKeys.length || undefined },
          {
            id: 'ssh',
            label: 'SSH',
            badge: sshCounts.identities + sshCounts.loginKeys || undefined,
          },
          { id: 'approvals', label: '審批', badge: approvals.length || undefined },
          { id: 'allowlist', label: '允許清單', badge: tools.length || undefined },
        
          { id: 'about', label: '說明' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'account' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title="操作員雙重驗證 (TOTP)">
                <p className="muted u-text-sm">
                  狀態：
                  {totpStatus?.enabled
                    ? '已啟用'
                    : totpStatus?.enrolled
                      ? '已產生密鑰、未確認'
                      : '未設定'}
                </p>
                <FormLayout columns={2}>
                  <Field
                    label="重新驗證密碼"
                    htmlFor="reauth-pw"
                    flush
                    hint="開始／重設 2FA 需要再輸入密碼（防 session 被盜）"
                  >
                    <input
                      id="reauth-pw"
                      type="password"
                      value={reauthPassword}
                      onChange={(e) => setReauthPassword(e.target.value)}
                      autoComplete="current-password"
                    />
                  </Field>
                </FormLayout>
                <ActionBar className="u-mt-3">
                  <Button
                    variant="primary"
                    size="md"
                    loading={totpBusy}
                    disabled={!reauthPassword}
                    onClick={() => {
                      setTotpBusy(true);
                      setTotpErr(null);
                      void api
                        .totpBegin({ password: reauthPassword })
                        .then((r) => {
                          setTotpSecret(r.secret);
                          setTotpUrl(r.otpauthUrl);
                          setTotpMsg('已產生密鑰 — 用驗證器 App 掃描後輸入 6 位碼確認');
                          setReauthPassword('');
                          return refreshTotp();
                        })
                        .catch((e: Error) => setTotpErr(e.message))
                        .finally(() => setTotpBusy(false));
                    }}
                  >
                    {totpStatus?.enabled ? '重新設定 2FA' : '開始設定 2FA'}
                  </Button>
                </ActionBar>
                {totpSecret ? (
                  <div className="u-mt-4">
                    <FormHint>
                      密鑰：<code className="inline">{totpSecret}</code>
                      {totpUrl ? (
                        <>
                          <br />
                          otpauth：
                          <code className="inline u-break-all">{totpUrl}</code>
                        </>
                      ) : null}
                    </FormHint>
                    <FormLayout columns={2}>
                      <Field
                        label="確認碼"
                        htmlFor="totp-confirm"
                        flush
                        required
                        hint="Authenticator 顯示的 6 位數字"
                      >
                        <input
                          id="totp-confirm"
                          value={totpCode}
                          onChange={(e) => setTotpCode(e.target.value)}
                          maxLength={6}
                          placeholder="000000"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                        />
                      </Field>
                    </FormLayout>
                    <FormActions>
                      <Button
                        variant="primary"
                        size="md"
                        loading={totpBusy}
                        onClick={() => {
                          setTotpBusy(true);
                          setTotpErr(null);
                          void api
                            .totpConfirm(totpCode)
                            .then((r) => {
                              setTotpMsg(
                                '2FA 已啟用 — 請立即保存下方 recovery codes（只顯示一次）',
                              );
                              setRecoveryCodes(r.recoveryCodes ?? null);
                              setTotpSecret(null);
                              setTotpUrl(null);
                              setTotpCode('');
                              return refreshTotp();
                            })
                            .catch((e: Error) => setTotpErr(e.message))
                            .finally(() => setTotpBusy(false));
                        }}
                      >
                        確認啟用
                      </Button>
                    </FormActions>
                  </div>
                ) : null}
                {recoveryCodes && recoveryCodes.length > 0 ? (
                  <div className="u-mt-4">
                    <FormHint>
                      恢復碼（離線保存；每個只用一次）。登入時可填 recoveryCode 代替 App 碼。
                    </FormHint>
                    <pre className="u-font-mono u-text-sm">
                      {recoveryCodes.join('\n')}
                    </pre>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
                        setTotpMsg('已複製 recovery codes');
                      }}
                    >
                      複製全部
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRecoveryCodes(null)}
                    >
                      我已保存，關閉
                    </Button>
                  </div>
                ) : null}
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="工作階段"
                description="閒置 4 小時或最長 24 小時會失效。可撤銷其他裝置。"
              >
                <ActionBar className="u-mb-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void refreshSessions().catch(() => undefined)}
                  >
                    重新整理
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      void api
                        .revokeOtherSessions()
                        .then((r) => {
                          setTotpMsg(`已撤銷 ${r.revoked} 個其他工作階段`);
                          return refreshSessions();
                        })
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    撤銷其他階段
                  </Button>
                </ActionBar>
                {sessions.length === 0 ? (
                  <EmptyState title="無工作階段資料" />
                ) : (
                  <ul className="list-plain list-spaced">
                    {sessions.map((s) => (
                      <li key={s.id} className="u-justify-between u-flex-wrap">
                        <span>
                          <code className="inline">{s.id}…</code>
                          {s.current ? <Badge tone="ok">目前</Badge> : null}
                          <div className="muted u-text-sm">
                            {s.ip ?? '—'} · {s.last_seen_at ?? s.created_at}
                          </div>
                          {s.user_agent ? (
                            <div className="muted u-text-sm u-break-all">
                              {s.user_agent.slice(0, 80)}
                            </div>
                          ) : null}
                        </span>
                        {!s.current ? (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              void api
                                .revokeSession(s.id)
                                .then(() => refreshSessions())
                                .catch((e: Error) => setTotpErr(e.message));
                            }}
                          >
                            撤銷
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="Passkey / WebAuthn"
                description="硬體或平台驗證器作為第二因素（step-up）。需 HTTPS 或 localhost。"
              >
                <ActionBar className="u-mb-3">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={totpBusy}
                    onClick={() => {
                      setTotpBusy(true);
                      void (async () => {
                        try {
                          const { startRegistration } = await import(
                            '@simplewebauthn/browser'
                          );
                          const begin = await api.requestRaw<{
                            options: PublicKeyCredentialCreationOptionsJSON;
                          }>('/api/v1/auth/webauthn/register/begin', {
                            method: 'POST',
                            body: '{}',
                          });
                          const att = await startRegistration({
                            optionsJSON: begin.options as never,
                          });
                          const fin = await api.requestRaw<{
                            ok: boolean;
                            notes?: string[];
                          }>('/api/v1/auth/webauthn/register/finish', {
                            method: 'POST',
                            body: JSON.stringify({ response: att, name: 'Passkey' }),
                          });
                          setTotpMsg(
                            fin.ok
                              ? 'Passkey 已登記'
                              : (fin.notes ?? []).join('；') || '失敗',
                          );
                        } catch (e) {
                          setTotpErr(e instanceof Error ? e.message : 'WebAuthn 失敗');
                        } finally {
                          setTotpBusy(false);
                        }
                      })();
                    }}
                  >
                    登記 Passkey
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={totpBusy}
                    onClick={() => {
                      setTotpBusy(true);
                      void (async () => {
                        try {
                          const { startAuthentication } = await import(
                            '@simplewebauthn/browser'
                          );
                          const begin = await api.requestRaw<{
                            ok: boolean;
                            options?: PublicKeyCredentialRequestOptionsJSON;
                            notes?: string[];
                          }>('/api/v1/auth/webauthn/authenticate/begin', {
                            method: 'POST',
                            body: '{}',
                          });
                          if (!begin.ok || !begin.options) {
                            setTotpErr((begin.notes ?? []).join('；') || '無 passkey');
                            return;
                          }
                          const ass = await startAuthentication({
                            optionsJSON: begin.options as never,
                          });
                          const fin = await api.requestRaw<{ ok: boolean; notes?: string[] }>(
                            '/api/v1/auth/webauthn/authenticate/finish',
                            {
                              method: 'POST',
                              body: JSON.stringify({ response: ass }),
                            },
                          );
                          setTotpMsg(
                            fin.ok
                              ? 'Passkey 驗證成功（已 step-up）'
                              : (fin.notes ?? []).join('；') || '失敗',
                          );
                        } catch (e) {
                          setTotpErr(e instanceof Error ? e.message : '驗證失敗');
                        } finally {
                          setTotpBusy(false);
                        }
                      })();
                    }}
                  >
                    用 Passkey 驗證 (step-up)
                  </Button>
                </ActionBar>
                <FormHint>
                  登入仍用密碼+TOTP；Passkey 用於高危操作 step-up。詳見安全文件。
                </FormHint>
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="記住的裝置 / 加密備份 / Fail2ban"
                description="deviceToken 可跳過 TOTP（30 天）；備份含 secret 加密；Fail2ban 片段寫入 dataDir"
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      void api
                        .requestRaw<{ items: Array<{ id: string; ip?: string }> }>(
                          '/api/v1/auth/devices',
                        )
                        .then((r) =>
                          setTotpMsg(`信任裝置：${(r.items ?? []).length} 個`),
                        )
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    查看信任裝置
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      void api
                        .requestRaw('/api/v1/auth/devices', { method: 'DELETE' })
                        .then(() => setTotpMsg('已撤銷全部信任裝置'))
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    撤銷全部裝置
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setTotpPrompt({ kind: 'backup' })}
                  >
                    匯出 2FA 加密備份
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void api
                        .requestRaw<{ written?: string[]; notes?: string[] }>(
                          '/api/v1/security/fail2ban-snippets',
                        )
                        .then((r) =>
                          setTotpMsg(
                            `Fail2ban 片段：${(r.written ?? []).join(', ')} — ${(r.notes ?? []).join('；')}`,
                          ),
                        )
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    產生 Fail2ban 片段
                  </Button>
                </FormActions>
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="管理員 2FA 政策"
                description="建議開啟。Strict 會拒絕未開 2FA 的 admin 登入（需已有 2FA 帳號才能關）。"
              >
                <label className="ssh-check">
                  <input
                    type="checkbox"
                    checked={requireAdminTotp}
                    onChange={(e) => setRequireAdminTotp(e.target.checked)}
                  />
                  <span>要求 admin 啟用 2FA（登入後提示 mustEnrollTotp）</span>
                </label>
                <label className="ssh-check u-mt-2">
                  <input
                    type="checkbox"
                    checked={requireStrict}
                    onChange={(e) => setRequireStrict(e.target.checked)}
                  />
                  <span>Strict：未開 2FA 的 admin 直接拒絕登入</span>
                </label>
                <Field
                  label="確認 TOTP（改政策時）"
                  htmlFor="pol-totp"
                  flush
                  hint="開啟政策需 step-up"
                >
                  <input
                    id="pol-totp"
                    value={policyTotp}
                    onChange={(e) => setPolicyTotp(e.target.value)}
                    maxLength={12}
                    placeholder="6 位碼"
                  />
                </Field>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => {
                      void api
                        .setSecuritySettings({
                          requireAdminTotp,
                          requireAdminTotpStrict: requireStrict,
                          totp: policyTotp || undefined,
                        })
                        .then(() => {
                          setTotpMsg('安全政策已更新');
                          setPolicyTotp('');
                          return refreshPolicy();
                        })
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    儲存政策
                  </Button>
                </FormActions>
              </CardSection>
            </Card>

            {probeItems.length > 0 ? (
              <Card>
                <CardSection title="最近探測">
                  <DescriptionList
                    items={probeItems.map((i) => ({ label: i.label, value: i.value }))}
                  />
                </CardSection>
              </Card>
            ) : null}
          </div>
        ) : null}

        {tab === 'keys' ? (
          <div className="tab-panel">
            <DataTable
              title="API 存取金鑰"
              description="給腳本／CI 用。完整 token 只在建立時顯示一次。"
              toolbar={
                <ActionBar>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void refreshKeys().catch(() => undefined)}
                  >
                    重新整理
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setCreateKeyOpen(true)}
                  >
                    + 建立金鑰
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: '名稱',
                  render: (k) => <strong>{k.name}</strong>,
                },
                {
                  key: 'prefix',
                  header: '前綴',
                  render: (k) => <span className="muted">{k.prefix}…</span>,
                },
                {
                  key: 'created',
                  header: '建立',
                  className: 'muted u-text-sm',
                  render: (k) => k.created_at,
                },
              ]}
              rows={apiKeys}
              rowKey={(k) => k.id}
              empty={
                <EmptyState
                  title="尚未有 API 金鑰"
                  description="用列表右上角建立；建立後可用 Bearer token 呼叫 API"
                />
              }
              rowActions={(k) => (
                <ActionBar align="end">
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      void api
                        .deleteApiKey(k.id)
                        .then(() => refreshKeys())
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    刪除
                  </Button>
                </ActionBar>
              )}
            />
          </div>
        ) : null}

        {tab === 'ssh' ? (
          <SshWorkspace onCounts={(c) => setSshCounts(c)} />
        ) : null}

        {tab === 'approvals' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('security.pending')}>
                {approvals.length === 0 ? (
                  <EmptyState title={t('security.none')} />
                ) : (
                  <div className="list-panel">
                    {approvals.map((a) => (
                      <div key={String(a.id)} className="list-row list-row--static">
                        <div className="list-row__main">
                          <div className="list-row__title">
                            <code className="inline">{String(a.action)}</code>
                            <Badge tone="warn">{String(a.risk)}</Badge>
                          </div>
                          <div className="list-row__meta">
                            <span>{String(a.requestedBy ?? a.requested_by ?? '—')}</span>
                          </div>
                        </div>
                        <div className="list-row__side">
                          <Button
                            variant="primary"
                            size="sm"
                            loading={busy}
                            onClick={() => void approve(String(a.id))}
                          >
                            批准
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'allowlist' ? (
          <div className="tab-panel">
            <DataTable
              title={`Allowlist (${tools.length})`}
              columns={[
                {
                  key: 'tool',
                  header: 'Tool',
                  render: (tool) => (
                    <code className="inline">{String(tool.tool)}</code>
                  ),
                },
                {
                  key: 'allowed',
                  header: 'Allowed',
                  nowrap: true,
                  render: (tool) => (
                    <Badge tone={tool.allowed ? 'ok' : 'danger'}>
                      {String(tool.allowed)}
                    </Badge>
                  ),
                },
                {
                  key: 'risk',
                  header: 'Risk',
                  render: (tool) => String(tool.risk),
                },
                {
                  key: 'approval',
                  header: 'Approval',
                  render: (tool) => String(tool.requiresApproval),
                },
              ]}
              rows={tools}
              rowKey={(tool) => String(tool.tool)}
              empty={<p className="muted">尚無 allowlist 工具</p>}
            />
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="security" /> : null}
      </PageTabs>

      <Modal
        open={createKeyOpen}
        onClose={() => setCreateKeyOpen(false)}
        title="建立 API 金鑰"
        description="建立後完整 token 只顯示一次"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setCreateKeyOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={totpBusy}
              onClick={() => {
                if (totpStatus?.enabled) {
                  setTotpPrompt({ kind: 'apiKey' });
                  return;
                }
                setTotpBusy(true);
                const scopeEl = document.getElementById('ak-scope') as HTMLSelectElement | null;
                const scope = scopeEl?.value === 'read' ? 'read' : 'full';
                void api
                  .requestRaw<{
                    key: { id: string; name: string; prefix: string; created_at: string };
                    token: string;
                  }>('/api/v1/auth/api-keys', {
                    method: 'POST',
                    body: JSON.stringify({ name: newKeyName, scope }),
                  })
                  .then((r) => {
                    setNewKeyToken(r.token);
                    setTotpMsg('API 金鑰已建立');
                    setCreateKeyOpen(false);
                    return refreshKeys();
                  })
                  .catch((e: Error) => setTotpErr(e.message))
                  .finally(() => setTotpBusy(false));
              }}
            >
              建立金鑰
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label="名稱" htmlFor="ak-name" flush required hint="方便辨識，例如 CI／備份腳本">
            <input
              id="ak-name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="ci-deploy"
              spellCheck={false}
            />
          </Field>
          <Field label="範圍" htmlFor="ak-scope" flush hint="read = 只讀（no full mutate）">
            <select id="ak-scope" defaultValue="full">
              <option value="full">full（完整 API）</option>
              <option value="read">read（只讀）</option>
            </select>
          </Field>
          <FormHint>若已開 2FA，建立金鑰會要求再輸入驗證碼（step-up）。</FormHint>
        </FormLayout>
      </Modal>

      <PromptDialog
        open={totpPrompt != null}
        onClose={() => !totpBusy && setTotpPrompt(null)}
        title={
          totpPrompt?.kind === 'backup'
            ? '匯出 2FA 備份'
            : '建立 API 金鑰 · step-up'
        }
        description="請輸入目前 TOTP 驗證碼"
        label="TOTP"
        secret
        placeholder="6 位數字"
        confirmLabel={totpPrompt?.kind === 'backup' ? '匯出' : '建立'}
        busy={totpBusy}
        onSubmit={async (totp) => {
          if (totpPrompt?.kind === 'backup') {
            setTotpBusy(true);
            try {
              const r = await api.requestRaw<{
                ok: boolean;
                blob?: string;
                notes?: string[];
              }>('/api/v1/auth/totp/backup', {
                method: 'POST',
                body: JSON.stringify({ totp }),
              });
              if (r.blob) {
                void navigator.clipboard?.writeText(r.blob);
                setTotpMsg('加密備份已複製到剪貼簿（離線保存）');
              } else {
                setTotpErr((r.notes ?? []).join('；') || '失敗');
                return false;
              }
            } catch (e) {
              setTotpErr(e instanceof Error ? e.message : '失敗');
              return false;
            } finally {
              setTotpBusy(false);
            }
            setTotpPrompt(null);
            return true;
          }
          if (totpPrompt?.kind === 'apiKey') {
            setTotpBusy(true);
            const scopeEl = document.getElementById(
              'ak-scope',
            ) as HTMLSelectElement | null;
            const scope = scopeEl?.value === 'read' ? 'read' : 'full';
            try {
              const r = await api.requestRaw<{
                key: {
                  id: string;
                  name: string;
                  prefix: string;
                  created_at: string;
                };
                token: string;
              }>('/api/v1/auth/api-keys', {
                method: 'POST',
                body: JSON.stringify({ name: newKeyName, totp, scope }),
              });
              setNewKeyToken(r.token);
              setTotpMsg('API 金鑰已建立');
              setCreateKeyOpen(false);
              setTotpPrompt(null);
              await refreshKeys();
            } catch (e) {
              setTotpErr(e instanceof Error ? e.message : '失敗');
              return false;
            } finally {
              setTotpBusy(false);
            }
            return true;
          }
          return true;
        }}
      />
    </FeaturePageLayout>
  );
}
