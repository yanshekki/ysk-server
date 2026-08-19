/**
 * FTPS — unified page: accounts | SFTP keys | service | software | about
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Field,
  FeaturePageLayout,
  FormLayout,
  Modal,
  ServerListFilters,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  PageTabs,
  FormHint,
  PasswordInput,
} from '../../shared/components/ui';
import { ResourceStatusBadge } from '../../shared/components/resource/ResourceStatusBadge';
import { useResourceCrud } from '../../features/resources/useResourceCrud';
import {
  accountPillTone,
  buildFtpAccountBody,
  countApplyStatus,
  filterSftpKeys,
  formatSftpKeyTime,
  ftpApi,
  parseSshPubkeyMeta,
  statusLabel,
  type FtpsStatus,
  type SelectOption,
} from '../../features/ftp';
import { api } from '../../shared/services/api';
import { isFtpUsername } from 'ysk-server-shared';
import { toast } from '../../shared/stores/toast-store';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  bindCall1,
  bindFormSubmit,
  bindInput,
  bindRemoveIf,
  bindSet,
} from '../bind-handlers';
import { FtpServicePanel } from './FtpServicePanel';

type SftpKey = {
  id: string;
  username: string;
  comment?: string;
  publicKey: string;
  created_at: string;
};

// Re-export helpers for unit tests that imported from this module
export {
  parseSshPubkeyMeta,
  filterSftpKeys,
  formatSftpKeyTime,
  countApplyStatus,
  accountPillTone,
  buildFtpAccountBody,
} from '../../features/ftp';

const FTP_TABS = ['accounts', 'sftp', 'service', 'stack', 'about'] as const;

export function FtpPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const projectFilter = (searchParams.get('project') ?? '').trim();
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
  const [sftpUserFilter, setSftpUserFilter] = useState('');
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyUser, setKeyUser] = useState('');
  const [keyPub, setKeyPub] = useState('');
  const [keyComment, setKeyComment] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const setKeyMsg = useCallback((text: string | null) => {
    if (text) toast.ok(text);
  }, []);
  const [keyErr, setKeyErr] = useState<string | null>(null);
  const [delKeyId, setDelKeyId] = useState<string | null>(null);
  const [serviceStatus, setServiceStatus] = useState<FtpsStatus | null>(null);

  const loadOptions = useCallback(async (user?: string) => {
    try {
      const o = await ftpApi.options(user || undefined);
      setDomains(o.domains);
      setHomes(o.homes);
      return o;
    } catch {
      setDomains([]);
      setHomes([]);
      return { domains: [] as SelectOption[], homes: [] as SelectOption[] };
    }
  }, []);

  const refreshKeys = useCallback(async () => {
    const r = await api.requestRaw<{ items: SftpKey[] }>('/api/v1/sftp/keys');
    setSftpKeys(r.items ?? []);
  }, []);

  const loadServiceStatus = useCallback(async () => {
    try {
      const s = await ftpApi.settings();
      setServiceStatus({ ...s.status, settings: s.settings });
    } catch {
      /* optional KPI — service tab loads full settings */
    }
  }, []);

  useEffect(() => {
    void loadOptions();
    void refreshKeys().catch(() => undefined);
    void loadServiceStatus();
  }, [loadOptions, refreshKeys, loadServiceStatus]);

  useEffect(() => {
    if (!open) return;
    const queryUser = !editId && isFtpUsername(username) ? username.trim() : undefined;
    void loadOptions(queryUser).then((o) => {
      if (editId) return;
      const next = o.homes[0]?.value;
      if (!next) return;
      if (!isFtpUsername(username)) {
        setHomePath((prev) => prev || next);
        return;
      }
      const user = username.trim();
      setHomePath((prev) => {
        if (!prev || /\/user$/.test(prev) || prev.endsWith(`/${user}`)) {
          return next;
        }
        return prev.replace(/\/([^/]+)$/, `/${user}`);
      });
    });
  }, [username, open, editId, loadOptions]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!editId && !isFtpUsername(username)) {
      toast.error(t('ftp.usernameHint'));
      return;
    }
    const home =
      !editId && isFtpUsername(username)
        ? homePath.replace(/\/([^/]+)$/, `/${username.trim()}`)
        : homePath;
    const body = buildFtpAccountBody({ username, password, homePath: home, domain });
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
    const preferred =
      prefillUser ||
      sftpUserFilter ||
      (crud.items[0] ? String(crud.items[0].username ?? '') : '');
    setKeyUser(preferred);
    setKeyPub('');
    setKeyComment('');
    setKeyOpen(true);
  }

  const { applied, draft } = countApplyStatus(crud.items);
  const visibleAccounts = useMemo(() => {
    if (!projectFilter) return crud.items;
    return crud.items.filter((r) => String(r.projectId ?? '') === projectFilter);
  }, [crud.items, projectFilter]);
  const filteredSftpKeys = useMemo(
    () => filterSftpKeys(sftpKeys, sftpUserFilter),
    [sftpKeys, sftpUserFilter],
  );
  const accountUsernames = useMemo(
    () =>
      crud.items
        .map((r) => String(r.username ?? '').trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [crud.items],
  );

  const st = statusLabel(serviceStatus, t);

  return (
    <FeaturePageLayout
      title={t('nav.ftp')}
      showCapability={false}
      status={{
        pill: {
          label: st.text,
          tone: st.tone === 'neutral' ? 'warn' : st.tone,
        },
        items: [
          {
            label: t('ftp.accounts'),
            value: crud.allTotal,
            tone: accountPillTone(crud.items.length, draft),
          },
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
          {
            label: t('common.port'),
            value:
              serviceStatus?.settings?.listenPort != null
                ? String(serviceStatus.settings.listenPort)
                : '—',
          },
        ],
      }}
    >
      {crud.error ? <Alert variant="error">{crud.error}</Alert> : null}
      {serviceStatus?.active === 'failed' ? (
        <Alert variant="error">
          {serviceStatus.listenConflict
            ? t('ftp.listenConflictNeedFix')
            : t('ftp.vsftpdFailedGeneric')}{' '}
          <Link to="/ftp?tab=service">{t('ftp.tabService')}</Link>
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
          {
            id: 'service',
            label: t('ftp.serviceTitle'),
          },
          { id: 'stack', label: t('tabs.stack') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={(id) => {
          setTab(id);
          setKeyErr(null);
        }}
        variant="scroll"
      >
        {tab === 'accounts' ? (
          <div className="tab-panel">
            {projectFilter ? (
              <Alert variant="info">
                {t('ftp.filterProject')}{' '}
                <code className="inline">{projectFilter}</code>
                {' · '}
                <Link to="/ftp">{t('ftp.clearProjectFilter')}</Link>
              </Alert>
            ) : null}
            <Card flush>
              <div className="card__header card__header--pad">
                <div>
                  <h2 className="card__title">{t('ftp.accountsList')}</h2>
                  <p className="card__desc u-mb-0">{t('ftp.accountsListDesc')}</p>
                </div>
                <Button variant="primary" size="sm" onClick={openCreate}>
                  {t('ftp.createAccountPlus')}
                </Button>
              </div>
                <DataTable
                  rowKey={(r, i) => String((r as { id?: string }).id ?? i)}
                  filterActive={crud.activeFilterCount > 0}
                  filters={
                    <ServerListFilters
                      q={crud.q}
                      setQ={crud.setQ}
                      searching={crud.searching}
                      loading={crud.listLoading}
                      total={crud.total}
                      shown={visibleAccounts.length}
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
                  rows={visibleAccounts}
                  empty={
                    <EmptyState title={t('ftp.noFtpAccounts')} description={t('ftp.noFtpAccountsDesc')} />
                  }
                  rowActions={(r) => (
                    <ActionBar>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={crud.busy}
                        onClick={bindCall1(crud.apply, r.id)}
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
                        data-confirm={String(r.username ?? r.id)}
                        onClick={bindSet(setDelId, r.id)}
                      >
                        {t('common.delete')}
                      </Button>
                    </ActionBar>
                  )}
                />
            </Card>

            {crud.items.length > 0 ? (
              <p className="muted u-text-sm">{t('ftp.applyHint')}</p>
            ) : null}
          </div>
        ) : null}

        {tab === 'sftp' ? (
          <div className="tab-panel sftp-keys">
            <Card flush className="sftp-keys__card">
              <div className="card__header card__header--pad sftp-keys__header">
                <div className="sftp-keys__intro">
                  <h2 className="card__title">{t('ftp.sftpPubkeys')}</h2>
                  <p className="card__desc u-mb-0">{t('ftp.sftpTabDesc')}</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={accountUsernames.length === 0}
                  onClick={() => openKeyCreate()}
                  title={
                    accountUsernames.length === 0
                      ? t('ftp.sftpNeedAccount')
                      : t('ftp.addPubkey')
                  }
                >
                  {t('ftp.addPubkeyPlus')}
                </Button>
              </div>

              {accountUsernames.length === 0 ? (
                <div className="sftp-keys__body">
                  <EmptyState
                    title={t('ftp.sftpNeedAccountTitle')}
                    description={t('ftp.sftpNeedAccount')}
                  />
                  <div className="sftp-keys__cta">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setTab('accounts');
                        openCreate();
                      }}
                    >
                      {t('ftp.createAccountPlus')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="sftp-keys__toolbar">
                    <label className="sftp-keys__filter">
                      <span className="sftp-keys__filter-label">
                        {t('ftp.sftpFilterLabel')}
                      </span>
                      <select
                        className="sftp-keys__filter-select"
                        value={sftpUserFilter}
                        onChange={(e) => setSftpUserFilter(e.target.value)}
                        aria-label={t('ftp.sftpFilterLabel')}
                      >
                        <option value="">{t('ftp.sftpFilterAll')}</option>
                        {accountUsernames.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="sftp-keys__count muted u-text-sm">
                      {t('ftp.sftpKeyCount', { count: filteredSftpKeys.length })}
                    </span>
                  </div>

                  {filteredSftpKeys.length === 0 ? (
                    <div className="sftp-keys__body">
                      <EmptyState
                        title={
                          sftpUserFilter
                            ? t('ftp.sftpEmptyFiltered')
                            : t('ftp.noPubkeys')
                        }
                        description={
                          sftpUserFilter
                            ? t('ftp.sftpEmptyFilteredDesc', {
                                user: sftpUserFilter,
                              })
                            : t('ftp.pubkeyHint')
                        }
                      />
                      <div className="sftp-keys__cta">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => openKeyCreate(sftpUserFilter || undefined)}
                        >
                          {t('ftp.sftpRegister')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <ul className="sftp-keys__list" aria-label={t('ftp.sftpPubkeys')}>
                      {filteredSftpKeys.map((k) => {
                        const meta = parseSshPubkeyMeta(k.publicKey);
                        const label = k.comment?.trim() || meta.comment || '—';
                        return (
                          <li key={k.id} className="sftp-key-row">
                            <div className="sftp-key-row__main">
                              <div className="sftp-key-row__top">
                                <Badge tone="info">
                                  {meta.algo.replace(/^ssh-/, '')}
                                </Badge>
                                <strong className="sftp-key-row__user">
                                  {k.username}
                                </strong>
                                <span className="sftp-key-row__note muted">
                                  {label}
                                </span>
                              </div>
                              <code
                                className="sftp-key-row__preview"
                                title={k.publicKey}
                              >
                                {meta.preview}
                              </code>
                              <time
                                className="sftp-key-row__time muted u-text-sm"
                                dateTime={k.created_at}
                              >
                                {t('ftp.sftpAddedAt', {
                                  time: formatSftpKeyTime(k.created_at),
                                })}
                              </time>
                            </div>
                            <div className="sftp-key-row__actions">
                              <Button
                                variant="danger"
                                size="sm"
                                loading={keyBusy && delKeyId === k.id}
                                onClick={() => setDelKeyId(k.id)}
                              >
                                {t('common.delete')}
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}

              <details className="sftp-keys__tech">
                <summary>{t('ftp.sftpTechSummary')}</summary>
                <p className="muted u-text-sm u-mb-0">
                  {t('ftp.sftpTechNote')}{' '}
                  <code className="inline">
                    dataDir/ftps/ssh/&lt;user&gt;/authorized_keys
                  </code>
                  {t('ftp.sshdMatchNote')}
                </p>
              </details>
            </Card>
          </div>
        ) : null}

        {tab === 'service' ? (
          <FtpServicePanel onStatusChange={setServiceStatus} />
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel stack">
            <SoftwareInstallBanner
              feature="ftp"
              title={t('ftp.softwareMissing')}
              onInstalled={() => void loadServiceStatus()}
              showReadyActions={false}
            />
            <SoftwareVersionBar
              softwareId="vsftpd"
              unitStatus={serviceStatus?.active}
            />
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="ftp" /> : null}
      </PageTabs>

      <Modal
        open={open}
        onClose={bindSet(setOpen, false)}
        title={editId ? t('ftp.editAccount') : t('ftp.createAccount')}
        description={t('ftp.accountModalDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setOpen, false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="ftp-f"
              variant="primary"
              size="md"
              loading={crud.busy}
              disabled={!editId && !isFtpUsername(username)}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form id="ftp-f" noValidate onSubmit={bindFormSubmit(onSave)}>
          <FormLayout columns={2}>
            <Field
              label={t('common.username')}
              htmlFor="fu"
              flush
              required
              hint={t('ftp.usernameHintCreate')}
              error={
                !editId && username.trim() && !isFtpUsername(username)
                  ? t('ftp.usernameHint')
                  : undefined
              }
            >
              <input
                id="fu"
                value={username}
                onChange={bindInput(setUsername)}
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
              <PasswordInput
                id="fp"
                value={password}
                onChange={bindInput(setPassword)}
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
                  onChange={bindInput(setDomain)}
                  required={!editId}
                >
                  <option value="">{t('ftp.pickDomain')}</option>
                  {domains.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                  {domain && !domains.some((d) => d.value === domain) ? (
                    <option value={domain}>
                      {t('ftp.currentDomain', { domain })}
                    </option>
                  ) : null}
                </select>
              ) : (
                <input
                  id="fd"
                  value={domain}
                  onChange={bindInput(setDomain)}
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
                onChange={bindInput(setHomePath)}
                required={!editId}
              >
                <option value="">{t('ftp.pickHome')}</option>
                {homes.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
                {homePath && !homes.some((h) => h.value === homePath) ? (
                  <option value={homePath}>
                    {t('ftp.currentHome', { path: homePath })}
                  </option>
                ) : null}
              </select>
            </Field>
          </FormLayout>
          {homePath ? (
            <FormHint>
              {t('ftp.fullPath')}
              <code className="inline">{homePath}</code>
            </FormHint>
          ) : (
            <FormHint>{t('ftp.emptyHomes')}</FormHint>
          )}
        </form>
      </Modal>

      <Modal
        open={keyOpen}
        onClose={() => {
          setKeyOpen(false);
          setKeyErr(null);
        }}
        title={t('ftp.addPubkey')}
        description={t('ftp.addPubkeyDesc')}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setKeyOpen(false);
                setKeyErr(null);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={keyBusy}
              onClick={() => {
                const user = keyUser.trim();
                const pub = keyPub.trim();
                if (!user || !/^ssh-/.test(pub)) {
                  setKeyErr(t('ftp.sftpKeyInvalid'));
                  return;
                }
                setKeyBusy(true);
                setKeyErr(null);
                setKeyMsg(null);
                void api
                  .requestRaw<{ ok: boolean; notes?: string[] }>(
                    '/api/v1/sftp/keys',
                    {
                      method: 'POST',
                      body: JSON.stringify({
                        username: user,
                        publicKey: pub,
                        comment: keyComment || undefined,
                      }),
                    },
                  )
                  .then((r) => {
                    setKeyMsg(r.notes?.join('；') ?? t('ftp.pubkeyAdded'));
                    setKeyOpen(false);
                    setKeyPub('');
                    setKeyComment('');
                    return refreshKeys();
                  })
                  .catch((e: Error) => setKeyErr(t('ftp.sftpKeyInvalid')))
                  .finally(() => setKeyBusy(false));
              }}
            >
              {t('ftp.sftpRegister')}
            </Button>
          </>
        }
      >
        {keyErr ? <Alert variant="error">{keyErr}</Alert> : null}
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
                onChange={bindInput(setKeyUser)}
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
                onChange={bindInput(setKeyUser)}
                placeholder={t('ftp.ftpUsernamePh')}
                required
                spellCheck={false}
              />
            )}
          </Field>
          <Field
            label={t('common.notes')}
            htmlFor="sk-cmt"
            flush
            hint={t('ftp.noteHint')}
          >
            <input
              id="sk-cmt"
              value={keyComment}
              onChange={bindInput(setKeyComment)}
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
              onChange={bindInput(setKeyPub)}
              placeholder="ssh-ed25519 AAAA… comment"
              required
              spellCheck={false}
            />
          </Field>
        </FormLayout>
      </Modal>

      <ConfirmDialog
        open={Boolean(delId)}
        onClose={bindSet(setDelId, null)}
        onConfirm={bindRemoveIf(delId, crud.remove, setDelId)}
        title={t('ftp.deleteAccountNamed', {
          name: String(crud.items.find((r) => r.id === delId)?.username ?? delId ?? ''),
        })}
        description={t('ftp.deleteAccountDesc')}
        severity="standard"
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={crud.busy}
      />

      <ConfirmDialog
        open={Boolean(delKeyId)}
        onClose={bindSet(setDelKeyId, null)}
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
        severity="standard"
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={keyBusy}
      />
    </FeaturePageLayout>
  );
}
