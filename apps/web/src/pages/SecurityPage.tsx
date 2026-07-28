/**
 * Security — tabbed: 2FA · API Keys · 審批 · Allowlist
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSecurity } from '../features/security';
import { api } from '../shared/services/api';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  SummaryStrip,
  Tabs,
} from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';

const TAB_IDS = ['account', 'keys', 'sftp', 'approvals', 'allowlist'] as const;

export function SecurityPage() {
  const { t } = useTranslation();
  const { tools, approvals, error, result, busy, runSysInfo, approve } = useSecurity();
  const [tab, setTab] = usePageTab(TAB_IDS, 'account');
  const [totpStatus, setTotpStatus] = useState<{ enabled: boolean; enrolled: boolean } | null>(
    null,
  );
  const [totpSecret, setTotpSecret] = useState<string | null>(null);
  const [totpUrl, setTotpUrl] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpMsg, setTotpMsg] = useState<string | null>(null);
  const [totpErr, setTotpErr] = useState<string | null>(null);
  const [totpBusy, setTotpBusy] = useState(false);
  const [apiKeys, setApiKeys] = useState<
    Array<{ id: string; name: string; prefix: string; created_at: string }>
  >([]);
  const [newKeyName, setNewKeyName] = useState('panel-api');
  const [newKeyToken, setNewKeyToken] = useState<string | null>(null);

  const refreshTotp = useCallback(async () => {
    setTotpStatus(await api.totpStatus());
  }, []);

  const refreshKeys = useCallback(async () => {
    const r = await api.listApiKeys();
    setApiKeys(r.items ?? []);
  }, []);

  useEffect(() => {
    void refreshTotp().catch(() => undefined);
    void refreshKeys().catch(() => undefined);
  }, [refreshTotp, refreshKeys]);

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
      title={t('security.title')}
      subtitle={t('security.allowlist')}
      showCapability={false}
      actions={
        <Button variant="primary" size="md" loading={busy} onClick={() => void runSysInfo()}>
          {t('security.runSysInfo')}
        </Button>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {totpErr ? <Alert variant="error">{totpErr}</Alert> : null}
      {totpMsg ? <Alert variant="ok">{totpMsg}</Alert> : null}
      <Alert variant="info">{t('security.llmUntrusted')}</Alert>

      <SummaryStrip
        items={[
          { label: '工具', value: tools.length },
          { label: '允許', value: allowed, tone: 'ok' },
          { label: '需批准', value: needsApproval, tone: 'warn' },
          {
            label: '待批',
            value: approvals.length,
            tone: approvals.length > 0 ? 'danger' : 'default',
          },
          {
            label: '2FA',
            value: totpStatus?.enabled ? '已啟用' : '未啟用',
            tone: totpStatus?.enabled ? 'ok' : 'warn',
          },
        ]}
      />

      <Tabs
        tabs={[
          { id: 'account', label: '帳戶安全' },
          { id: 'keys', label: 'API 金鑰', badge: apiKeys.length || undefined },
          { id: 'sftp', label: 'SFTP / sshd' },
          { id: 'approvals', label: '審批', badge: approvals.length || undefined },
          { id: 'allowlist', label: '允許清單', badge: tools.length || undefined },
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
                <div className="btn-row u-mt-3">
                  <Button
                    variant="primary"
                    size="md"
                    loading={totpBusy}
                    onClick={() => {
                      setTotpBusy(true);
                      setTotpErr(null);
                      void api
                        .totpBegin()
                        .then((r) => {
                          setTotpSecret(r.secret);
                          setTotpUrl(r.otpauthUrl);
                          setTotpMsg('已產生密鑰 — 用驗證器 App 掃描後輸入 6 位碼確認');
                          return refreshTotp();
                        })
                        .catch((e: Error) => setTotpErr(e.message))
                        .finally(() => setTotpBusy(false));
                    }}
                  >
                    {totpStatus?.enabled ? '重新設定 2FA' : '開始設定 2FA'}
                  </Button>
                </div>
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
                            .then(() => {
                              setTotpMsg('2FA 已啟用');
                              setTotpSecret(null);
                              setTotpCode('');
                              return refreshTotp();
                            })
                            .catch((e: Error) => setTotpErr(e.message))
                            .finally(() => setTotpBusy(false));
                        }}
                      >
                        確認啟用
                      </Button>
                      {totpStatus?.enabled ? (
                        <Button
                          variant="danger"
                          size="md"
                          loading={totpBusy}
                          onClick={() => {
                            setTotpBusy(true);
                            setTotpErr(null);
                            void api
                              .totpDisable(totpCode)
                              .then(() => {
                                setTotpMsg('2FA 已關閉');
                                setTotpSecret(null);
                                setTotpCode('');
                                return refreshTotp();
                              })
                              .catch((e: Error) => setTotpErr(e.message))
                              .finally(() => setTotpBusy(false));
                          }}
                        >
                          關閉 2FA
                        </Button>
                      ) : null}
                    </FormActions>
                  </div>
                ) : null}
              </CardSection>
            </Card>
            <Card>
              <CardSection title="主機探測" description="讀取主機資訊（allowlist 工具）">
                {probeItems.length > 0 ? (
                  <DescriptionList columns={2} items={probeItems} />
                ) : (
                  <p className="muted">
                    尚未執行 — 按右上角「{t('security.runSysInfo')}」
                  </p>
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'keys' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="API 存取金鑰"
                description="建立後完整 token 只顯示一次。請求時：Authorization: Bearer ysk_…"
              >
                {newKeyToken ? (
                  <Alert variant="ok">
                    新金鑰（僅顯示一次）：<code className="inline">{newKeyToken}</code>
                    <FormHint>
                      curl 範例：Authorization: Bearer {newKeyToken.slice(0, 12)}…
                    </FormHint>
                  </Alert>
                ) : null}
                <FormHint>
                  API key 與登入 session 同等權限（所屬用戶角色）。請勿提交到 git 或公開日誌。
                </FormHint>
                <FormLayout columns={2}>
                  <Field
                    label="名稱"
                    htmlFor="ak-name"
                    flush
                    required
                    hint="方便辨識，例如 CI／備份腳本"
                  >
                    <input
                      id="ak-name"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="ci-deploy"
                      spellCheck={false}
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
                      void api
                        .createApiKey(newKeyName)
                        .then((r) => {
                          setNewKeyToken(r.token);
                          setTotpMsg('API 金鑰已建立');
                          return refreshKeys();
                        })
                        .catch((e: Error) => setTotpErr(e.message))
                        .finally(() => setTotpBusy(false));
                    }}
                  >
                    建立金鑰
                  </Button>
                </FormActions>
                {apiKeys.length > 0 ? (
                  <ul className="list-plain list-spaced u-mt-4">
                    {apiKeys.map((k) => (
                      <li key={k.id} className="btn-row u-justify-between">
                        <span>
                          <strong>{k.name}</strong> · <code className="inline">{k.prefix}…</code>
                        </span>
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
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="尚未有 API key" description="上方輸入名稱後建立" />
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'sftp' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="sshd SFTP 片段（專案 Linux 用戶）"
                description="Match ysks_*/ysk_* + internal-sftp + home/.ssh/authorized_keys"
              >
                <FormHint>
                  專案資源頁或 SFTP 金鑰可綁 projectId 寫入 home/.ssh。此處安裝系統
                  sshd_config.d 片段（需 root）。
                </FormHint>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={totpBusy}
                    onClick={() => {
                      setTotpBusy(true);
                      setTotpErr(null);
                      void api
                        .requestRaw<{ snippet: string; notes: string[] }>(
                          '/api/v1/sftp/sshd-snippet',
                        )
                        .then((r) => {
                          setTotpMsg(
                            (r.notes ?? []).join('；') +
                              '\n\n' +
                              (r.snippet ?? '').slice(0, 800),
                          );
                          void navigator.clipboard?.writeText(r.snippet ?? '');
                        })
                        .catch((e: Error) => setTotpErr(e.message))
                        .finally(() => setTotpBusy(false));
                    }}
                  >
                    預覽並複製片段
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    loading={totpBusy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          '將片段寫入 /etc/ssh/sshd_config.d 並 reload sshd？需 root + YSK_EXECUTE',
                        )
                      ) {
                        return;
                      }
                      setTotpBusy(true);
                      setTotpErr(null);
                      void api
                        .requestRaw<{ ok: boolean; notes: string[]; snippet?: string }>(
                          '/api/v1/sftp/sshd-snippet/apply',
                          {
                            method: 'POST',
                            body: JSON.stringify({ installSystem: true, chroot: false }),
                          },
                        )
                        .then((r) => {
                          setTotpMsg((r.notes ?? []).join('；') || (r.ok ? '已套用' : '未完成'));
                        })
                        .catch((e: Error) => setTotpErr(e.message))
                        .finally(() => setTotpBusy(false));
                    }}
                  >
                    安裝到系統並 reload
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
          </div>
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
            <Card>
              <CardSection title={`Allowlist (${tools.length})`}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tool</th>
                        <th>Allowed</th>
                        <th>Risk</th>
                        <th>Approval</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tools.map((tool) => (
                        <tr key={String(tool.tool)}>
                          <td>
                            <code className="inline">{String(tool.tool)}</code>
                          </td>
                          <td>
                            <Badge tone={tool.allowed ? 'ok' : 'danger'}>
                              {String(tool.allowed)}
                            </Badge>
                          </td>
                          <td>{String(tool.risk)}</td>
                          <td>{String(tool.requiresApproval)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardSection>
            </Card>
          </div>
        ) : null}
      </Tabs>
    </FeaturePageLayout>
  );
}
