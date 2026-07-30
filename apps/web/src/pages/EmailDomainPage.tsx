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

function asOps(r: Record<string, unknown> | null): OpsResultLike | null {
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
      setWebmailDomain(`webmail.${found.domain}`);
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
        <Button variant="secondary" size="md" onClick={() => navigate('/email')}>
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
    { id: 'relay', label: t('email.tabRelay') },
    { id: 'sieve', label: t('email.tabSieve') },
    { id: 'advanced', label: t('email.tabAdvanced') },
    { id: 'about', label: t('common.about') },
  ];

  const applySt = (domain.apply_status ?? 'draft').toLowerCase();

  return (
    <FeaturePageLayout
      title={domain.domain}
      subtitle={domain.server_ip}
      showCapability={false}
      backTo="/email"
      backLabel={t('email.backToList')}
      status={{
        pill: {
          label:
            applySt === 'applied'
              ? t('email.pillApplied')
              : applySt === 'written'
                ? t('email.pillManaged')
                : t('email.pillDraft'),
          tone: applySt === 'applied' ? 'ok' : 'warn',
        },
        items: [
          {
            label: t('email.statHealth'),
            value: `${domain.health_score}/100`,
            tone: domain.health_score >= 80 ? 'ok' : 'warn',
          },
          {
            label: t('email.statApply'),
            value:
              applySt === 'applied'
                ? 'applied'
                : applySt === 'written'
                  ? 'written'
                  : 'draft',
            tone: applySt === 'applied' ? 'ok' : 'warn',
          },
          {
            label: t('email.statDomain'),
            value:
              (domain as { suspended?: boolean; status?: string }).suspended ||
              (domain as { status?: string }).status === 'suspended'
                ? t('email.pausedFlag')
                : t('email.normal'),
            tone:
              (domain as { suspended?: boolean; status?: string }).suspended ||
              (domain as { status?: string }).status === 'suspended'
                ? 'warn'
                : 'ok',
          },
          { label: t('email.statMailboxes'), value: mailboxes.length },
          { label: t('email.statDnsRecords'), value: bundle?.records.length ?? '—' },
        ],
      }}
      actions={<ActionBar>
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() =>
              void withBusy(async () => {
                setBundle(await emailApi.dns(domain.id));
                setMailboxes((await emailApi.listMailboxes(domain.id)).items);
              })
            }
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
                      onClick={() => {
                        const text = bundle.records
                          .map((r) => `${r.type}\t${r.name}\t${r.value}`)
                          .join('\n');
                        void navigator.clipboard?.writeText(text);
                      }}
                    >
                      {t('email.copyAllRecords')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        navigate(`/dns`)
                      }
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
                          <Badge tone={bundle.health.score >= 80 ? 'ok' : 'warn'}>
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
                            onClick={() =>
                              void navigator.clipboard?.writeText(r.value)
                            }
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
                        onClick={() => {
                          const text = bundle.externalTodos
                            .map(
                              (t) =>
                                `- ${t.completed ? '[x]' : '[ ]'} ${t.title}: ${t.description}`,
                            )
                            .join('\n');
                          void navigator.clipboard?.writeText(text);
                        }}
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
                    onClick={() => {
                      setMboxLocal('info');
                      setMboxPass('');
                      setCreateMboxOpen(true);
                    }}
                  >
                    {t('email.createMailbox')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setMailboxes(
                          (await emailApi.listMailboxes(domain.id)).items,
                        );
                      })
                    }
                  >
                    {t('common.refresh')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setMboxLog(await emailApi.dovecotPassdb(domain.id));
                      })
                    }
                  >
                    {t('email.writeDovecot')}
                  </Button>
                </ActionBar>
                {mailboxes.length > 0 ? (
                  <ul className="list-plain list-spaced">
                    {mailboxes.map((m) => (
                      <li key={String(m.id)}>
                        <code className="inline">{String(m.address)}</code>{' '}
                        <Badge tone={String(m.status) === 'active' ? 'ok' : 'neutral'}>
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
                        { value: 'catchall', label: 'Catch-all' },
                      ]}
                    />
                  </Field>
                  {aliasType !== 'catchall' ? (
                    <Field label={t('email.localPart')} htmlFor="al-local" hint={t('email.localPartHint')} flush>
                      <input
                        id="al-local"
                        value={aliasLocal}
                        onChange={(e) => setAliasLocal(e.target.value)}
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
                      onChange={(e) => setAliasDest(e.target.value)}
                      placeholder={`info@${domain.domain}`}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const destinations = aliasDest
                          .split(/[,;\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean);
                        setAliasLog(
                          await emailApi.createAlias(domain.id, {
                            type: aliasType,
                            localPart: aliasType === 'catchall' ? undefined : aliasLocal,
                            destinations,
                          }),
                        );
                        setAliases((await emailApi.listAliases(domain.id)).items);
                      })
                    }
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
                            void withBusy(async () => {
                              setAliasLog(
                                await emailApi.deleteAlias(domain.id, String(a.id)),
                              );
                              setAliases((await emailApi.listAliases(domain.id)).items);
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
                      onChange={(e) => setAutoreplySubject(e.target.value)}
                    />
                  </Field>
                  <Field label={t('email.body')} htmlFor="ar-body" fullWidth flush>
                    <textarea
                      id="ar-body"
                      rows={4}
                      value={autoreplyBody}
                      onChange={(e) => setAutoreplyBody(e.target.value)}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.updateFlags(domain.id, {
                          autoreplyEnabled: autoreplyOn,
                          autoreplySubject,
                          autoreplyBody,
                          applySystem: flagsApplySystem,
                        });
                        setFlagsLog({
                          ok: r.ok,
                          apply_status: r.apply_status,
                          notes: r.notes ?? [],
                          written: r.written,
                          blocked: r.blocked,
                          blockMessage: r.blockMessage,
                        });
                        await load();
                      })
                    }
                  >
                    {flagsApplySystem ? t('email.saveApplyAutoreply') : t('email.saveAutoreplyWritten')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.updateFlags(domain.id, {
                          suspended: true,
                          applySystem: flagsApplySystem,
                        });
                        setFlagsLog({
                          ok: r.ok,
                          apply_status: r.apply_status,
                          notes: r.notes ?? [],
                          written: r.written,
                          blocked: r.blocked,
                          blockMessage: r.blockMessage,
                        });
                        await load();
                      })
                    }
                  >
                    {flagsApplySystem ? t('email.suspendApply') : t('email.suspendWritten')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.updateFlags(domain.id, {
                          suspended: false,
                          applySystem: flagsApplySystem,
                        });
                        setFlagsLog({
                          ok: r.ok,
                          apply_status: r.apply_status,
                          notes: r.notes ?? [],
                          written: r.written,
                          blocked: r.blocked,
                          blockMessage: r.blockMessage,
                        });
                        await load();
                      })
                    }
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
                    tone:
                      (live
                        ? Number(
                            (live as { health?: { score?: number } }).health?.score ??
                              domain.health_score,
                          )
                        : domain.health_score) >= 80
                        ? 'ok'
                        : 'warn',
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
                    value: dnsbl
                      ? (dnsbl as { ok?: boolean }).ok
                        ? 'Clean'
                        : 'Listed'
                      : live
                        ? (live as { dnsbl?: { ok?: boolean } }).dnsbl?.ok
                          ? 'Clean'
                          : 'Listed'
                        : t('email.notTested'),
                    tone: (dnsbl ?? live)
                      ? (
                          (dnsbl as { ok?: boolean } | null)?.ok ??
                          (live as { dnsbl?: { ok?: boolean } })?.dnsbl?.ok
                        )
                        ? 'ok'
                        : 'danger'
                      : 'default',
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
                  onClick={() =>
                    void withBusy(async () => {
                      const r = await emailApi.liveCheck(domain.id);
                      setLive(r);
                      await load();
                    })
                  }
                >
                  {t('email.runLiveCheck')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setDnsbl(await emailApi.dnsbl(domain.server_ip));
                    })
                  }
                >
                  {t('email.dnsblThisIp')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      const ips = [domain.server_ip];
                      try {
                        const hostIps = await api.requestRaw<{ items: string[] }>(
                          '/api/v1/system/ips',
                        );
                        ips.push(...(hostIps.items ?? []));
                      } catch {
                        /* optional */
                      }
                      setDnsbl(await emailApi.dnsblMulti([...new Set(ips)]));
                    })
                  }
                >
                  {t('email.multiIpRbl')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void withBusy(async () => {
                      setWarmup(await emailApi.warmupDomain(domain.id));
                    })
                  }
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
                          <Badge
                            tone={
                              r.ok === true
                                ? 'ok'
                                : r.ok === false
                                  ? 'danger'
                                  : 'warn'
                            }
                          >
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
                    rows={(
                      [
                        ['MX', live.mx],
                        ['SPF', live.spf],
                        ['DKIM', live.dkim],
                        ['DMARC', live.dmarc],
                        ['PTR', live.ptr],
                        [t('email.outboundPort25'), live.port25],
                        ['DNSBL', live.dnsbl],
                      ] as const
                    ).map(([label, cell]) => {
                      const c = cell as
                        | { ok?: boolean | null; detail?: string }
                        | undefined;
                      return {
                        label,
                        ok: c?.ok ?? null,
                        detail: String(c?.detail ?? '—'),
                      };
                    })}
                    rowKey={(r) => r.label}
                    empty={<p className="muted">{t('email.noProbeResults')}</p>}
                  />
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
                    onClick={() =>
                      navigate(
                        `/ssl?domain=${encodeURIComponent(`mail.${domain.domain}`)}&action=le`,
                      )
                    }
                  >
                    LE · mail.{domain.domain}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/ssl?domain=${encodeURIComponent(webmailDomain || `webmail.${domain.domain}`)}&action=le`,
                      )
                    }
                  >
                    LE · webmail
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigate(
                        `/ssl?domain=${encodeURIComponent(domain.domain)}&action=le`,
                      )
                    }
                  >
                    LE · {domain.domain}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/ssl')}
                  >
                    {t('email.openSslPage')}
                  </Button>
                </ActionBar>
              </div>

              <div className="u-mt-4">
                <h3 className="section-block__title">{t('email.webmailSsoSkeleton')}</h3>
                <ActionBar>
                  <Button
                    variant="ghost"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setLive(
                          await api.requestRaw('/api/v1/email/webmail/sso-plugin', {
                            method: 'POST',
                            body: JSON.stringify({}),
                          }),
                        );
                      })
                    }
                  >
                    {t('email.writeRoundcubeSso')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setLive(
                          await api.requestRaw('/api/v1/email/webmail/sso-plugin', {
                            method: 'POST',
                            body: JSON.stringify({ enableSystem: true }),
                          }),
                        );
                      })
                    }
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
                      onChange={(e) => setPolicyRate(e.target.value)}
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
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.applyPolicy(domain.id, {
                          rateLimitPerHour: Number(policyRate) || 200,
                          antispam: policyAntispam,
                          applySystem: false,
                        });
                        setPolicyLog(r as Record<string, unknown>);
                        await load();
                      })
                    }
                  >
                    {t('email.writeControlOnly')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.applyPolicy(domain.id, {
                          rateLimitPerHour: Number(policyRate) || 200,
                          antispam: policyAntispam,
                          applySystem: true,
                        });
                        setPolicyLog(r as Record<string, unknown>);
                        await load();
                      })
                    }
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
                      onChange={(e) => setRelayHost(e.target.value)}
                      placeholder="smtp.example.com"
                    />
                  </Field>
                  <Field label={t('common.username')} htmlFor="ru" flush>
                    <input
                      id="ru"
                      value={relayUser}
                      onChange={(e) => setRelayUser(e.target.value)}
                    />
                  </Field>
                  <Field label={t('common.password')} htmlFor="rp" flush>
                    <input
                      id="rp"
                      type="password"
                      value={relayPass}
                      onChange={(e) => setRelayPass(e.target.value)}
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
                    onClick={() =>
                      void withBusy(async () => {
                        setRelayLog(
                          await emailApi.setRelay({
                            host: relayHost,
                            port: 587,
                            username: relayUser || undefined,
                            password: relayPass || undefined,
                            security: 'starttls',
                            applySystem: relayApplySystem,
                          }),
                        );
                      })
                    }
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
                    onClick={() =>
                      void withBusy(async () => {
                        const pwEl = document.getElementById('sso-pw') as HTMLInputElement | null;
                        const password = pwEl?.value || undefined;
                        const email = `postmaster@${domain.domain}`;
                        const r = await emailApi.webmailSso({
                          email,
                          domain: domain.domain,
                          ttlMinutes: 10,
                          password,
                        });
                        setWebmailLog(r as Record<string, unknown>);
                      })
                    }
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
                    onClick={() =>
                      void withBusy(async () => {
                        const mailbox = `postmaster@${domain.domain}`;
                        const r = await emailApi.writeSieve({
                          mailbox,
                          name: 'default.sieve',
                          content: `require ["fileinto"];\n# YSK sieve for ${domain.domain}\n# if header :contains "X-Spam-Flag" "YES" { fileinto "Junk"; stop; }\n`,
                        });
                        setWebmailLog(r);
                      })
                    }
                  >
                    {t('email.writeDefaultSieve')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        const mailbox = `postmaster@${domain.domain}`;
                        setWebmailLog(await emailApi.listSieve(mailbox));
                      })
                    }
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
                    onClick={() =>
                      navigate(
                        `/ssl?domain=${encodeURIComponent(domain.domain)}&action=le`,
                      )
                    }
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
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.autodiscover(domain.id);
                        setWebmailLog({
                          ok: true,
                          notes: r.notes,
                          mozillaXml: r.mozillaXml.slice(0, 200) + '…',
                          urls: r.urls,
                        });
                        void navigator.clipboard?.writeText(r.mozillaXml);
                      })
                    }
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
                    onClick={() =>
                      void withBusy(async () => {
                        const r = await emailApi.mailQueue();
                        setWebmailLog({
                          ...r,
                          items: (r.items ?? []).slice(0, 20),
                        });
                      })
                    }
                  >
                    {t('email.viewQueue')}
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setWebmailLog(await emailApi.flushQueue({ all: true }));
                      })
                    }
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
                      onChange={(e) => setBootstrapPassword(e.target.value)}
                      minLength={8}
                      autoComplete="new-password"
                      placeholder={t('email.adminPasswordPh')}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={bootstrapPassword.trim().length < 8}
                    onClick={() =>
                      void withBusy(async () => {
                        if (bootstrapPassword.trim().length < 8) {
                          setError(t('email.adminPasswordRequired'));
                          return;
                        }
                        setWebmailLog(
                          await emailApi.bootstrap({
                            domain: domain.domain,
                            serverIp: domain.server_ip,
                            adminLocalPart: 'postmaster',
                            adminPassword: bootstrapPassword.trim(),
                            installPackages: true,
                            webmail: true,
                          }),
                        );
                        await load();
                      })
                    }
                  >
                    {t('email.bootstrapBtn')}
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title="Webmail（Roundcube）"
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
                      onChange={(e) => setWebmailDomain(e.target.value)}
                      placeholder={`webmail.${domain.domain}`}
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    onClick={() =>
                      void withBusy(async () => {
                        setWebmailLog(
                          await emailApi.webmailApply({
                            domain: webmailDomain,
                            download: true,
                          }),
                        );
                      })
                    }
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
        onClose={() => setCreateMboxOpen(false)}
        title={t('email.createMailboxTitle')}
        description={t('email.createMailboxDesc', { local: mboxLocal || '…', domain: domain.domain })}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCreateMboxOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="md"
              loading={busy}
              onClick={() =>
                void withBusy(async () => {
                  setMboxLog(
                    await emailApi.createMailbox(domain.id, {
                      localPart: mboxLocal,
                      password: mboxPass || undefined,
                    }),
                  );
                  setMailboxes(
                    (await emailApi.listMailboxes(domain.id)).items,
                  );
                  setCreateMboxOpen(false);
                  setMboxPass('');
                })
              }
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
              onChange={(e) => setMboxLocal(e.target.value)}
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
              onChange={(e) => setMboxPass(e.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </FormLayout>
      </Modal>
    </FeaturePageLayout>
  );
}
