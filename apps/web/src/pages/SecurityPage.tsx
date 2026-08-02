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
  ConfirmDialog,
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
import { bindSet, bindInput, bindCheck, bindVoid } from './bind-handlers';

const TAB_IDS = ['account', 'keys', 'ssh', 'approvals', 'allowlist', 'about'] as const;

type SessionRow = {
  id: string;
  created_at: string;
  last_seen_at?: string;
  ip?: string;
  user_agent?: string;
  current?: boolean;
};

/** Friendly browser/OS from User-Agent (best-effort). */
export function parseUserAgent(ua?: string): { browser: string; os: string; icon: string } {
  const s = ua || '';
  let browser = 'Unknown';
  let icon = '💻';
  if (/curl\//i.test(s)) {
    browser = 'curl / API';
    icon = '⌨️';
  } else if (/Edg\//i.test(s)) {
    browser = 'Microsoft Edge';
    icon = '🌐';
  } else if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) {
    browser = 'Chrome';
    icon = '🌐';
  } else if (/Firefox\//i.test(s)) {
    browser = 'Firefox';
    icon = '🦊';
  } else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) {
    browser = 'Safari';
    icon = '🧭';
  } else if (s.trim()) {
    browser = s.slice(0, 40) + (s.length > 40 ? '…' : '');
  }
  let os = '';
  if (/Windows/i.test(s)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone|iPad/i.test(s)) os = 'iOS';
  else if (/Linux/i.test(s)) os = 'Linux';
  return { browser, os, icon };
}

export function relativeTime(
  iso: string | undefined,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return iso.slice(0, 19).replace('T', ' ');
  const sec = Math.floor(ms / 1000);
  if (sec < 45) return t('security.sessionJustNow');
  if (sec < 3600) return t('security.sessionMinAgo', { n: Math.max(1, Math.floor(sec / 60)) });
  if (sec < 86400) return t('security.sessionHourAgo', { n: Math.floor(sec / 3600) });
  if (sec < 86400 * 7) return t('security.sessionDayAgo', { n: Math.floor(sec / 86400) });
  return new Date(iso).toLocaleString();
}

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
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<SessionRow | null>(null);
  const [revokeOthersOpen, setRevokeOthersOpen] = useState(false);
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
      return [{ label: t('security.output'), value: result.slice(0, 500) }];
    }
  })();

  return (
    <FeaturePageLayout
      title={t('nav.security')}
      showCapability={false}
      status={{
        pill: {
          label:
            approvals.length > 0
              ? t('security.pillPending', { count: approvals.length })
              : totpStatus?.enabled
                ? t('security.pillReady')
                : t('security.pill2faOff'),
          tone: approvals.length > 0 ? 'warn' : totpStatus?.enabled ? 'ok' : 'warn',
        },
        items: [
          {
            label: t('security.stat2fa'),
            value: totpStatus?.enabled ? t('common.on') : t('common.off'),
            tone: totpStatus?.enabled ? 'ok' : 'warn',
          },
          { label: t('security.statApi'), value: apiKeys.length },
          {
            label: t('security.statSsh'),
            value: `${sshCounts.identities}/${sshCounts.loginKeys}`,
          },
          {
            label: t('security.statPending'),
            value: approvals.length,
            tone: approvals.length > 0 ? 'danger' : 'ok',
          },
        ],
      }}
      actions={<Button variant="secondary" size="sm" loading={busy} onClick={bindVoid(runSysInfo)}>
          {t('security.runSysInfo')}
        </Button>
      }
    >
      {error ? <Alert variant="error">{error}</Alert> : null}
      {totpErr ? <Alert variant="error">{totpErr}</Alert> : null}
      {totpMsg ? <Alert variant="ok">{totpMsg}</Alert> : null}
      {newKeyToken ? (
        <Alert variant="ok">
          {t('security.apiTokenOnce')}<code className="inline u-break-all">{newKeyToken}</code>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(newKeyToken);
              setTotpMsg(t('security.copiedToken'));
            }}
          >
            {t('common.copy')}
          </Button>
          <Button variant="ghost" size="sm" onClick={bindSet(setNewKeyToken, null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          { id: 'account', label: t('security.tabAccount') },
          { id: 'keys', label: t('security.tabApiKeys'), badge: apiKeys.length || undefined },
          {
            id: 'ssh',
            label: t('security.tabSsh'),
            badge: sshCounts.identities + sshCounts.loginKeys || undefined,
          },
          { id: 'approvals', label: t('security.tabApprovals'), badge: approvals.length || undefined },
          { id: 'allowlist', label: t('security.tabAllowlist'), badge: tools.length || undefined },
        
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'account' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('security.totpTitle')}>
                <p className="muted u-text-sm">
                  {t('security.totpStatus')}
                  {totpStatus?.enabled
                    ? t('security.totpEnabled')
                    : totpStatus?.enrolled
                      ? t('security.totpEnrolledUnconfirmed')
                      : t('security.totpNotSet')}
                </p>
                <FormLayout columns={2}>
                  <Field
                    label={t('security.reauthPassword')}
                    htmlFor="reauth-pw"
                    flush
                    hint={t('security.reauthPasswordHint')}
                  >
                    <input
                      id="reauth-pw"
                      type="password"
                      value={reauthPassword}
                      onChange={bindInput(setReauthPassword)}
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
                          setTotpMsg(t('security.totpSecretGenerated'));
                          setReauthPassword('');
                          return refreshTotp();
                        })
                        .catch((e: Error) => setTotpErr(e.message))
                        .finally(() => setTotpBusy(false));
                    }}
                  >
                    {totpStatus?.enabled ? t('security.reset2fa') : t('security.start2fa')}
                  </Button>
                </ActionBar>
                {totpSecret ? (
                  <div className="u-mt-4">
                    <FormHint>
                      {t('security.secretLabel')}<code className="inline">{totpSecret}</code>
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
                        label={t('security.confirmCode')}
                        htmlFor="totp-confirm"
                        flush
                        required
                        hint={t('security.confirmCodeHint')}
                      >
                        <input
                          id="totp-confirm"
                          value={totpCode}
                          onChange={bindInput(setTotpCode)}
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
                                t('security.totpEnabledSaveCodes'),
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
                        {t('security.confirmEnable')}
                      </Button>
                    </FormActions>
                  </div>
                ) : null}
                {recoveryCodes && recoveryCodes.length > 0 ? (
                  <div className="u-mt-4">
                    <FormHint>
                      {t('security.recoveryCodesHint')}
                    </FormHint>
                    <pre className="u-font-mono u-text-sm">
                      {recoveryCodes.join('\n')}
                    </pre>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(recoveryCodes.join('\n'));
                        setTotpMsg(t('security.copiedRecoveryCodes'));
                      }}
                    >
                      {t('security.copyAll')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={bindSet(setRecoveryCodes, null)}
                    >
                      {t('security.savedClose')}
                    </Button>
                  </div>
                ) : null}
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={t('security.sessionsTitle')}
                description={t('security.sessionsDesc')}
              >
                {sessions.length > 0 ? (
                  <div className="sess-summary u-mb-3">
                    <div className="sess-summary__stat">
                      <span className="sess-summary__n">{sessions.length}</span>
                      <span className="sess-summary__l">{t('security.sessionsActive')}</span>
                    </div>
                    <div className="sess-summary__stat">
                      <span className="sess-summary__n">
                        {sessions.filter((s) => !s.current).length}
                      </span>
                      <span className="sess-summary__l">{t('security.sessionsOther')}</span>
                    </div>
                    <p className="sess-summary__hint muted u-text-sm">
                      {t('security.sessionsHint')}
                    </p>
                  </div>
                ) : null}

                <ActionBar className="u-mb-4">
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => void refreshSessions().catch(() => undefined)}
                  >
                    {t('common.refresh')}
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    disabled={sessions.filter((s) => !s.current).length === 0}
                    onClick={bindSet(setRevokeOthersOpen, true)}
                  >
                    {t('security.revokeOtherSessions')}
                  </Button>
                </ActionBar>

                {sessions.length === 0 ? (
                  <EmptyState
                    title={t('security.noSessions')}
                    description={t('security.noSessionsHint')}
                  />
                ) : (
                  <ul className="sess-list">
                    {[...sessions]
                      .sort((a, b) => Number(!!b.current) - Number(!!a.current))
                      .map((s) => {
                        const ua = parseUserAgent(s.user_agent);
                        const title = ua.os
                          ? t('security.sessionDeviceOn', {
                              browser: ua.browser,
                              os: ua.os,
                            })
                          : ua.browser;
                        const when = relativeTime(s.last_seen_at ?? s.created_at, t);
                        return (
                          <li
                            key={s.id}
                            className={`sess-card${s.current ? ' sess-card--current' : ''}`}
                          >
                            <div className="sess-card__icon" aria-hidden>
                              {ua.icon}
                            </div>
                            <div className="sess-card__body">
                              <div className="sess-card__title-row">
                                <strong className="sess-card__title">{title}</strong>
                                {s.current ? (
                                  <Badge tone="ok">{t('security.currentSession')}</Badge>
                                ) : (
                                  <Badge tone="neutral">{t('security.sessionOtherBadge')}</Badge>
                                )}
                              </div>
                              <div className="sess-card__meta">
                                <span>{s.ip || t('security.sessionIpUnknown')}</span>
                                <span className="sess-card__dot" aria-hidden>
                                  ·
                                </span>
                                <span>
                                  {t('security.sessionLastActive', { when })}
                                </span>
                              </div>
                              <div className="sess-card__sub muted u-text-sm">
                                {t('security.sessionStarted', {
                                  when: relativeTime(s.created_at, t),
                                })}
                                <span className="sess-card__id" title={s.id}>
                                  {t('security.sessionIdShort', {
                                    id: s.id.slice(0, 10),
                                  })}
                                </span>
                              </div>
                            </div>
                            <div className="sess-card__actions">
                              {s.current ? (
                                <span className="sess-card__this muted u-text-sm">
                                  {t('security.sessionThisDevice')}
                                </span>
                              ) : (
                                <Button
                                  variant="danger"
                                  size="md"
                                  onClick={bindSet(setRevokeTarget, s)}
                                >
                                  {t('security.revoke')}
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                )}

                <ConfirmDialog
                  open={Boolean(revokeTarget)}
                  title={t('security.revokeSessionTitle')}
                  description={
                    revokeTarget
                      ? t('security.revokeSessionDesc', {
                          device: parseUserAgent(revokeTarget.user_agent).browser,
                          ip: revokeTarget.ip || '—',
                        })
                      : ''
                  }
                  confirmLabel={t('security.revoke')}
                  danger
                  onClose={bindSet(setRevokeTarget, null)}
                  onConfirm={() => {
                    if (!revokeTarget) return;
                    const id = revokeTarget.id;
                    setRevokeTarget(null);
                    void api
                      .revokeSession(id)
                      .then(() => {
                        setTotpMsg(t('security.sessionRevoked'));
                        return refreshSessions();
                      })
                      .catch((e: Error) => setTotpErr(e.message));
                  }}
                />
                <ConfirmDialog
                  open={revokeOthersOpen}
                  title={t('security.revokeOthersTitle')}
                  description={t('security.revokeOthersDesc', {
                    count: sessions.filter((s) => !s.current).length,
                  })}
                  confirmLabel={t('security.revokeOtherSessions')}
                  danger
                  onClose={bindSet(setRevokeOthersOpen, false)}
                  onConfirm={() => {
                    setRevokeOthersOpen(false);
                    void api
                      .revokeOtherSessions()
                      .then((r) => {
                        setTotpMsg(
                          t('security.revokedOtherSessions', { count: r.revoked }),
                        );
                        return refreshSessions();
                      })
                      .catch((e: Error) => setTotpErr(e.message));
                  }}
                />
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={t('security.passkeyTitle')}
                description={t('security.passkeyDesc')}
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
                              ? t('security.passkeyRegistered')
                              : (fin.notes ?? []).join(' · ') || t('common.failed'),
                          );
                        } catch (e) {
                          setTotpErr(e instanceof Error ? e.message : t('security.webauthnFailed'));
                        } finally {
                          setTotpBusy(false);
                        }
                      })();
                    }}
                  >
                    {t('security.registerPasskey')}
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
                            setTotpErr((begin.notes ?? []).join(' · ') || t('security.noPasskey'));
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
                              ? t('security.passkeyVerifyOk')
                              : (fin.notes ?? []).join(' · ') || t('common.failed'),
                          );
                        } catch (e) {
                          setTotpErr(e instanceof Error ? e.message : t('security.verifyFailed'));
                        } finally {
                          setTotpBusy(false);
                        }
                      })();
                    }}
                  >
                    {t('security.verifyWithPasskey')}
                  </Button>
                </ActionBar>
                <FormHint>
                  {t('security.passkeyHint')}
                </FormHint>
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={t('security.devicesTitle')}
                description={t('security.devicesDesc')}
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
                          setTotpMsg(t('security.trustedDevicesCount', { count: (r.items ?? []).length })),
                        )
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    {t('security.viewTrustedDevices')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => {
                      void api
                        .requestRaw('/api/v1/auth/devices', { method: 'DELETE' })
                        .then(() => setTotpMsg(t('security.revokedAllDevices')))
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    {t('security.revokeAllDevices')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setTotpPrompt({ kind: 'backup' })}
                  >
                    {t('security.export2faBackup')}
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
                            t('security.fail2banSnippetMsg', {
                              written: (r.written ?? []).join(', '),
                              notes: (r.notes ?? []).join(' · '),
                            }),
                          ),
                        )
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    {t('security.generateFail2ban')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={t('security.adminPolicyTitle')}
                description={t('security.adminPolicyDesc')}
              >
                <label className="ssh-check">
                  <input
                    type="checkbox"
                    checked={requireAdminTotp}
                    onChange={bindCheck(setRequireAdminTotp)}
                  />
                  <span>{t('security.requireAdmin2fa')}</span>
                </label>
                <label className="ssh-check u-mt-2">
                  <input
                    type="checkbox"
                    checked={requireStrict}
                    onChange={bindCheck(setRequireStrict)}
                  />
                  <span>{t('security.strictAdmin2fa')}</span>
                </label>
                <Field
                  label={t('security.confirmTotpPolicy')}
                  htmlFor="pol-totp"
                  className="u-mt-4"
                  hint={t('security.confirmTotpPolicyHint')}
                >
                  <input
                    id="pol-totp"
                    value={policyTotp}
                    onChange={bindInput(setPolicyTotp)}
                    maxLength={12}
                    placeholder={t('security.totp6digitPlaceholder')}
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
                          setTotpMsg(t('security.policyUpdated'));
                          setPolicyTotp('');
                          return refreshPolicy();
                        })
                        .catch((e: Error) => setTotpErr(e.message));
                    }}
                  >
                    {t('security.savePolicy')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>

            {probeItems.length > 0 ? (
              <Card>
                <CardSection title={t('security.recentProbe')}>
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
              title={t('security.apiKeysTitle')}
              description={t('security.apiKeysDesc')}
              toolbar={
                <ActionBar>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void refreshKeys().catch(() => undefined)}
                  >
                    {t('common.refresh')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={bindSet(setCreateKeyOpen, true)}
                  >
                    {t('security.createKey')}
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: t('security.colName'),
                  render: (k) => <strong>{k.name}</strong>,
                },
                {
                  key: 'prefix',
                  header: t('security.colPrefix'),
                  render: (k) => <span className="muted">{k.prefix}…</span>,
                },
                {
                  key: 'created',
                  header: t('security.colCreated'),
                  className: 'muted u-text-sm',
                  render: (k) => k.created_at,
                },
              ]}
              rows={apiKeys}
              rowKey={(k) => k.id}
              empty={
                <EmptyState
                  title={t('security.apiKeysEmpty')}
                  description={t('security.apiKeysEmptyHint')}
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
                    {t('common.delete')}
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
                            {t('security.approve')}
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
              title={t('security.allowlistTitle', { count: tools.length })}
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
              empty={<p className="muted">{t('security.allowlistEmpty')}</p>}
            />
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="security" /> : null}
      </PageTabs>

      <Modal
        open={createKeyOpen}
        onClose={bindSet(setCreateKeyOpen, false)}
        title={t('security.createApiKeyTitle')}
        description={t('security.createApiKeyDesc')}
        footer={
          <>
            <Button variant="secondary" size="md" onClick={bindSet(setCreateKeyOpen, false)}>
              {t('common.cancel')}
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
                    setTotpMsg(t('security.apiKeyCreated'));
                    setCreateKeyOpen(false);
                    return refreshKeys();
                  })
                  .catch((e: Error) => setTotpErr(e.message))
                  .finally(() => setTotpBusy(false));
              }}
            >
              {t('security.createKeyBtn')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('common.name')} htmlFor="ak-name" flush required hint={t('security.apiKeyNameHint')}>
            <input
              id="ak-name"
              value={newKeyName}
              onChange={bindInput(setNewKeyName)}
              placeholder="ci-deploy"
              spellCheck={false}
            />
          </Field>
          <Field label={t('security.apiKeyScope')} htmlFor="ak-scope" flush hint={t('security.apiKeyScopeHint')}>
            <select id="ak-scope" defaultValue="full">
              <option value="full">{t('security.scopeFull')}</option>
              <option value="read">{t('security.scopeRead')}</option>
            </select>
          </Field>
          <FormHint>{t('security.apiKey2faHint')}</FormHint>
        </FormLayout>
      </Modal>

      <PromptDialog
        open={totpPrompt != null}
        onClose={() => !totpBusy && setTotpPrompt(null)}
        title={
          totpPrompt?.kind === 'backup'
            ? t('security.export2faBackupTitle')
            : t('security.createApiKeyStepUp')
        }
        description={t('security.enterTotpCode')}
        label="TOTP"
        secret
        placeholder={t('security.digit6Placeholder')}
        confirmLabel={totpPrompt?.kind === 'backup' ? t('security.export') : t('common.create')}
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
                setTotpMsg(t('security.backupCopied'));
              } else {
                setTotpErr((r.notes ?? []).join(' · ') || t('common.failed'));
                return false;
              }
            } catch (e) {
              setTotpErr(e instanceof Error ? e.message : t('common.failed'));
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
              setTotpMsg(t('security.apiKeyCreated'));
              setCreateKeyOpen(false);
              setTotpPrompt(null);
              await refreshKeys();
            } catch (e) {
              setTotpErr(e instanceof Error ? e.message : t('common.failed'));
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
