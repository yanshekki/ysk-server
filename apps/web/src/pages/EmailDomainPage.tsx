/**
 * Email domain detail — professional console layout (aligned with recent UX).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { emailApi, type EmailBundle, type EmailDomain } from '../features/email';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DataTable,
  DescriptionList,
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
  FormHint,
  SegRadio,
} from '../shared/components/ui';
import type { OpsResultLike } from '../shared/components/ui';
import { api } from '../shared/services/api';
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
  bindBusyMailQueue,
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
  bindSet,
} from './bind-handlers';

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
    notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
  } as OpsResultLike;
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
): 'ok' | 'neutral' {
  return String(status) === 'active' ? 'ok' : 'neutral';
}

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
      detail: String(c?.detail ?? '—'),
    };
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

/** Bootstrap admin password is usable (≥8 chars). */
export function isBootstrapPasswordValid(pw: string): boolean {
  return pw.trim().length >= 8;
}

/** Default webmail hostname for a domain. */
export function defaultWebmailDomain(domain: string): string {
  return `webmail.${domain}`;
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
    blockMessage: r.blockMessage,
  };
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
  const [tab, setTab] = useState('dns');
  const [bundle, setBundle] = useState<EmailBundle | null>(null);
  const [live, setLive] = useState<Record<string, unknown> | null>(null);
  const [dnsbl, setDnsbl] = useState<Record<string, unknown> | null>(null);
  const [warmup, setWarmup] = useState<Record<string, unknown> | null>(null);
  const [deliverability, setDeliverability] = useState<Awaited<
    ReturnType<typeof emailApi.deliverability>
  > | null>(null);
  const [relayHost, setRelayHost] = useState('smtp.example.com');
  const [relayUser, setRelayUser] = useState('');
  const [relayPass, setRelayPass] = useState('');
  const [relayApplySystem, setRelayApplySystem] = useState(true);
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

  useEffect(() => {
    setAutoreplySubject((prev) => prev || t('email.defaultAutoreplySubject'));
    setAutoreplyBody((prev) => prev || t('email.defaultAutoreplyBody'));
  }, [t]);

  const load = useCallback(async () => {
    const list = await emailApi.list();
    const found = list.items.find((d) => d.id === id) ?? null;
    setDomain(found);
    if (!found) return null;
    // Prefill policy form from control-plane domain flags
    if (found.rate_limit_per_hour != null && Number(found.rate_limit_per_hour) > 0) {
      setPolicyRate(String(found.rate_limit_per_hour));
    }
    if (typeof found.antispam === 'boolean') {
      setPolicyAntispam(found.antispam);
    }
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

  async function withBusy(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.opFailed'));
    } finally {
      setBusy(false);
    }
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
        <SoftwareInstallBanner feature="email" title={t('email.softwareNeeded')} />
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
    {
      id: 'deliverability',
      label: t('email.tabDeliverability', { defaultValue: 'Deliverability' }),
    },
    { id: 'relay', label: t('email.tabRelay') },
    { id: 'sieve', label: t('email.tabSieve') },
    { id: 'advanced', label: t('email.tabAdvanced') },
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
          tone: applyStatusTone(domain.apply_status),
        },
        items: [
          {
            label: t('email.statHealth'),
            value: `${domain.health_score}/100`,
            tone: healthScoreTone(domain.health_score),
          },
          {
            label: t('email.statApply'),
            value: applySt,
            tone: applyStatusTone(domain.apply_status),
          },
          {
            label: t('email.statDomain'),
            value: suspended ? t('email.pausedFlag') : t('email.normal'),
            tone: suspended ? 'warn' : 'ok',
          },
          { label: t('email.statMailboxes'), value: mailboxes.length },
          { label: t('email.statDnsRecords'), value: (bundle?.records ?? []).length },
        ],
      }}
      actions={<ActionBar>
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
        </ActionBar>
      }
    >
      <SoftwareInstallBanner feature="email" title={t('email.softwareNeeded')} />
      {error ? <Alert variant="error">{error}</Alert> : null}

      <PageTabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'dns' ? (
          <Card>
            <CardSection
              title={t('email.dnsTodosTitle')}
              description={t('email.dnsTodosDesc')}
            >
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
                  </ActionBar>
                  <DescriptionList
                    columns={2}
                    items={[
                      {
                        label: t('email.healthScore'),
                        value: (
                          <Badge tone={healthScoreTone(bundle.health.score)}>
                            {bundle.health.score}/{bundle.health.maxScore}
                          </Badge>
                        ),
                      },
                      { label: t('email.suggestedRecords'), value: String(bundle.records.length) },
                      { label: t('email.externalTodosCount'), value: String(bundle.externalTodos.length) },
                    ]}
                  />
                  {bundle.health.messages.length > 0 ? (
                    <ul className="muted list-flush u-mt-3">
                      {bundle.health.messages.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="u-mt-4">
                    <DataTable
                      columns={[
                        {
                          key: 'type',
                          header: t('email.colType'),
                          nowrap: true,
                          render: (r) => <Badge>{r.type}</Badge>,
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
                            <code className="inline">{r.value}</code>
                          ),
                        },
                        {
                          key: 'description',
                          header: t('email.colNote'),
                          className: 'muted u-text-sm',
                          render: (r) => r.description,
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
                    <div className="u-mt-4">
                      <h4 className="u-mb-2">{t('email.externalTodosHeading')}</h4>
                      <FormHint>
                        {t('email.externalTodosBody')}</FormHint>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="u-mb-3"
                        onClick={bindClipboard(formatExternalTodosText(bundle.externalTodos))}
                      >
                        {t('email.copyExternalTodos')}
                      </Button>
                      <ul className="list-plain list-spaced">
                        {bundle.externalTodos.map((todo) => (
                          <li key={todo.id}>
                            <Badge tone={todo.completed ? 'ok' : 'warn'}>
                              {todo.completed ? t('email.todoDone') : t('email.todoPending')}
                            </Badge>{' '}
                            <strong>{todo.title}</strong>
                            <div className="muted u-text-sm">{todo.description}</div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="muted u-m-0">
                  {t('email.refreshDnsHint')}
                </p>
              )}
            </CardSection>
          </Card>
        ) : null}

        {tab === 'mailbox' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('email.mailboxListTitle', { count: mailboxes.length })}
                description={t('email.mailboxListDesc')}
              >
                <ActionBar className="u-mb-3">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={bindOpenCreate(setCreateMboxOpen, [setMboxLocal, setMboxPass], ['info', ''])}
                  >
                    {t('email.createMailbox')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={bindBusyMap(withBusy, () => emailApi.listMailboxes(domain.id), setMailboxes, (r) => r.items)}
                  >
                    {t('common.refresh')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    onClick={bindBusySet(withBusy, () => emailApi.dovecotPassdb(domain.id), setMboxLog)}
                  >
                    {t('email.writeDovecot')}
                  </Button>
                </ActionBar>
                {mailboxes.length > 0 ? (
                  <ul className="list-plain list-spaced">
                    {mailboxes.map((m) => (
                      <li key={String(m.id)}>
                        <code className="inline">{String(m.address)}</code>{' '}
                        <Badge tone={mailboxStatusTone(m.status)}>
                          {String(m.status ?? '—')}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">{t('email.noMailboxes')}</p>
                )}
                <OpsResultPanel title={t('email.mailboxOpsResult')} result={asOps(mboxLog)} busy={busy} />
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'aliases' ? (
          <div className="tab-panel">
            <Card>
              <CardSection title={t('email.aliasesTitle')} description={t('email.aliasesDesc')}>
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
                  {aliasType !== 'catchall' ? (
                    <Field label={t('email.localPart')} htmlFor="al-local" hint={t('email.localPartHint')} flush>
                      <input
                        id="al-local"
                        value={aliasLocal}
                        onChange={bindInput(setAliasLocal)}
                        placeholder="sales"
                      />
                    </Field>
                  ) : null}
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
                          destinations: parseAliasDestinations(aliasDest),
                        }),
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
                          onClick={bindBusyMutateList(
                              withBusy,
                              () => emailApi.deleteAlias(domain.id, String(a.id)),
                              setAliasLog,
                              () => emailApi.listAliases(domain.id),
                              setAliases,
                            )}
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
              <CardSection
                title={t('email.autoreplyTitle')}
                description={t('email.autoreplyDesc')}
              >
                <FormHint>
                  {t('email.autoreplyBodyHint')}
                </FormHint>
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
                        applySystem: flagsApplySystem,
                      },
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
          <div className="tab-panel">
          <Card>
            <CardSection
              title={t('email.healthLiveTitle')}
              description={t('email.healthLiveDesc')}
            >
              <SummaryStrip
                items={[
                  {
                    label: t('email.serverIpLabel'),
                    value: domain.server_ip || '—',
                  },
                  {
                    label: t('email.healthScore'),
                    value: live
                      ? String(
                          (live as { health?: { score?: number } }).health?.score ??
                            domain.health_score,
                        )
                      : String(domain.health_score),
                    tone: healthScoreTone(
                      live
                        ? Number(
                            (live as { health?: { score?: number } }).health?.score ??
                              domain.health_score,
                          )
                        : domain.health_score,
                    ),
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
              <FormHint>
                {t('email.healthExternalNote')}
              </FormHint>
              <ActionBar className="u-mb-3">
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={bindBusySetAndTab(
                    withBusy,
                    () => emailApi.deliverability(domain.id),
                    setDeliverability,
                    setTab,
                    'deliverability',
                  )}
                >
                  {t('email.runDeliverabilityPack', {
                    defaultValue: 'Run deliverability pack',
                  })}
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

              {live ? (
                <div className="u-mb-4">
                  <h3 className="section-block__title">{t('email.probeMatrix')}</h3>
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
                    <Alert variant="warn" className="u-mt-3">
                      <strong>{t('email.dnsAuthRepairTitle')}</strong>
                      <ul className="list-flush u-mt-2 u-mb-0">
                        {dnsAuthRepairHints(live, t).map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                      <p className="muted u-text-sm u-mb-0 u-mt-2">{t('email.dnsAuthRepairHint')}</p>
                    </Alert>
                  ) : null}
                  {Array.isArray(
                    (live as { health?: { messages?: string[] } }).health?.messages,
                  ) &&
                  ((live as { health?: { messages?: string[] } }).health
                    ?.messages?.length ?? 0) > 0 ? (
                    <ul className="muted list-flush u-mt-3">
                      {(
                        (live as { health?: { messages?: string[] } }).health
                          ?.messages ?? []
                      ).map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <EmptyState
                  title={t('email.noLiveYet')}
                  description={t('email.noLiveYetHint')}
                />
              )}

              <div className="u-mt-4">
                <h3 className="section-block__title">{t('email.mailSslTitle')}</h3>
                <p className="section-block__desc">
                  {t('email.mailSslHint')}
                </p>
                <ActionBar>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={bindNavigate(navigate, `/ssl?domain=${encodeURIComponent(defaultMailSslDomain(domain.domain))}&action=le`)}
                  >
                    {t('email.leMailHost', { host: defaultMailSslDomain(domain.domain) })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={bindNavigate(navigate, `/ssl?domain=${encodeURIComponent(webmailDomain || defaultWebmailDomain(domain.domain))}&action=le`)}
                  >
                    {t('email.leWebmailHost', {
                      host: webmailDomain || defaultWebmailDomain(domain.domain),
                    })}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={bindNavigate(
                      navigate,
                      `/ssl?domain=${encodeURIComponent(domain.domain)}&action=le`,
                    )}
                  >
                    {t('email.leApexHost', { host: domain.domain })}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
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
                    size="sm"
                    onClick={bindNavigate(navigate, '/ssl')}
                  >
                    {t('email.openSslPage')}
                  </Button>
                </ActionBar>
                <p className="muted u-text-sm u-mt-2">{t('email.applyMailTlsHint')}</p>
              </div>

              <div className="u-mt-4">
                <h3 className="section-block__title">{t('email.webmailSsoSkeleton')}</h3>
                <ActionBar>
                  <Button
                    variant="ghost"
                    size="md"
                    loading={busy}
                    onClick={bindBusySet(
                      withBusy,
                      () =>
                        api.requestRaw('/api/v1/email/webmail/sso-plugin', {
                          method: 'POST',
                          body: JSON.stringify({}),
                        }),
                      setLive,
                    )}
                  >
                    {t('email.writeRoundcubeSso')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusySet(
                      withBusy,
                      () =>
                        api.requestRaw('/api/v1/email/webmail/sso-plugin', {
                          method: 'POST',
                          body: JSON.stringify({ enableSystem: true }),
                        }),
                      setLive,
                    )}
                  >
                    {t('email.ssoSkeletonSymlink')}
                  </Button>
                </ActionBar>
              </div>

              <div className="u-mt-4">
                <h3 className="section-block__title">{t('email.rateLimitTitle')}</h3>
                <p className="section-block__desc">
                  {t('email.rateLimitDesc')}
                </p>
                <p className="muted u-text-sm u-mb-3">{t('email.policyApplySystemHint')}</p>
                <FormLayout columns={2}>
                  <Field
                    label={t('email.hourlyMsgCap')}
                    htmlFor="policy-rate"
                    flush
                    hint={t('email.hourlyMsgCapHint')}
                  >
                    <input
                      id="policy-rate"
                      type="number"
                      min={10}
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
                <FormActions align="end">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
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
                    size="sm"
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
                </FormActions>
              </div>

              {dnsbl ? <OpsResultPanel title={t('email.dnsblResult')} result={asOps(dnsbl)} /> : null}
              {warmup ? <OpsResultPanel title={t('email.warmupResult')} result={asOps(warmup)} /> : null}
              {policyLog ? (
                <OpsResultPanel title={t('email.policyResult')} result={asOps(policyLog)} busy={busy} />
              ) : null}
            </CardSection>
          </Card>
          </div>
        ) : null}

        {tab === 'deliverability' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('email.deliverabilityTitle', {
                  defaultValue: 'Deliverability pack',
                })}
                description={t('email.deliverabilityDesc', {
                  defaultValue:
                    'Unified PTR / DNS / DNSBL / Port 25 / relay / warm-up checklist. Never claims global inbox delivery.',
                })}
              >
                <Alert variant="info">
                  {t('email.deliverabilityHonesty', {
                    defaultValue:
                      'YSK cannot set PTR or unlock Port 25 at the VPS provider. Gmail/Outlook placement is external.',
                  })}
                </Alert>
                <ActionBar className="u-mb-3">
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusySet(withBusy, () => emailApi.deliverability(domain.id), setDeliverability)}
                  >
                    {t('email.runDeliverabilityPack', {
                      defaultValue: 'Run deliverability pack',
                    })}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={bindSet(setTab, 'relay')}
                  >
                    {t('email.tabRelay')}
                  </Button>
                </ActionBar>
                {deliverability ? (
                  <>
                    <SummaryStrip
                      items={[
                        {
                          label: t('email.healthScore'),
                          value: String(deliverability.score),
                          tone: healthScoreTone(deliverability.score),
                        },
                        {
                          label: t('email.panelReady', { defaultValue: 'Panel-checkable' }),
                          value: deliverability.panelReady
                            ? t('common.ready', { defaultValue: 'Ready' })
                            : t('common.degraded', { defaultValue: 'Gaps' }),
                          tone: deliverability.panelReady ? 'ok' : 'warn',
                        },
                        {
                          label: t('email.guaranteed', { defaultValue: 'Inbox guarantee' }),
                          value: t('common.no'),
                          tone: 'default',
                        },
                      ]}
                    />
                    <ul className="list-plain u-mt-3">
                      {deliverability.honesty.map((h) => (
                        <li key={h} className="muted u-text-sm">
                          {h}
                        </li>
                      ))}
                    </ul>
                    <DataTable
                      title={t('email.checklist', { defaultValue: 'Checklist' })}
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
                                ? 'OK'
                                : i.level === 'external'
                                  ? 'External'
                                  : i.ok === false
                                    ? 'Fail'
                                    : '—'}
                            </Badge>
                          ),
                        },
                        {
                          key: 'owner',
                          header: t('email.owner', { defaultValue: 'Owner' }),
                          className: 'muted u-text-sm',
                          render: (i) => i.owner,
                        },
                        {
                          key: 'detail',
                          header: t('common.notes'),
                          className: 'u-text-sm',
                          render: (i) => (
                            <span>
                              {i.detail}
                              {i.fixHint ? (
                                <span className="muted"> · {i.fixHint}</span>
                              ) : null}
                            </span>
                          ),
                        },
                      ]}
                      rows={deliverability.items}
                      rowKey={(i) => i.id}
                    />
                    {deliverability.externalTodos?.length ? (
                      <div className="u-mt-4">
                        <h4>{t('email.externalTodosHeading')}</h4>
                        <ul className="u-text-sm">
                          {deliverability.externalTodos.map((todo) => (
                            <li key={todo.id}>
                              <strong>{todo.title ?? todo.id}</strong>
                              {todo.description ? ` — ${todo.description}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    title={t('email.deliverabilityEmpty', {
                      defaultValue: 'No pack run yet',
                    })}
                    description={t('email.deliverabilityEmptyDesc', {
                      defaultValue: 'Click Run deliverability pack to probe DNS, PTR, Port 25, DNSBL.',
                    })}
                  />
                )}
              </CardSection>
            </Card>
          </div>
        ) : null}

        {tab === 'relay' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title={t('email.relayTitle')}
                description={t('email.relayDesc')}
              >
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
                    description={t('email.applyRelaySystemDesc')}
                    checked={relayApplySystem}
                    onChange={setRelayApplySystem}
                  />
                </div>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={bindBusySetRelay(
                      withBusy,
                      emailApi.setRelay,
                      {
                        host: relayHost,
                        port: 587,
                        username: relayUser || undefined,
                        password: relayPass || undefined,
                        security: 'starttls',
                        applySystem: relayApplySystem,
                      },
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
              <CardSection
                title={t('email.webmailSsoTitle')}
                description={t('email.webmailSsoDesc')}
              >
                <FormLayout>
                  <Field
                    label={t('email.mailboxPasswordOptional')}
                    htmlFor="sso-pw"
                    flush
                    hint={t('email.mailboxPasswordHint', { domain: domain.domain })}
                  >
                    <input
                      id="sso-pw"
                      type="password"
                      autoComplete="new-password"
                      placeholder={t('email.mailboxPasswordPh')}
                    />
                  </Field>
                </FormLayout>
                <FormHint>{t('email.ssoTokenHint')}</FormHint>
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
                    )}
                  >
                    {t('email.issueSsoToken')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title={t('email.sieveTitle')}
                description={t('email.sieveDesc')}
              >
                <FormHint>
                  {t('email.sieveTemplateHint', { domain: domain.domain })}
                </FormHint>
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
          <div className="stack">
            <Card>
              <CardSection
                title={t('email.domainSslTitle')}
                description={t('email.domainSslDesc')}
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={bindNavigate(
                      navigate,
                      `/ssl?domain=${encodeURIComponent(domain.domain)}&action=le`,
                    )}
                  >
                    {t('email.requestCert', { domain: domain.domain })}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title={t('email.clientAutoTitle')}
                description={t('email.clientAutoDesc')}
              >
                <FormHint>{t('email.clientAutoHint')}</FormHint>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyAutodiscover(
                      withBusy,
                      () => emailApi.autodiscover(domain.id),
                      setWebmailLog,
                    )}
                  >
                    {t('email.generateCopyXml')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title={t('email.queueTitle')}
                description={t('email.queueDesc')}
              >
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusyMailQueue(
                      withBusy,
                      () => emailApi.mailQueue(),
                      setWebmailLog,
                    )}
                  >
                    {t('email.viewQueue')}
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    loading={busy}
                    onClick={bindBusySet(
                      withBusy,
                      () => emailApi.flushQueue({ all: true }),
                      setWebmailLog,
                    )}
                  >
                    {t('email.flushQueue')}
                  </Button>
                </FormActions>
                <FormHint>
                  {t('email.publicAutoconfig')}
                  <code className="inline">
                    /mail/config-v1.1.xml?domain={domain.domain}
                  </code>
                </FormHint>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title={t('email.bootstrapTitle')}
                description={t('email.bootstrapDesc')}
              >
                <Alert variant="info">
                  {t('email.bootstrapHonesty')}
                </Alert>
                <FormLayout>
                  <Field
                    label={t('email.adminPassword')}
                    htmlFor="boot-pw"
                    flush
                    required
                    hint={t('email.adminPasswordHint')}
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
                <p className="muted u-text-sm u-mb-3">{t('email.bootstrapAfterSteps')}</p>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={!isBootstrapPasswordValid(bootstrapPassword)}
                    onClick={bindBusyBootstrap(
                      withBusy,
                      bootstrapPassword,
                      isBootstrapPasswordValid,
                      () => setError(t('email.adminPasswordRequired')),
                      emailApi.bootstrap,
                      {
                        domain: domain.domain,
                        serverIp: domain.server_ip,
                        adminLocalPart: 'postmaster',
                        adminPassword: bootstrapPassword.trim(),
                        installPackages: true,
                        webmail: true,
                      },
                      setWebmailLog,
                      load,
                    )}
                  >
                    {t('email.bootstrapBtn')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindNavigate(
                      navigate,
                      `/ssl?domain=${encodeURIComponent(defaultMailSslDomain(domain.domain))}&action=le`,
                    )}
                  >
                    {t('email.bootstrapThenSsl')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title={t('email.webmailRoundcube')}
                description={t('email.webmailInstallDesc')}
              >
                <FormLayout columns={2}>
                  <Field
                    label={t('email.webmailHostname')}
                    htmlFor="wmd"
                    flush
                    hint={t('email.webmailHostnameHint')}
                  >
                    <input
                      id="wmd"
                      value={webmailDomain}
                      onChange={bindInput(setWebmailDomain)}
                      placeholder={defaultWebmailDomain(domain.domain)}
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={bindBusySet(
                      withBusy,
                      () =>
                        emailApi.webmailApply({
                          domain: webmailDomain,
                          download: true,
                        }),
                      setWebmailLog,
                    )}
                  >
                    {t('email.installWebmail')}
                  </Button>
                </FormActions>
                <OpsResultPanel
                  title={t('email.bootstrapResult')}
                  result={asOps(webmailLog)}
                  busy={busy}
                />
              </CardSection>
            </Card>
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
    </FeaturePageLayout>
  );
}
