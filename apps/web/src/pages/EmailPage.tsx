/**
 * Email control plane: domains · queue · software · about (guide only).
 * Create only in domains ListPanel toolbar (table top-right).
 * Software version bars live only on the software tab — never page chrome.
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { emailApi, type EmailDomain } from '../features/email';
import { emailHealthUnprobed } from '../features/email/health-display';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormHint,
  FormLayout,
  ListPanel,
  ListToolbar,
  Modal,
  ConfirmDialog,
  DataTable,
  OpsResultPanel,
  PageTabs,
  SegRadio,
  SoftwareInstallBanner,
  SoftwareVersionBar } from '../shared/components/ui';
import type { OpsResultLike } from '../shared/components/ui';
import { api } from '../shared/services/api';
import { notifyError, notifyOk, notifyWarn } from '../shared/lib/notify';
import { getServerContext, setServerContext } from '../shared/stores/server-context';
import { usePageTab } from '../shared/hooks/usePageTab';
import { useServerList } from '../shared/hooks/useServerList';
import { useNavBookmarks } from '../shared/hooks/useNavBookmarks';
import {
  bindCloseIfIdle,
  bindFilter,
  bindFormSubmit,
  bindInput,
  bindInputContext,
  bindRefreshCatch,
  bindSeq,
  bindSet,
  bindVoid } from './bind-handlers';
import { ServiceAccessStrip } from '../features/network/service-exposure';
import { ServiceLifecycleBar } from '../features/system/ServiceLifecycleBar';
import { sslApi } from '../features/ssl/api';

function asOps(r: Record<string, unknown> | null): OpsResultLike | null {
  if (!r) return null;
  const blocked = Boolean(r.blocked || r.requiresExecute || r.requiresRoot);
  const ok =
    typeof r.ok === 'boolean' ? r.ok : !blocked && r.apply_status !== 'blocked';
  return {
    ...r,
    ok,
    blocked,
    blockMessage: typeof r.blockMessage === 'string' ? r.blockMessage : undefined,
    notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
  } as OpsResultLike;
}

function notifyOps(
  r: Record<string, unknown>,
  t: (k: string) => string,
): void {
  const notes = Array.isArray(r.notes)
    ? r.notes.map(String).map((n) => n.trim()).filter(Boolean)
    : [];
  const blocked = Boolean(
    r.blocked || r.requiresExecute || r.requiresRoot || r.apply_status === 'blocked',
  );
  const ok = r.ok === true && !blocked;
  const main =
    (typeof r.blockMessage === 'string' && r.blockMessage.trim()) ||
    notes[0] ||
    (ok ? t('common.completed') : t('common.opFailed'));
  const extra = notes.filter((n) => n !== main).slice(0, 4);
  const detail = extra.length ? extra.join('\n') : undefined;
  const opts = detail ? { detail, durationMs: 8000 as const } : undefined;
  if (ok) notifyOk(main, opts);
  else notifyWarn(main, opts);
}

function isIpv4(s: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s.trim());
}

function isIpv6(s: string): boolean {
  const t = s.trim();
  return t.includes(':') && !isIpv4(t);
}

const TABS = ['domains', 'webmail', 'queue', 'stack', 'about'] as const;
const GLOBAL_WEBMAIL_PROJECT = 'ysk-webmail';

export function applyLabel(status: string | undefined, t: (k: string) => string): { text: string; tone: 'ok' | 'info' | 'neutral' | 'warn' } {
  const s = (status ?? 'draft').toLowerCase();
  if (s === 'applied') return { text: t('email.applyApplied'), tone: 'ok' };
  if (s === 'written') return { text: t('email.applyWritten'), tone: 'info' };
  if (s === 'failed') return { text: t('email.applyFailed'), tone: 'warn' };
  return { text: t('email.applyDraft'), tone: 'neutral' };
}

export function countAppliedDomains(
  items: Array<{ apply_status?: string }>,
  facets?: { status?: { applied?: number } } | null,
): number {
  return (
    facets?.status?.applied ??
    items.filter((d) => (d.apply_status ?? '').toLowerCase() === 'applied')
      .length
  );
}

export function countHealthyDomains(
  items: Array<{
    health_score: number;
    dns_applied?: boolean;
    ptr_ok?: boolean;
    port25_open?: boolean | null;
  }>,
  threshold = 80,
): number {
  return items.filter((d) => !emailHealthUnprobed(d) && d.health_score >= threshold).length;
}

export function anyDomainHealthChecked(
  items: Array<{
    dns_applied?: boolean;
    ptr_ok?: boolean;
    port25_open?: boolean | null;
  }>,
): boolean {
  return items.some((d) => !emailHealthUnprobed(d));
}

export function countDraftDomains(
  items: Array<{ apply_status?: string }>,
  facets?: { status?: { draft?: number; written?: number } } | null,
): number {
  if (facets) {
    return (facets.status?.draft ?? 0) + (facets.status?.written ?? 0);
  }
  return items.filter((d) => {
    const s = (d.apply_status ?? 'draft').toLowerCase();
    return s === 'draft' || s === 'written' || !d.apply_status;
  }).length;
}

export function domainNameFromCreate(created: {
  domain: string | { domain: string };
}): string {
  return typeof created.domain === 'string'
    ? created.domain
    : created.domain.domain;
}

export function domainIdFromCreate(created: {
  domain: string | { id?: string };
}): string {
  return typeof created.domain === 'object' &&
    created.domain &&
    'id' in created.domain
    ? String((created.domain as { id?: string }).id ?? '')
    : '';
}

export function EmailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ctx = getServerContext();
  const list = useServerList<EmailDomain>({
    path: '/api/v1/email/domains',
    debounceMs: 300 });
  const items = list.items;
  const [tab, setTab] = usePageTab(TABS, 'domains');
  const [createOpen, setCreateOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [serverIp, setServerIp] = useState(ctx.serverIp);
  const [serverIpv6, setServerIpv6] = useState(ctx.serverIpv6 ?? '');
  const [busy, setBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [flushConfirmOpen, setFlushConfirmOpen] = useState(false);
  const [deleteQueueId, setDeleteQueueId] = useState<string | null>(null);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queueOk, setQueueOk] = useState<boolean | null>(null);
  const [queueQ, setQueueQ] = useState('');
  const [queueItems, setQueueItems] = useState<
    Array<{
      id: string;
      raw: string;
      size?: number;
      sender?: string;
      recipients?: string[];
      time?: string;
      status?: 'active' | 'held' | 'deferred';
      reason?: string;
    }>
  >([]);
  const [hostIps, setHostIps] = useState<string[]>([]);
  const [dovecotFailed, setDovecotFailed] = useState(false);
  const [dovecotActive, setDovecotActive] = useState<string>('');
  const [svcActive, setSvcActive] = useState<Record<string, string>>({});
  const [certNames, setCertNames] = useState<string[]>([]);

  // Global webmail (shared by all mail domains)
  const [wmTool, setWmTool] = useState<'roundcube' | 'snappymail'>('roundcube');
  const [wmHost, setWmHost] = useState('webmail.example.com');
  const [wmProject, setWmProject] = useState(GLOBAL_WEBMAIL_PROJECT);
  const [wmForceHttps, setWmForceHttps] = useState(false);
  const [wmLog, setWmLog] = useState<Record<string, unknown> | null>(null);
  const [wmBusy, setWmBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api
      .requestRaw<{
        items?: Array<{ id?: string; active?: string }>;
      }>('/api/v1/system/services/matrix')
      .then((r) => {
        if (cancelled) return;
        const dove = (r.items ?? []).find((s) => s.id === 'dovecot');
        setDovecotActive(String(dove?.active ?? ''));
        setDovecotFailed(dove?.active === 'failed');
        const map: Record<string, string> = {};
        for (const s of r.items ?? []) {
          if (s.id) map[s.id] = String(s.active ?? '');
        }
        setSvcActive(map);
      })
      .catch(() => {
        if (!cancelled) setDovecotFailed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void sslApi
      .list()
      .then((r) => {
        if (cancelled) return;
        const names = (r.items ?? [])
          .flatMap((c) => [
            String((c as { domain?: string }).domain ?? ''),
            ...(((c as { names?: string[] }).names ?? []) as string[]),
          ])
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        setCertNames([...new Set(names)]);
      })
      .catch(() => {
        if (!cancelled) setCertNames([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hostV4 = useMemo(() => hostIps.filter(isIpv4), [hostIps]);
  const hostV6 = useMemo(() => hostIps.filter(isIpv6), [hostIps]);

  // Prefill webmail host from first registered domain when available
  useEffect(() => {
    if (!items.length) return;
    setWmHost((cur) => {
      if (cur && cur !== 'webmail.example.com') return cur;
      const d = items[0]?.domain?.trim();
      return d ? `webmail.${d}` : cur;
    });
  }, [items]);

  useEffect(() => {
    if (!createOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await api.requestRaw<{ items?: string[] }>('/api/v1/system/ips');
        if (cancelled) return;
        const raw = (r.items ?? [])
          .map((s) => s.replace(/\/\d+$/, '').trim())
          .filter(Boolean);
        const flat = raw.flatMap((s) => s.split(/\s+/)).filter(Boolean);
        const uniq = [...new Set(flat)];
        setHostIps(uniq);
        setServerIp((cur) => {
          if (cur.trim()) return cur;
          const first4 = uniq.find(isIpv4);
          if (first4) {
            setServerContext({ serverIp: first4 });
            return first4;
          }
          return cur;
        });
      } catch {
        if (!cancelled) setHostIps([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [createOpen]);

  const total = list.meta?.total ?? items.length;
  const facets = list.meta?.facets;
  const applied = countAppliedDomains(items, facets);
  const healthy = countHealthyDomains(items);
  const draft = countDraftDomains(items, facets);
  const { isEmailBookmarked, toggleEmail } = useNavBookmarks();
  const mailHostsWanted = useMemo(() => {
    const out = new Set<string>();
    for (const d of items) {
      const base = String(d.domain || '').trim().toLowerCase();
      if (!base) continue;
      out.add(`mail.${base}`);
    }
    const wm = wmHost.trim().toLowerCase();
    if (wm) out.add(wm);
    return [...out];
  }, [items, wmHost]);
  const missingMailCerts = mailHostsWanted.filter((h) => !certNames.includes(h));
  const wmHasCert = certNames.includes(wmHost.trim().toLowerCase());

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    list.setError(null);
    setBusy(true);
    try {
      const created = await emailApi.create({
        domain,
        serverIp,
        ...(serverIpv6.trim() ? { serverIpv6: serverIpv6.trim() } : {}) });
      setDomain('');
      setCreateOpen(false);
      setServerContext({
        domain,
        serverIp,
        serverIpv6: serverIpv6.trim() || undefined });
      const domainName = domainNameFromCreate(created);
      const next = await list.refresh();
      // refresh doesn't return items from useServerList — use list after
      void next;
      await list.refresh();
      // navigate by id from create response if possible
      const foundId = domainIdFromCreate(created);
      if (foundId) navigate(`/email/domains/${foundId}`);
      else navigate(`/email`);
      void domainName;
    } catch (err) {
      list.setError(err instanceof Error ? err.message : t('common.createFailed'));
    } finally {
      setBusy(false);
    }
  }

  const loadQueue = useCallback(async () => {
    setQueueBusy(true);
    setQueueMsg(null);
    try {
      const r = await emailApi.mailQueue();
      setQueueItems(r.items ?? []);
      setQueueOk(r.ok !== false && !r.blocked);
      setQueueMsg(
        (r.notes ?? []).join(' · ') ||
          t('email.queueMsgCount', { count: (r.items ?? []).length }),
      );
    } catch (e) {
      setQueueOk(false);
      setQueueMsg(e instanceof Error ? e.message : t('email.queueLoadFailed'));
      setQueueItems([]);
    } finally {
      setQueueBusy(false);
    }
  }, [t]);

  useEffect(() => {
    if (tab !== 'queue') return;
    void loadQueue();
  }, [tab, loadQueue]);

  const visibleQueue = useMemo(() => {
    const q = queueQ.trim().toLowerCase();
    if (!q) return queueItems;
    return queueItems.filter((it) =>
      [it.id, it.sender, it.reason, ...(it.recipients ?? []), it.raw]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [queueItems, queueQ]);

  function queueStatusLabel(status?: string): string {
    if (status === 'active') return t('email.queueActive');
    if (status === 'held') return t('email.queueHeld');
    return t('email.queueDeferred');
  }

  async function flushAll() {
    setQueueBusy(true);
    try {
      const r = await emailApi.flushQueue({ all: true });
      setQueueItems([]);
      setQueueOk(r.ok !== false && !(r as { blocked?: boolean }).blocked);
      setQueueMsg(
        ((r as { notes?: string[] }).notes ?? []).join(' · ') || t('email.queueFlushRequested'),
      );
    } catch (e) {
      setQueueOk(false);
      setQueueMsg(e instanceof Error ? e.message : t('email.queueFlushFailed'));
    } finally {
      setQueueBusy(false);
    }
  }

  async function flushOne(id: string) {
    setQueueBusy(true);
    try {
      const r = await emailApi.flushQueue({ id });
      setQueueMsg(((r as { notes?: string[] }).notes ?? []).join(' · ') || t('email.queueDeleted', { id }));
      setQueueOk(r.ok !== false);
      setQueueItems((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setQueueOk(false);
      setQueueMsg(e instanceof Error ? e.message : t('email.queueDeleteFailed'));
    } finally {
      setQueueBusy(false);
    }
  }

  async function runWebmail(opts: { reinstall?: boolean }) {
    setWmBusy(true);
    try {
      const host = wmHost.trim() || 'webmail.local';
      const firstDomain = items[0]?.domain?.trim();
      const mailDomain =
        firstDomain ||
        (host.match(/^webmail\d*\.(.+)$/i)?.[1] ?? undefined);
      const imapHost = mailDomain ? `mail.${mailDomain}` : undefined;
      const r = await emailApi.webmailApply({
        domain: host,
        mailDomain,
        imapHost,
        smtpHost: imapHost,
        projectName: wmProject.trim() || GLOBAL_WEBMAIL_PROJECT,
        tool: wmTool,
        asProject: true,
        download: true,
        reinstall: opts.reinstall !== false,
        forceHttps: wmForceHttps,
        installSsoPlugin: wmTool === 'roundcube',
        projectId:
          opts.reinstall && typeof wmLog?.projectId === 'string'
            ? wmLog.projectId
            : undefined,
      });
      setWmLog(r);
      notifyOps(r, t);
    } catch (e) {
      notifyError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setWmBusy(false);
    }
  }

  return (
    <FeaturePageLayout
      title={t('nav.email')}
      status={{
        pill: {
          label: total ? t('email.pillDomains', { count: total }) : t('email.pillNoDomain'),
          tone: total ? 'ok' : 'warn' },
        items: [
          { label: t('email.statDomains'), value: total },
          {
            label: t('email.statHealthy80'),
            value: anyDomainHealthChecked(items) ? healthy : '—',
            tone: healthy > 0 ? 'ok' : undefined },
          {
            label: t('email.statApplied'),
            value: applied,
            tone: applied > 0 ? 'ok' : undefined },
          {
            label: t('email.statDraft'),
            value: draft,
            tone: draft > 0 ? 'warn' : undefined },
        ] }}
      actions={
        <ActionBar>
          <Button
            variant="ghost"
            size="sm"
            loading={busy || list.loading}
            onClick={bindRefreshCatch(list.refresh, list.setError)}
          >
            {t('common.refresh')}
          </Button>
        </ActionBar>
      }
    >
      {list.error ? <Alert variant="error">{list.error}</Alert> : null}
      {dovecotFailed ? (
        <Alert variant="error">
          {t('email.dovecotFailedStatus', { status: dovecotActive || 'failed' })}{' '}
          <Link to="/email?tab=stack">{t('email.tabStack')}</Link>
          {missingMailCerts.length ? (
            <>
              {' · '}
              {t('email.mailCertMissing', { hosts: missingMailCerts.join(', ') })}{' '}
              <Link to="/ssl">SSL</Link>
            </>
          ) : (
            <>
              {' · '}
              {t('email.mailCertPresent')}
            </>
          )}
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: 'domains',
            label: t('email.tabDomains'),
            badge: items.length || undefined },
          { id: 'webmail', label: t('email.tabWebmail') },
          {
            id: 'queue',
            label: t('email.tabQueue'),
            badge: queueItems.length || undefined },
          { id: 'stack', label: t('email.tabStack') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'domains' ? (
          <div className="tab-panel mail-panel">
            <ListPanel
              title={t('email.domainsTitle', { filtered: items.length, total })}
              description={t('email.domainsListDesc')}
              toolbar={
                <ActionBar>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={bindSet(setCreateOpen, true)}
                  >
                    + {t('email.create')}
                  </Button>
                </ActionBar>
              }
              filters={
                <ListToolbar
                  search={list.q}
                  onSearchChange={list.setQ}
                  searchPlaceholder={t('email.searchPlaceholder')}
                  searchAriaLabel={t('email.searchPlaceholder')}
                  searching={list.searching}
                  loading={list.loading}
                  total={total}
                  shown={items.length}
                  activeFilterCount={list.activeFilterCount}
                  onClear={list.clear}
                  chipGroups={[
                    {
                      key: 'status',
                      ariaLabel: t('common.status'),
                      allLabel: t('common.all', { defaultValue: 'All' }),
                      value: list.filters.status ?? '',
                      onChange: bindFilter(list.setFilter, 'status'),
                      chips: [
                        {
                          id: 'applied',
                          label: t('email.applyApplied'),
                          count: facets?.status?.applied,
                          tone: 'ok' },
                        {
                          id: 'draft',
                          label: t('email.applyDraft'),
                          count: facets?.status?.draft },
                        {
                          id: 'failed',
                          label: t('email.applyFailed'),
                          count:
                            facets?.status?.failed ??
                            items.filter((d) => (d.apply_status ?? '').toLowerCase() === 'failed')
                              .length,
                          tone: 'danger' },
                      ] },
                  ]}
                />
              }
              empty={items.length === 0}
              emptyTitle={
                list.activeFilterCount > 0 ? t('listToolbar.noResults') : t('email.empty')
              }
              emptyDescription={
                list.activeFilterCount > 0
                  ? t('listToolbar.noResultsHint')
                  : t('email.emptyCreateHint')
              }
            >
              <div className="list-panel mail-domain-list" role="list">
                {items.map((d) => {
                  const st = applyLabel(d.apply_status, t);
                  const pinned = isEmailBookmarked(d.id);
                  return (
                    <div key={d.id} className="list-row mail-domain-row">
                      <Link
                        to={`/email/domains/${d.id}`}
                        className="list-row__main"
                      >
                        <div className="list-row__title">
                          <span className="mail-domain-name">{d.domain}</span>
                          <Badge tone={st.tone}>{st.text}</Badge>
                          {pinned ? (
                            <span title={t('nav.bookmarkPinned')}>
                              <Badge tone="warn">★</Badge>
                            </span>
                          ) : null}
                        </div>
                        <div className="list-row__meta">
                          <span>IP {d.server_ip || '—'}</span>
                        </div>
                      </Link>
                      <div className="list-row__side">
                        <Button
                          variant="ghost"
                          size="sm"
                          title={pinned ? t('nav.unbookmark') : t('nav.bookmark')}
                          aria-label={
                            pinned ? t('nav.unbookmark') : t('nav.bookmark')
                          }
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void toggleEmail({ id: d.id, domain: d.domain })
                              .then((on) =>
                                notifyOk(
                                  on
                                    ? t('nav.bookmarkAdded')
                                    : t('nav.bookmarkRemoved'),
                                ),
                              )
                              .catch((err: Error) => notifyWarn(err.message));
                          }}
                        >
                          {pinned ? '★' : '☆'}
                        </Button>
                        <Badge
                          tone={
                            emailHealthUnprobed(d)
                              ? 'neutral'
                              : d.health_score >= 80
                                ? 'ok'
                                : 'warn'
                          }
                        >
                          {emailHealthUnprobed(d)
                            ? t('email.healthUnchecked')
                            : `${d.health_score}/100`}
                        </Badge>
                        <Link
                          to={`/email/domains/${d.id}`}
                          className="list-row__chevron"
                          aria-hidden
                        >
                          ›
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ListPanel>
          </div>
        ) : null}

        {tab === 'webmail' ? (
          <div className="tab-panel mail-panel">
            <Card>
              <CardSection
                title={t('email.webmailRoundcube')}
                description={t('email.webmailGlobalDesc')}
              >
                <Alert variant="info">{t('email.webmailGlobalHint')}</Alert>
                <p className="muted u-text-sm">{t('email.webmailRisk')}</p>
                <FormLayout columns={2}>
                  <Field label={t('email.webmailTool')} htmlFor="g-wtool" flush>
                    <SegRadio
                      name="global-webmail-tool"
                      value={wmTool}
                      onChange={(v) =>
                        setWmTool(v === 'snappymail' ? 'snappymail' : 'roundcube')
                      }
                      options={[
                        { value: 'roundcube', label: t('email.webmailToolRoundcube') },
                        { value: 'snappymail', label: t('email.webmailToolSnappy') },
                      ]}
                    />
                  </Field>
                  <Field
                    label={t('email.webmailHostname')}
                    htmlFor="g-wmd"
                    flush
                    hint={t('email.webmailHostnameHint')}
                    required
                  >
                    <input
                      id="g-wmd"
                      value={wmHost}
                      onChange={bindInput(setWmHost)}
                      placeholder="webmail.example.com"
                      spellCheck={false}
                    />
                  </Field>
                  <Field label={t('email.webmailProjectName')} htmlFor="g-wpn" flush>
                    <input
                      id="g-wpn"
                      value={wmProject}
                      onChange={bindInput(setWmProject)}
                      placeholder={GLOBAL_WEBMAIL_PROJECT}
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <CheckboxField
                  id="g-wm-https"
                  checked={wmForceHttps && wmHasCert}
                  disabled={!wmHasCert}
                  onChange={(c) => {
                    if (c && !wmHasCert) return;
                    setWmForceHttps(c);
                  }}
                  label={t('email.webmailForceHttps')}
                  description={
                    wmHasCert ? undefined : t('email.webmailNeedCert', { host: wmHost })
                  }
                />
                <ActionBar size="md">
                  <Button
                    variant="primary"
                    size="md"
                    loading={wmBusy}
                    title={t('email.installWebmailTitle')}
                    onClick={() => void runWebmail({ reinstall: false })}
                  >
                    {t('email.installWebmailProject')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={wmBusy}
                    disabled={!wmLog?.projectId}
                    title={
                      wmLog?.projectId
                        ? t('email.reinstallWebmailTitle')
                        : t('email.reinstallNeedInstall')
                    }
                    onClick={() => void runWebmail({ reinstall: true })}
                  >
                    {t('email.reinstallWebmail')}
                  </Button>
                  {typeof wmLog?.urlHint === 'string' && wmLog.urlHint ? (
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => {
                        window.open(String(wmLog.urlHint), '_blank', 'noopener,noreferrer');
                      }}
                    >
                      {t('email.openWebmail')}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={() =>
                      navigate(
                        `/ssl?domain=${encodeURIComponent(wmHost.trim() || 'webmail.local')}&action=le`,
                      )
                    }
                  >
                    {t('email.openSslPage')}
                  </Button>
                </ActionBar>
                {wmLog ? (
                  <OpsResultPanel
                    title={t('email.webmailRoundcube')}
                    result={asOps(wmLog)}
                    busy={wmBusy}
                  />
                ) : null}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'queue' ? (
          <div className="tab-panel">
            {queueMsg && queueOk === false ? (
              <Alert variant="error">{queueMsg}</Alert>
            ) : null}
            <DataTable
              title={t('email.queueLocalTitle')}
              description={t('email.queueHint')}
              toolbar={
                <ActionBar size="md">
                  <Button
                    variant="secondary"
                    size="md"
                    loading={queueBusy}
                    onClick={bindVoid(loadQueue)}
                  >
                    {t('common.refresh')}
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    loading={queueBusy}
                    disabled={!queueItems.length}
                    title={
                      !queueItems.length
                        ? t('email.flushQueueEmpty')
                        : t('email.flushQueueNeedExecute')
                    }
                    onClick={bindSet(setFlushConfirmOpen, true)}
                  >
                    {t('email.flushQueue')}
                  </Button>
                </ActionBar>
              }
              filters={
                <Field label={t('common.search')} htmlFor="mail-queue-q" flush>
                  <input
                    id="mail-queue-q"
                    value={queueQ}
                    onChange={bindInput(setQueueQ)}
                    placeholder={t('email.queueSearchPh')}
                  />
                </Field>
              }
              columns={[
                {
                  key: 'id',
                  header: t('email.queueId'),
                  nowrap: true,
                  render: (r) => <code className="inline">{r.id}</code>,
                },
                {
                  key: 'sender',
                  header: t('email.queueSender'),
                  render: (r) => r.sender || '—',
                },
                {
                  key: 'to',
                  header: t('email.queueRecipients'),
                  render: (r) =>
                    r.recipients?.length ? r.recipients.join(', ') : '—',
                },
                {
                  key: 'size',
                  header: t('email.queueSize'),
                  nowrap: true,
                  render: (r) => (r.size != null ? String(r.size) : '—'),
                },
                {
                  key: 'status',
                  header: t('common.status'),
                  nowrap: true,
                  render: (r) => (
                    <Badge>{queueStatusLabel(r.status)}</Badge>
                  ),
                },
                {
                  key: 'reason',
                  header: t('email.queueReason'),
                  render: (r) => (
                    <span className="muted u-text-sm">{r.reason || '—'}</span>
                  ),
                },
              ]}
              rows={visibleQueue}
              rowKey={(r) => r.id}
              rowActions={(r) => (
                <ActionBar>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={queueBusy}
                    onClick={() => setDeleteQueueId(r.id)}
                  >
                    {t('email.deleteThisId')}
                  </Button>
                </ActionBar>
              )}
              empty={
                queueBusy && queueOk === null ? (
                  <EmptyState title={t('common.loading')} />
                ) : queueOk === false ? (
                  <EmptyState
                    title={t('email.queueLoadFailed')}
                    description={queueMsg ?? undefined}
                  />
                ) : (
                  <EmptyState
                    title={t('email.queueEmpty')}
                    description={t('email.queueEmptyHint')}
                  />
                )
              }
            />
            {queueOk === true && queueMsg && visibleQueue.length > 0 ? (
              <FormHint>{queueMsg}</FormHint>
            ) : null}
          </div>
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel mail-panel stack">
            <SoftwareInstallBanner feature="email" title={t('email.softwareNeeded')} showReadyActions={false} />
            <div className="u-mb-3 u-stack-form">
              <ServiceAccessStrip
                serviceId="postfix"
                heading={t('serviceExposure.roleSmtp')}
                ports={[
                  { role: 'smtp', port: '25', proto: 'tcp' },
                  { role: 'smtps', port: '465', proto: 'tcp' },
                  { role: 'submission', port: '587', proto: 'tcp' },
                ]}
                compact
                tenantCount={items.length}
              />
              <ServiceAccessStrip
                serviceId="dovecot"
                heading={t('serviceExposure.roleImap')}
                ports={[
                  { role: 'imap', port: '143', proto: 'tcp' },
                  { role: 'imaps', port: '993', proto: 'tcp' },
                  { role: 'pop3', port: '110', proto: 'tcp' },
                  { role: 'pop3s', port: '995', proto: 'tcp' },
                ]}
                compact
                tenantCount={items.length}
              />
            </div>
            <Card>
              <CardSection title="Postfix">
                <SoftwareVersionBar softwareId="postfix" title="Postfix" unitStatus={svcActive.postfix} />
                <ServiceLifecycleBar
                  unit="postfix"
                  label="Postfix"
                  actions={['start', 'stop', 'restart', 'reload']}
                  size="sm"
                />
              </CardSection>
            </Card>
            <Card>
              <CardSection title="Dovecot">
                <SoftwareVersionBar softwareId="dovecot" title="Dovecot" unitStatus={svcActive.dovecot} />
                <ServiceLifecycleBar
                  unit="dovecot"
                  label="Dovecot"
                  actions={['start', 'stop', 'restart', 'reload']}
                  size="sm"
                />
              </CardSection>
            </Card>
            <Card>
              <CardSection title="OpenDKIM">
                <SoftwareVersionBar softwareId="opendkim" title="OpenDKIM" unitStatus={svcActive.opendkim} />
                <ServiceLifecycleBar
                  unit="opendkim"
                  label="OpenDKIM"
                  actions={['start', 'stop', 'restart']}
                  size="sm"
                />
                <p className="muted u-text-sm u-mt-2" title={t('email.opendkimNoReloadTitle')}>
                  {t('email.opendkimNoReload')}
                </p>
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="email" /> : null}
      </PageTabs>

      <Modal
        open={createOpen}
        onClose={bindSet(setCreateOpen, false)}
        title={t('email.create')}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={bindSet(setCreateOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="email-create-form"
              variant="primary"
              size="md"
              loading={busy}
            >
              {t('email.registerDomain')}
            </Button>
          </>
        }
      >
        <form id="email-create-form" className="stack" onSubmit={bindFormSubmit(onCreate)}>
          <Field label={t('email.domain')} htmlFor="edomain" flush required>
            <input
              id="edomain"
              value={domain}
              onChange={bindInput(setDomain)}
              placeholder="example.com"
              required
              autoFocus
              spellCheck={false}
            />
          </Field>

          <Field label={t('email.serverIp')} htmlFor="eip" flush required>
            <input
              id="eip"
              value={serverIp}
              onChange={bindInputContext(setServerIp, setServerContext, 'serverIp')}
              required
              placeholder="203.0.113.10"
              spellCheck={false}
            />
            {hostV4.length > 0 ? (
              <div className="mail-ip-presets" role="group" aria-label={t('email.hostIpPick')}>
                {hostV4.map((ip) => (
                  <button
                    key={ip}
                    type="button"
                    className={`mail-ip-presets__chip${serverIp.trim() === ip ? ' is-on' : ''}`}
                    onClick={() => {
                      setServerIp(ip);
                      setServerContext({ serverIp: ip });
                    }}
                  >
                    {ip}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>

          <Field label={t('email.serverIpv6')} htmlFor="eip6" flush>
            <input
              id="eip6"
              value={serverIpv6}
              onChange={bindInputContext(setServerIpv6, setServerContext, 'serverIpv6')}
              placeholder={t('email.serverIpv6Ph')}
              spellCheck={false}
            />
            {hostV6.length > 0 ? (
              <div className="mail-ip-presets" role="group" aria-label={t('email.hostIpPickV6')}>
                {hostV6.map((ip) => (
                  <button
                    key={ip}
                    type="button"
                    className={`mail-ip-presets__chip${serverIpv6.trim() === ip ? ' is-on' : ''}`}
                    onClick={() => {
                      setServerIpv6(ip);
                      setServerContext({ serverIpv6: ip });
                    }}
                  >
                    {ip}
                  </button>
                ))}
              </div>
            ) : null}
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={flushConfirmOpen}
        onClose={bindCloseIfIdle(queueBusy, bindSet(setFlushConfirmOpen, false))}
        onConfirm={bindSeq(bindSet(setFlushConfirmOpen, false), bindVoid(flushAll))}
        title={t('email.flushConfirmTitle')}
        description={t('email.flushConfirmDesc')}
        confirmLabel={t('email.flushConfirm')}
        cancelLabel={t('common.cancel')}
        danger
        busy={queueBusy}
      />
      <ConfirmDialog
        open={Boolean(deleteQueueId)}
        onClose={bindCloseIfIdle(queueBusy, () => setDeleteQueueId(null))}
        onConfirm={() => {
          const id = deleteQueueId;
          setDeleteQueueId(null);
          if (id) void flushOne(id);
        }}
        title={t('email.deleteQueueTitle')}
        description={t('email.deleteQueueDesc', { id: deleteQueueId ?? '' })}
        confirmLabel={t('email.deleteThisId')}
        cancelLabel={t('common.cancel')}
        danger
        busy={queueBusy}
      />
    </FeaturePageLayout>
  );
}
