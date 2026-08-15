/**
 * Validators (Beta) — list, create wizard, disk, about.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  Modal,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SegRadio,
  SoftwareInstallBanner,
  type OpsResultLike,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import {
  validatorsApi,
  type ValidatorChainSpec,
  type ValidatorDiskInstance,
  type ValidatorDiskReport,
  type ValidatorInstanceDto,
  type ValidatorOpsResponse,
  type ValidatorStatusResponse,
} from '../../features/validators';

const TABS = ['nodes', 'disk', 'about'] as const;

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(1)} GiB`;
}

export function ValidatorsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'nodes');
  const [instances, setInstances] = useState<ValidatorInstanceDto[]>([]);
  const [chains, setChains] = useState<ValidatorChainSpec[]>([]);
  const [disk, setDisk] = useState<ValidatorDiskReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState(0);
  const [chain, setChain] = useState('eth');
  const [network, setNetwork] = useState('hoodi');
  const [profile, setProfile] = useState('minimal');
  const [mainnetOk, setMainnetOk] = useState(false);
  const [el, setEl] = useState('reth');
  const [cl, setCl] = useState('lighthouse');
  const [mithril, setMithril] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ops, setOps] = useState<OpsResultLike | null>(null);
  const [detail, setDetail] = useState<ValidatorInstanceDto | null>(null);
  const [status, setStatus] = useState<ValidatorStatusResponse | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [clearText, setClearText] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const [list, diskRes, chainRes] = await Promise.all([
        validatorsApi.list(),
        validatorsApi.disk(),
        validatorsApi.chains(),
      ]);
      setInstances(list.instances ?? []);
      setDisk(diskRes.disk ?? null);
      setChains(chainRes.chains ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chainSpec = useMemo(() => chains.find((c) => c.id === chain), [chains, chain]);
  const netSpec = chainSpec?.networks.find((n) => n.id === network);
  const canCreate =
    Boolean(chainSpec && netSpec) && (netSpec?.kind !== 'mainnet' || mainnetOk);

  const openWizard = () => {
    setWizard(true);
    setStep(0);
    setChain('eth');
    setNetwork(chainSpec?.networks.find((n) => n.recommended)?.id ?? 'hoodi');
    setProfile('minimal');
    setMainnetOk(false);
    setEl('reth');
    setCl('lighthouse');
    setMithril(true);
    setOps(null);
  };

  const create = async (execute: boolean) => {
    setBusy(true);
    try {
      const r = await validatorsApi.create({
        chain,
        network,
        profile,
        el: chain === 'eth' ? el : undefined,
        cl: chain === 'eth' ? cl : undefined,
        mithril: chain === 'ada' ? mithril : undefined,
        execute,
      });
      setOps(toOps(r));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (fn: () => Promise<ValidatorOpsResponse>) => {
    setBusy(true);
    try {
      const r = await fn();
      setOps(toOps(r));
      await load();
      if (detail) {
        const st = await validatorsApi.status(detail.id);
        setStatus(st);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (row: ValidatorInstanceDto) => {
    setDetail(row);
    setClearText('');
    setLogs([]);
    try {
      const [st, lg] = await Promise.all([
        validatorsApi.status(row.id),
        validatorsApi.logs(row.id),
      ]);
      setStatus(st);
      setLogs(lg.lines ?? []);
    } catch {
      setStatus(null);
    }
  };

  const diskTone = disk?.tone === 'danger' ? 'danger' : disk?.tone === 'warn' ? 'warn' : 'ok';

  return (
    <FeaturePageLayout
      title={t('validators.title')}
      subtitle={t('validators.subtitle')}
      actions={
        <Button size="sm" onClick={() => void load()}>
          {t('validators.refresh')}
        </Button>
      }
      status={{
        pill: { label: t('validators.beta'), tone: 'warn' },
        items: [
          { label: t('validators.col.status'), value: String(instances.length) },
          {
            label: t('validators.disk.free'),
            value: formatBytes(disk?.availBytes),
            tone: diskTone,
          },
        ],
      }}
    >
      <SoftwareInstallBanner
        feature="docker"
        title={t('validators.errors.needDocker')}
        showReadyActions={false}
      />
      <PageTabs
        tabs={TABS.map((id) => ({ id, label: t(`validators.tab.${id}`) }))}
        active={tab}
        onChange={setTab}
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        {ops ? <OpsResultPanel title={t('validators.title')} result={ops} /> : null}

        {tab === 'nodes' ? (
          <DataTable<ValidatorInstanceDto>
            rowKey={(row) => row.id}
            toolbar={
              <Button variant="primary" onClick={openWizard}>
                {t('validators.create')}
              </Button>
            }
            empty={
              <EmptyState
                title={t('validators.empty.title')}
                description={t('validators.empty.desc')}
              />
            }
            columns={[
              { key: 'id', header: t('validators.col.id'), render: (row) => row.id },
              {
                key: 'chain',
                header: t('validators.col.chain'),
                render: (row) => t(`validators.chain.${row.chain}`),
              },
              {
                key: 'network',
                header: t('validators.col.network'),
                render: (row) => (
                  <span>
                    {t(`validators.network.${row.network}`)}{' '}
                    <Badge tone={row.network === 'mainnet' ? 'warn' : 'ok'}>
                      {row.network === 'mainnet'
                        ? t('validators.networkKind.mainnet')
                        : t('validators.networkKind.testnet')}
                    </Badge>
                  </span>
                ),
              },
              {
                key: 'profile',
                header: t('validators.col.profile'),
                render: (row) => t(`validators.profile.${row.profile}`),
              },
              {
                key: 'status',
                header: t('validators.col.status'),
                render: (row) => row.desiredState,
              },
            ]}
            rows={loading ? [] : instances}
            rowActions={(row) => (
              <>
                <Button size="sm" onClick={() => void openDetail(row)}>
                  {t('validators.actions.detail')}
                </Button>
                <Button size="sm" onClick={() => void runAction(() => validatorsApi.start(row.id))}>
                  {t('validators.actions.start')}
                </Button>
                <Button size="sm" onClick={() => void runAction(() => validatorsApi.stop(row.id))}>
                  {t('validators.actions.stop')}
                </Button>
              </>
            )}
          />
        ) : null}

        {tab === 'disk' ? (
          <>
            {disk?.tone === 'danger' ? (
              <Alert variant="error">{t('validators.disk.danger')}</Alert>
            ) : disk?.tone === 'warn' ? (
              <Alert variant="warn">{t('validators.disk.warn')}</Alert>
            ) : null}
            <dl className="desc-list">
              <div>
                <dt>{t('validators.disk.root')}</dt>
                <dd>
                  <code>{disk?.rootPath ?? '—'}</code>
                </dd>
              </div>
              <div>
                <dt>{t('validators.disk.used')}</dt>
                <dd>{formatBytes(disk?.usedBytes)}</dd>
              </div>
              <div>
                <dt>{t('validators.disk.free')}</dt>
                <dd>{formatBytes(disk?.availBytes)}</dd>
              </div>
            </dl>
            {disk?.instances.length ? (
              <DataTable<ValidatorDiskInstance>
                rowKey={(row) => row.id}
                columns={[
                  { key: 'id', header: t('validators.col.id'), render: (row) => row.id },
                  {
                    key: 'disk',
                    header: t('validators.col.disk'),
                    render: (row) => formatBytes(row.usedBytes),
                  },
                ]}
                rows={disk.instances}
              />
            ) : (
              <EmptyState title={t('validators.disk.none')} />
            )}
          </>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="validators" /> : null}
      </PageTabs>

      <Modal
        open={wizard}
        onClose={() => setWizard(false)}
        title={t('validators.wizard.title')}
        size="lg"
        footer={
          <>
            {step > 0 ? (
              <Button onClick={() => setStep((s) => s - 1)}>{t('validators.wizard.back')}</Button>
            ) : null}
            {step < 3 ? (
              <Button
                variant="primary"
                disabled={step === 1 && !canCreate}
                onClick={() => setStep((s) => s + 1)}
              >
                {t('validators.wizard.next')}
              </Button>
            ) : (
              <Button variant="primary" disabled={busy || !canCreate} onClick={() => void create(true)}>
                {t('validators.wizard.install')}
              </Button>
            )}
          </>
        }
      >
        {step === 0 ? (
          <>
            <SegRadio
              name="chain"
              value={chain}
              onChange={(v) => {
                setChain(v);
                const c = chains.find((x) => x.id === v);
                setNetwork(c?.networks.find((n) => n.recommended)?.id ?? c?.networks[0]?.id ?? '');
              }}
              options={(chains.length
                ? chains
                : [
                    { id: 'eth' },
                    { id: 'avax' },
                    { id: 'near' },
                    { id: 'ada' },
                    { id: 'btc' },
                    { id: 'cosmos' },
                    { id: 'sui' },
                    { id: 'aptos' },
                    { id: 'dot' },
                    { id: 'sol' },
                  ]
              ).map((c) => ({
                value: c.id,
                label: t(`validators.chain.${c.id}`),
              }))}
            />
            {chainSpec?.heavy ? <Alert variant="warn">{t('validators.wizard.heavyWarn')}</Alert> : null}
          </>
        ) : null}
        {step === 1 ? (
          <>
            <SegRadio
              name="network"
              value={network}
              onChange={setNetwork}
              options={(chainSpec?.networks ?? []).map((n) => ({
                value: n.id,
                label: t(`validators.network.${n.id}`),
              }))}
            />
            {netSpec?.kind === 'mainnet' ? (
              <>
                <Alert variant="warn">{t('validators.wizard.mainnetWarn')}</Alert>
                <Field htmlFor="val-mainnet-ack" label={t('validators.wizard.mainnetAck')}>
                  <input
                    id="val-mainnet-ack"
                    type="checkbox"
                    checked={mainnetOk}
                    onChange={(e) => setMainnetOk(e.target.checked)}
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
        {step === 2 ? (
          <>
            <SegRadio
              name="profile"
              value={profile}
              onChange={setProfile}
              options={['minimal', 'pruned', 'validator-ready', 'rpc'].map((p) => ({
                value: p,
                label: t(`validators.profile.${p}`),
              }))}
            />
            {chain === 'eth' ? (
              <>
                <Field htmlFor="val-el" label={t('validators.clients.el')}>
                  <select id="val-el" value={el} onChange={(e) => setEl(e.target.value)}>
                    {(chainSpec?.clients.filter((c) => c.role === 'el') ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field htmlFor="val-cl" label={t('validators.clients.cl')}>
                  <select id="val-cl" value={cl} onChange={(e) => setCl(e.target.value)}>
                    {(chainSpec?.clients.filter((c) => c.role === 'cl') ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}
            {chain === 'ada' ? (
              <Field htmlFor="val-mithril" label={t('validators.mithril.label')}>
                <input
                  id="val-mithril"
                  type="checkbox"
                  checked={mithril}
                  onChange={(e) => setMithril(e.target.checked)}
                />
              </Field>
            ) : null}
          </>
        ) : null}
        {step === 3 ? (
          <dl className="desc-list">
            <div>
              <dt>{t('validators.col.chain')}</dt>
              <dd>{t(`validators.chain.${chain}`)}</dd>
            </div>
            <div>
              <dt>{t('validators.col.network')}</dt>
              <dd>{t(`validators.network.${network}`)}</dd>
            </div>
            <div>
              <dt>{t('validators.col.profile')}</dt>
              <dd>{t(`validators.profile.${profile}`)}</dd>
            </div>
          </dl>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={detail?.id ?? ''}
        size="lg"
        footer={
          detail ? (
            <>
              <Button onClick={() => void runAction(() => validatorsApi.restart(detail.id))}>
                {t('validators.actions.restart')}
              </Button>
              <Button
                onClick={() => void runAction(() => validatorsApi.upgrade(detail.id))}
                disabled={!status?.upgrade}
              >
                {t('validators.actions.upgrade')}
              </Button>
              {detail.chain === 'ada' ? (
                <Button
                  onClick={() =>
                    void runAction(() => validatorsApi.mithril(detail.id, detail.id))
                  }
                >
                  {t('validators.mithril.action')}
                </Button>
              ) : null}
              <Button
                variant="danger"
                disabled={clearText !== detail.id && clearText.toUpperCase() !== 'CLEAR'}
                onClick={() =>
                  void runAction(() => validatorsApi.clear(detail.id, clearText)).then(() =>
                    setDetail(null),
                  )
                }
              >
                {t('validators.actions.clear')}
              </Button>
            </>
          ) : null
        }
      >
        {detail ? (
          <>
            <p className="u-text-sm">
              {status?.status ?? '—'} · {t('validators.col.disk')}{' '}
              {status?.syncProgress != null
                ? `${Math.round(status.syncProgress * 100)}%`
                : '—'}
            </p>
            {status?.upgrade ? (
              <Alert variant="info">
                {status.upgrade.clientId} {status.upgrade.currentTag} → {status.upgrade.nextTag}
              </Alert>
            ) : null}
            <Field htmlFor="val-policy" label={t('validators.policy.label')}>
              <select
                id="val-policy"
                value={detail.upgradePolicy}
                onChange={(e) => {
                  const v = e.target.value;
                  void validatorsApi.policy(detail.id, v).then(() => load());
                }}
              >
                {['manual', 'notify', 'auto-safe', 'auto-all'].map((p) => (
                  <option key={p} value={p}>
                    {t(`validators.policy.${p}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="val-clear" label={t('validators.actions.clearConfirm')}>
              <input
                id="val-clear"
                value={clearText}
                onChange={(e) => setClearText(e.target.value)}
              />
            </Field>
            <pre className="code-block">{logs.join('\n') || t('validators.logs.empty')}</pre>
          </>
        ) : null}
      </Modal>
    </FeaturePageLayout>
  );
}

function toOps(r: ValidatorOpsResponse): OpsResultLike {
  return {
    ok: r.ok,
    blocked: r.blocked,
    apply_status: r.apply_status as OpsResultLike['apply_status'],
    notes: r.notes ?? [],
    blockMessage: r.blockMessage,
  };
}
