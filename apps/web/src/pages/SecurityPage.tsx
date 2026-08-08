/**
 * Security — 2FA · API Keys · SSH 工作台 · 審批 · Allowlist
 * SSH UX lives in features/security/ssh (job-to-be-done workspace).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { useSecurity } from '../features/security';
import { TotpSetupPanel } from '../features/security/TotpSetupPanel';
import { SshWorkspace } from '../features/security/ssh';
import { api } from '../shared/services/api';
import { toast } from '../shared/stores/toast-store';
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
  PageTabs } from '../shared/components/ui';
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

/** True when browser exposes WebAuthn APIs (does not guarantee platform authenticator). */
export function browserSupportsWebAuthn(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  try {
    return (
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential ===
        'function' &&
      typeof navigator.credentials?.create === 'function' &&
      typeof navigator.credentials?.get === 'function'
    );
  } catch {
    return false;
  }
}

/** WebAuthn requires a secure context (HTTPS or localhost). */
export function isSecureWebAuthnContext(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.isSecureContext === true;
  } catch {
    return false;
  }
}

/** Hostnames that browsers treat as valid WebAuthn RP IDs (not public IPs). */
export function isWebAuthnIpHostname(hostname: string): boolean {
  const h = (hostname || '').trim().toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return false;
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // IPv6 (with or without brackets)
  if (h.includes(':')) return true;
  return false;
}

export type WebAuthnEnv = {
  origin: string;
  hostname: string;
  isSecureContext: boolean;
  hasPublicKeyCredential: boolean;
  isIpHost: boolean;
  isLocalhost: boolean;
  /** Browser + URL look usable for a Passkey ceremony (still may fail for other reasons). */
  likelyOk: boolean;
};

/** Snapshot of current page environment for Passkey (diagnosis only — never a product gate). */
export function getWebAuthnEnv(): WebAuthnEnv {
  if (typeof window === 'undefined' || typeof location === 'undefined') {
    return {
      origin: '',
      hostname: '',
      isSecureContext: false,
      hasPublicKeyCredential: false,
      isIpHost: false,
      isLocalhost: false,
      likelyOk: false };
  }
  const hostname = location.hostname || '';
  const isLocalhost =
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  const isSecureContext = window.isSecureContext === true;
  const hasPublicKeyCredential = browserSupportsWebAuthn();
  const isIpHost = isWebAuthnIpHostname(hostname);
  // Spec: secure context required; public IP is not a valid RP ID.
  const likelyOk = hasPublicKeyCredential && isSecureContext && !isIpHost;
  return {
    origin: location.origin || '',
    hostname,
    isSecureContext,
    hasPublicKeyCredential,
    isIpHost,
    isLocalhost,
    likelyOk };
}

/**
 * Human diagnosis when Passkey cannot start.
 * Prefer environment truth over library's misleading "not supported in this browser"
 * (often thrown on http://IP even in Brave).
 */
export function diagnoseWebAuthnBlocker(
  t: (k: string, o?: Record<string, unknown>) => string,
  env: WebAuthnEnv = getWebAuthnEnv(),
): string | null {
  if (env.isIpHost) {
    return t('security.webauthnIpHost', { origin: env.origin || env.hostname });
  }
  if (!env.isSecureContext) {
    return t('security.webauthnInsecureContext', { origin: env.origin });
  }
  if (!env.hasPublicKeyCredential) {
    return t('security.webauthnUnsupported');
  }
  return null;
}

/** Map library / DOMException messages to locale keys (avoid raw English on top of zh UI). */
export function mapWebAuthnError(
  err: unknown,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  const env = getWebAuthnEnv();
  const msg = err instanceof Error ? err.message : String(err ?? '');
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';

  if (!msg.trim()) return t('security.webauthnFailed');
  // Library often says "not supported" when the real issue is http://IP or insecure context.
  if (/not supported|unsupported|publickeycredential is not defined/i.test(msg)) {
    return diagnoseWebAuthnBlocker(t, env) ?? t('security.webauthnUnsupported');
  }
  if (
    code === 'ERROR_INVALID_DOMAIN' ||
    code === 'ERROR_INVALID_RP_ID' ||
    /invalid domain|invalid for this domain|rp id/i.test(msg)
  ) {
    return t('security.webauthnIpHost', { origin: env.origin || env.hostname });
  }
  if (/secure context|insecure|must be.*https|only available in secure/i.test(msg)) {
    return t('security.webauthnInsecureContext', { origin: env.origin });
  }
  if (
    /timed out|timeout|not allowed|notallowederror|abort|cancel|operation either timed out/i.test(
      msg,
    )
  ) {
    return t('security.webauthnCancelled');
  }
  // Keep short server notes (often already localized); drop long English library noise.
  if (/[\u4e00-\u9fff]/.test(msg) || msg.startsWith('YSK_') || msg.length <= 80) {
    return msg;
  }
  return t('security.webauthnFailed');
}

/** Pre-flight before calling @simplewebauthn/browser — still allows click; returns error text. */
export function preflightWebAuthn(
  t: (k: string, o?: Record<string, unknown>) => string,
): string | null {
  return diagnoseWebAuthnBlocker(t);
}

export function SecurityPage() {
  const { t } = useTranslation();
  const { tools, approvals, error, result, busy, runSysInfo, approve } = useSecurity();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = usePageTab(TAB_IDS, 'account');
  const [createKeyOpen, setCreateKeyOpen] = useState(false);
  const [totpStatus, setTotpStatus] = useState<{
    enabled: boolean;
    enrolled: boolean;
    recoveryRemaining?: number;
  } | null>(null);  const [passkeyErr, setPasskeyErrRaw] = useState<string | null>(null);
  const setPasskeyErr = useCallback((text: string | null) => {
    if (text) toast.error(text);
    setPasskeyErrRaw(null);
  }, []);
  const setPasskeyMsg = useCallback((text: string | null) => {
    if (text) toast.ok(text);
  }, []);  const [totpBusy, setTotpBusy] = useState(false);
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
          tone: approvals.length > 0 ? 'warn' : totpStatus?.enabled ? 'ok' : 'warn' },
        items: [
          {
            label: t('security.stat2fa'),
            value: totpStatus?.enabled ? t('common.on') : t('common.off'),
            tone: totpStatus?.enabled ? 'ok' : 'warn' },
          { label: t('security.statApi'), value: apiKeys.length },
          {
            label: t('security.statSsh'),
            value: `${sshCounts.identities}/${sshCounts.loginKeys}` },
          {
            label: t('security.statPending'),
            value: approvals.length,
            tone: approvals.length > 0 ? 'danger' : 'ok' },
        ] }}
      actions={<Button variant="secondary" size="sm" loading={busy} onClick={bindVoid(runSysInfo)}>
          {t('security.runSysInfo')}
        </Button>
      }
    >
      <PageTabs
        tabs={[
          { id: 'account', label: t('security.tabAccount') },
          { id: 'keys', label: t('security.tabApiKeys'), badge: apiKeys.length || undefined },
          {
            id: 'ssh',
            label: t('security.tabSsh'),
            badge: sshCounts.identities + sshCounts.loginKeys || undefined },
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
            <Alert variant="info" className="u-mb-3">
              {t('security.mySecurityHint')}
            </Alert>
            <Card>
              <CardSection>
                <TotpSetupPanel status={totpStatus} onStatusChange={refreshTotp} />
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
                              os: ua.os })
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
                                  when: relativeTime(s.created_at, t) })}
                                <span className="sess-card__id" title={s.id}>
                                  {t('security.sessionIdShort', {
                                    id: s.id.slice(0, 10) })}
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
                          ip: revokeTarget.ip || '—' })
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
                        toast.ok(t('security.sessionRevoked'));
                        return refreshSessions();
                      })
                      .catch((e: Error) =>
                        toast.error(e.message),
                      );
                  }}
                />
                <ConfirmDialog
                  open={revokeOthersOpen}
                  title={t('security.revokeOthersTitle')}
                  description={t('security.revokeOthersDesc', {
                    count: sessions.filter((s) => !s.current).length })}
                  confirmLabel={t('security.revokeOtherSessions')}
                  danger
                  onClose={bindSet(setRevokeOthersOpen, false)}
                  onConfirm={() => {
                    setRevokeOthersOpen(false);
                    void api
                      .revokeOtherSessions()
                      .then((r) => {
                        toast.ok(t('security.revokedOtherSessions', {
                            count: r.revoked }));
                        return refreshSessions();
                      })
                      .catch((e: Error) =>
                        toast.error(e.message),
                      );
                  }}
                />
              </CardSection>
            </Card>

            <Card>
              <CardSection
                title={t('security.passkeyTitle')}
                description={t('security.passkeyDesc')}
              >
                {/* Diagnosis only — never disable buttons. Brave/NordPass need HTTPS + domain. */}
                {(() => {
                  const env = getWebAuthnEnv();
                  if (env.likelyOk) {
                    return (
                      <Alert variant="info" className="u-mb-3">
                        {t('security.webauthnEnvOk', { origin: env.origin })}
                      </Alert>
                    );
                  }
                  return (
                    <Alert variant="info" className="u-mb-3">
                      {t('security.webauthnEnvCurrent', { origin: env.origin || '—' })}
                      <span className="u-block u-mt-1 muted u-text-sm">
                        {diagnoseWebAuthnBlocker(t, env) ?? t('security.webauthnUnavailableHint')}
                      </span>
                    </Alert>
                  );
                })()}
                <ActionBar className="u-mb-3">
                  <Button
                    variant="primary"
                    size="sm"
                    loading={totpBusy}
                    onClick={() => {
                      setPasskeyErr(null);
                      setPasskeyMsg(null);
                      const block = preflightWebAuthn(t);
                      if (block) {
                        setPasskeyErr(block);
                        return;
                      }
                      setTotpBusy(true);
                      void (async () => {
                        try {
                          const { startRegistration, browserSupportsWebAuthn: libSupports } =
                            await import('@simplewebauthn/browser');
                          if (typeof libSupports === 'function' && !libSupports()) {
                            setPasskeyErr(
                              diagnoseWebAuthnBlocker(t) ?? t('security.webauthnUnsupported'),
                            );
                            return;
                          }
                          const begin = await api.requestRaw<{
                            options: PublicKeyCredentialCreationOptionsJSON;
                          }>('/api/v1/auth/webauthn/register/begin', {
                            method: 'POST',
                            body: '{}' });
                          if (!begin?.options) {
                            setPasskeyErr(t('security.webauthnFailed'));
                            return;
                          }
                          const att = await startRegistration({
                            optionsJSON: begin.options as never });
                          const fin = await api.requestRaw<{
                            ok: boolean;
                            notes?: string[];
                          }>('/api/v1/auth/webauthn/register/finish', {
                            method: 'POST',
                            body: JSON.stringify({ response: att, name: 'Passkey' }) });
                          setPasskeyMsg(
                            fin.ok
                              ? t('security.passkeyRegistered')
                              : (fin.notes ?? []).join(' · ') || t('common.failed'),
                          );
                        } catch (e) {
                          setPasskeyErr(mapWebAuthnError(e, t));
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
                      setPasskeyErr(null);
                      setPasskeyMsg(null);
                      const block = preflightWebAuthn(t);
                      if (block) {
                        setPasskeyErr(block);
                        return;
                      }
                      setTotpBusy(true);
                      void (async () => {
                        try {
                          const { startAuthentication, browserSupportsWebAuthn: libSupports } =
                            await import('@simplewebauthn/browser');
                          if (typeof libSupports === 'function' && !libSupports()) {
                            setPasskeyErr(
                              diagnoseWebAuthnBlocker(t) ?? t('security.webauthnUnsupported'),
                            );
                            return;
                          }
                          const begin = await api.requestRaw<{
                            ok: boolean;
                            options?: PublicKeyCredentialRequestOptionsJSON;
                            notes?: string[];
                          }>('/api/v1/auth/webauthn/authenticate/begin', {
                            method: 'POST',
                            body: '{}' });
                          if (!begin.ok || !begin.options) {
                            setPasskeyErr(
                              (begin.notes ?? []).join(' · ') || t('security.noPasskey'),
                            );
                            return;
                          }
                          const ass = await startAuthentication({
                            optionsJSON: begin.options as never });
                          const fin = await api.requestRaw<{ ok: boolean; notes?: string[] }>(
                            '/api/v1/auth/webauthn/authenticate/finish',
                            {
                              method: 'POST',
                              body: JSON.stringify({ response: ass }) },
                          );
                          setPasskeyMsg(
                            fin.ok
                              ? t('security.passkeyVerifyOk')
                              : (fin.notes ?? []).join(' · ') || t('common.failed'),
                          );
                        } catch (e) {
                          setPasskeyErr(mapWebAuthnError(e, t));
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
                          toast.ok(t('security.trustedDevicesCount', {
                              count: (r.items ?? []).length })),
                        )
                        .catch((e: Error) =>
                          toast.error(e.message),
                        );
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
                        .then(() => toast.ok(t('security.revokedAllDevices')))
                        .catch((e: Error) =>
                          toast.error(e.message),
                        );
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
                          toast.ok(t('security.fail2banSnippetMsg', {
                              written: (r.written ?? []).join(', '),
                              notes: (r.notes ?? []).join(' · ') })),
                        )
                        .catch((e: Error) =>
                          toast.error(e.message),
                        );
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
                <p className="muted u-text-sm u-mb-3">{t('security.policyTotpHint')}</p>
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
                          totp: policyTotp || undefined })
                        .then(() => {
                          toast.ok(t('security.policyUpdated'));
                          setPolicyTotp('');
                          return refreshPolicy();
                        })
                        .catch((e: Error) =>
                          toast.error(e.message),
                        );
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
            <Modal
              open={Boolean(newKeyToken)}
              onClose={() => setNewKeyToken(null)}
              title={t('security.apiTokenOnce')}
              size="sm"
              footer={
                <>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      if (newKeyToken) {
                        void navigator.clipboard?.writeText(newKeyToken);
                        toast.ok(t('security.copiedToken'));
                      }
                    }}
                  >
                    {t('common.copy')}
                  </Button>
                  <Button variant="primary" size="md" onClick={() => setNewKeyToken(null)}>
                    {t('common.close')}
                  </Button>
                </>
              }
            >
              {newKeyToken ? (
                <p className="u-break-all">
                  <code>{newKeyToken}</code>
                </p>
              ) : null}
            </Modal>
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
                  render: (k) => <strong>{k.name}</strong> },
                {
                  key: 'prefix',
                  header: t('security.colPrefix'),
                  render: (k) => <span className="muted">{k.prefix}…</span> },
                {
                  key: 'created',
                  header: t('security.colCreated'),
                  className: 'muted u-text-sm',
                  render: (k) => k.created_at },
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
                        .catch((e: Error) =>
                          toast.error(e.message),
                        );
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
            {error ? (
              <Alert variant="error" className="u-mb-3">
                {error}
              </Alert>
            ) : null}
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
            {error ? (
              <Alert variant="error" className="u-mb-3">
                {error}
              </Alert>
            ) : null}
            <DataTable
              title={t('security.allowlistTitle', { count: tools.length })}
              columns={[
                {
                  key: 'tool',
                  header: 'Tool',
                  render: (tool) => (
                    <code className="inline">{String(tool.tool)}</code>
                  ) },
                {
                  key: 'allowed',
                  header: 'Allowed',
                  nowrap: true,
                  render: (tool) => (
                    <Badge tone={tool.allowed ? 'ok' : 'danger'}>
                      {String(tool.allowed)}
                    </Badge>
                  ) },
                {
                  key: 'risk',
                  header: 'Risk',
                  render: (tool) => String(tool.risk) },
                {
                  key: 'approval',
                  header: 'Approval',
                  render: (tool) => String(tool.requiresApproval) },
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
                    body: JSON.stringify({ name: newKeyName, scope }) })
                  .then((r) => {
                    setNewKeyToken(r.token);
                    toast.ok(t('security.apiKeyCreated'));
                    setCreateKeyOpen(false);
                    return refreshKeys();
                  })
                  .catch((e: Error) =>
                    toast.error(e.message),
                  )
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
                body: JSON.stringify({ totp }) });
              if (r.blob) {
                void navigator.clipboard?.writeText(r.blob);
                toast.ok(t('security.backupCopied'));
              } else {
                toast.error((r.notes ?? []).join(' · ') || t('common.failed'));
                return false;
              }
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t('common.failed'));
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
                body: JSON.stringify({ name: newKeyName, totp, scope }) });
              setNewKeyToken(r.token);
              toast.ok(t('security.apiKeyCreated'));
              setCreateKeyOpen(false);
              setTotpPrompt(null);
              await refreshKeys();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t('common.failed'));
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
