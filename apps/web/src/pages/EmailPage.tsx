/**
 * Email control plane — SOC-style hub:
 * domains · queue · software stack · ops notes.
 * Create only in domains ListPanel toolbar (table top-right).
 */
import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { emailApi, type EmailDomain } from '../features/email';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  ListPanel,
  ListToolbar,
  Modal,
  ConfirmDialog,
  PageTabs,
  SoftwareInstallBanner,
} from '../shared/components/ui';
import { getServerContext, setServerContext } from '../shared/stores/server-context';
import { usePageTab } from '../shared/hooks/usePageTab';
import { useServerList } from '../shared/hooks/useServerList';
import { bindCall1, bindCloseIfIdle, bindFilter, bindFormSubmit, bindInput, bindInputContext, bindRefreshCatch, bindSeq, bindSet, bindVoid } from './bind-handlers';

const TABS = ['domains', 'queue', 'stack', 'ops', 'about'] as const;

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
  items: Array<{ health_score: number }>,
  threshold = 80,
): number {
  return items.filter((d) => d.health_score >= threshold).length;
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
    debounceMs: 300,
  });
  const items = list.items;
  const [tab, setTab] = usePageTab(TABS, 'domains');
  const [createOpen, setCreateOpen] = useState(false);
  const [domain, setDomain] = useState('');
  const [serverIp, setServerIp] = useState(ctx.serverIp);
  const [serverIpv6, setServerIpv6] = useState(ctx.serverIpv6 ?? '');
  const [busy, setBusy] = useState(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [flushConfirmOpen, setFlushConfirmOpen] = useState(false);
  const [queueMsg, setQueueMsg] = useState<string | null>(null);
  const [queueOk, setQueueOk] = useState<boolean | null>(null);
  const [queueItems, setQueueItems] = useState<Array<{ id: string; raw: string }>>([]);

  const total = list.meta?.total ?? items.length;
  const facets = list.meta?.facets;
  const applied = countAppliedDomains(items, facets);
  const healthy = countHealthyDomains(items);
  const draft = countDraftDomains(items, facets);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    list.setError(null);
    setBusy(true);
    try {
      const created = await emailApi.create({
        domain,
        serverIp,
        ...(serverIpv6.trim() ? { serverIpv6: serverIpv6.trim() } : {}),
      });
      setDomain('');
      setCreateOpen(false);
      setServerContext({
        domain,
        serverIp,
        serverIpv6: serverIpv6.trim() || undefined,
      });
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

  async function loadQueue() {
    setQueueBusy(true);
    setQueueMsg(null);
    try {
      const r = await emailApi.mailQueue();
      setQueueItems(r.items ?? []);
      setQueueOk(r.ok !== false && !r.blocked);
      setQueueMsg((r.notes ?? []).join(' · ') || t('email.queueMsgCount', { count: (r.items ?? []).length }));
    } catch (e) {
      setQueueOk(false);
      setQueueMsg(e instanceof Error ? e.message : t('email.queueLoadFailed'));
      setQueueItems([]);
    } finally {
      setQueueBusy(false);
    }
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

  return (
    <FeaturePageLayout
      title={t('nav.email')}
      status={{
        pill: {
          label: total ? t('email.pillDomains', { count: total }) : t('email.pillNoDomain'),
          tone: total ? 'ok' : 'warn',
        },
        items: [
          { label: t('email.statDomains'), value: total },
          {
            label: t('email.statHealthy80'),
            value: healthy,
            tone: healthy > 0 ? 'ok' : undefined,
          },
          {
            label: t('email.statApplied'),
            value: applied,
            tone: applied > 0 ? 'ok' : undefined,
          },
          {
            label: t('email.statDraft'),
            value: draft,
            tone: draft > 0 ? 'warn' : undefined,
          },
        ],
      }}
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
      <SoftwareInstallBanner feature="email" title={t('email.softwareNeeded')} />
      {list.error ? <Alert variant="error">{list.error}</Alert> : null}

      <PageTabs
        tabs={[
          {
            id: 'domains',
            label: t('email.tabDomains'),
            badge: items.length || undefined,
          },
          {
            id: 'queue',
            label: t('email.tabQueue'),
            badge: queueItems.length || undefined,
          },
          { id: 'stack', label: t('email.tabStack') },
          { id: 'ops', label: t('email.tabOps') },
        
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
              description={t('email.searchPlaceholder')}
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
                          tone: 'ok',
                        },
                        {
                          id: 'draft',
                          label: t('email.applyDraft'),
                          count: facets?.status?.draft,
                        },
                        {
                          id: 'failed',
                          label: t('email.applyFailed'),
                          count: facets?.status?.failed,
                          tone: 'danger',
                        },
                      ],
                    },
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
                  return (
                    <Link
                      key={d.id}
                      to={`/email/domains/${d.id}`}
                      className="list-row mail-domain-row"
                    >
                      <div className="list-row__main">
                        <div className="list-row__title">
                          <span className="mail-domain-name">{d.domain}</span>
                          <Badge tone={st.tone}>{st.text}</Badge>
                        </div>
                        <div className="list-row__meta">
                          <span>IP {d.server_ip || '—'}</span>
                        </div>
                      </div>
                      <div className="list-row__side">
                        <Badge tone={d.health_score >= 80 ? 'ok' : 'warn'}>
                          {d.health_score}/100
                        </Badge>
                        <span className="list-row__chevron" aria-hidden>
                          ›
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </ListPanel>
          </div>
        ) : null}

        {tab === 'queue' ? (
          <div className="tab-panel mail-panel">
            <div className="mail-card">
              <div className="mail-card__head">
                <div>
                  <h3 className="mail-card__title">{t('email.queueLocalTitle')}</h3>
                  <p className="mail-card__desc muted u-text-sm">
                    {t('email.needExecute')}
                  </p>
                </div>
                <ActionBar>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={queueBusy}
                    onClick={bindVoid(loadQueue)}
                  >
                    {t('email.viewQueue')}
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    loading={queueBusy}
                    onClick={bindSet(setFlushConfirmOpen, true)}
                  >
                    {t('email.flushQueue')}
                  </Button>
                </ActionBar>
              </div>

              {queueMsg ? (
                <Alert
                  variant={
                    queueOk === false
                      ? 'error'
                      : queueOk === true
                        ? 'ok'
                        : 'info'
                  }
                >
                  {queueMsg}
                </Alert>
              ) : (
                <Alert variant="info">
                  {t('email.queueHint')}
                </Alert>
              )}

              {queueItems.length > 0 ? (
                <ul className="mail-queue-list">
                  {queueItems.slice(0, 50).map((it) => (
                    <li key={it.id}>
                      <code className="mail-queue-list__raw">{it.raw}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={queueBusy}
                        onClick={bindCall1(flushOne, it.id)}
                      >
                        {t('email.deleteThisId')}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : queueOk === true ? (
                <EmptyState title={t('email.queueEmpty')} description={t('email.queueEmptyHint')} />
              ) : null}
            </div>
          </div>
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel mail-panel">
            <div className="mail-ops-grid">
              <div className="mail-card">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">{t('email.mtaTitle')}</h3>
                </div>
                <p className="muted u-text-sm">
                  {t('email.mtaBody')}
                </p>
                <ul className="mail-stack-list">
                  <li>
                    <strong>Postfix</strong>
                    <span className="muted">{t('email.mtaSmtp')}</span>
                  </li>
                  <li>
                    <strong>Dovecot</strong>
                    <span className="muted">{t('email.mtaImap')}</span>
                  </li>
                  <li>
                    <strong>OpenDKIM</strong>
                    <span className="muted">{t('email.mtaDkim')}</span>
                  </li>
                </ul>
                <FormHint>
                  {t('email.mtaMissingHint')}
                </FormHint>
              </div>

              <div className="mail-card">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">{t('email.pathTitle')}</h3>
                </div>
                <ol className="mail-steps">
                  <li>{t('email.path1')}</li>
                  <li>{t('email.path2')}</li>
                  <li>{t('email.path3')}</li>
                  <li>{t('email.path4')}</li>
                </ol>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={bindSet(setTab, 'domains')}
                  >
                    {t('email.viewDomainList')}
                  </Button>
                </FormActions>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'ops' ? (
          <div className="tab-panel mail-panel">
            <div className="mail-ops-grid">
              <div className="mail-card">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">{t('email.opsPanelTitle')}</h3>
                </div>
                <ul className="mail-bullets">
                  <li>{t('email.opsThisPage')}</li>
                  <li>{t('email.opsDetail')}</li>
                  <li>{t('email.opsHost')}</li>
                  <li>{t('email.opsRegistrar')}</li>
                </ul>
              </div>
              <div className="mail-card mail-card--muted">
                <div className="mail-card__head">
                  <h3 className="mail-card__title">{t('email.statusTitle')}</h3>
                </div>
                <ul className="mail-bullets">
                  <li>{t('email.statusDraft')}</li>
                  <li>{t('email.statusWritten')}</li>
                  <li>{t('email.statusApplied')}</li>
                  <li>{t('email.statusReputation')}</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="email" /> : null}
      </PageTabs>

      <Modal
        open={createOpen}
        onClose={bindSet(setCreateOpen, false)}
        title={t('email.create')}
        description={t('email.createModalDesc')}
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
        <form id="email-create-form" onSubmit={bindFormSubmit(onCreate)}>
          <FormLayout columns={2}>
            <Field
              label={t('email.domain')}
              htmlFor="edomain"
              flush
              required
              hint={t('email.domainApexHint')}
            >
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
            <Field
              label={t('email.serverIp')}
              htmlFor="eip"
              flush
              required
              hint={t('email.serverIpv4Hint')}
            >
              <input
                id="eip"
                value={serverIp}
                onChange={bindInputContext(setServerIp, setServerContext, 'serverIp')}
                required
                placeholder={t('email.serverIpv4Ph')}
                spellCheck={false}
              />
            </Field>
            <Field
              label={t('email.serverIpv6')}
              htmlFor="eip6"
              flush
              hint={t('email.serverIpv6Hint')}
            >
              <input
                id="eip6"
                value={serverIpv6}
                onChange={bindInputContext(setServerIpv6, setServerContext, 'serverIpv6')}
                placeholder={t('email.serverIpv6Ph')}
                spellCheck={false}
              />
            </Field>
          </FormLayout>
          <FormHint>
            {t('email.registerNote')}
          </FormHint>
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
    </FeaturePageLayout>
  );
}
