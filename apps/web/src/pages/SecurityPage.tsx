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
  Modal,
  OpsHero,
  Tabs,
} from '../shared/components/ui';
import { usePageTab } from '../shared/hooks/usePageTab';
import { Link } from 'react-router-dom';

const TAB_IDS = ['account', 'keys', 'sftp', 'approvals', 'allowlist'] as const;

export function SecurityPage() {
  const { t } = useTranslation();
  const { tools, approvals, error, result, busy, runSysInfo, approve } = useSecurity();
  const [tab, setTab] = usePageTab(TAB_IDS, 'account');
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [createSftpOpen, setCreateSftpOpen] = useState(false);
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

  type SftpKeyRow = {
    id: string;
    username: string;
    comment?: string;
    publicKey: string;
    created_at: string;
    projectId?: string;
    linuxUser?: string;
    homeDir?: string;
  };
  const [sftpKeys, setSftpKeys] = useState<SftpKeyRow[]>([]);
  const [sftpProjects, setSftpProjects] = useState<
    Array<{ id: string; name: string; linuxUser: string; homeDir: string }>
  >([]);
  const [sftpProjectId, setSftpProjectId] = useState('');
  const [sftpPubKey, setSftpPubKey] = useState('');
  const [sftpComment, setSftpComment] = useState('');
  const [sshdSnippet, setSshdSnippet] = useState('');
  const [sshdNotes, setSshdNotes] = useState<string[]>([]);
  const [sftpBusy, setSftpBusy] = useState(false);
  const [sftpMsg, setSftpMsg] = useState<string | null>(null);
  const [sftpErr, setSftpErr] = useState<string | null>(null);

  const refreshTotp = useCallback(async () => {
    setTotpStatus(await api.totpStatus());
  }, []);

  const refreshKeys = useCallback(async () => {
    const r = await api.listApiKeys();
    setApiKeys(r.items ?? []);
  }, []);

  const refreshSftp = useCallback(async () => {
    const [keysRes, projRes] = await Promise.all([
      api.requestRaw<{ items: SftpKeyRow[] }>('/api/v1/sftp/keys'),
      api.listProjects(),
    ]);
    setSftpKeys(keysRes.items ?? []);
    setSftpProjects(
      (projRes.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        linuxUser: p.linuxUser,
        homeDir: p.homeDir,
      })),
    );
  }, []);

  useEffect(() => {
    void refreshTotp().catch(() => undefined);
    void refreshKeys().catch(() => undefined);
  }, [refreshTotp, refreshKeys]);

  useEffect(() => {
    if (tab !== 'sftp') return;
    setSftpErr(null);
    void refreshSftp().catch((e: Error) => setSftpErr(e.message));
    void api
      .requestRaw<{ snippet: string; notes: string[] }>('/api/v1/sftp/sshd-snippet')
      .then((r) => {
        setSshdSnippet(r.snippet ?? '');
        setSshdNotes(r.notes ?? []);
      })
      .catch((e: Error) => setSftpErr(e.message));
  }, [tab, refreshSftp]);

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
      actions={
        <>
          <Button variant="primary" size="md" loading={busy} onClick={() => void runSysInfo()}>
            {t('security.runSysInfo')}
          </Button>
          <Link to="/users" className="btn btn--ghost btn--md">
            用戶
          </Link>
          <Link to="/protection" className="btn btn--ghost btn--md">
            防護
          </Link>
        </>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {totpErr ? <Alert variant="error">{totpErr}</Alert> : null}
      {totpMsg ? <Alert variant="ok">{totpMsg}</Alert> : null}
      {sftpErr ? <Alert variant="error">{sftpErr}</Alert> : null}
      {sftpMsg ? (
        <Alert variant="ok">
          {sftpMsg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setSftpMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      <OpsHero
        eyebrow="Security"
        title="帳戶 · 金鑰 · 審批"
        pill={approvals.length > 0 ? `${approvals.length} 待批` : '就緒'}
        pillTone={approvals.length > 0 ? 'warn' : totpStatus?.enabled ? 'ok' : 'warn'}
        tone={approvals.length > 0 ? 'warn' : 'ok'}
        hint={t('security.llmUntrusted')}
        meta={
          <>
            <span>
              工具 <strong>{tools.length}</strong>
            </span>
            <span className="ops-hero__dot" />
            <span>
              允許 <strong>{allowed}</strong>
            </span>
            <span className="ops-hero__dot" />
            <span>
              2FA <strong>{totpStatus?.enabled ? '開' : '關'}</strong>
            </span>
          </>
        }
        cta={
          <>
            <Button variant="primary" size="md" loading={busy} onClick={() => void runSysInfo()}>
              {t('security.runSysInfo')}
            </Button>
            <Button variant="secondary" size="md" onClick={() => setTab('approvals')}>
              審批
            </Button>
            <Button variant="ghost" size="md" onClick={() => setTab('account')}>
              2FA
            </Button>
          </>
        }
        stats={[
          { label: '工具', value: tools.length },
          { label: '允許', value: <Badge tone="ok">{allowed}</Badge> },
          {
            label: '需批准',
            value: <Badge tone={needsApproval ? 'warn' : 'neutral'}>{needsApproval}</Badge>,
          },
          {
            label: '待批',
            value: (
              <Badge tone={approvals.length > 0 ? 'danger' : 'ok'}>{approvals.length}</Badge>
            ),
          },
        ]}
        rail={
          <>
            <li>
              <span className="ops-rail__k">2FA</span>
              <Badge tone={totpStatus?.enabled ? 'ok' : 'warn'}>
                {totpStatus?.enabled ? '已啟用' : '未啟用'}
              </Badge>
            </li>
            <li>
              <span className="ops-rail__k">API keys</span>
              <span className="ops-rail__text">{apiKeys.length}</span>
            </li>
            <li>
              <span className="ops-rail__k">SFTP keys</span>
              <span className="ops-rail__text">{sftpKeys.length}</span>
            </li>
          </>
        }
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
                <div className="btn-row u-mb-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setNewKeyName('');
                      setCreateKeyOpen(true);
                    }}
                  >
                    + 建立金鑰
                  </Button>
                </div>
                {apiKeys.length > 0 ? (
                  <ul className="list-plain list-spaced">
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
                  <EmptyState
                    title="尚未有 API key"
                    description="按「建立金鑰」開啟對話框"
                    action={
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                          setNewKeyName('');
                          setCreateKeyOpen(true);
                        }}
                      >
                        + 建立金鑰
                      </Button>
                    }
                  />
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'sftp' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="SFTP 說明"
                description="跟專案 Linux 用戶隔離，唔係共用一個全局 SFTP 帳戶"
              >
                <ul className="list-plain list-spaced u-mb-0">
                  <li>
                    每個專案有自己嘅 <code className="inline">ysks_*</code> 用戶與{' '}
                    <code className="inline">/home/ysk-server-{'{id}'}</code>
                  </li>
                  <li>SSH 公鑰寫入該專案 home 的 <code className="inline">.ssh/authorized_keys</code></li>
                  <li>
                    系統 sshd 需安裝 Match 片段（下方）先允許專案用戶用{' '}
                    <code className="inline">internal-sftp</code>
                  </li>
                  <li>
                    寫入 ≠ 線上生效：安裝片段需 <strong>root + YSK_EXECUTE</strong>
                  </li>
                </ul>
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="SSH 公鑰（綁專案）"
                description="選擇專案後，金鑰會寫入該專案 home/.ssh"
              >
                <div className="btn-row u-mb-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setSftpPubKey('');
                      setSftpComment('');
                      setCreateSftpOpen(true);
                    }}
                  >
                    + 新增公鑰
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={sftpBusy}
                    onClick={() => {
                      setSftpBusy(true);
                      void refreshSftp()
                        .catch((e: Error) => setSftpErr(e.message))
                        .finally(() => setSftpBusy(false));
                    }}
                  >
                    重新整理
                  </Button>
                </div>
                {sftpProjects.length === 0 ? (
                  <EmptyState
                    title="尚未有專案"
                    description="請先建立專案並（建議）建立系統用戶，再綁 SFTP 金鑰"
                  />
                ) : null}
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={`已登記金鑰（${sftpKeys.length}）`}
                description="面板管理記錄；實際登入仍取決於 sshd 與檔案權限"
              >
                {sftpKeys.length === 0 ? (
                  <EmptyState
                    title="尚未有 SFTP 公鑰"
                    description="按「新增公鑰」開啟對話框"
                    action={
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                          setSftpPubKey('');
                          setSftpComment('');
                          setCreateSftpOpen(true);
                        }}
                      >
                        + 新增公鑰
                      </Button>
                    }
                  />
                ) : (
                  <ul className="list-plain list-spaced u-mb-0">
                    {sftpKeys.map((k) => (
                      <li key={k.id} className="btn-row u-justify-between u-flex-wrap">
                        <span>
                          <strong>{k.username}</strong>
                          {k.comment ? (
                            <span className="muted"> · {k.comment}</span>
                          ) : null}
                          {k.projectId ? (
                            <Badge tone="info">專案</Badge>
                          ) : (
                            <Badge tone="neutral">無專案</Badge>
                          )}
                          <div className="muted u-text-sm u-break-all">
                            {k.publicKey.slice(0, 72)}
                            {k.publicKey.length > 72 ? '…' : ''}
                          </div>
                          {k.homeDir ? (
                            <div className="muted u-text-sm">{k.homeDir}/.ssh</div>
                          ) : null}
                        </span>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={sftpBusy}
                          onClick={() => {
                            setSftpBusy(true);
                            void api
                              .requestRaw(`/api/v1/sftp/keys/${k.id}`, { method: 'DELETE' })
                              .then(() => {
                                setSftpMsg('已刪除金鑰');
                                return refreshSftp();
                              })
                              .catch((e: Error) => setSftpErr(e.message))
                              .finally(() => setSftpBusy(false));
                          }}
                        >
                          刪除
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title="sshd 系統片段"
                description="Match ysks_* / ysk_* → internal-sftp；寫入 /etc/ssh/sshd_config.d"
              >
                <FormHint>
                  預覽在下方。安裝會複製到系統並嘗試 reload sshd（需 root + YSK_EXECUTE）。未安裝時專案用戶可能無法 SFTP。
                </FormHint>
                {sshdNotes.length > 0 ? (
                  <ul className="list-plain u-mb-3">
                    {sshdNotes.map((n) => (
                      <li key={n} className="muted u-text-sm">
                        {n}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Field label="片段預覽" htmlFor="sshd-snip" flush fullWidth>
                  <textarea
                    id="sshd-snip"
                    rows={12}
                    readOnly
                    value={sshdSnippet || '（載入中或失敗 — 按重新載入片段）'}
                    spellCheck={false}
                    className="u-font-mono"
                  />
                </Field>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={sftpBusy}
                    onClick={() => {
                      setSftpBusy(true);
                      setSftpErr(null);
                      void api
                        .requestRaw<{ snippet: string; notes: string[] }>(
                          '/api/v1/sftp/sshd-snippet',
                        )
                        .then((r) => {
                          setSshdSnippet(r.snippet ?? '');
                          setSshdNotes(r.notes ?? []);
                          void navigator.clipboard?.writeText(r.snippet ?? '');
                          setSftpMsg('已重新載入並複製片段到剪貼簿');
                        })
                        .catch((e: Error) => setSftpErr(e.message))
                        .finally(() => setSftpBusy(false));
                    }}
                  >
                    重新載入並複製
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    loading={sftpBusy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          '將片段寫入 /etc/ssh/sshd_config.d 並 reload sshd？需 root + YSK_EXECUTE',
                        )
                      ) {
                        return;
                      }
                      setSftpBusy(true);
                      setSftpErr(null);
                      void api
                        .requestRaw<{ ok: boolean; notes: string[] }>(
                          '/api/v1/sftp/sshd-snippet/apply',
                          {
                            method: 'POST',
                            body: JSON.stringify({ installSystem: true, chroot: false }),
                          },
                        )
                        .then((r) => {
                          setSftpMsg(
                            (r.notes ?? []).join('；') || (r.ok ? '已套用 sshd 片段' : '未完成'),
                          );
                        })
                        .catch((e: Error) => setSftpErr(e.message))
                        .finally(() => setSftpBusy(false));
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

      <Modal
        open={createKeyOpen}
        onClose={() => setCreateKeyOpen(false)}
        title="建立 API 金鑰"
        description="建立後完整 token 只顯示一次"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreateKeyOpen(false)}
            >
              取消
            </Button>
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
      </Modal>

      <Modal
        open={createSftpOpen}
        onClose={() => setCreateSftpOpen(false)}
        title="新增 SSH 公鑰"
        description="選擇專案後，金鑰會寫入該專案 home/.ssh"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreateSftpOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={sftpBusy}
              disabled={!sftpProjectId || !sftpPubKey.trim()}
              onClick={() => {
                setSftpBusy(true);
                setSftpErr(null);
                void api
                  .requestRaw<{ ok: boolean; notes?: string[] }>('/api/v1/sftp/keys', {
                    method: 'POST',
                    body: JSON.stringify({
                      projectId: sftpProjectId,
                      publicKey: sftpPubKey.trim(),
                      comment: sftpComment.trim() || undefined,
                    }),
                  })
                  .then((r) => {
                    setSftpMsg(
                      (r.notes ?? []).join('；') || (r.ok ? '已加入公鑰' : '未完成'),
                    );
                    setSftpPubKey('');
                    setCreateSftpOpen(false);
                    return refreshSftp();
                  })
                  .catch((e: Error) => setSftpErr(e.message))
                  .finally(() => setSftpBusy(false));
              }}
            >
              加入公鑰
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field
            label="專案"
            htmlFor="sftp-proj"
            flush
            required
            hint="綁定 linux 用戶與 home"
          >
            <select
              id="sftp-proj"
              value={sftpProjectId}
              onChange={(e) => setSftpProjectId(e.target.value)}
            >
              <option value="">— 選擇專案 —</option>
              {sftpProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.linuxUser}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="SSH 公鑰"
            htmlFor="sftp-pub"
            flush
            required
            hint="一整行 ssh-ed25519 / ssh-rsa …"
          >
            <textarea
              id="sftp-pub"
              rows={3}
              value={sftpPubKey}
              onChange={(e) => setSftpPubKey(e.target.value)}
              placeholder="ssh-ed25519 AAAA… comment"
              spellCheck={false}
            />
          </Field>
          <Field label="備註" htmlFor="sftp-cmt" flush>
            <input
              id="sftp-cmt"
              value={sftpComment}
              onChange={(e) => setSftpComment(e.target.value)}
              placeholder="筆電 / CI"
              spellCheck={false}
            />
          </Field>
        </FormLayout>
        {sftpProjects.length === 0 ? (
          <EmptyState
            title="尚未有專案"
            description="請先建立專案並（建議）建立系統用戶，再綁 SFTP 金鑰"
          />
        ) : null}
      </Modal>
    </FeaturePageLayout>
  );
}
