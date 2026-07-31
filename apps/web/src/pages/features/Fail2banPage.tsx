/**
 * fail2ban — log-driven temporary bans & jail policy.
 * Not UFW (ports) · Defense Center orchestrates both under attack.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  CheckboxField,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  ServerListFilters,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  SoftwareInstallBanner,
  PageTabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';

const F2B_TABS = ['bans', 'whitelist', 'jails', 'policy', 'service', 'about'] as const;

type F2bStatus = Awaited<ReturnType<typeof systemApi.fail2banStatus>>;

export function Fail2banPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(F2B_TABS, 'bans');
  const [status, setStatus] = useState<F2bStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bantime, setBantime] = useState('1h');
  const [findtime, setFindtime] = useState('10m');
  const [maxretry, setMaxretry] = useState(5);
  const [banIp, setBanIp] = useState('');
  const [banJail, setBanJail] = useState('sshd');
  const [ignoreIp, setIgnoreIp] = useState('');
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const catalog = status?.catalog ?? [];
  const jailOptions = useMemo(() => {
    if (catalog.length) return catalog.map((c) => c.id);
    return status?.defaultJails?.length
      ? status.defaultJails
      : ['sshd', 'nginx-http-auth', 'postfix', 'dovecot'];
  }, [catalog, status?.defaultJails]);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await systemApi.fail2banStatus();
      setStatus(s);
      setSelected((prev) => {
        if (prev.length) return prev;
        const live = s.jails?.map((j) => j.name) ?? [];
        if (live.length) return live;
        return (
          s.catalog?.slice(0, 4).map((c) => c.id) ?? [
            'sshd',
            'nginx-http-auth',
            'postfix',
            'dovecot',
          ]
        );
      });
      if (s.jails?.[0]?.name) setBanJail((j) => j || s.jails[0].name);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = status?.active === 'active';
  const [banQ, setBanQ] = useState('');
  const bannedAll = status?.banned ?? [];
  const banned = useMemo(() => {
    const n = banQ.trim().toLowerCase();
    if (!n) return bannedAll;
    return bannedAll.filter(
      (b) =>
        b.ip.toLowerCase().includes(n) ||
        b.jail.toLowerCase().includes(n),
    );
  }, [bannedAll, banQ]);

  function toggleJail(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  }

  function descFor(id: string): string | undefined {
    return catalog.find((c) => c.id === id)?.desc;
  }

  return (
    <FeaturePageLayout
      title={t('nav.fail2ban')}
      backTo="/protection"
      backLabel={t('fail2ban.backToProtection')}
      status={{
        pill: {
          label: status?.activeLabel ?? '—',
          tone: running ? 'ok' : status?.installed ? 'warn' : 'danger',
        },
        items: [
          {
            label: t('fail2ban.statCurrentBan'),
            value:
              status?.jails?.reduce((a, j) => a + (j.currentlyBanned ?? 0), 0) ?? 0,
          },
          {
            label: t('fail2ban.statTotal'),
            value: status?.jails?.reduce((a, j) => a + (j.totalBanned ?? 0), 0) ?? 0,
          },
          { label: 'Jail', value: status?.jails?.length ?? 0 },
          { label: t('fail2ban.statBanList'), value: banned.length },
          { label: 'ignoreip', value: status?.ignoreIps?.length ?? 0 },
          {
            label: t('fail2ban.statBoot'),
            value: status?.installed
              ? (status.enabled ?? '—')
              : t('common.notInstalled'),
          },
        ],
      }}
      actions={
        <div className="def-head-actions">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => {
              setError(null);
              setMsg(null);
              void refresh();
            }}
          >
            {t('common.refresh')}
          </Button>
          {status?.installed && !running ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = (await systemApi.fail2banService('enable')) as OpsResultLike;
                  await refresh();
                  return r;
                }, t('fail2ban.startedOk'))
              }
            >
              {t('fail2ban.startService')}
            </Button>
          ) : null}
        </div>
      }
    >
      <SoftwareInstallBanner feature="fail2ban" title={t('fail2ban.notInstalled')} />

      <Alert variant="info">
        <strong>{t('fail2ban.toolHintPrefix')}</strong> {t('fail2ban.toolHintBody')}
        <strong>{t('fail2ban.toolHintTemp')}</strong> {t('fail2ban.toolHintBody2')}{' '}
        <Link to="/protection">{t('nav.protection')}</Link>
        {' · '}
        <Link to="/protection/firewall">UFW</Link> = {t('fail2ban.toolHintUfw')}
      </Alert>

      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            {t('common.close')}
          </Button>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: 'bans',
            label: t('fail2ban.tabs.bans'),
            badge: banned.length || undefined,
          },
          {
            id: 'whitelist',
            label: t('fail2ban.tabs.whitelist'),
            badge: status?.ignoreIps?.length || undefined,
          },
          {
            id: 'jails',
            label: t('fail2ban.tabs.jails'),
            badge: status?.jails?.length || undefined,
          },
          { id: 'policy', label: t('fail2ban.tabs.policy') },
          { id: 'service', label: t('fail2ban.tabs.service') },
          { id: 'about', label: t('fail2ban.tabs.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'bans' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('fail2ban.manualBanTitle')}</h3>
              </div>
              <FormLayout columns={2}>
                <Field label="IP" htmlFor="f2b-ban-ip" flush required>
                  <input
                    id="f2b-ban-ip"
                    value={banIp}
                    onChange={(e) => setBanIp(e.target.value)}
                    placeholder={t('fail2ban.ipPlaceholder')}
                    spellCheck={false}
                  />
                </Field>
                <Field label="Jail" htmlFor="f2b-ban-jail" flush>
                  {(() => {
                    const jails = status?.jails?.length
                      ? status.jails.map((j) => j.name)
                      : jailOptions;
                    if (jails.length <= 10) {
                      return (
                        <SegRadio
                          name="f2b-ban-jail"
                          aria-label="Jail"
                          value={jails.includes(banJail) ? banJail : jails[0] ?? banJail}
                          onChange={setBanJail}
                          options={jails.map((j) => ({ value: j, label: j }))}
                        />
                      );
                    }
                    return (
                      <select
                        id="f2b-ban-jail"
                        value={banJail}
                        onChange={(e) => setBanJail(e.target.value)}
                      >
                        {jails.map((j) => (
                          <option key={j} value={j}>
                            {j}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="danger"
                  size="md"
                  loading={busy}
                  disabled={!banIp.trim()}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.fail2banBan(
                        banJail,
                        banIp.trim(),
                      )) as OpsResultLike;
                      setBanIp('');
                      await refresh();
                      return r;
                    }, t('fail2ban.banipOk'))
                  }
                >
                  banip
                </Button>
              </FormActions>
              <FormHint>{t('fail2ban.manualBanHint')}</FormHint>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">
                  {t('fail2ban.currentBans')}{' '}
                  <Badge tone="neutral">{banned.length}</Badge>
                </h3>
              </div>
              <DataTable
                title={t('fail2ban.bannedTableTitle')}
                description={t('fail2ban.bannedTableDesc')}
                filters={
                  <ServerListFilters
                    q={banQ}
                    setQ={setBanQ}
                    total={bannedAll.length}
                    shown={banned.length}
                    activeFilterCount={banQ.trim() ? 1 : 0}
                    clear={() => setBanQ('')}
                    searchPlaceholder="IP / jail"
                  />
                }
                columns={[
                  {
                    key: 'jail',
                    header: 'Jail',
                    nowrap: true,
                    render: (b) => <code className="inline">{b.jail}</code>,
                  },
                  {
                    key: 'ip',
                    header: 'IP',
                    render: (b) => <code className="inline">{b.ip}</code>,
                  },
                ]}
                rows={banned}
                rowKey={(b) => `${b.jail}-${b.ip}`}
                rowActions={(b) => (
                  <ActionBar align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void navigator.clipboard?.writeText(b.ip)}
                    >
                      {t('common.copy')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = (await systemApi.fail2banUnban(
                            b.jail,
                            b.ip,
                          )) as OpsResultLike;
                          await refresh();
                          return r;
                        }, t('fail2ban.unbanOk'))
                      }
                    >
                      {t('fail2ban.unban')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy}
                      title={t('fail2ban.addWhitelistTitle')}
                      onClick={() =>
                        void run(async () => {
                          const r = (await systemApi.fail2banIgnoreIp(
                            b.ip,
                            'add',
                          )) as OpsResultLike;
                          await refresh();
                          return r;
                        }, t('fail2ban.whitelistAdded'))
                      }
                    >
                      {t('fail2ban.addWhitelistShort')}
                    </Button>
                  </ActionBar>
                )}
                empty={
                  <EmptyState
                    title={t('fail2ban.emptyBansTitle')}
                    description={t('fail2ban.emptyBansDesc')}
                  />
                }
              />
            </div>
          </div>
        ) : null}

        {tab === 'whitelist' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <div>
                  <h3 className="def-section-head__title">
                    {t('fail2ban.ignoreipTitle')}
                  </h3>
                  <p className="def-section-head__desc">{t('fail2ban.ignoreipDesc')}</p>
                </div>
              </div>
              <FormLayout columns={2}>
                <Field label={t('fail2ban.addIp')} htmlFor="f2b-ignore" flush required>
                  <input
                    id="f2b-ignore"
                    value={ignoreIp}
                    onChange={(e) => setIgnoreIp(e.target.value)}
                    placeholder={t('fail2ban.ipPlaceholder')}
                    spellCheck={false}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!ignoreIp.trim()}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.fail2banIgnoreIp(
                        ignoreIp.trim(),
                        'add',
                      )) as OpsResultLike;
                      setIgnoreIp('');
                      await refresh();
                      return r;
                    }, t('fail2ban.whitelistAdded'))
                  }
                >
                  {t('fail2ban.addWhitelist')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  disabled={!selected.length}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.fail2banApply({
                        apply: true,
                        jails: selected,
                        bantime,
                        findtime,
                        maxretry,
                      })) as OpsResultLike;
                      await refresh();
                      return r;
                    }, t('fail2ban.applyIgnoreipOk'))
                  }
                >
                  {t('fail2ban.applyPolicyIgnoreip')}
                </Button>
              </FormActions>
              <FormHint>{t('fail2ban.ignoreipHint')}</FormHint>
              <DataTable
                className="u-mt-4"
                title={t('fail2ban.whitelistTitle', {
                  count: status?.ignoreIps?.length ?? 0,
                })}
                description="dataDir/fail2ban/ignoreip.txt"
                columns={[
                  {
                    key: 'ip',
                    header: 'IP',
                    render: (row) => <code className="inline">{row.ip}</code>,
                  },
                ]}
                rows={(status?.ignoreIps ?? []).map((ip) => ({ ip }))}
                rowKey={(row) => row.ip}
                rowActions={(row) => (
                  <ActionBar align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void navigator.clipboard?.writeText(row.ip)}
                    >
                      {t('common.copy')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      onClick={() =>
                        void run(async () => {
                          const r = (await systemApi.fail2banIgnoreIp(
                            row.ip,
                            'remove',
                          )) as OpsResultLike;
                          await refresh();
                          return r;
                        }, t('fail2ban.whitelistRemoved'))
                      }
                    >
                      {t('fail2ban.remove')}
                    </Button>
                  </ActionBar>
                )}
                empty={
                  <EmptyState
                    title={t('fail2ban.emptyWhitelistTitle')}
                    description={t('fail2ban.emptyWhitelistDesc')}
                  />
                }
              />
            </div>
          </div>
        ) : null}

        {tab === 'jails' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('fail2ban.activeJails')}</h3>
              </div>
              <DataTable
                columns={[
                  {
                    key: 'name',
                    header: 'Jail',
                    render: (j) => <code className="inline">{j.name}</code>,
                  },
                  {
                    key: 'currently',
                    header: t('fail2ban.colCurrent'),
                    nowrap: true,
                    render: (j) => j.currentlyBanned ?? '—',
                  },
                  {
                    key: 'total',
                    header: t('fail2ban.colTotal'),
                    nowrap: true,
                    render: (j) => j.totalBanned ?? '—',
                  },
                  {
                    key: 'desc',
                    header: t('fail2ban.colDesc'),
                    className: 'muted u-text-sm',
                    render: (j) => descFor(j.name) ?? '—',
                  },
                ]}
                rows={status?.jails ?? []}
                rowKey={(j) => j.name}
                empty={
                  <EmptyState
                    title={t('fail2ban.emptyJailsTitle')}
                    description={t('fail2ban.emptyJailsDesc')}
                  />
                }
              />
            </div>
          </div>
        ) : null}

        {tab === 'policy' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <div>
                  <h3 className="def-section-head__title">{t('fail2ban.policyTitle')}</h3>
                  <p className="def-section-head__desc">{t('fail2ban.policyDesc')}</p>
                </div>
              </div>
              <FormLayout columns={2}>
                <Field
                  label="bantime"
                  htmlFor="f2b-bt"
                  flush
                  hint={t('fail2ban.bantimeHint')}
                >
                  <PresetChips
                    options={[
                      { value: '10m', label: t('fail2ban.min', { n: 10 }) },
                      { value: '1h', label: t('fail2ban.hour', { n: 1 }) },
                      { value: '6h', label: t('fail2ban.hour', { n: 6 }) },
                      { value: '24h', label: t('fail2ban.hour', { n: 24 }) },
                      { value: '1w', label: t('fail2ban.week', { n: 1 }) },
                      { value: '3600', label: '3600s' },
                    ]}
                    value={bantime}
                    onChange={setBantime}
                    allowCustom
                    customPlaceholder={t('fail2ban.customExample2h')}
                  />
                </Field>
                <Field
                  label="findtime"
                  htmlFor="f2b-ft"
                  flush
                  hint={t('fail2ban.findtimeHint')}
                >
                  <PresetChips
                    options={[
                      { value: '5m', label: t('fail2ban.min', { n: 5 }) },
                      { value: '10m', label: t('fail2ban.min', { n: 10 }) },
                      { value: '30m', label: t('fail2ban.min', { n: 30 }) },
                      { value: '1h', label: t('fail2ban.hour', { n: 1 }) },
                      { value: '600', label: '600s' },
                    ]}
                    value={findtime}
                    onChange={setFindtime}
                    allowCustom
                    customPlaceholder={t('fail2ban.customExample15m')}
                  />
                </Field>
                <Field
                  label="maxretry"
                  htmlFor="f2b-mr"
                  flush
                  hint={t('fail2ban.maxretryHint')}
                >
                  <PresetChips
                    options={[
                      { value: '3', label: '3' },
                      { value: '5', label: '5' },
                      { value: '8', label: '8' },
                      { value: '10', label: '10' },
                      { value: '15', label: '15' },
                    ]}
                    value={String(maxretry)}
                    onChange={(v) =>
                      setMaxretry(Math.max(1, Math.min(50, Number(v) || 5)))
                    }
                    allowCustom
                    customPlaceholder={t('fail2ban.customMaxretry')}
                  />
                </Field>
              </FormLayout>
              <FormHint>{t('fail2ban.enableJailsHint')}</FormHint>
              <div className="form-check-row f2b-jail-grid">
                {(catalog.length
                  ? catalog
                  : jailOptions.map((id) => ({
                      id,
                      label: id,
                      desc: descFor(id) ?? '',
                      group: 'other',
                    }))
                ).map((c) => (
                  <CheckboxField
                    key={c.id}
                    id={`f2b-jail-${c.id}`}
                    label={c.label || c.id}
                    description={c.desc}
                    checked={selected.includes(c.id)}
                    onChange={() => toggleJail(c.id)}
                  />
                ))}
              </div>
              <FormActions>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  disabled={!selected.length}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.fail2banApply({
                        apply: false,
                        jails: selected,
                        bantime,
                        findtime,
                        maxretry,
                      })) as OpsResultLike;
                      return r;
                    }, t('fail2ban.writtenOnlyMsg'))
                  }
                >
                  {t('fail2ban.writeOnly')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!selected.length}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.fail2banApply({
                        apply: true,
                        jails: selected,
                        bantime,
                        findtime,
                        maxretry,
                      })) as OpsResultLike;
                      await refresh();
                      return r;
                    }, t('fail2ban.appliedOk'))
                  }
                >
                  {t('fail2ban.applyToSystem')}
                </Button>
              </FormActions>
            </div>
          </div>
        ) : null}

        {tab === 'service' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('fail2ban.systemdTitle')}</h3>
              </div>
              <div className="def-head-actions">
                {(
                  [
                    ['enable', t('fail2ban.enableAndStart')],
                    ['start', 'start'],
                    ['reload', 'reload'],
                    ['restart', 'restart'],
                    ['stop', 'stop'],
                  ] as const
                ).map(([action, label]) => (
                  <Button
                    key={action}
                    variant={action === 'stop' ? 'danger' : 'secondary'}
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      void run(async () => {
                        const r = (await systemApi.fail2banService(
                          action,
                        )) as OpsResultLike;
                        await refresh();
                        return r;
                      }, `systemctl ${action}`)
                    }
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <FormHint>
                {t('fail2ban.serviceHint')}{' '}
                <Link to="/protection">{t('nav.protection')}</Link>
                {t('fail2ban.serviceHintSuffix')}
              </FormHint>
            </div>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="fail2ban" /> : null}
      </PageTabs>

      <OpsResultPanel result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
