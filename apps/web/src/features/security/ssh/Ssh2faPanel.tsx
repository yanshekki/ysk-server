/**
 * SSH login 2FA — independent of panel operator TOTP.
 * enroll → confirm code → write ~/.google_authenticator → PAM notes
 */
import { useCallback, useEffect, useState } from 'react';
import { ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  EmptyState,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  Modal,
  PromptDialog,
} from '../../../shared/components/ui';
import { api } from '../../../shared/services/api';

type Row = {
  id: string;
  linuxUser: string;
  homeDir: string;
  projectId?: string;
  status: string;
  label: string;
  filePath?: string;
  fromPanel?: boolean;
  notes: string[];
  hasSecret: boolean;
};

type ProjectOpt = { id: string; name: string; linuxUser: string; homeDir: string };

type Props = {
  onFlash: (tone: 'ok' | 'error', text: string) => void;
};

function statusLabel(s: string): string {
  switch (s) {
    case 'enrolled':
      return '已產生密鑰';
    case 'confirmed':
      return '已確認 App';
    case 'file_written':
      return '已寫入 home';
    case 'retired':
      return '已退役';
    default:
      return s;
  }
}

function statusTone(s: string): 'ok' | 'warn' | 'info' | 'neutral' | 'danger' {
  if (s === 'file_written') return 'ok';
  if (s === 'confirmed') return 'info';
  if (s === 'enrolled') return 'warn';
  if (s === 'error') return 'danger';
  return 'neutral';
}

export function Ssh2faPanel({ onFlash }: Props) {
  const [items, setItems] = useState<Row[]>([]);
  const [hostNotes, setHostNotes] = useState<string[]>([]);
  const [lights, setLights] = useState<{
    package: string;
    pam: string;
    kbdInteractive: string;
  } | null>(null);
  const [pamSnippet, setPamSnippet] = useState('');
  const [sshdHints, setSshdHints] = useState('');
  const [strictSnippet, setStrictSnippet] = useState('');
  const [strictNotes, setStrictNotes] = useState<string[]>([]);
  const [recoveryUsers, setRecoveryUsers] = useState('root');
  const [projects, setProjects] = useState<ProjectOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [enrollOpen, setEnrollOpen] = useState(false);
  const [projectId, setProjectId] = useState('');
  const [linuxUser, setLinuxUser] = useState('');
  const [fromPanel, setFromPanel] = useState(false);
  const [strictTotpOpen, setStrictTotpOpen] = useState(false);
  const [sharedConfirmOpen, setSharedConfirmOpen] = useState(false);

  const [reveal, setReveal] = useState<{
    secret: string;
    otpauthUrl: string;
    id: string;
  } | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    const [list, pam, projs] = await Promise.all([
      api.requestRaw<{
        items: Row[];
        host?: {
          notes?: string[];
          lights?: { package: string; pam: string; kbdInteractive: string };
        };
      }>('/api/v1/ssh/2fa'),
      api.requestRaw<{
        pamSnippet: string;
        sshdHints: string;
        strictSnippet?: string;
        strictNotes?: string[];
      }>('/api/v1/ssh/2fa/pam-snippet?recovery=' + encodeURIComponent(recoveryUsers)),
      api.listProjects(),
    ]);
    setItems(list.items ?? []);
    setHostNotes(list.host?.notes ?? []);
    setLights(list.host?.lights ?? null);
    setPamSnippet(pam.pamSnippet ?? '');
    setSshdHints(pam.sshdHints ?? '');
    setStrictSnippet(pam.strictSnippet ?? '');
    setStrictNotes(pam.strictNotes ?? []);
    setProjects(
      (projs.items ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        linuxUser: p.linuxUser,
        homeDir: p.homeDir,
      })),
    );
  }, []);

  useEffect(() => {
    void refresh().catch((e: Error) => setErr(e.message));
  }, [refresh]);

  async function doEnroll() {
    setBusy(true);
    try {
      const body: Record<string, unknown> = { fromPanel };
      if (projectId) body.projectId = projectId;
      else if (linuxUser.trim()) body.linuxUser = linuxUser.trim();
      else {
        onFlash('error', '請選專案或填 Linux 用戶名');
        return;
      }
      const r = await api.requestRaw<{
        ok: boolean;
        secret?: string;
        otpauthUrl?: string;
        record?: Row;
        notes?: string[];
      }>('/api/v1/ssh/2fa', { method: 'POST', body: JSON.stringify(body) });
      if (!r.ok) {
        onFlash('error', (r.notes ?? []).join('；') || '登記失敗');
        return;
      }
      setEnrollOpen(false);
      if (r.secret && r.record) {
        setReveal({
          secret: r.secret,
          otpauthUrl: r.otpauthUrl ?? '',
          id: r.record.id,
        });
        setConfirmId(r.record.id);
        setConfirmCode('');
      }
      onFlash('ok', '已產生 SSH 專用 TOTP（與 panel 2FA 分開，除非勾選同步）');
      await refresh();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '失敗');
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm() {
    if (!confirmId || !confirmCode.trim()) return;
    setBusy(true);
    try {
      const r = await api.requestRaw<{ ok: boolean; notes?: string[] }>(
        `/api/v1/ssh/2fa/${confirmId}/confirm`,
        { method: 'POST', body: JSON.stringify({ code: confirmCode.trim() }) },
      );
      onFlash(r.ok ? 'ok' : 'error', (r.notes ?? []).join('；') || (r.ok ? '已確認' : '碼錯誤'));
      if (r.ok) {
        setReveal(null);
        setConfirmId(null);
        await refresh();
      }
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '失敗');
    } finally {
      setBusy(false);
    }
  }

  async function doInstall(id: string) {
    setBusy(true);
    try {
      const r = await api.requestRaw<{
        ok: boolean;
        applied?: boolean;
        blocked?: boolean;
        notes?: string[];
      }>(`/api/v1/ssh/2fa/${id}/install`, {
        method: 'POST',
        body: JSON.stringify({ apply: true }),
      });
      onFlash(
        r.ok && r.applied ? 'ok' : r.blocked ? 'error' : 'ok',
        (r.notes ?? []).join('；') ||
          (r.applied
            ? '已寫入 .google_authenticator'
            : r.blocked
              ? '需開啟系統執行權限'
              : '未完成'),
      );
      await refresh();
    } catch (e) {
      onFlash('error', e instanceof Error ? e.message : '失敗');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-gap">
      {err ? <Alert variant="error">{err}</Alert> : null}

      <Card>
        <CardSection
          title="SSH 登入第二因素"
          description="保護 ssh 登入 Linux 用戶。與「帳戶安全」的 panel 2FA 分開；預設獨立 secret。"
        >
          <div className="ssh-callout">
            <ol className="list-spaced u-mb-0">
              <li>為 Linux 用戶登記 TOTP（掃碼）</li>
              <li>確認 App 6 位碼</li>
              <li>寫入 home <code className="inline">.google_authenticator</code></li>
              <li>系統安裝 PAM 模組並合併片段（下方）</li>
            </ol>
          </div>
          {lights ? (
            <ActionBar className="u-mb-3 u-flex-wrap">
              <Badge tone={lights.package === 'green' ? 'ok' : 'danger'}>
                套件 {lights.package}
              </Badge>
              <Badge
                tone={
                  lights.pam === 'green' ? 'ok' : lights.pam === 'yellow' ? 'warn' : 'danger'
                }
              >
                PAM {lights.pam}
              </Badge>
              <Badge
                tone={
                  lights.kbdInteractive === 'green'
                    ? 'ok'
                    : lights.kbdInteractive === 'yellow'
                      ? 'warn'
                      : 'danger'
                }
              >
                sshd kbd {lights.kbdInteractive}
              </Badge>
            </ActionBar>
          ) : null}
          {hostNotes.length > 0 ? (
            <ul className="list-plain u-mb-3">
              {hostNotes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
          <ActionBar className="u-mb-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setProjectId(projects[0]?.id ?? '');
                setLinuxUser('');
                setFromPanel(false);
                setEnrollOpen(true);
              }}
            >
              為用戶登記 SSH 2FA
            </Button>
            <Button
              variant="ghost"
              size="md"
              loading={busy}
              onClick={() => void refresh().catch((e: Error) => setErr(e.message))}
            >
              重新整理
            </Button>
          </ActionBar>

          {items.length === 0 ? (
            <EmptyState
              title="尚未為任何 Linux 用戶開啟 SSH 2FA"
              description="建議先用金鑰登入；2FA 作第二道門。專案 SFTP-only 用戶通常不需要 keyboard-interactive。"
              action={
                <Button variant="primary" size="md" onClick={() => setEnrollOpen(true)}>
                  開始登記
                </Button>
              }
            />
          ) : (
            <div className="list-panel">
              {items.map((row) => (
                <div key={row.id} className="list-row list-row--static">
                  <div className="list-row__main">
                    <div className="list-row__title">
                      <span>{row.linuxUser}</span>
                      <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge>
                      {row.fromPanel ? <Badge tone="warn">與 panel 同源</Badge> : null}
                    </div>
                    <div className="list-row__meta">
                      <span>{row.homeDir}</span>
                      {row.filePath ? <span className="u-font-mono">{row.filePath}</span> : null}
                    </div>
                  </div>
                  <div className="list-row__side">
                    <ActionBar>
                      {row.status === 'enrolled' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setConfirmId(row.id);
                            setConfirmCode('');
                            setReveal(null);
                          }}
                        >
                          輸入驗證碼
                        </Button>
                      ) : null}
                      {row.status === 'confirmed' || row.status === 'file_written' ? (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={busy}
                          onClick={() => void doInstall(row.id)}
                        >
                          {row.status === 'file_written' ? '重寫 home 檔' : '寫入 home'}
                        </Button>
                      ) : null}
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() => {
                          setBusy(true);
                          void api
                            .requestRaw(`/api/v1/ssh/2fa/${row.id}?purgeFile=1`, {
                              method: 'DELETE',
                            })
                            .then(() => {
                              onFlash('ok', '已退役');
                              return refresh();
                            })
                            .catch((e: Error) => onFlash('error', e.message))
                            .finally(() => setBusy(false));
                        }}
                      >
                        退役
                      </Button>
                    </ActionBar>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardSection>
      </Card>

      <Card>
        <CardSection
          title="系統：PAM / sshd（手動或有權限時套用）"
          description="nullok 避免未寫檔用戶被鎖死。寫檔 ≠ 已要求 TOTP。"
        >
          <Field label="PAM 片段（建議併入 /etc/pam.d/sshd）" htmlFor="pam-snip" flush fullWidth>
            <textarea
              id="pam-snip"
              rows={5}
              readOnly
              value={pamSnippet}
              className="u-font-mono"
            />
          </Field>
          <Field label="sshd 提示" htmlFor="sshd-hint" flush fullWidth>
            <textarea
              id="sshd-hint"
              rows={6}
              readOnly
              value={sshdHints}
              className="u-font-mono"
            />
          </Field>
          <Field
            label="救援用戶（逗號分隔，永不進 strict Match）"
            htmlFor="rec-u"
            flush
          >
            <input
              id="rec-u"
              value={recoveryUsers}
              onChange={(e) => setRecoveryUsers(e.target.value)}
              spellCheck={false}
            />
          </Field>
          <Field
            label="Strict Match 預覽（publickey+TOTP、關 password）"
            htmlFor="strict-snip"
            flush
            fullWidth
          >
            <textarea
              id="strict-snip"
              rows={8}
              readOnly
              value={strictSnippet}
              className="u-font-mono"
            />
          </Field>
          {strictNotes.length > 0 ? (
            <ul className="list-plain u-mb-2">
              {strictNotes.map((n) => (
                <li key={n} className="muted u-text-sm">
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
          <FormActions>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                void navigator.clipboard?.writeText(pamSnippet);
                onFlash('ok', '已複製 PAM 片段');
              }}
            >
              複製 PAM
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => {
                setBusy(true);
                void api
                  .requestRaw<{ notes?: string[]; dryRun?: boolean }>(
                    '/api/v1/ssh/2fa/strict-apply',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        apply: false,
                        recoveryUsers: recoveryUsers.split(/[\s,]+/).filter(Boolean),
                      }),
                    },
                  )
                  .then((r) => {
                    onFlash('ok', (r.notes ?? []).join('；') || 'strict dry-run');
                    return refresh();
                  })
                  .catch((e: Error) => onFlash('error', e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Strict dry-run
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => setStrictTotpOpen(true)}
            >
              套用 Strict 到系統
            </Button>
          </FormActions>
          <FormHint>
            套件：<code className="inline">libpam-google-authenticator</code>。保留至少一名未寫
            2FA 檔的救援管理員（預設 root）。
          </FormHint>
        </CardSection>
      </Card>

      <Modal
        open={enrollOpen}
        onClose={() => setEnrollOpen(false)}
        title="登記 SSH 2FA"
        description="預設產生獨立 secret（唔共用 panel）。進階才可同步 panel TOTP。"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setEnrollOpen(false)}>
              取消
            </Button>
            <Button variant="primary" size="md" loading={busy} onClick={() => void doEnroll()}>
              產生並顯示密鑰
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label="專案（建議）" htmlFor="e2-proj" flush>
            <select
              id="e2-proj"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                if (e.target.value) setLinuxUser('');
              }}
            >
              <option value="">— 或手動填用戶 —</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.linuxUser}
                </option>
              ))}
            </select>
          </Field>
          {!projectId ? (
            <Field label="Linux 用戶" htmlFor="e2-user" flush>
              <input
                id="e2-user"
                value={linuxUser}
                onChange={(e) => setLinuxUser(e.target.value)}
                placeholder="deploy"
                spellCheck={false}
              />
            </Field>
          ) : null}
          <label className="ssh-check">
            <input
              type="checkbox"
              checked={fromPanel}
              onChange={(e) => {
                if (e.target.checked) {
                  setSharedConfirmOpen(true);
                  return;
                }
                setFromPanel(false);
              }}
            />
            <span>
              進階：使用目前 panel 操作員的 TOTP secret（需輸入 SHARED 確認）
            </span>
          </label>
        </FormLayout>
      </Modal>

      <Modal
        open={Boolean(reveal || confirmId)}
        onClose={() => {
          setReveal(null);
          setConfirmId(null);
        }}
        title="設定 Authenticator"
        description="掃碼或輸入密鑰後，用 App 的 6 位碼確認。確認後才寫 home 檔。"
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setReveal(null);
                setConfirmId(null);
              }}
            >
              稍後
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              disabled={confirmCode.trim().length < 6}
              onClick={() => void doConfirm()}
            >
              確認驗證碼
            </Button>
          </>
        }
      >
        {reveal ? (
          <>
            <FormHint>
              otpauth：
              <code className="inline u-break-all">{reveal.otpauthUrl}</code>
            </FormHint>
            <Field label="密鑰（base32）" htmlFor="sec" flush fullWidth>
              <input
                id="sec"
                readOnly
                value={reveal.secret}
                className="u-font-mono"
                onFocus={(e) => e.target.select()}
              />
            </Field>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard?.writeText(reveal.secret);
                onFlash('ok', '已複製 secret');
              }}
            >
              複製 secret
            </Button>
          </>
        ) : (
          <FormHint>若已掃碼，直接輸入目前 6 位碼即可。</FormHint>
        )}
        <div className="u-mt-3">
          <Field label="驗證碼" htmlFor="c2" flush required>
            <input
              id="c2"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              placeholder="000000"
              autoComplete="one-time-code"
            />
          </Field>
        </div>
      </Modal>

      <PromptDialog
        open={strictTotpOpen}
        onClose={() => !busy && setStrictTotpOpen(false)}
        title="套用 Strict · step-up"
        description="輸入目前 panel TOTP 驗證碼"
        label="TOTP"
        secret
        placeholder="6 位數字"
        confirmLabel="套用"
        busy={busy}
        onSubmit={async (totp) => {
          setBusy(true);
          try {
            const r = await api.requestRaw<{
              notes?: string[];
              ok?: boolean;
              blocked?: boolean;
            }>('/api/v1/ssh/2fa/strict-apply', {
              method: 'POST',
              body: JSON.stringify({
                apply: true,
                totp,
                recoveryUsers: recoveryUsers.split(/[\s,]+/).filter(Boolean),
              }),
            });
            onFlash(
              r.ok ? 'ok' : 'error',
              (r.notes ?? []).join('；') || (r.ok ? '已套用' : '失敗'),
            );
            await refresh();
            setStrictTotpOpen(false);
            return true;
          } catch (e) {
            onFlash('error', e instanceof Error ? e.message : '失敗');
            return false;
          } finally {
            setBusy(false);
          }
        }}
      />

      <PromptDialog
        open={sharedConfirmOpen}
        onClose={() => setSharedConfirmOpen(false)}
        title="共用 panel TOTP secret？"
        description="風險高。請輸入 SHARED 確認。"
        label="確認字串"
        placeholder="SHARED"
        expectExact="SHARED"
        confirmLabel="啟用共用"
        danger
        onSubmit={() => {
          setFromPanel(true);
          setSharedConfirmOpen(false);
          return true;
        }}
      />
    </div>
  );
}
