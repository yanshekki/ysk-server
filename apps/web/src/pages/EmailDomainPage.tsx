/**
 * Email domain detail — professional console layout (aligned with recent UX).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  emailApi,
  EmailDomainDeleteDialog,
  type EmailBundle,
  type EmailDomain,
} from '../features/email';
import { emailHealthPartial, emailHealthUnprobed } from '../features/email/health-display';
import { usePageTab } from '../shared/hooks/usePageTab';
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
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  LoadingBlock,
  Modal,
  OpsResultPanel,
  SoftwareInstallBanner,
  SummaryStrip,
  PageTabs,
  FormActions,
  CheckboxField,
  SegRadio,
  DescriptionList } from '../shared/components/ui';
import type { OpsResultLike } from '../shared/components/ui';
import { ApiError, api } from '../shared/services/api';
import { formatDateTime } from '../shared/lib/datetime';
import { notifyError, notifyOk, notifyWarn } from '../shared/lib/notify';
import {
  bindBusyApplyPolicy,
  bindBusyAutodiscover,
  bindBusyBootstrap,
  bindBusyCreateMailbox,
  bindBusyDnsblMulti,
  bindBusyDual,
  bindBusyFlagsUpdate,
  bindBusyListSieve,
  bindBusyLiveReload,

  bindBusyMap,
  bindBusyMutateList,
  bindBusySet,
  bindBusySetAndTab,
  bindBusySetRelay,
  bindBusyWebmailSso,
  bindBusyWriteSieve,
  bindClipboard,
  bindInput,
  bindNavigate,
  bindOpenCreate,
  bindSet } from './bind-handlers';

export function asOps(r: Record<string, unknown> | null): OpsResultLike | null {
  if (!r) return null;
  const blocked = Boolean(r.blocked || r.requiresExecute || r.requiresRoot);
  const ok =
    typeof r.ok === 'boolean'
      ? r.ok
      : !blocked && r.apply_status !== 'blocked';
  return {
    ...r,
    ok,
    blocked,
    blockMessage: typeof r.blockMessage === 'string' ? r.blockMessage : undefined,
    notes: Array.isArray(r.notes) ? r.notes.map(String) : [] } as OpsResultLike;
}

/**
 * Top-right toast for ops results — never use page-top red Alert for success notes.
 * ok → green; blocked/partial fail → amber; bare exceptions handled by withBusy.
 */
export function notifyOpsResult(
  r: Record<string, unknown> | null | undefined,
  t: (k: string) => string,
): void {
  if (!r || typeof r !== 'object') return;
  const notes = Array.isArray(r.notes)
    ? r.notes.map(String).map((n) => n.trim()).filter(Boolean)
    : [];
  const blocked = Boolean(
    r.blocked ||
      r.requiresExecute ||
      r.requiresRoot ||
      r.apply_status === 'blocked',
  );
  const ok = r.ok === true && !blocked;
  const blockMsg =
    typeof r.blockMessage === 'string' && r.blockMessage.trim()
      ? r.blockMessage.trim()
      : '';
  const main = blockMsg || notes[0] || (ok ? t('common.completed') : t('common.opFailed'));
  const extra = notes.filter((n) => n !== main).slice(0, 4);
  const detail = extra.length ? extra.join('\n') : undefined;
  const opts = detail ? { detail, durationMs: 8000 as const } : undefined;
  if (ok) notifyOk(main, opts);
  else notifyWarn(main, opts);
}

/** Normalize apply_status for display comparisons. */
export function normalizeApplyStatus(
  status: string | null | undefined,
): 'applied' | 'written' | 'draft' {
  const s = (status ?? 'draft').toLowerCase();
  if (s === 'applied') return 'applied';
  if (s === 'written') return 'written';
  return 'draft';
}

/** Pill tone from apply status. */
export function applyStatusTone(
  status: string | null | undefined,
): 'ok' | 'warn' {
  return normalizeApplyStatus(status) === 'applied' ? 'ok' : 'warn';
}

/** i18n key for apply-status pill label. */
export function applyStatusPillKey(
  status: string | null | undefined,
): 'email.pillApplied' | 'email.pillManaged' | 'email.pillDraft' {
  const s = normalizeApplyStatus(status);
  if (s === 'applied') return 'email.pillApplied';
  if (s === 'written') return 'email.pillManaged';
  return 'email.pillDraft';
}

/** Health score badge tone (≥ threshold → ok). */
export function healthScoreTone(
  score: number | null | undefined,
  threshold = 80,
): 'ok' | 'warn' {
  return (score ?? 0) >= threshold ? 'ok' : 'warn';
}

/** Whether domain is suspended via flag or status field. */
export function isDomainSuspended(domain: {
  suspended?: boolean;
  status?: string;
}): boolean {
  return Boolean(domain.suspended) || domain.status === 'suspended';
}

/** Format DNS records for clipboard. */
export function formatDnsRecordsText(
  records: Array<{ type?: string; name?: string; value?: string }>,
): string {
  return records
    .map((r) => `${r.type ?? ''}\t${r.name ?? ''}\t${r.value ?? ''}`)
    .join('\n');
}

/** Format external todos checklist for clipboard. */
export function formatExternalTodosText(
  todos: Array<{
    completed?: boolean;
    title?: string;
    description?: string;
  }>,
): string {
  return todos
    .map(
      (t) =>
        `- ${t.completed ? '[x]' : '[ ]'} ${t.title ?? ''}: ${t.description ?? ''}`,
    )
    .join('\n');
}

/** Parse alias destination free text into address list. */
export function parseAliasDestinations(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Mailbox status badge tone. */
export function mailboxStatusTone(
  status: unknown,
): 'ok' | 'neutral' | 'danger' | 'warn' {
  const s = String(status ?? '').toLowerCase();
  if (s === 'disabled') return 'danger';
  if (s === 'active' || s === 'managed' || s === 'system_provisioned') return 'ok';
  if (s === 'managed_pending_system' || s === 'managed_system_failed') return 'warn';
  return 'neutral';
}

const MBOX_PAGE_SIZE = 10;

/** Probe / check cell tone from ok tri-state. */
export function probeOkTone(
  ok: boolean | null | undefined,
): 'ok' | 'danger' | 'warn' {
  if (ok === true) return 'ok';
  if (ok === false) return 'danger';
  return 'warn';
}

/** Map live-check probe cells into table rows. */
export function mapLiveProbeRows(
  live: Record<string, unknown>,
  port25Label: string,
  labels?: {
    mx?: string;
    spf?: string;
    dkim?: string;
    dmarc?: string;
    ptr?: string;
    dnsbl?: string;
  },
): Array<{ label: string; ok: boolean | null; detail: string; id: string }> {
  const pairs: Array<[string, string, unknown]> = [
    ['mx', labels?.mx ?? 'MX', live.mx],
    ['spf', labels?.spf ?? 'SPF', live.spf],
    ['dkim', labels?.dkim ?? 'DKIM', live.dkim],
    ['dmarc', labels?.dmarc ?? 'DMARC', live.dmarc],
    ['ptr', labels?.ptr ?? 'PTR', live.ptr],
    ['port25', port25Label, live.port25],
    ['dnsbl', labels?.dnsbl ?? 'DNSBL', live.dnsbl],
  ];
  return pairs.map(([id, label, cell]) => {
    const c = cell as { ok?: boolean | null; detail?: string } | undefined;
    return {
      id,
      label,
      ok: c?.ok ?? null,
      detail: String(c?.detail ?? '—') };
  });
}

/** Build short repair hints for failed DNS auth probes (F6–F7). */
export function dnsAuthRepairHints(
  live: Record<string, unknown> | null | undefined,
  t: (key: string, opts?: Record<string, string>) => string,
): string[] {
  if (!live) return [];
  const hints: string[] = [];
  const cell = (k: string) => live[k] as { ok?: boolean } | undefined;
  if (cell('spf')?.ok === false) hints.push(t('email.fixHintSpf'));
  if (cell('dkim')?.ok === false) hints.push(t('email.fixHintDkim'));
  if (cell('dmarc')?.ok === false) hints.push(t('email.fixHintDmarc'));
  if (cell('mx')?.ok === false) hints.push(t('email.fixHintMx'));
  return hints;
}

/** Policy rate-limit with fallback. */
export function parsePolicyRate(raw: unknown, fallback = 200): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isPolicyRateValid(raw: unknown): boolean {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0;
}

/** Bootstrap admin password is usable (≥8 chars). */
export function isBootstrapPasswordValid(pw: string): boolean {
  return pw.trim().length >= 8;
}

/** Default webmail hostname for a domain. */
export function defaultWebmailDomain(domain: string): string {
  return `webmail.${domain}`;
}

/** Default PHP project name for webmail tool + apex domain. */
export function defaultWebmailProjectName(
  tool: 'roundcube' | 'snappymail',
  mailDomain: string,
): string {
  const base = tool === 'snappymail' ? 'snappymail' : 'roundcube';
  const slug = mailDomain
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '')
    .replace(/\./g, '-')
    .slice(0, 40);
  return slug ? `${base}-${slug}` : base;
}

/** Default mail SSL hostname. */
export function defaultMailSslDomain(domain: string): string {
  return `mail.${domain}`;
}

/** Build flags ops log shape from API flag update response. */
export function flagsResultToLog(r: {
  ok?: boolean;
  apply_status?: string;
  notes?: string[];
  written?: unknown;
  blocked?: boolean;
  blockMessage?: string;
}): Record<string, unknown> {
  return {
    ok: r.ok,
    apply_status: r.apply_status,
    notes: r.notes ?? [],
    written: r.written,
    blocked: r.blocked,
    blockMessage: r.blockMessage };
}

/** Deliverability checklist row tone. */
export function deliverabilityItemTone(item: {
  ok?: boolean | null;
  level?: string;
}): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (item.ok === true) return 'ok';
  if (item.level === 'external') return 'warn';
  if (item.ok === false) return 'danger';
  return 'neutral';
}

/** DNSBL summary label. */
export function dnsblSummaryLabel(
  dnsbl: { ok?: boolean } | null | undefined,
  liveDnsbl: { ok?: boolean } | null | undefined,
  notTested: string,
): string {
  const src = dnsbl ?? liveDnsbl;
  if (!src) return notTested;
  return src.ok ? 'Clean' : 'Listed';
}

/** DNSBL summary tone. */
export function dnsblSummaryTone(
  dnsbl: { ok?: boolean } | null | undefined,
  liveDnsbl: { ok?: boolean } | null | undefined,
): 'ok' | 'danger' | 'default' {
  const src = dnsbl ?? liveDnsbl;
  if (!src) return 'default';
  return src.ok ? 'ok' : 'danger';
}

/** Unique IP list for multi-RBL (domain IP + host IPs). */
export function uniqueIps(
  primary: string | null | undefined,
  extra: string[] | null | undefined,
): string[] {
  const list = [primary ?? '', ...(extra ?? [])].map((s) => s.trim()).filter(Boolean);
  return [...new Set(list)];
}

export function EmailDomainPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [domain, setDomain] = useState<EmailDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = usePageTab(
    [
      'dns',
      'mailbox',
      'aliases',
      'health',
      'deliverability',
      'relay',
      'sieve',
      'advanced',
      'stack',
      'about',
    ] as const,
    'dns',
  );
  const [bundle, setBundle] = useState<EmailBundle | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [dnsbl, setDnsbl] = useState<Record<string, unknown> | null>(null);
  const [warmup, setWarmup] = useState<Record<string, unknown> | null>(null);
  const [deliverability, setDeliverability] = useState<Awaited<
    ReturnType<typeof emailApi.deliverability>
  > | null>(null);
  const [relayHost, setRelayHost] = useState('');
  const [relayUser, setRelayUser] = useState('');
  const [relayPass, setRelayPass] = useState('');
  const [relayApplySystem, setRelayApplySystem] = useState(false);
  const [relayLog, setRelayLog] = useState<Record<string, unknown> | null>(null);
  const [bootstrapPassword, setBootstrapPassword] = useState('');
  const [mboxLocal, setMboxLocal] = useState('info');
  const [mboxPass, setMboxPass] = useState('');
  const [mboxLog, setMboxLog] = useState<Record<string, unknown> | null>(null);
  const [createMboxOpen, setCreateMboxOpen] = useState(false);
  const [mailboxes, setMailboxes] = useState<Array<Record<string, unknown>>>([]);
  const [aliases, setAliases] = useState<Array<Record<string, unknown>>>([]);
  const [aliasLocal, setAliasLocal] = useState('sales');
  const [aliasDest, setAliasDest] = useState('');
  const [aliasType, setAliasType] = useState<'forward' | 'alias' | 'catchall'>('forward');
  const [aliasLog, setAliasLog] = useState<Record<string, unknown> | null>(null);
  const [flagsLog, setFlagsLog] = useState<Record<string, unknown> | null>(null);
  const [policyLog, setPolicyLog] = useState<Record<string, unknown> | null>(null);
  const [policyRate, setPolicyRate] = useState('200');
  const [policyAntispam, setPolicyAntispam] = useState(true);
  const [flagsApplySystem, setFlagsApplySystem] = useState(false);
  const [autoreplyOn, setAutoreplyOn] = useState(false);
  const [autoreplySubject, setAutoreplySubject] = useState('');
  const [autoreplyBody, setAutoreplyBody] = useState('');
  const [webmailDomain, setWebmailDomain] = useState('webmail.example.com');
  const [webmailLog, setWebmailLog] = useState<Record<string, unknown> | null>(null);
  const [bootstrapLog, setBootstrapLog] = useState<Record<string, unknown> | null>(null);
  const [advancedOpsLog, setAdvancedOpsLog] = useState<Record<string, unknown> | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [delMailbox, setDelMailbox] = useState<{
    id: string;
    address: string;
  } | null>(null);
  const [editMailbox, setEditMailbox] = useState<{
    id: string;
    address: string;
    status: string;
    has_password: boolean;
  } | null>(null);
  const [editMboxPass, setEditMboxPass] = useState('');
  const [editMboxPass2, setEditMboxPass2] = useState('');
  const [editMboxStatus, setEditMboxStatus] = useState<'active' | 'disabled'>('active');
  const [mboxPage, setMboxPage] = useState(0);
  const [delAlias, setDelAlias] = useState<{
    id: string;
    source: string;
  } | null>(null);

  const mboxPageCount = Math.max(1, Math.ceil(mailboxes.length / MBOX_PAGE_SIZE));
  const mboxPageSafe = Math.min(mboxPage, mboxPageCount - 1);
  const mboxPageItems = useMemo(() => {
    const start = mboxPageSafe * MBOX_PAGE_SIZE;
    return mailboxes.slice(start, start + MBOX_PAGE_SIZE);
  }, [mailboxes, mboxPageSafe]);

  useEffect(() => {
    if (mboxPage > mboxPageCount - 1) setMboxPage(Math.max(0, mboxPageCount - 1));
  }, [mboxPage, mboxPageCount]);

  useEffect(() => {
    setAutoreplySubject((prev) => prev || t('email.defaultAutoreplySubject'));
    setAutoreplyBody((prev) => prev || t('email.defaultAutoreplyBody'));
  }, [t]);

  const load = useCallback(async () => {
    const r = await emailApi.get(id ?? '');
    const found = r.domain?.id ? r.domain : null;
    setDomain(found);
    if (!found) return null;
    setError(null);
    // Prefill policy form from control-plane domain flags
    if (found.rate_limit_per_hour != null && Number(found.rate_limit_per_hour) > 0) {
      setPolicyRate(String(found.rate_limit_per_hour));
    }
    if (typeof found.antispam === 'boolean') {
      setPolicyAntispam(found.antispam);
    }
    if (typeof found.autoreply_enabled === 'boolean') {
      setAutoreplyOn(found.autoreply_enabled);
    }
    if (found.autoreply_subject) setAutoreplySubject(String(found.autoreply_subject));
    if (found.autoreply_body) setAutoreplyBody(String(found.autoreply_body));
    try {
      setBundle(await emailApi.dns(found.id));
      setMailboxes((await emailApi.listMailboxes(found.id)).items);
      setAliases((await emailApi.listAliases(found.id)).items);
      setWebmailDomain(defaultWebmailDomain(found.domain));
    } catch {
      /* optional */
    }
    return found;
  }, [id]);

  useEffect(() => {
    if (tab !== 'relay') return;
    let cancelled = false;
    void emailApi
      .getRelay()
      .then((r) => {
        if (cancelled) return;
        const s = (r.settings ?? {}) as Record<string, unknown>;
        if (typeof s.host === 'string') setRelayHost(s.host);
        if (typeof s.username === 'string') setRelayUser(s.username);
      })
      .catch(() => {
        /* optional */
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void load()
      .then((found) => {
        if (cancelled) return;
        if (!found) setError(t('email.notFound'));
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load, t]);

  /** Run mutation with top-right toast feedback (no page-top red Alert). */
  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.details && typeof e.details === 'object') {
        const d = e.details as Record<string, unknown>;
        if (
          Array.isArray(d.notes) ||
          d.requiresExecute != null ||
          d.requiresRoot != null ||
          d.blocked != null ||
          typeof d.blockMessage === 'string' ||
          typeof d.ok === 'boolean'
        ) {
          notifyOpsResult({ ...d, ok: d.ok === true ? true : false }, t);
          if (d.projectId != null || d.tool != null || d.urlHint != null) {
            setWebmailLog(d);
          }
          return;
        }
      }
      notifyError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
  }

  function setBootstrapLogToast(r: Record<string, unknown>) {
    setBootstrapLog(r);
    notifyOpsResult(r, t);
  }

  if (loading) return <LoadingBlock />;
  if (!domain) {
    return (
      <FeaturePageLayout
        title={t('email.title')}
        showCapability={false}
        backTo="/email"
        backLabel={t('email.backToList')}
      >
        <Alert variant="error">
          {error ?? t('email.notFound')}
        </Alert>
        <Button variant="secondary" size="md" onClick={bindNavigate(navigate, '/email')}>
          {t('email.backToList')}
        </Button>
      </FeaturePageLayout>
    );
  }

  const tabs = [
    { id: 'dns', label: 'DNS' },
    { id: 'mailbox', label: t('email.tabMailbox') },
    { id: 'aliases', label: t('email.tabAliases') },
    { id: 'health', label: t('email.tabHealth') },
    { id: 'deliverability', label: t('email.tabDeliverability') },
    { id: 'relay', label: t('email.tabRelay') },
    { id: 'sieve', label: t('email.tabSieve') },
    { id: 'advanced', label: t('email.tabAdvanced') },
    { id: 'stack', label: t('tabs.stack') },
    { id: 'about', label: t('common.about') },
  ];

  const applySt = normalizeApplyStatus(domain.apply_status);
  const suspended = isDomainSuspended(
    domain as { suspended?: boolean; status?: string },
  );

  return (
    <FeaturePageLayout
      title={domain.domain}
      subtitle={domain.server_ip}
      showCapability={false}
      backTo="/email"
      backLabel={t('email.backToList')}
      status={{
        pill: {
          label: t(applyStatusPillKey(domain.apply_status)),
          tone: applyStatusTone(domain.apply_status) },
        items: [
          {
            label: t('email.statHealth'),
            value: emailHealthUnprobed(domain)
              ? t('email.healthUnchecked')
              : emailHealthPartial(domain, live, dnsbl)
                ? t('email.healthPartialScore', { n: domain.health_score })
                : `${domain.health_score}/100`,
            hint: emailHealthUnprobed(domain)
              ? t('email.healthUncheckedHint')
              : emailHealthPartial(domain, live, dnsbl)
                ? t('email.healthPartialHint')
                : t('email.healthLiveHint'),
            tone: emailHealthUnprobed(domain) || emailHealthPartial(domain, live, dnsbl)
              ? 'warn'
              : healthScoreTone(domain.health_score) },
          {
            label: t('email.statApply'),
            value: applySt,
            tone: applyStatusTone(domain.apply_status) },
          {
            label: t('email.statDomain'),
            value: suspended ? t('email.pausedFlag') : t('email.normal'),
            tone: suspended ? 'warn' : 'ok' },
          { label: t('email.statMailboxes'), value: mailboxes.length },
          { label: t('email.statDnsRecords'), value: (bundle?.records ?? []).length },
        ] }}
      actions={
        <ActionBar>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={bindBusyDual(
              withBusy,
              () => emailApi.dns(domain.id),
              setBundle,
              async () => (await emailApi.listMailboxes(domain.id)).items,
              setMailboxes,
            )}
          >
            {t('common.refresh')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={deleteBusy}
            onClick={bindSet(setDeleteOpen, true)}
          >
            {t('email.deleteDomain')}
          </Button>
        </ActionBar>
      }
    >
      <PageTabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'dns' ? (
          <Card>
            <CardSection title={t('email.dnsTodosTitle')}>
              {bundle ? (
                <>
                  <ActionBar className="u-mb-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={bindClipboard(formatDnsRecordsText(bundle.records))}
                    >
                      {t('email.copyAllRecords')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={bindNavigate(navigate, '/dns')}
                    >
                      {t('email.openDnsPage')}
                    </Button>
                    {bundle.externalTodos.length > 0 ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={bindClipboard(formatExternalTodosText(bundle.externalTodos))}
                      >
                        {t('email.copyExternalTodos')}
                      </Button>
                    ) : null}
                  </ActionBar>
                  <SummaryStrip
                    items={[
                      {
                        label: t('email.healthScore'),
                        value: emailHealthUnprobed(domain)
                          ? t('email.healthUnchecked')
                          : `${bundle.health.score}/${bundle.health.maxScore}`,
                        tone: emailHealthUnprobed(domain)
                          ? 'default'
                          : healthScoreTone(bundle.health.score),
                      },
                      {
                        label: t('email.suggestedRecords'),
                        value: String(bundle.records.length),
                      },
                      {
                        label: t('email.pendingCount'),
                        value: String(
                          bundle.health.messages.length + bundle.externalTodos.length,
                        ),
                        tone:
                          bundle.health.messages.length + bundle.externalTodos.length > 0
                            ? 'warn'
                            : 'ok',
                      },
                    ]}
                  />
                  {bundle.health.messages.length > 0 ? (
                    <ul className="list-plain list-spaced u-mt-3 u-text-sm">
                      {bundle.health.messages.slice(0, 5).map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="u-mt-3">
                    <DataTable
                      columns={[
                        {
                          key: 'type',
                          header: t('email.colType'),
                          nowrap: true,
                          render: (r) => (
                            <span title={r.description || undefined}>
                              <Badge>{r.type}</Badge>
                            </span>
                          ),
                        },
                        {
                          key: 'name',
                          header: t('email.colName'),
                          render: (r) => (
                            <code className="inline">{r.name}</code>
                          ),
                        },
                        {
                          key: 'value',
                          header: t('email.colValue'),
                          className: 'u-break-all',
                          render: (r) => (
                            <code className="inline" title={r.description || undefined}>
                              {r.value}
                            </code>
                          ),
                        },
                      ]}
                      rows={bundle.records}
                      rowKey={(r, i) => `${r.type}-${r.name}-${i}`}
                      rowActions={(r) => (
                        <ActionBar align="end">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={bindClipboard(r.value)}
                          >
                            {t('email.copy')}
                          </Button>
                        </ActionBar>
                      )}
                      empty={<p className="muted">{t('email.noDnsRecords')}</p>}
                    />
                  </div>
                  {bundle.externalTodos.length > 0 ? (
                    <p className="muted u-text-sm u-mt-3 u-mb-0">
                      {t('email.externalTodosOneLiner')}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted u-m-0">{t('email.refreshDnsHint')}</p>
              )}
            </CardSection>
          </Card>
        ) : null}

        {tab === 'mailbox' ? (
          <div className="tab-panel">
            <DataTable
              rowKey={(m) => String(m.id)}
              title={t('email.mailboxListTitle', { count: mailboxes.length })}
              description={t('email.mailboxListDesc')}
              toolbar={
                <ActionBar>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={bindOpenCreate(
                      setCreateMboxOpen,
                      [setMboxLocal, setMboxPass],
                      ['info', ''],
                    )}
                  >
                    {t('email.createMailbox')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={bindBusyMap(
                      withBusy,
                      () => emailApi.listMailboxes(domain.id),
                      setMailboxes,
                      (r) => r.items,
                    )}
                  >
                    {t('common.refresh')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    onClick={bindBusySet(
                      withBusy,
                      () => emailApi.dovecotPassdb(domain.id),
                      setMboxLog,
                    )}
                  >
                    {t('email.writeDovecot')}
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'address',
                  header: t('email.colAddress'),
                  render: (m) => (
                    <code className="inline">{String(m.address ?? '—')}</code>
                  ),
                },
                {
                  key: 'local_part',
                  header: t('email.colLocalPart'),
                  render: (m) => String(m.local_part ?? '—'),
                },
                {
                  key: 'status',
                  header: t('email.colStatus'),
                  nowrap: true,
                  render: (m) => (
                    <Badge tone={mailboxStatusTone(m.status)}>
                      {String(m.status ?? '—')}
                    </Badge>
                  ),
                },
                {
                  key: 'password',
                  header: t('email.colPassword'),
                  nowrap: true,
                  render: (m) =>
                    m.has_password ? (
                      <Badge tone="ok">{t('email.hasPassword')}</Badge>
                    ) : (
                      <Badge tone="warn">{t('email.noPassword')}</Badge>
                    ),
                },
                {
                  key: 'created',
                  header: t('email.colCreated'),
                  nowrap: true,
                  render: (m) => {
                    const raw = m.created_at;
                    if (!raw) return '—';
                    const d = new Date(String(raw));
                    return Number.isNaN(d.getTime())
                      ? String(raw)
                      : formatDateTime(d);
                  },
                },
              ]}
              rows={mboxPageItems}
              empty={<EmptyState title={t('email.mailboxEmptyTitle')} description={t('email.noMailboxes')} />}
              rowActions={(m) => (
                <ActionBar>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const st = String(m.status ?? 'active').toLowerCase();
                      setEditMailbox({
                        id: String(m.id),
                        address: String(m.address ?? ''),
                        status: st,
                        has_password: Boolean(m.has_password),
                      });
                      setEditMboxPass('');
                      setEditMboxPass2('');
                      setEditMboxStatus(st === 'disabled' ? 'disabled' : 'active');
                    }}
                  >
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      setDelMailbox({
                        id: String(m.id),
                        address: String(m.address),
                      })
                    }
                  >
                    {t('email.deleteMailbox')}
                  </Button>
                </ActionBar>
              )}
            />
            {mailboxes.length > MBOX_PAGE_SIZE ? (
              <div
                className="sys-conf-pager"
                role="navigation"
                aria-label={t('email.mailboxPager')}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={mboxPageSafe <= 0}
                  onClick={() => setMboxPage((p) => Math.max(0, p - 1))}
                >
                  {t('email.prevPage')}
                </Button>
                <span className="sys-conf-pager__meta">
                  {t('email.pageOf', {
                    page: mboxPageSafe + 1,
                    total: mboxPageCount,
                    count: mailboxes.length,
                  })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={mboxPageSafe >= mboxPageCount - 1}
                  onClick={() =>
                    setMboxPage((p) => Math.min(mboxPageCount - 1, p + 1))
                  }
                >
                  {t('email.nextPage')}
                </Button>
              </div>
            ) : null}
            <OpsResultPanel
              title={t('email.mailboxOpsResult')}
              result={asOps(mboxLog)}
              busy={busy}
            />
          </div>
        ) : null}

        {tab === 'aliases' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('email.aliasesTitle')}>
                <FormLayout columns={2}>
                  <Field label={t('email.aliasType')} htmlFor="al-type" flush>
                    <SegRadio
                      name="al-type"
                      aria-label={t('email.aliasTypeAria')}
                      value={aliasType}
                      onChange={(v) =>
                        setAliasType(v as 'forward' | 'alias' | 'catchall')
                      }
                      options={[
                        { value: 'forward', label: t('email.typeForward') },
                        { value: 'alias', label: t('email.typeAlias') },
                        { value: 'catchall', label: t('email.catchall') },
                      ]}
                    />
                  </Field>
                  {aliasType === 'catchall' ? (
                    <Field
                      label={t('email.catchall')}
                      htmlFor="al-dest-hint"
                      hint={t('email.catchallHint')}
                      flush
                    >
                      <span id="al-dest-hint" className="muted u-text-sm">
                        @{domain.domain}
                      </span>
                    </Field>
                  ) : (
                    <Field label={t('email.localPart')} htmlFor="al-local" hint={t('email.localPartHint')} flush>
                      <input
                        id="al-local"
                        value={aliasLocal}
                        onChange={bindInput(setAliasLocal)}
                        placeholder="sales"
                      />
                    </Field>
                  )}
                  <Field
                    label={t('email.targetMailbox')}
                    htmlFor="al-dest"
                    hint={t('email.targetMailboxHint')}
                    fullWidth
                    flush
                  >
                    <input
                      id="al-dest"
                      value={aliasDest}
                      onChange={bindInput(setAliasDest)}
                      placeholder={`info@${domain.domain}`}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyMutateList(
                      withBusy,
                      () =>
                        emailApi.createAlias(domain.id, {
                          type: aliasType,
                          localPart: aliasType === 'catchall' ? undefined : aliasLocal,
                          destinations: parseAliasDestinations(aliasDest) }),
                      setAliasLog,
                      () => emailApi.listAliases(domain.id),
                      setAliases,
                    )}
                  >
                    {t('email.addAlias')}
                  </Button>
                </FormActions>
                {aliases.length > 0 ? (
                  <ul className="list-plain list-spaced u-mt-4">
                    {aliases.map((a) => (
                      <li key={String(a.id)} className=" u-flex u-justify-between">
                        <span>
                          <Badge>{String(a.type)}</Badge>{' '}
                          <code className="inline">{String(a.source)}</code> →{' '}
                          {(a.destinations as string[] | undefined)?.join(', ')}
                        </span>
                        <Button
                          variant="danger"
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            setDelAlias({
                              id: String(a.id),
                              source: String(a.source),
                            })
                          }
                        >
                          {t('common.delete')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted u-mt-3">{t('email.noAliases')}</p>
                )}
                <OpsResultPanel title={t('email.aliasResult')} result={asOps(aliasLog)} busy={busy} />
              </CardSection>
            </Card>
            <Card>
              <CardSection title={t('email.autoreplyTitle')}>
                <div className="form-switches">
                  <CheckboxField
                    id="ar-on"
                    label={t('email.enableAutoreply')}
                    description={t('email.enableAutoreplyDesc')}
                    checked={autoreplyOn}
                    onChange={setAutoreplyOn}
                  />
                  <CheckboxField
                    id="ar-sys"
                    label={t('email.applyToSystem')}
                    description={t('email.applyToSystemDesc')}
                    checked={flagsApplySystem}
                    onChange={setFlagsApplySystem}
                  />
                </div>
                <FormLayout>
                  <Field label={t('email.subject')} htmlFor="ar-sub" flush>
                    <input
                      id="ar-sub"
                      value={autoreplySubject}
                      onChange={bindInput(setAutoreplySubject)}
                    />
                  </Field>
                  <Field label={t('email.body')} htmlFor="ar-body" fullWidth flush>
                    <textarea
                      id="ar-body"
                      rows={4}
                      value={autoreplyBody}
                      onChange={bindInput(setAutoreplyBody)}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyFlagsUpdate(
                      withBusy,
                      emailApi.updateFlags,
                      domain.id,
                      {
                        autoreplyEnabled: autoreplyOn,
                        autoreplySubject,
                        autoreplyBody,
                        applySystem: flagsApplySystem },
                      flagsResultToLog,
                      setFlagsLog,
                      load,
                    )}
                  >
                    {flagsApplySystem ? t('email.saveApplyAutoreply') : t('email.saveAutoreplyWritten')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyFlagsUpdate(
                      withBusy,
                      emailApi.updateFlags,
                      domain.id,
                      { suspended: true, applySystem: flagsApplySystem },
                      flagsResultToLog,
                      setFlagsLog,
                      load,
                    )}
                  >
                    {flagsApplySystem ? t('email.suspendApply') : t('email.suspendWritten')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyFlagsUpdate(
                      withBusy,
                      emailApi.updateFlags,
                      domain.id,
                      { suspended: false, applySystem: flagsApplySystem },
                      flagsResultToLog,
                      setFlagsLog,
                      load,
                    )}
                  >
                    {flagsApplySystem ? t('email.resumeApply') : t('email.resumeWritten')}
                  </Button>
                </FormActions>
                <OpsResultPanel title={t('email.flagsResult')} result={asOps(flagsLog)} busy={busy} />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'health' ? (
          <div className="tab-panel mail-check">
            <Card>
              <CardSection title={t('email.healthLiveTitle')}>
                <SummaryStrip
                  items={[
                    {
                      label: t('email.serverIpLabel'),
                      value: domain.server_ip || '—',
                    },
                    {
                      label: t('email.healthScore'),
                      value:
                        live || !emailHealthUnprobed(domain)
                          ? String(
                              live
                                ? (live as { health?: { score?: number } }).health?.score ??
                                  domain.health_score
                                : domain.health_score,
                            )
                          : t('email.healthUnchecked'),
                      tone:
                        live || !emailHealthUnprobed(domain)
                          ? healthScoreTone(
                              live
                                ? Number(
                                    (live as { health?: { score?: number } }).health?.score ??
                                      domain.health_score,
                                  )
                                : domain.health_score,
                            )
                          : 'default',
                    },
                    {
                      label: t('email.liveCheck'),
                      value: live
                        ? (live as { ok?: boolean }).ok
                          ? t('email.liveOk')
                          : t('email.liveBad')
                        : t('email.notTested'),
                      tone: live
                        ? (live as { ok?: boolean }).ok
                          ? 'ok'
                          : 'warn'
                        : 'default',
                    },
                    {
                      label: t('email.blacklist'),
                      value: dnsblSummaryLabel(
                        dnsbl as { ok?: boolean } | null,
                        (live as { dnsbl?: { ok?: boolean } } | null)?.dnsbl,
                        t('email.notTested'),
                      ),
                      tone: dnsblSummaryTone(
                        dnsbl as { ok?: boolean } | null,
                        (live as { dnsbl?: { ok?: boolean } } | null)?.dnsbl,
                      ),
                    },
                  ]}
                />
                <ActionBar size="md" className="action-bar--toolbar" aria-label={t('email.healthLiveTitle')}>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyLiveReload(
                      withBusy,
                      () => emailApi.deliverability(domain.id),
                      setDeliverability,
                      load,
                    )}
                  >
                    {t('email.runDeliverabilityPack')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyLiveReload(
                      withBusy,
                      () => emailApi.liveCheck(domain.id),
                      setLive,
                      load,
                    )}
                  >
                    {t('email.runLiveCheck')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusySet(withBusy, () => emailApi.dnsbl(domain.server_ip), setDnsbl)}
                  >
                    {t('email.dnsblThisIp')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyDnsblMulti(
                      withBusy,
                      async () => {
                        const r = await api.requestRaw<{ items: string[] }>(
                          '/api/v1/system/ips',
                        );
                        return r.items ?? [];
                      },
                      domain.server_ip,
                      (ips) => emailApi.dnsblMulti(ips),
                      uniqueIps,
                      setDnsbl,
                    )}
                  >
                    {t('email.multiIpRbl')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusySet(withBusy, () => emailApi.warmupDomain(domain.id), setWarmup)}
                  >
                    {t('email.warmupAdvice')}
                  </Button>
                </ActionBar>
              </CardSection>
            </Card>

            {live ? (
              <Card>
                <CardSection title={t('email.probeMatrix')}>
                  <div className="mail-probe">
                    <DataTable
                      columns={[
                        {
                          key: 'item',
                          header: t('email.colItem'),
                          nowrap: true,
                          render: (r) => <strong>{r.label}</strong>,
                        },
                        {
                          key: 'st',
                          header: t('email.colStatus'),
                          nowrap: true,
                          render: (r) => (
                            <Badge tone={probeOkTone(r.ok)}>
                              {r.ok === true
                                ? t('email.pass')
                                : r.ok === false
                                  ? t('email.fail')
                                  : t('email.unknown')}
                            </Badge>
                          ),
                        },
                        {
                          key: 'detail',
                          header: t('email.colDetail'),
                          className: 'u-break-all',
                          render: (r) => (
                            <code className="inline u-text-sm">{r.detail}</code>
                          ),
                        },
                      ]}
                      rows={mapLiveProbeRows(live, t('email.outboundPort25'), {
                        mx: t('email.probeMx'),
                        spf: t('email.probeSpf'),
                        dkim: t('email.probeDkim'),
                        dmarc: t('email.probeDmarc'),
                        ptr: t('email.probePtr'),
                        dnsbl: t('email.probeDnsbl'),
                      })}
                      rowKey={(r) => r.id}
                      empty={<p className="muted">{t('email.noProbeResults')}</p>}
                    />
                    {dnsAuthRepairHints(live, t).length > 0 ? (
                      <Alert variant="warn">
                        <strong>{t('email.dnsAuthRepairTitle')}</strong>
                        <ul className="list-plain list-spaced">
                          {dnsAuthRepairHints(live, t).map((h) => (
                            <li key={h}>{h}</li>
                          ))}
                        </ul>
                        <p className="muted u-text-sm u-mb-0">{t('email.dnsAuthRepairHint')}</p>
                      </Alert>
                    ) : null}
                    {Array.isArray(
                      (live as { health?: { messages?: string[] } }).health?.messages,
                    ) &&
                    ((live as { health?: { messages?: string[] } }).health?.messages
                      ?.length ?? 0) > 0 ? (
                      <ul className="mail-messages">
                        {(
                          (live as { health?: { messages?: string[] } }).health
                            ?.messages ?? []
                        ).map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </CardSection>
              </Card>
            ) : (
              <Card>
                <div className="mail-empty">
                  <EmptyState
                    title={t('email.noLiveYet')}
                    description={t('email.noLiveYetHint')}
                  />
                </div>
              </Card>
            )}

            {dnsbl ? (
              <OpsResultPanel title={t('email.dnsblResult')} result={asOps(dnsbl)} />
            ) : null}
            {warmup ? (
              <OpsResultPanel title={t('email.warmupResult')} result={asOps(warmup)} />
            ) : null}
          </div>
        ) : null}

        {tab === 'deliverability' ? (
          <div className="tab-panel mail-check">
            <Card>
              <CardSection title={t('email.deliverabilityTitle')}>
                <ActionBar size="md" aria-label={t('email.deliverabilityTitle')}>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyLiveReload(
                      withBusy,
                      () => emailApi.deliverability(domain.id),
                      setDeliverability,
                      load,
                    )}
                  >
                    {t('email.runDeliverabilityPack')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={bindSet(setTab, 'relay')}
                  >
                    {t('email.tabRelay')}
                  </Button>
                </ActionBar>
              </CardSection>
            </Card>

            {deliverability ? (
              <Card>
                <CardSection title={t('email.probeMatrix')}>
                  <SummaryStrip
                    items={[
                      {
                        label: t('email.healthScore'),
                        value: `${deliverability.score}/100`,
                        tone: healthScoreTone(deliverability.score),
                      },
                      {
                        label: t('email.deliverabilityChecks'),
                        value: String(deliverability.items.length),
                      },
                      {
                        label: t('email.panelReady'),
                        value: deliverability.panelReady
                          ? t('common.ready')
                          : t('email.gaps'),
                        tone: deliverability.panelReady ? 'ok' : 'warn',
                      },
                    ]}
                  />
                  <DataTable
                    columns={[
                      {
                        key: 'title',
                        header: t('common.name'),
                        render: (i) => <strong>{i.title}</strong>,
                      },
                      {
                        key: 'ok',
                        header: t('common.status'),
                        render: (i) => (
                          <Badge tone={deliverabilityItemTone(i)}>
                            {i.ok === true
                              ? t('email.checkOk')
                              : i.level === 'external'
                                ? t('email.checkExternal')
                                : i.ok === false
                                  ? t('email.checkFail')
                                  : '—'}
                          </Badge>
                        ),
                      },
                      {
                        key: 'detail',
                        header: t('common.notes'),
                        className: 'u-text-sm',
                        render: (i) => i.detail || i.fixHint || '—',
                      },
                    ]}
                    rows={deliverability.items}
                    rowKey={(i) => i.id}
                  />
                  {deliverability.externalTodos?.length ? (
                    <p className="muted u-text-sm u-mb-0">
                      {t('email.externalTodosOneLiner')}
                    </p>
                  ) : null}
                </CardSection>
              </Card>
            ) : (
              <Card>
                <div className="mail-empty">
                  <EmptyState
                    title={t('email.deliverabilityEmpty')}
                    description={t('email.deliverabilityEmptyDesc')}
                  />
                </div>
              </Card>
            )}
          </div>
        ) : null}

        {tab === 'relay' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('email.relayTitle')}>
                <FormLayout columns={2}>
                  <Field label={t('email.relayHost')} htmlFor="rh" required flush>
                    <input
                      id="rh"
                      value={relayHost}
                      onChange={bindInput(setRelayHost)}
                      placeholder="smtp.example.com"
                    />
                  </Field>
                  <Field label={t('common.username')} htmlFor="ru" flush>
                    <input
                      id="ru"
                      value={relayUser}
                      onChange={bindInput(setRelayUser)}
                    />
                  </Field>
                  <Field label={t('common.password')} htmlFor="rp" flush>
                    <input
                      id="rp"
                      type="password"
                      value={relayPass}
                      onChange={bindInput(setRelayPass)}
                      autoComplete="new-password"
                    />
                  </Field>
                </FormLayout>
                <div className="form-switches">
                  <CheckboxField
                    id="ras"
                    label={t('email.applyRelaySystem')}
                    checked={relayApplySystem}
                    onChange={setRelayApplySystem}
                  />
                </div>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={!relayHost.trim()}
                    title={!relayHost.trim() ? t('email.relayHostRequired', { defaultValue: t('common.required') }) : undefined}
                    onClick={bindBusySetRelay(
                      withBusy,
                      emailApi.setRelay,
                      {
                        host: relayHost,
                        port: 587,
                        username: relayUser || undefined,
                        password: relayPass || undefined,
                        security: 'starttls',
                        applySystem: relayApplySystem },
                      setRelayLog,
                    )}
                  >
                    {relayApplySystem ? t('email.saveApplyRelay') : t('email.saveOnly')}
                  </Button>
                </FormActions>
                <OpsResultPanel title={t('email.relayResult')} result={asOps(relayLog)} busy={busy} />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'sieve' ? (
          <div className="stack">
            <Card>
              <CardSection title={t('email.webmailSsoTitle')}>
                <FormLayout>
                  <Field
                    label={t('email.mailboxPasswordOptional')}
                    htmlFor="sso-pw"
                    flush
                  >
                    <input
                      id="sso-pw"
                      type="password"
                      autoComplete="new-password"
                      placeholder={t('email.mailboxPasswordPh')}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyWebmailSso(
                      withBusy,
                      'sso-pw',
                      `postmaster@${domain.domain}`,
                      domain.domain,
                      emailApi.webmailSso,
                      setWebmailLog,
                      webmailDomain
                        ? `https://${webmailDomain}`
                        : `https://webmail.${domain.domain}`,
                    )}
                  >
                    {t('email.issueSsoToken')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection title={t('email.sieveTitle')}>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyWriteSieve(
                      withBusy,
                      domain.domain,
                      emailApi.writeSieve,
                      setWebmailLog,
                    )}
                  >
                    {t('email.writeDefaultSieve')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyListSieve(
                      withBusy,
                      domain.domain,
                      emailApi.listSieve,
                      setWebmailLog,
                    )}
                  >
                    {t('email.listWrittenFiles')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            {webmailLog ? <OpsResultPanel title={t('email.result')} result={asOps(webmailLog)} /> : null}
          </div>
        ) : null}

        {tab === 'advanced' ? (
          <div className="tab-panel mail-check mail-advanced">
            {/* 1. First-time ready */}
            <Card>
              <CardSection title={t('email.bootstrapTitle')}>
                <p className="muted u-text-sm u-mb-0">{t('email.bootstrapAfterSteps')}</p>
                <FormLayout columns={2}>
                  <Field
                    label={t('email.adminPassword')}
                    htmlFor="boot-pw"
                    flush
                    required
                  >
                    <input
                      id="boot-pw"
                      type="password"
                      value={bootstrapPassword}
                      onChange={bindInput(setBootstrapPassword)}
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={t('email.adminPasswordPh')}
                    />
                  </Field>
                </FormLayout>
                <ActionBar size="md">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={!isBootstrapPasswordValid(bootstrapPassword)}
                    onClick={bindBusyBootstrap(
                      withBusy,
                      bootstrapPassword,
                      isBootstrapPasswordValid,
                      () => notifyWarn(t('email.adminPasswordRequired')),
                      emailApi.bootstrap,
                      {
                        domain: domain.domain,
                        serverIp: domain.server_ip,
                        adminLocalPart: 'postmaster',
                        adminPassword: bootstrapPassword.trim(),
                        installPackages: true,
                        webmail: true,
                      },
                      setBootstrapLogToast,
                      load,
                    )}
                  >
                    {t('email.bootstrapBtn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={bindNavigate(
                      navigate,
                      `/ssl?domain=${encodeURIComponent(defaultMailSslDomain(domain.domain))}&action=le`,
                    )}
                  >
                    {t('email.bootstrapThenSsl')}
                  </Button>
                </ActionBar>
                {bootstrapLog ? (
                  <OpsResultPanel
                    title={t('email.bootstrapTitle')}
                    result={asOps(bootstrapLog)}
                    busy={busy}
                  />
                ) : null}
              </CardSection>
            </Card>

            {/* 2. Webmail — global (all domains); install on Email → 網頁電郵 */}
            <Card>
              <CardSection title={t('email.webmailRoundcube')}>
                <p className="muted u-text-sm u-mb-0">{t('email.webmailMovedHint')}</p>
                <ActionBar size="md" className="u-mt-3">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={bindNavigate(navigate, '/email?tab=webmail')}
                  >
                    {t('email.openGlobalWebmailSettings')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={bindSet(setTab, 'sieve')}
                  >
                    {t('email.tabSieve')}
                  </Button>
                </ActionBar>
              </CardSection>
            </Card>

            {/* 3. Certificates & TLS */}
            <Card>
              <CardSection title={t('email.mailSslTitle')}>
                <DescriptionList
                  columns={1}
                  items={[
                    {
                      label: t('email.tlsRoleMail'),
                      value: (
                        <span className="mail-advanced__host-row">
                          <code className="inline">
                            {defaultMailSslDomain(domain.domain)}
                          </code>
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={bindNavigate(
                              navigate,
                              `/ssl?domain=${encodeURIComponent(defaultMailSslDomain(domain.domain))}&action=le`,
                            )}
                          >
                            {t('email.tlsRequestLeFor', {
                              host: defaultMailSslDomain(domain.domain),
                            })}
                          </Button>
                        </span>
                      ),
                      hint: t('email.tlsRoleMailHint'),
                    },
                    {
                      label: t('email.tlsRoleWebmail'),
                      value: (
                        <span className="mail-advanced__host-row">
                          <code className="inline">
                            {webmailDomain || defaultWebmailDomain(domain.domain)}
                          </code>
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={bindNavigate(
                              navigate,
                              `/ssl?domain=${encodeURIComponent(
                                webmailDomain || defaultWebmailDomain(domain.domain),
                              )}&action=le`,
                            )}
                          >
                            {t('email.tlsRequestLeFor', {
                              host: webmailDomain || defaultWebmailDomain(domain.domain),
                            })}
                          </Button>
                        </span>
                      ),
                      hint: t('email.tlsRoleWebmailHint'),
                    },
                    {
                      label: t('email.tlsRoleApex'),
                      value: (
                        <span className="mail-advanced__host-row">
                          <code className="inline">{domain.domain}</code>
                          <Button
                            variant="secondary"
                            size="md"
                            onClick={bindNavigate(
                              navigate,
                              `/ssl?domain=${encodeURIComponent(domain.domain)}&action=le`,
                            )}
                          >
                            {t('email.tlsRequestLeFor', { host: domain.domain })}
                          </Button>
                        </span>
                      ),
                      hint: t('email.tlsRoleApexHint'),
                    },
                  ]}
                />
                <ActionBar size="md" className="action-bar--toolbar">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => {
                      void withBusy(async () => {
                        const r = await emailApi.applyMailTls({
                          domain: domain.domain,
                          mailHost: defaultMailSslDomain(domain.domain),
                        });
                        setLive((prev) => ({
                          ...(prev ?? {}),
                          mailTlsApply: r,
                        }));
                      });
                    }}
                  >
                    {t('email.applyMailTls')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="md"
                    onClick={bindNavigate(navigate, '/ssl')}
                  >
                    {t('email.openSslPage')}
                  </Button>
                </ActionBar>
                {(live as { mailTlsApply?: OpsResultLike } | null)?.mailTlsApply ? (
                  <OpsResultPanel
                    title={t('email.applyMailTls')}
                    result={asOps(
                      ((live as { mailTlsApply?: OpsResultLike }).mailTlsApply ??
                        null) as Record<string, unknown> | null,
                    )}
                  />
                ) : null}
              </CardSection>
            </Card>

            {/* 4. Ops tools */}
            <div className="mail-advanced__ops-grid">
              <Card>
                <CardSection title={t('email.rateLimitTitle')}>
                  <FormLayout>
                    <Field
                      label={t('email.hourlyMsgCap')}
                      htmlFor="policy-rate"
                      flush
                      hint={t('email.hourlyMsgCapHint')}
                      error={
                        !isPolicyRateValid(policyRate)
                          ? t('email.hourlyMsgCapInvalid', { defaultValue: t('common.invalid') })
                          : undefined
                      }
                    >
                      <input
                        id="policy-rate"
                        type="number"
                        min={1}
                        max={100000}
                        value={policyRate}
                        onChange={bindInput(setPolicyRate)}
                      />
                    </Field>
                    <CheckboxField
                      id="policy-spam"
                      label={t('email.enableAntispam')}
                      description={t('email.enableAntispamDesc')}
                      checked={policyAntispam}
                      onChange={setPolicyAntispam}
                      disabled={busy}
                    />
                  </FormLayout>
                  <ActionBar size="md">
                    <Button
                      variant="secondary"
                      size="md"
                      loading={busy}
                      disabled={!isPolicyRateValid(policyRate)}
                      onClick={bindBusyApplyPolicy(
                        withBusy,
                        emailApi.applyPolicy,
                        domain.id,
                        {
                          rateLimitPerHour: parsePolicyRate(policyRate),
                          antispam: policyAntispam,
                          applySystem: false,
                        },
                        setPolicyLog,
                        load,
                      )}
                    >
                      {t('email.writeControlOnly')}
                    </Button>
                    <Button
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={bindBusyApplyPolicy(
                        withBusy,
                        emailApi.applyPolicy,
                        domain.id,
                        {
                          rateLimitPerHour: parsePolicyRate(policyRate),
                          antispam: policyAntispam,
                          applySystem: true,
                        },
                        setPolicyLog,
                        load,
                      )}
                    >
                      {t('email.applyToSystemBtn')}
                    </Button>
                  </ActionBar>
                  {policyLog ? (
                    <OpsResultPanel
                      title={t('email.policyResult')}
                      result={asOps(policyLog)}
                      busy={busy}
                    />
                  ) : null}
                </CardSection>
              </Card>

              <Card>
                <CardSection title={t('email.advancedToolsTitle')}>
                  <div className="mail-advanced__tool-block">
                    <h4 className="mail-advanced__tool-label">{t('email.queueTitle')}</h4>
                    <ActionBar size="md">
                      <Link to="/email?tab=queue">
                        <Button variant="secondary" size="md">
                          {t('email.openQueuePage')}
                        </Button>
                      </Link>
                    </ActionBar>
                  </div>
                  <div className="mail-advanced__tool-block">
                    <h4 className="mail-advanced__tool-label">{t('email.clientAutoTitle')}</h4>
                    <ActionBar size="md">
                      <Button
                        variant="secondary"
                        size="md"
                        loading={busy}
                        onClick={bindBusyAutodiscover(
                          withBusy,
                          () => emailApi.autodiscover(domain.id),
                          setAdvancedOpsLog,
                        )}
                      >
                        {t('email.generateCopyXml')}
                      </Button>
                    </ActionBar>
                  </div>
                  {advancedOpsLog ? (
                    <OpsResultPanel
                      title={t('email.advancedToolsTitle')}
                      result={asOps(advancedOpsLog)}
                      busy={busy}
                    />
                  ) : null}
                </CardSection>
              </Card>
            </div>
          </div>
        ) : null}
      
        {tab === 'stack' ? (
          <div className="tab-panel stack">
            <SoftwareInstallBanner feature="email" title={t('email.softwareNeeded')} />
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="emailDomain" /> : null}
      </PageTabs>

      <Modal
        open={createMboxOpen}
        onClose={bindSet(setCreateMboxOpen, false)}
        title={t('email.createMailboxTitle')}
        description={t('email.createMailboxDesc', { local: mboxLocal || '…', domain: domain.domain })}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={bindSet(setCreateMboxOpen, false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={bindBusyCreateMailbox(
                withBusy,
                emailApi.createMailbox,
                domain.id,
                mboxLocal,
                mboxPass,
                setMboxLog,
                emailApi.listMailboxes,
                setMailboxes,
                () => setCreateMboxOpen(false),
                () => setMboxPass(''),
              )}
            >
              {t('email.createMailboxBtn')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field
            label={t('email.localPartLabel')}
            htmlFor="mlocal"
            hint={t('email.localPartFullHint', { local: mboxLocal || '…', domain: domain.domain })}
            required
            flush
          >
            <input
              id="mlocal"
              value={mboxLocal}
              onChange={bindInput(setMboxLocal)}
              placeholder="info"
            />
          </Field>
          <Field
            label={t('common.password')}
            htmlFor="mpass"
            hint={t('email.passwordOptionalHint8')}
            flush
          >
            <input
              id="mpass"
              type="password"
              value={mboxPass}
              onChange={bindInput(setMboxPass)}
              autoComplete="new-password"
            />
          </Field>
        </FormLayout>
      </Modal>

      <Modal
        open={Boolean(editMailbox)}
        onClose={() => {
          if (!busy) {
            setEditMailbox(null);
            setEditMboxPass('');
            setEditMboxPass2('');
          }
        }}
        title={t('email.editMailboxTitle')}
        description={t('email.editMailboxDesc', {
          address: editMailbox?.address ?? '',
        })}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              disabled={busy}
              onClick={() => {
                setEditMailbox(null);
                setEditMboxPass('');
                setEditMboxPass2('');
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() => {
                if (!editMailbox || !domain) return;
                const pw = editMboxPass.trim();
                if (pw && pw !== editMboxPass2.trim()) {
                  notifyWarn(t('email.passwordMismatch'));
                  return;
                }
                if (pw && pw.length < 8) {
                  notifyWarn(t('email.passwordTooShort'));
                  return;
                }
                const prevStatus =
                  String(editMailbox.status).toLowerCase() === 'disabled'
                    ? 'disabled'
                    : 'active';
                const statusChanged = editMboxStatus !== prevStatus;
                if (!pw && !statusChanged) {
                  notifyWarn(t('email.mailboxUpdateNeedField'));
                  return;
                }
                const target = editMailbox;
                void withBusy(async () => {
                  const r = await emailApi.updateMailbox(domain.id, target.id, {
                    password: pw || undefined,
                    status: statusChanged ? editMboxStatus : undefined,
                  });
                  setMboxLog(r);
                  notifyOpsResult(r as Record<string, unknown>, t);
                  setMailboxes((await emailApi.listMailboxes(domain.id)).items);
                  setEditMailbox(null);
                  setEditMboxPass('');
                  setEditMboxPass2('');
                });
              }}
            >
              {t('email.editMailboxSave')}
            </Button>
          </>
        }
      >
        <FormLayout columns={1}>
          <Field label={t('email.colAddress')} htmlFor="edit-addr" flush>
            <input
              id="edit-addr"
              value={editMailbox?.address ?? ''}
              readOnly
              disabled
            />
          </Field>
          <Field
            label={t('email.mailboxStatus')}
            htmlFor="edit-status"
            hint={t('email.mailboxStatusHint')}
            flush
          >
            <select
              id="edit-status"
              value={editMboxStatus}
              onChange={(e) =>
                setEditMboxStatus(
                  e.target.value === 'disabled' ? 'disabled' : 'active',
                )
              }
            >
              <option value="active">{t('email.mailboxStatusActive')}</option>
              <option value="disabled">{t('email.mailboxStatusDisabled')}</option>
            </select>
          </Field>
          <Field
            label={t('email.newPassword')}
            htmlFor="edit-pass"
            hint={
              editMailbox?.has_password
                ? t('email.newPasswordHint')
                : t('email.passwordOptionalHint8')
            }
            flush
          >
            <input
              id="edit-pass"
              type="password"
              value={editMboxPass}
              onChange={bindInput(setEditMboxPass)}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label={t('email.confirmPassword')}
            htmlFor="edit-pass2"
            flush
          >
            <input
              id="edit-pass2"
              type="password"
              value={editMboxPass2}
              onChange={bindInput(setEditMboxPass2)}
              autoComplete="new-password"
            />
          </Field>
        </FormLayout>
      </Modal>

      <EmailDomainDeleteDialog
        domain={domain}
        open={deleteOpen}
        busy={deleteBusy}
        mailboxCount={mailboxes.length}
        recordCount={(bundle?.records ?? []).length}
        aliasCount={aliases.length}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        onDeleted={(r) => {
          setDeleteBusy(false);
          setDeleteOpen(false);
          if (r.ok) {
            notifyOk(t('common.success'));
            navigate('/email');
          } else {
            notifyWarn((r.notes ?? []).join(' · ') || t('common.deleteFailed'));
          }
        }}
      />

      <ConfirmDialog
        open={Boolean(delMailbox)}
        onClose={() => {
          if (!busy) setDelMailbox(null);
        }}
        onConfirm={() => {
          if (!delMailbox) return;
          const target = delMailbox;
          setDelMailbox(null);
          void withBusy(async () => {
            const r = await emailApi.deleteMailbox(domain.id, target.id);
            setMboxLog(r);
            notifyOpsResult(r as Record<string, unknown>, t);
            setMailboxes((await emailApi.listMailboxes(domain.id)).items);
          });
        }}
        title={t('email.deleteMailboxTitle')}
        description={t('email.deleteMailboxDesc', {
          address: delMailbox?.address ?? '',
        })}
        consequences={[
          t('email.deleteMailboxC1'),
          t('email.deleteMailboxC2'),
          t('email.deleteMailboxC3'),
        ]}
        confirmLabel={t('email.deleteMailbox')}
        severity="destructive"
        busy={busy}
      />

      <ConfirmDialog
        open={Boolean(delAlias)}
        onClose={() => {
          if (!busy) setDelAlias(null);
        }}
        onConfirm={() => {
          if (!delAlias) return;
          const target = delAlias;
          setDelAlias(null);
          bindBusyMutateList(
            withBusy,
            () => emailApi.deleteAlias(domain.id, target.id),
            setAliasLog,
            () => emailApi.listAliases(domain.id),
            setAliases,
          )();
        }}
        title={t('email.deleteAliasTitle')}
        description={t('email.deleteAliasDesc', {
          source: delAlias?.source ?? '',
        })}
        confirmLabel={t('common.delete')}
        severity="standard"
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
