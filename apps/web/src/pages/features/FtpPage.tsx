/**
 * FTPS accounts — tabbed UX: 帳戶列表 | SFTP 公鑰
 * List-first; create/edit always in Modal (no huge empty forms).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  SoftwareInstallBanner,
  SummaryStrip,
  Tabs,
  FormHint,
} from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { ResourceTable } from '../../shared/components/resource/ResourceTable';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import { ftpApi, type SelectOption } from '../../features/ftp';
import { api } from '../../shared/services/api';
import { usePageTab } from '../../shared/hooks/usePageTab';

type SftpKey = {
  id: string;
  username: string;
  comment?: string;
  publicKey: string;
  created_at: string;
};

const FTP_TABS = ['accounts', 'sftp'] as const;

export function FtpPage() {
  const crud = useResourceCrud('ftp/accounts');
  const [tab, setTab] = usePageTab(FTP_TABS, 'accounts');
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
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyUser, setKeyUser] = useState('');
  const [keyPub, setKeyPub] = useState('');
  const [keyComment, setKeyComment] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [delKeyId, setDelKeyId] = useState<string | null>(null);

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

  function openKeyCreate(prefillUser?: string) {
    setKeyUser(prefillUser ?? '');
    setKeyPub('');
    setKeyComment('');
    setKeyOpen(true);
  }

  const applied = crud.items.filter((r) => String(r.apply_status) === 'applied').length;
  const draft = crud.items.length - applied;

  return (
    <FeaturePageLayout
      title="FTPS 帳戶"
      subtitle="虛擬 FTP 帳戶 · 套用到 vsftpd · 可選 SFTP 公鑰"
      actions={
        <div className="btn-row">
          <Link to="/ftp/service">
            <Button variant="secondary" size="md">
              vsftpd 服務
            </Button>
          </Link>
          {tab === 'accounts' ? (
            <Button variant="primary" size="md" onClick={openCreate}>
              + 建立帳戶
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={() => openKeyCreate()}>
              + 新增公鑰
            </Button>
          )}
        </div>
      }
    >
      <SoftwareInstallBanner feature="ftp" title="尚未安裝 FTPS 服務軟件" />

      {crud.error || keyErr ? <Alert variant="error">{crud.error ?? keyErr}</Alert> : null}
      {crud.msg || keyMsg ? (
        <Alert variant="ok">
          {crud.msg ?? keyMsg}{' '}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              crud.setMsg?.(null);
              setKeyMsg(null);
            }}
          >
            關閉
          </Button>
        </Alert>
      ) : null}
      {crud.lastNotes?.length ? (
        <Alert variant="info">
          <ul className="list-plain list-spaced">
            {crud.lastNotes.map((n) => (
              <li key={n} className="u-text-sm">
                {n}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <SummaryStrip
        items={[
          { label: '帳戶', value: crud.items.length },
          {
            label: '已套用',
            value: applied,
            tone: applied > 0 ? 'ok' : 'default',
          },
          {
            label: '待套用',
            value: draft,
            tone: draft > 0 ? 'warn' : 'default',
          },
          {
            label: 'SFTP 公鑰',
            value: sftpKeys.length,
            tone: sftpKeys.length > 0 ? 'ok' : 'default',
          },
        ]}
      />

      <Tabs
        tabs={[
          {
            id: 'accounts',
            label: 'FTP 帳戶',
            badge: crud.items.length || undefined,
          },
          {
            id: 'sftp',
            label: 'SFTP 公鑰',
            badge: sftpKeys.length || undefined,
          },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'accounts' ? (
          <div className="tab-panel">
            <Card flush>
              <div className="card__header card__header--pad">
                <div>
                  <h2 className="card__title">帳戶列表</h2>
                  <p className="card__desc u-mb-0">
                    建立後按「套用」同步到 vsftpd。服務未裝時請先用上方安裝，再到{' '}
                    <Link to="/ftp/service">vsftpd 服務</Link> 啟動。
                  </p>
                </div>
                {crud.items.length > 0 ? (
                  <Button variant="primary" size="sm" onClick={openCreate}>
                    + 建立
                  </Button>
                ) : null}
              </div>
              {crud.items.length === 0 ? (
                <div className="empty empty--compact">
                  <div className="empty__title">尚未有 FTP 帳戶</div>
                  <p>建立虛擬帳戶後，可指定家目錄與網域，再套用到系統。</p>
                  <div className="form-actions btn-row" style={{ justifyContent: 'center' }}>
                    <Button variant="primary" size="md" onClick={openCreate}>
                      + 建立帳戶
                    </Button>
                    <Link to="/ftp/service">
                      <Button variant="secondary" size="md">
                        前往 vsftpd 服務
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : (
                <ResourceTable
                  columns={[
                    {
                      key: 'user',
                      header: '用戶名',
                      render: (r) => <strong>{String(r.username)}</strong>,
                    },
                    {
                      key: 'home',
                      header: '家目錄',
                      render: (r) => (
                        <span className="u-break-all muted u-text-sm">
                          {String(r.homePath ?? '—')}
                        </span>
                      ),
                    },
                    {
                      key: 'domain',
                      header: '網域',
                      render: (r) => String(r.domain ?? '—'),
                    },
                    {
                      key: 'status',
                      header: '狀態',
                      render: (r) => (
                        <ResourceStatusBadge status={String(r.apply_status)} />
                      ),
                    },
                  ]}
                  rows={crud.items}
                  rowActions={(r) => (
                    <div className="btn-row">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={crud.busy}
                        onClick={() => void crud.apply(r.id)}
                      >
                        套用
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
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
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setTab('sftp');
                          openKeyCreate(String(r.username ?? ''));
                        }}
                      >
                        公鑰
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={crud.busy}
                        onClick={() => setDelId(r.id)}
                      >
                        刪除
                      </Button>
                    </div>
                  )}
                />
              )}
            </Card>

            {crud.items.length > 0 ? (
              <p className="muted u-text-sm">
                提示：套用只寫入管理設定；真正聽埠需 vsftpd 服務為 active。
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === 'sftp' ? (
          <div className="tab-panel">
            <Card flush>
              <div className="card__header card__header--pad">
                <div>
                  <h2 className="card__title">SFTP 公鑰</h2>
                  <p className="card__desc u-mb-0">
                    寫入 <code className="inline">dataDir/ftps/ssh/&lt;user&gt;/authorized_keys</code>
                    ；系統 sshd Match 設定後才真正生效。
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => openKeyCreate()}>
                  + 新增公鑰
                </Button>
              </div>

              {sftpKeys.length === 0 ? (
                <div className="empty empty--compact">
                  <div className="empty__title">尚未登錄公鑰</div>
                  <p>
                    {crud.items.length === 0
                      ? '建議先建立 FTP 帳戶，再為該用戶加 SSH 公鑰。'
                      : '為既有 FTP 用戶登錄 ssh-ed25519 / ssh-rsa 公鑰。'}
                  </p>
                  <div className="form-actions btn-row" style={{ justifyContent: 'center' }}>
                    <Button variant="primary" size="md" onClick={() => openKeyCreate()}>
                      + 新增公鑰
                    </Button>
                    {crud.items.length === 0 ? (
                      <Button
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          setTab('accounts');
                          openCreate();
                        }}
                      >
                        先建立帳戶
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>用戶</th>
                        <th>備註</th>
                        <th>金鑰指紋（前綴）</th>
                        <th>建立</th>
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
                              {k.publicKey.slice(0, 56)}
                              {k.publicKey.length > 56 ? '…' : ''}
                            </code>
                          </td>
                          <td className="muted u-nowrap u-text-sm">
                            {String(k.created_at).slice(0, 19).replace('T', ' ')}
                          </td>
                          <td>
                            <Button
                              variant="danger"
                              size="sm"
                              loading={keyBusy}
                              onClick={() => setDelKeyId(k.id)}
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
            </Card>

            {crud.items.length > 0 ? (
              <Card>
                <CardSection title="快速選擇帳戶" description="點用戶名帶入新增公鑰表單">
                  <div className="chip-row">
                    {crud.items.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        className="badge badge-link"
                        onClick={() => openKeyCreate(String(r.username))}
                      >
                        <Badge tone="info">{String(r.username)}</Badge>
                      </button>
                    ))}
                  </div>
                </CardSection>
              </Card>
            ) : null}
          </div>
        ) : null}
      </Tabs>

      {/* Create / edit account */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? '編輯 FTP 帳戶' : '建立 FTP 帳戶'}
        description="網域與家目錄請從清單選擇；無清單時可手填。儲存後需「套用」才寫入 vsftpd"
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
          <FormLayout columns={2}>
            <Field
              label="用戶名"
              htmlFor="fu"
              flush
              required
              hint="英數、點、底線、減號；建立後不可改"
            >
              <input
                id="fu"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={Boolean(editId)}
                pattern="[a-zA-Z0-9._-]+"
                title="英數、點、底線、減號"
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={editId ? '新密碼（可留空）' : '密碼'}
              htmlFor="fp"
              flush
              required={!editId}
              hint={editId ? '留空表示不變更' : '至少 8 字元'}
            >
              <input
                id="fp"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={!editId}
                minLength={editId ? 0 : 8}
                autoComplete="new-password"
              />
            </Field>
            <Field
              label="網域"
              htmlFor="fd"
              flush
              required={!editId}
              hint="對應站點或郵件網域，用於分組與路徑建議"
            >
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
                  placeholder="可先建立站點／郵件網域，或暫時輸入"
                  required={!editId}
                  spellCheck={false}
                />
              )}
            </Field>
            <Field
              label="家目錄"
              htmlFor="fh"
              flush
              required={!editId}
              hint="用戶登入後的根目錄（chroot 後可見範圍）"
            >
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
          </FormLayout>
          {homePath ? (
            <FormHint>
              完整路徑：<code className="inline">{homePath}</code>
            </FormHint>
          ) : (
            <FormHint>若清單為空，請先建立專案或站點以產生家目錄選項。</FormHint>
          )}
        </form>
      </Modal>

      {/* Add SFTP key */}
      <Modal
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        title="新增 SFTP 公鑰"
        description="貼上一行完整公鑰（ssh-ed25519 / ssh-rsa …）；寫入 authorized_keys ≠ 已驗證可連"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setKeyOpen(false)}>
              取消
            </Button>
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
                    setKeyOpen(false);
                    setKeyPub('');
                    setKeyComment('');
                    return refreshKeys();
                  })
                  .catch((e: Error) => setKeyErr(e.message))
                  .finally(() => setKeyBusy(false));
              }}
            >
              新增
            </Button>
          </>
        }
      >
        <FormLayout columns={2}>
          <Field
            label="FTP 用戶名"
            htmlFor="sk-user"
            flush
            required
            hint="須與已登記的 FTP 帳戶相同"
          >
            {crud.items.length > 0 ? (
              <select
                id="sk-user"
                value={keyUser}
                onChange={(e) => setKeyUser(e.target.value)}
                required
              >
                <option value="">— 選擇帳戶 —</option>
                {crud.items.map((r) => (
                  <option key={r.id} value={String(r.username)}>
                    {String(r.username)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="sk-user"
                value={keyUser}
                onChange={(e) => setKeyUser(e.target.value)}
                placeholder="與 FTP 帳戶相同"
                required
                spellCheck={false}
              />
            )}
          </Field>
          <Field label="備註" htmlFor="sk-cmt" flush hint="方便辨識裝置，例如 筆電／公司">
            <input
              id="sk-cmt"
              value={keyComment}
              onChange={(e) => setKeyComment(e.target.value)}
              placeholder="筆電 / 公司主機"
            />
          </Field>
          <Field
            label="SSH 公鑰"
            htmlFor="sk-pub"
            fullWidth
            flush
            required
            hint="通常來自 ~/.ssh/id_ed25519.pub，整行貼上"
          >
            <textarea
              id="sk-pub"
              rows={4}
              value={keyPub}
              onChange={(e) => setKeyPub(e.target.value)}
              placeholder="ssh-ed25519 AAAA… comment"
              required
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

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

      <ConfirmDialog
        open={Boolean(delKeyId)}
        onClose={() => setDelKeyId(null)}
        onConfirm={() => {
          if (!delKeyId) return;
          setKeyBusy(true);
          void api
            .requestRaw(`/api/v1/sftp/keys/${delKeyId}`, { method: 'DELETE' })
            .then(() => {
              setDelKeyId(null);
              return refreshKeys();
            })
            .catch((e: Error) => setKeyErr(e.message))
            .finally(() => setKeyBusy(false));
        }}
        title="刪除 SFTP 公鑰？"
        description="會從管理檔移除；系統 authorized_keys 可能仍需重載才生效。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={keyBusy}
      />
    </FeaturePageLayout>
  );
}
