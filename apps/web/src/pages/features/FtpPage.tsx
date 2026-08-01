/**
 * FTPS accounts — tabbed UX: {i18n.t('ftp.accountsList')} | SFTP 公鑰
 * List-first; create/edit always in Modal (no huge empty forms).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../shared/lib/i18n';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  ConfirmDialog,
  DataTable,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  ServerListFilters,
  SoftwareInstallBanner,
  PageTabs,
  FormHint,
} from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
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

const FTP_TABS = ['accounts', 'sftp', 'about'] as const;

export function countApplyStatus(
  items: Array<Record<string, unknown>>,
): { applied: number; draft: number } {
  const applied = items.filter((r) => String(r.apply_status) === 'applied')
    .length;
  return { applied, draft: items.length - applied };
}

export function accountPillTone(
  total: number,
  draft: number,
): 'ok' | 'warn' {
  return draft > 0 ? 'warn' : total ? 'ok' : 'warn';
}

export function buildFtpAccountBody(input: {
  username: string;
  password: string;
  homePath: string;
  domain: string;
}): {
  username: string;
  password_plain?: string;
  homePath?: string;
  domain?: string;
} {
  return {
    username: input.username,
    password_plain: input.password || undefined,
    homePath: input.homePath || undefined,
    domain: input.domain || undefined,
  };
}

export function FtpPage() {
  const { t } = useTranslation();
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
    const body = buildFtpAccountBody({ username, password, homePath, domain });
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

  const { applied, draft } = countApplyStatus(crud.items);

  return (
    <FeaturePageLayout
      title={t('nav.ftp', { defaultValue: t('nav.ftp') })}
      status={{
        pill: {
          label: t('ftp.accountsCount', { count: crud.items.length }),
          tone: accountPillTone(crud.items.length, draft),
        },
        items: [
          { label: t('ftp.accounts'), value: crud.items.length },
          {
            label: t('common.applied'),
            value: applied,
            tone: applied > 0 ? 'ok' : 'neutral',
          },
          {
            label: t('ftp.pendingApply'),
            value: draft,
            tone: draft > 0 ? 'warn' : 'ok',
          },
          { label: t('ftp.sftpKeys'), value: sftpKeys.length },
        ],
      }}
      actions={
        <ActionBar>
          <Link to="/ftp/service">
            <Button variant="secondary" size="sm">
              {t('nav.ftpService')}
            </Button>
          </Link>
        </ActionBar>
      }
    >
      <SoftwareInstallBanner feature="ftp" title={t('ftp.softwareMissing')} />

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
            {t('common.close')}
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

      <PageTabs
        tabs={[
          {
            id: 'accounts',
            label: t('ftp.ftpAccounts'),
            badge: crud.items.length || undefined,
          },
          {
            id: 'sftp',
            label: t('ftp.sftpPubkeys'),
            badge: sftpKeys.length || undefined,
          },
        
          { id: 'about', label: t('common.about') },
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
                  <h2 className="card__title">{t('ftp.accountsList')}</h2>
                  <p className="card__desc u-mb-0">
                    {t('ftp.accountsListDesc')}{' '}
                    <Link to="/ftp/service">{t('nav.ftpService')}</Link>{t('ftp.startService')}
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={openCreate}>
                  {t('ftp.createAccountPlus')}
                </Button>
              </div>
              {crud.items.length === 0 ? (
                <div className="empty empty--compact">
                  <div className="empty__title">{t('ftp.noFtpAccounts')}</div>
                  <p>{t('ftp.noFtpAccountsDesc')}</p>
                </div>
              ) : (
                <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                  filters={
                    <ServerListFilters
                      q={crud.q}
                      setQ={crud.setQ}
                      searching={crud.searching}
                      loading={crud.listLoading}
                      total={crud.total}
                      shown={crud.items.length}
                      activeFilterCount={crud.activeFilterCount}
                      clear={crud.clearSearch}
                    />
                  }
                  columns={[
                    {
                      key: 'user',
                      header: t('common.username'),
                      render: (r) => <strong>{String(r.username)}</strong>,
                    },
                    {
                      key: 'home',
                      header: t('ftp.homeDir'),
                      render: (r) => (
                        <span className="u-break-all muted u-text-sm">
                          {String(r.homePath ?? '—')}
                        </span>
                      ),
                    },
                    {
                      key: 'domain',
                      header: t('runtime.domain'),
                      render: (r) => String(r.domain ?? '—'),
                    },
                    {
                      key: 'status',
                      header: t('common.status'),
                      render: (r) => (
                        <ResourceStatusBadge status={String(r.apply_status)} />
                      ),
                    },
                  ]}
                  rows={crud.items}
                  rowActions={(r) => (
                    <ActionBar>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={crud.busy}
                        onClick={() => void crud.apply(r.id)}
                      >
                        {t('common.apply')}
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
                        {t('common.edit')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setTab('sftp');
                          openKeyCreate(String(r.username ?? ''));
                        }}
                      >
                        {t('security.ssh.publicKeyStrong')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={crud.busy}
                        onClick={() => setDelId(r.id)}
                      >
                        {t('common.delete')}
                      </Button>
                    </ActionBar>
                  )}
                />
              )}
            </Card>

            {crud.items.length > 0 ? (
              <p className="muted u-text-sm">
                {t('ftp.applyHint')}
              </p>
            ) : null}
          </div>
        ) : null}

        {tab === 'sftp' ? (
          <div className="tab-panel">
            <Card flush>
              <div className="card__header card__header--pad">
                <div>
                  <h2 className="card__title">{t('ftp.sftpPubkeys')}</h2>
                  <p className="card__desc u-mb-0">
                    {t('redis.writable')} <code className="inline">dataDir/ftps/ssh/&lt;user&gt;/authorized_keys</code>
                    {t('ftp.sshdMatchNote')}
                  </p>
                </div>
                <Button variant="primary" size="sm" onClick={() => openKeyCreate()}>
                  {t('ftp.addPubkeyPlus')}
                </Button>
              </div>

              <DataTable
                columns={[
                  {
                    key: 'username',
                    header: t('common.user'),
                    render: (k) => <strong>{k.username}</strong>,
                  },
                  {
                    key: 'comment',
                    header: t('common.notes'),
                    className: 'muted',
                    render: (k) => k.comment ?? '—',
                  },
                  {
                    key: 'key',
                    header: t('ftp.keyFingerprint'),
                    render: (k) => (
                      <code className="inline u-break-all">
                        {k.publicKey.slice(0, 56)}
                        {k.publicKey.length > 56 ? '…' : ''}
                      </code>
                    ),
                  },
                  {
                    key: 'created',
                    header: t('common.create'),
                    className: 'muted u-nowrap u-text-sm',
                    nowrap: true,
                    render: (k) =>
                      String(k.created_at).slice(0, 19).replace('T', ' '),
                  },
                ]}
                rows={sftpKeys}
                rowKey={(k) => k.id}
                rowActions={(k) => (
                  <ActionBar align="end">
                    <Button
                      variant="danger"
                      size="sm"
                      loading={keyBusy}
                      onClick={() => setDelKeyId(k.id)}
                    >
                      {t('common.delete')}
                    </Button>
                  </ActionBar>
                )}
                empty={
                  <div className="empty empty--compact">
                    <div className="empty__title">{t('ftp.noPubkeys')}</div>
                    <p>
                      {crud.items.length === 0
                        ? t('ftp.createHint')
                        : t('ftp.pubkeyHint')}
                    </p>
                  </div>
                }
              />
            </Card>

            {crud.items.length > 0 ? (
              <Card>
                <CardSection title={t('ftp.quickSelect')} description={t('ftp.quickSelectHint')}>
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
      
        {tab === 'about' ? <PageGuide guideId="ftp" /> : null}
      </PageTabs>

      {/* Create / edit account */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? t('ftp.editAccount') : t('ftp.createAccount')}
        description={t('ftp.accountModalDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="ftp-f" variant="primary" size="md" loading={crud.busy}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="ftp-f" onSubmit={(e) => void onSave(e)}>
          <FormLayout columns={2}>
            <Field
              label={t('common.username')}
              htmlFor="fu"
              flush
              required
              hint={t('ftp.usernameHintCreate')}
            >
              <input
                id="fu"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={Boolean(editId)}
                pattern="[a-zA-Z0-9._-]+"
                title={t('ftp.usernameHint')}
                spellCheck={false}
                autoComplete="off"
              />
            </Field>
            <Field
              label={editId ? t('ftp.newPasswordOptional') : t('common.password')}
              htmlFor="fp"
              flush
              required={!editId}
              hint={editId ? t('ftp.passwordKeepHint') : t('ftp.passwordMin8')}
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
              label={t('runtime.domain')}
              htmlFor="fd"
              flush
              required={!editId}
              hint={t('ftp.domainHint')}
            >
              {domains.length > 0 ? (
                <select
                  id="fd"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required={!editId}
                >
                  <option value="">{t('ftp.pickDomain')}</option>
                  {domains.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                  {domain && !domains.some((d) => d.value === domain) ? (
                    <option value={domain}>{t('ftp.currentDomain', { domain })}</option>
                  ) : null}
                </select>
              ) : (
                <input
                  id="fd"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder={t('ftp.domainPh')}
                  required={!editId}
                  spellCheck={false}
                />
              )}
            </Field>
            <Field
              label={t('ftp.homeDir')}
              htmlFor="fh"
              flush
              required={!editId}
              hint={t('ftp.homeHint')}
            >
              <select
                id="fh"
                value={homePath}
                onChange={(e) => setHomePath(e.target.value)}
                required={!editId}
              >
                <option value="">{t('ftp.pickHome')}</option>
                {homes.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
                {homePath && !homes.some((h) => h.value === homePath) ? (
                  <option value={homePath}>{t('ftp.currentHome', { path: homePath })}</option>
                ) : null}
              </select>
            </Field>
          </FormLayout>
          {homePath ? (
            <FormHint>
              {t('ftp.fullPath')}<code className="inline">{homePath}</code>
            </FormHint>
          ) : (
            <FormHint>{t('ftp.emptyHomes')}</FormHint>
          )}
        </form>
      </Modal>

      {/* Add SFTP key */}
      <Modal
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        title={t('ftp.addPubkey')}
        description={t('ftp.addPubkeyDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setKeyOpen(false)}>
              {t('common.cancel')}
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
                    setKeyMsg(r.notes?.join('；') ?? t('ftp.pubkeyAdded'));
                    setKeyOpen(false);
                    setKeyPub('');
                    setKeyComment('');
                    return refreshKeys();
                  })
                  .catch((e: Error) => setKeyErr(e.message))
                  .finally(() => setKeyBusy(false));
              }}
            >
              {t('network.add')}
            </Button>
          </>
        }
      >
        <FormLayout columns={2}>
          <Field
            label={t('ftp.ftpUsername')}
            htmlFor="sk-user"
            flush
            required
            hint={t('ftp.ftpUsernameHint')}
          >
            {crud.items.length > 0 ? (
              <select
                id="sk-user"
                value={keyUser}
                onChange={(e) => setKeyUser(e.target.value)}
                required
              >
                <option value="">{t('ftp.pickAccount')}</option>
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
                placeholder={t('ftp.ftpUsernamePh')}
                required
                spellCheck={false}
              />
            )}
          </Field>
          <Field label={t('common.notes')} htmlFor="sk-cmt" flush hint={t('ftp.noteHint')}>
            <input
              id="sk-cmt"
              value={keyComment}
              onChange={(e) => setKeyComment(e.target.value)}
              placeholder={t('ftp.notePh')}
            />
          </Field>
          <Field
            label={t('ftp.sshPubkey')}
            htmlFor="sk-pub"
            fullWidth
            flush
            required
            hint={t('ftp.sshPubkeyHint')}
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
        title={t('ftp.deleteAccountTitle')}
        description={t('ftp.deleteAccountDesc')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
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
        title={t('ftp.deleteKeyTitle')}
        description={t('ftp.deleteKeyDesc')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={keyBusy}
      />
    </FeaturePageLayout>
  );
}
