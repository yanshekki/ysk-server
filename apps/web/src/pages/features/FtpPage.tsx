import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormGrid,
  Modal,
  SoftwareInstallBanner,
} from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { ResourceTable } from '../../shared/components/resource/ResourceTable';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import { ftpApi, type SelectOption } from '../../features/ftp';
import { api } from '../../shared/services/api';

type SftpKey = {
  id: string;
  username: string;
  comment?: string;
  publicKey: string;
  created_at: string;
};

export function FtpPage() {
  const crud = useResourceCrud('ftp/accounts');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [homePath, setHomePath] = useState('');
  const [domain, setDomain] = useState('');
  const [domains, setDomains] = useState<SelectOption[]>([]);
  const [homes, setHomes] = useState<SelectOption[]>([]);
  const [sftpKeys, setSftpKeys] = useState<SftpKey[]>([]);
  const [keyUser, setKeyUser] = useState('');
  const [keyPub, setKeyPub] = useState('');
  const [keyComment, setKeyComment] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState<string | null>(null);

  const loadOptions = useCallback(async (user?: string) => {
    try {
      const o = await ftpApi.options(user || undefined);
      setDomains(o.domains);
      setHomes(o.homes);
      return o;
    } catch {
      setDomains([]);
      setHomes([]);
      return { domains: [], homes: [] };
    }
  }, []);

  const refreshKeys = useCallback(async () => {
    const r = await api.requestRaw<{ items: SftpKey[] }>('/api/v1/sftp/keys');
    setSftpKeys(r.items ?? []);
  }, []);

  useEffect(() => {
    void loadOptions();
    void refreshKeys().catch(() => undefined);
  }, [loadOptions, refreshKeys]);

  useEffect(() => {
    if (!open) return;
    void loadOptions(username).then((o) => {
      // When creating, default home to first option if empty
      if (!editId && !homePath && o.homes[0]) {
        setHomePath(o.homes[0].value);
      }
    });
  }, [username, open, editId, homePath, loadOptions]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const body = {
      username,
      password_plain: password || undefined,
      homePath: homePath || undefined,
      domain: domain || undefined,
    };
    if (editId) await crud.update(editId, body);
    else await crud.create(body);
    setOpen(false);
    setEditId(null);
    setUsername('');
    setPassword('');
    setHomePath('');
    setDomain('');
  }

  function openCreate() {
    setEditId(null);
    setUsername('');
    setPassword('');
    setHomePath('');
    setDomain('');
    setOpen(true);
  }

  return (
    <FeaturePageLayout
      title="FTPS 帳戶"
      subtitle="FTP 虛擬帳戶（需於 vsftpd 服務頁啟動服務）"
      actions={
        <div className="btn-row">
          <Link to="/ftp/service">
            <Button variant="secondary" size="md">
              vsftpd 服務
            </Button>
          </Link>
          <Button variant="primary" size="md" onClick={openCreate}>
            + 建立帳戶
          </Button>
        </div>
      }
    >
      <SoftwareInstallBanner feature="ftp" title="尚未安裝 FTPS 服務軟件" />
      {crud.error || keyErr ? <Alert variant="error">{crud.error ?? keyErr}</Alert> : null}
      {crud.msg || keyMsg ? <Alert variant="ok">{crud.msg ?? keyMsg}</Alert> : null}
      {crud.lastNotes?.length ? (
        <Alert variant="info">
          <ul className="list-plain">
            {crud.lastNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardSection
          title={`FTP 帳戶 (${crud.items.length})`}
          description="建立後按「套用」同步到 vsftpd；首次請先到服務頁安裝並啟動"
        >
          <ResourceTable
            columns={[
              {
                key: 'user',
                header: '用戶名',
                render: (r) => <strong>{String(r.username)}</strong>,
              },
              {
                key: 'home',
                header: 'Home',
                render: (r) => (
                  <span className="u-break-all muted u-text-sm">{String(r.homePath ?? '—')}</span>
                ),
              },
              {
                key: 'domain',
                header: 'Domain',
                render: (r) => String(r.domain ?? '—'),
              },
              {
                key: 'status',
                header: '狀態',
                render: (r) => <ResourceStatusBadge status={String(r.apply_status)} />,
              },
            ]}
            rows={crud.items}
            empty={
              <EmptyState
                title="尚未有 FTP 帳戶"
                description="先建立帳戶，再到 vsftpd 服務頁啟動服務"
                action={
                  <Button variant="primary" size="md" onClick={openCreate}>
                    + 建立帳戶
                  </Button>
                }
              />
            }
            rowActions={(r) => (
              <div className="btn-row">
                <Button
                  variant="primary"
                  size="sm"
                  loading={crud.busy}
                  onClick={() => void crud.apply(r.id)}
                >
                  套用到系統
                </Button>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  disabled={crud.busy}
                  onClick={() => {
                    setEditId(r.id);
                    setUsername(String(r.username ?? ''));
                    setHomePath(String(r.homePath ?? ''));
                    setDomain(String(r.domain ?? ''));
                    setPassword('');
                    setOpen(true);
                  }}
                >
                  編輯
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  disabled={crud.busy}
                  onClick={() => setDelId(r.id)}
                >
                  刪除
                </button>
              </div>
            )}
          />
        </CardSection>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? '編輯 FTP 帳戶' : '建立 FTP 帳戶'}
        description="Domain 與 Home 請從清單選擇"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="ftp-f" variant="primary" size="md" loading={crud.busy}>
              儲存
            </Button>
          </>
        }
      >
        <form id="ftp-f" onSubmit={(e) => void onSave(e)}>
          <FormGrid>
            <Field label="用戶名" techKey="username" htmlFor="fu">
              <input
                id="fu"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={Boolean(editId)}
                pattern="[a-zA-Z0-9._-]+"
                title="英數、點、底線、減號"
              />
            </Field>
            <Field label={editId ? '新密碼（可留空）' : '密碼'} techKey="password" htmlFor="fp">
              <input
                id="fp"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!editId}
                minLength={editId ? 0 : 8}
              />
            </Field>
            <Field label="網域" techKey="domain" htmlFor="fd">
              {domains.length > 0 ? (
                <select
                  id="fd"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required={!editId}
                >
                  <option value="">— 選擇網域 —</option>
                  {domains.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                  {domain && !domains.some((d) => d.value === domain) ? (
                    <option value={domain}>{domain}（目前）</option>
                  ) : null}
                </select>
              ) : (
                <input
                  id="fd"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="先建立郵件/站點/SSL 網域，或暫時輸入"
                  required={!editId}
                />
              )}
            </Field>
            <Field label="家目錄" techKey="home_path" htmlFor="fh">
              <select
                id="fh"
                value={homePath}
                onChange={(e) => setHomePath(e.target.value)}
                required={!editId}
              >
                <option value="">— 選擇家目錄 —</option>
                {homes.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
                {homePath && !homes.some((h) => h.value === homePath) ? (
                  <option value={homePath}>{homePath}（目前）</option>
                ) : null}
              </select>
            </Field>
          </FormGrid>
          {homePath ? (
            <p className="muted u-text-sm u-mt-3">完整路徑：{homePath}</p>
          ) : null}
        </form>
      </Modal>

      <Card>
        <CardSection
          title={`SFTP 公鑰 (${sftpKeys.length})`}
          description="寫入 dataDir/ftps/ssh/<user>/authorized_keys；需系統 sshd Match 才真正生效"
        >
          <FormGrid>
            <Field label="FTP 用戶名" htmlFor="sk-user" flush>
              <input
                id="sk-user"
                value={keyUser}
                onChange={(e) => setKeyUser(e.target.value)}
                placeholder="與 FTP 帳戶相同"
              />
            </Field>
            <Field label="備註" htmlFor="sk-cmt" flush>
              <input
                id="sk-cmt"
                value={keyComment}
                onChange={(e) => setKeyComment(e.target.value)}
                placeholder="laptop"
              />
            </Field>
          </FormGrid>
          <Field label="SSH 公鑰（ssh-ed25519 / ssh-rsa …）" htmlFor="sk-pub" flush>
            <textarea
              id="sk-pub"
              rows={3}
              value={keyPub}
              onChange={(e) => setKeyPub(e.target.value)}
              placeholder="ssh-ed25519 AAAA… comment"
            />
          </Field>
          <div className="btn-row u-mt-3">
            <Button
              variant="primary"
              size="md"
              loading={keyBusy}
              onClick={() => {
                setKeyBusy(true);
                setKeyErr(null);
                setKeyMsg(null);
                void api
                  .requestRaw<{ ok: boolean; notes?: string[] }>('/api/v1/sftp/keys', {
                    method: 'POST',
                    body: JSON.stringify({
                      username: keyUser,
                      publicKey: keyPub,
                      comment: keyComment || undefined,
                    }),
                  })
                  .then((r) => {
                    setKeyMsg(r.notes?.join('；') ?? '已新增公鑰');
                    setKeyPub('');
                    setKeyComment('');
                    return refreshKeys();
                  })
                  .catch((e: Error) => setKeyErr(e.message))
                  .finally(() => setKeyBusy(false));
              }}
            >
              新增公鑰
            </Button>
            <Button
              variant="secondary"
              size="md"
              loading={keyBusy}
              onClick={() => void refreshKeys().catch((e: Error) => setKeyErr(e.message))}
            >
              重新整理
            </Button>
          </div>
          {sftpKeys.length === 0 ? (
            <EmptyState title="尚未有 SFTP 公鑰" description="為 FTP 用戶登錄 ssh 公鑰" />
          ) : (
            <div className="table-wrap u-mt-3">
              <table className="data">
                <thead>
                  <tr>
                    <th>用戶</th>
                    <th>備註</th>
                    <th>金鑰</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sftpKeys.map((k) => (
                    <tr key={k.id}>
                      <td>
                        <strong>{k.username}</strong>
                      </td>
                      <td className="muted">{k.comment ?? '—'}</td>
                      <td>
                        <code className="inline u-break-all">
                          {k.publicKey.slice(0, 48)}…
                        </code>
                      </td>
                      <td>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={keyBusy}
                          onClick={() => {
                            setKeyBusy(true);
                            void api
                              .requestRaw(`/api/v1/sftp/keys/${k.id}`, { method: 'DELETE' })
                              .then(() => refreshKeys())
                              .catch((e: Error) => setKeyErr(e.message))
                              .finally(() => setKeyBusy(false));
                          }}
                        >
                          刪除
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>
      </Card>

      <ConfirmDialog
        open={Boolean(delId)}
        onClose={() => setDelId(null)}
        onConfirm={() => {
          if (delId) void crud.remove(delId).then(() => setDelId(null));
        }}
        title="刪除 FTP 帳戶？"
        description="會移除控制面登記；請再「套用」其他帳戶或於服務頁重載。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={crud.busy}
      />
    </FeaturePageLayout>
  );
}
