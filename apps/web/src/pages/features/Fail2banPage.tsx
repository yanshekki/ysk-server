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
  SoftwareVersionBar,
  ConfirmDialog,
  PageTabs } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ServiceLifecycleBar, systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { api } from '../../shared/services/api';
import { isCidr, isIpAddress } from 'ysk-server-shared';
import {
  collectHostIps,
  collectLoginIps,
  isProtectedSelfIp,
} from '../../shared/lib/self-ip';
import {
  bindSet,
  bindInput,
  bindToggleInList,
  bindChipNumber,
  bindRefreshClear,
  bindApiRefresh0,
  bindApiRefresh1,
  bindApiRefresh2,
  bindClipboard } from '../bind-handlers';

const F2B_TABS = ['bans', 'whitelist', 'jails', 'policy', 'service', 'stack', 'about'] as const;

type F2bStatus = Awaited<ReturnType<typeof systemApi.fail2banStatus>>;

const FALLBACK_JAILS = ['sshd', 'nginx-http-auth', 'postfix', 'dovecot'] as const;

/** Resolve jail option ids from catalog or defaults. */
export function resolveJailOptions(
  catalog: Array<{ id: string }> | undefined,
  defaultJails: string[] | undefined,
): string[] {
  if (catalog?.length) return catalog.map((c) => c.id);
  if (defaultJails?.length) return defaultJails;
  return [...FALLBACK_JAILS];
}

/** Initial jail multi-select from live status. */
export function initialSelectedJails(s: {
  jails?: Array<{ name: string }>;
  catalog?: Array<{ id: string }>;
}): string[] {
  const live = s.jails?.map((j) => j.name) ?? [];
  if (live.length) return live;
  return s.catalog?.slice(0, 4).map((c) => c.id) ?? [...FALLBACK_JAILS];
}

/** Header chip from machine state — never the server-localized `activeLabel`. */
export function fail2banStatusChipLabel(
  status: { installed?: boolean; active?: string } | null,
  t: (key: string) => string,
): string {
  if (!status) return '—';
  if (status.installed === false) return t('fail2ban.notInstalled');
  if (status.active === 'active') return t('common.running');
  return t('common.stopped');
}

/** Filter banned rows by free-text query (ip or jail). */
export function filterBannedRows<T extends { ip: string; jail: string }>(
  rows: T[],
  q: string,
): T[] {
  const n = q.trim().toLowerCase();
  if (!n) return rows;
  return rows.filter(
    (b) => b.ip.toLowerCase().includes(n) || b.jail.toLowerCase().includes(n),
  );
}

/** Badge tone for a fail2ban jail enabled flag. */
export function jailEnabledTone(enabled: boolean | undefined): 'ok' | 'neutral' | 'warn' {
  if (enabled === true) return 'ok';
  if (enabled === false) return 'warn';
  return 'neutral';
}

/** Normalize bantime / findtime preset strings. */
export function normalizeDurationPreset(raw: string, fallback = '1h'): string {
  const v = raw.trim();
  if (!v) return fallback;
  if (/^\d+[smhd]$/i.test(v)) return v.toLowerCase();
  if (/^\d+$/.test(v)) return `${v}s`;
  return fallback;
}

/** Clamp maxretry to a sane range. */
export function clampMaxretry(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 5;
  return Math.max(1, Math.min(50, Math.floor(n)));
}

/** Strict IPv4 / IPv6 — ident.ts isIpAddress (rejects 999.999.999.999). */
export function isValidBanIp(ip: string): boolean {
  return isIpAddress(ip);
}

/** Ban IP or CIDR for ignoreip. */
export function isValidIgnoreIp(ip: string): boolean {
  const s = ip.trim();
  return isIpAddress(s) || isCidr(s);
}

/** Active-ban census: banned list length, else jail currentlyBanned sum. */
export function fail2banBanCensus(status: {
  banned?: Array<unknown> | null;
  jails?: Array<{ currentlyBanned?: number }>;
} | null | undefined): number {
  if (!status) return 0;
  if (Array.isArray(status.banned)) return status.banned.length;
  return (status.jails ?? []).reduce((a, j) => a + (j.currentlyBanned ?? 0), 0);
}

export function Fail2banPage() {
  const { t } = useTranslation();
  const [tab, setTab, unknownTab] = usePageTab(F2B_TABS, 'bans');
  const panel = unknownTab ? null : tab;
  const [status, setStatus] = useState<F2bStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bantime, setBantime] = useState('1h');
  const [findtime, setFindtime] = useState('10m');
  const [maxretry, setMaxretry] = useState(5);
  const [banIp, setBanIp] = useState('');
  const [banJail, setBanJail] = useState('sshd');
  const [ignoreIp, setIgnoreIp] = useState('');
  const [ignorePendingApply, setIgnorePendingApply] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState(false);
  const [hostIps, setHostIps] = useState<string[]>([]);
  const [loginIps, setLoginIps] = useState<string[]>([]);
  const { busy, error, result, msg, run: runRaw, setMsg, setError } = useFeatureAction();
  const [resultTab, setResultTab] = useState<string | null>(null);
  const run: typeof runRaw = useCallback(
    (fn, okMessage) => {
      setResultTab(tab);
      return runRaw(fn, okMessage);
    },
    [runRaw, tab],
  );
  useEffect(() => {
    setResultTab((prev) => (prev == null || prev === tab ? prev : null));
  }, [tab]);

  const catalog = status?.catalog ?? [];
  const jailOptions = useMemo(
    () => resolveJailOptions(catalog, status?.defaultJails),
    [catalog, status?.defaultJails],
  );

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await systemApi.fail2banStatus();
      setStatus(s);
      setSelected((prev) => (prev.length ? prev : initialSelectedJails(s)));
      if (s.jails?.[0]?.name) setBanJail((j) => j || s.jails[0].name);
      try {
        const host = await api.requestRaw<{ network?: { ips?: string[] } }>(
          '/api/v1/system/host',
        );
        setHostIps(collectHostIps(host));
      } catch {
        /* optional */
      }
      try {
        const ses = await api.listSessions();
        setLoginIps(collectLoginIps(ses.items));
      } catch {
        /* optional */
      }
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
  const banned = useMemo(() => filterBannedRows(bannedAll, banQ), [bannedAll, banQ]);
  const banCensus = fail2banBanCensus(status);
  const selfIpOpts = useMemo(
    () => ({
      hostIps,
      loginIps,
      ignoreIps: status?.ignoreIps ?? [],
    }),
    [hostIps, loginIps, status?.ignoreIps],
  );
  const suggestedIgnore = useMemo(() => {
    const have = new Set((status?.ignoreIps ?? []).map((x) => x.trim()));
    return [...new Set([...hostIps, ...loginIps])].filter(
      (ip) =>
        ip &&
        !have.has(ip) &&
        !ip.startsWith('127.') &&
        !ip.toLowerCase().startsWith('fe80:'),
    );
  }, [hostIps, loginIps, status?.ignoreIps]);

  function descFor(id: string): string {
    const raw = catalog.find((c) => c.id === id)?.desc;
    const camel = id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const keys = [
      raw?.startsWith('fail2ban.jail.') ? raw : '',
      `fail2ban.jail.${camel}`,
      `fail2ban.jail.${id}`,
    ].filter(Boolean);
    for (const key of keys) {
      const translated = t(key, { defaultValue: '' });
      if (translated && translated !== key) return translated;
    }
    if (raw && !raw.startsWith('fail2ban.jail.')) return raw;
    return '—';
  }

  return (
    <FeaturePageLayout
      title={t('nav.fail2ban')}
      backTo="/protection"
      backLabel={t('fail2ban.backToProtection')}
      status={{
        pill: {
          label: fail2banStatusChipLabel(status, t),
          tone: running ? 'ok' : status?.installed ? 'warn' : 'danger' },
        items: [
          {
            label: t('fail2ban.statCurrentBan'),
            value: banCensus },
          {
            label: t('fail2ban.statTotal'),
            value: status?.jails?.reduce((a, j) => a + (j.totalBanned ?? 0), 0) ?? 0 },
          { label: 'Jail', value: status?.jails?.length ?? 0 },
          {
            label: t('fail2ban.statWhitelist'),
            value: status?.ignoreIps?.length ?? 0,
            tone: (status?.ignoreIps?.length ?? 0) === 0 ? 'warn' : 'ok',
            hint:
              (status?.ignoreIps?.length ?? 0) === 0
                ? t('fail2ban.whitelistEmptyWarn')
                : undefined,
          },
          {
            label: t('fail2ban.statBoot'),
            value: status?.installed
              ? status.enabled === 'enabled'
                ? t('common.enabled')
                : status.enabled === 'disabled'
                  ? t('common.disabled')
                  : t('services.bootEnabled', { defaultValue: String(status.enabled ?? '—') })
              : t('common.notInstalled') },
        ] }}
      actions={
        <div className="def-head-actions">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={bindRefreshClear(setError, setMsg, refresh)}
          >
            {t('common.refresh')}
          </Button>
          {status?.installed && !running ? (
            <Button
              variant="primary"
              size="sm"
              loading={busy}
              onClick={bindApiRefresh1(
                run,
                systemApi.fail2banService,
                'enable',
                refresh,
                t('fail2ban.startedOk'),
              )}
            >
              {t('fail2ban.startService')}
            </Button>
          ) : null}
        </div>
      }
    >
      <Alert variant="info">
        {t('fail2ban.toolHintBody')}{' '}
        <Link to="/protection">{t('nav.protection')}</Link>
        {' · '}
        <Link to="/protection/firewall">UFW</Link>
        {' '}
        {t('fail2ban.toolHintUfw')}
      </Alert>

      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      <PageTabs
        tabs={[
          {
            id: 'bans',
            label: t('fail2ban.tabs.bans'),
            badge: banCensus || undefined },
          {
            id: 'whitelist',
            label: t('fail2ban.tabs.whitelist'),
            badge: status?.ignoreIps?.length || undefined },
          {
            id: 'jails',
            label: t('fail2ban.tabs.jails'),
            badge: status?.jails?.length || undefined },
          { id: 'policy', label: t('fail2ban.tabs.policy') },
          { id: 'service', label: t('fail2ban.tabs.service') },
          { id: 'stack', label: t('tabs.stack') },
          { id: 'about', label: t('fail2ban.tabs.about') },
        ]}
        active={unknownTab ? '' : tab}
        onChange={setTab}
        variant="scroll"
      >
        {unknownTab ? (
          <div className="tab-panel">
            <EmptyState
              title={t('tabs.unknown')}
              description={t('tabs.unknownHint', { tab: unknownTab })}
            />
          </div>
        ) : null}
        {panel === 'bans' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('fail2ban.manualBanTitle')}</h3>
              </div>
              <FormLayout columns={2}>
                <Field
                  label="IP"
                  htmlFor="f2b-ban-ip"
                  flush
                  required
                  error={
                    banIp.trim() && !isValidBanIp(banIp)
                      ? t('fail2ban.invalidIp')
                      : undefined
                  }
                >
                  <input
                    id="f2b-ban-ip"
                    value={banIp}
                    onChange={bindInput(setBanIp)}
                    placeholder={t('fail2ban.ipPlaceholder')}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('fail2ban.colJail')} htmlFor="f2b-ban-jail" flush>
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
                        onChange={bindInput(setBanJail)}
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
                  disabled={
                    !isValidBanIp(banIp) ||
                    isProtectedSelfIp(banIp.trim(), selfIpOpts)
                  }
                  title={
                    isProtectedSelfIp(banIp.trim(), selfIpOpts)
                      ? t('fail2ban.cannotBanSelf')
                      : undefined
                  }
                  onClick={bindApiRefresh2(
                    run,
                    systemApi.fail2banBan,
                    banJail,
                    banIp.trim(),
                    refresh,
                    t('fail2ban.banipOk'),
                    setBanIp,
                  )}
                >
                  {t('protection.ban')}
                </Button>
              </FormActions>
              <FormHint>{t('fail2ban.manualBanHint')}</FormHint>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">
                  {t('fail2ban.currentBans')}{' '}
                  <Badge tone="neutral">{banCensus}</Badge>
                </h3>
              </div>
              <DataTable
                title={t('fail2ban.bannedTableTitle')}
                description={t('fail2ban.bannedTableDesc')}
                filters={
                  <ServerListFilters
                    q={banQ}
                    setQ={setBanQ}
                    total={banCensus}
                    shown={banned.length}
                    activeFilterCount={banQ.trim() ? 1 : 0}
                    clear={bindSet(setBanQ, '')}
                    searchPlaceholder="IP / jail"
                  />
                }
                columns={[
                  {
                    key: 'jail',
                    header: t('fail2ban.colJail'),
                    nowrap: true,
                    render: (b) => <code className="inline">{b.jail}</code> },
                  {
                    key: 'ip',
                    header: 'IP',
                    render: (b) => <code className="inline">{b.ip}</code> },
                ]}
                rows={banned}
                rowKey={(b) => `${b.jail}-${b.ip}`}
                rowActions={(b) => (
                  <ActionBar align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={bindClipboard(b.ip)}
                    >
                      {t('common.copy')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={busy}
                      onClick={bindApiRefresh2(
                        run,
                        systemApi.fail2banUnban,
                        b.jail,
                        b.ip,
                        refresh,
                        t('fail2ban.unbanOk'),
                      )}
                    >
                      {t('fail2ban.unban')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy}
                      title={t('fail2ban.addWhitelistTitle')}
                      onClick={bindApiRefresh2(
                        run,
                        systemApi.fail2banIgnoreIp,
                        b.ip,
                        'add',
                        refresh,
                        t('fail2ban.whitelistAdded'),
                      )}
                    >
                      {t('fail2ban.addWhitelistShort')}
                    </Button>
                  </ActionBar>
                )}
                filterActive={Boolean(banQ.trim())}
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

        {panel === 'whitelist' ? (
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
              {(status?.ignoreIps?.length ?? 0) === 0 ? (
                <Alert variant="warn">{t('fail2ban.whitelistEmptyWarn')}</Alert>
              ) : null}
              {suggestedIgnore.length ? (
                <Alert variant="info">
                  <p className="u-mt-0 u-mb-2">{t('fail2ban.suggestIgnoreHint')}</p>
                  <ActionBar>
                    {suggestedIgnore.map((ip) => (
                      <Button
                        key={ip}
                        variant="secondary"
                        size="sm"
                        loading={busy}
                        onClick={async () => {
                          await bindApiRefresh2(
                            run,
                            systemApi.fail2banIgnoreIp,
                            ip,
                            'add',
                            refresh,
                            t('fail2ban.whitelistAdded'),
                          )();
                          setIgnorePendingApply(true);
                        }}
                      >
                        {loginIps.includes(ip)
                          ? t('fail2ban.suggestIgnoreLogin', { ip })
                          : t('fail2ban.suggestIgnoreAdd', { ip })}
                      </Button>
                    ))}
                  </ActionBar>
                </Alert>
              ) : null}
              <FormLayout columns={2}>
                <Field
                  label={t('fail2ban.addIp')}
                  htmlFor="f2b-ignore"
                  flush
                  required
                  error={
                    ignoreIp.trim() && !isValidIgnoreIp(ignoreIp)
                      ? t('fail2ban.invalidIp')
                      : undefined
                  }
                >
                  <input
                    id="f2b-ignore"
                    value={ignoreIp}
                    onChange={bindInput(setIgnoreIp)}
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
                  disabled={!isValidIgnoreIp(ignoreIp)}
                  onClick={async () => {
                    await bindApiRefresh2(
                      run,
                      systemApi.fail2banIgnoreIp,
                      ignoreIp.trim(),
                      'add',
                      refresh,
                      t('fail2ban.whitelistAdded'),
                      setIgnoreIp,
                    )();
                    setIgnorePendingApply(true);
                  }}
                >
                  {t('fail2ban.addWhitelist')}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  disabled={!selected.length || (status?.ignoreIps?.length ?? 0) === 0}
                  title={
                    (status?.ignoreIps?.length ?? 0) === 0
                      ? t('fail2ban.applyIgnoreEmptyWarn')
                      : t('fail2ban.applyIgnoreNeedConfirm')
                  }
                  data-confirm="ignoreip"
                  onClick={() => setApplyConfirm(true)}
                >
                  {t('fail2ban.applyPolicyIgnoreip')}
                </Button>
              </FormActions>
              {ignorePendingApply ? (
                <Alert variant="warn">{t('fail2ban.whitelistPendingApply')}</Alert>
              ) : null}
              <FormHint>{t('fail2ban.ignoreipHint')}</FormHint>
              <DataTable
                className="u-mt-4"
                title={t('fail2ban.whitelistTitle', {
                  count: status?.ignoreIps?.length ?? 0 })}
                description={status?.ignoreipFile || t('fail2ban.ignoreipFile')}
                columns={[
                  {
                    key: 'ip',
                    header: 'IP',
                    render: (row) => <code className="inline">{row.ip}</code> },
                ]}
                rows={(status?.ignoreIps ?? []).map((ip) => ({ ip }))}
                rowKey={(row) => row.ip}
                rowActions={(row) => (
                  <ActionBar align="end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={bindClipboard(row.ip)}
                    >
                      {t('common.copy')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      loading={busy}
                      onClick={bindApiRefresh2(
                        run,
                        systemApi.fail2banIgnoreIp,
                        row.ip,
                        'remove',
                        refresh,
                        t('fail2ban.whitelistRemoved'),
                      )}
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

        <ConfirmDialog
          open={applyConfirm}
          onClose={() => setApplyConfirm(false)}
          onConfirm={() => {
            setApplyConfirm(false);
            void bindApiRefresh1(
              run,
              systemApi.fail2banApply,
              {
                apply: true,
                jails: selected,
                bantime: normalizeDurationPreset(bantime, '1h'),
                findtime: normalizeDurationPreset(findtime, '10m'),
                maxretry: clampMaxretry(maxretry),
              },
              async () => {
                await refresh();
                setIgnorePendingApply(false);
              },
              t('fail2ban.applyIgnoreipOk'),
            )();
          }}
          title={t('fail2ban.applyPolicyIgnoreip')}
          dataConfirm="ignoreip"
          description={
            (status?.ignoreIps?.length ?? 0) === 0
              ? t('fail2ban.applyIgnoreEmptyWarn')
              : t('fail2ban.applyIgnoreNeedConfirm')
          }
          confirmLabel={t('fail2ban.applyPolicyIgnoreip')}
          danger={(status?.ignoreIps?.length ?? 0) === 0}
        />

        {panel === 'jails' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('fail2ban.activeJails')}</h3>
                <p className="def-section-head__desc">{t('fail2ban.jailsTabHint')}</p>
              </div>
              <DataTable
                columns={[
                  {
                    key: 'name',
                    header: t('fail2ban.colJail'),
                    render: (j) => <code className="inline">{j.name}</code> },
                  {
                    key: 'enabled',
                    header: t('fail2ban.colEnabled'),
                    nowrap: true,
                    render: (j) => (
                      <Badge tone={jailEnabledTone((j as { enabled?: boolean }).enabled)}>
                        {(j as { enabled?: boolean }).enabled === false
                          ? t('common.off')
                          : t('common.on')}
                      </Badge>
                    ) },
                  {
                    key: 'currently',
                    header: t('fail2ban.colCurrent'),
                    nowrap: true,
                    render: (j) => j.currentlyBanned ?? '—' },
                  {
                    key: 'total',
                    header: t('fail2ban.colTotal'),
                    nowrap: true,
                    render: (j) => j.totalBanned ?? '—' },
                  {
                    key: 'desc',
                    header: t('fail2ban.colDesc'),
                    className: 'muted u-text-sm',
                    render: (j) => descFor(j.name) ?? '—' },
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

        {panel === 'policy' ? (
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
                    onChange={bindChipNumber(setMaxretry, 5, 1, 50)}
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
                      group: 'other' }))
                ).map((c) => (
                  <CheckboxField
                    key={c.id}
                    id={`f2b-jail-${c.id}`}
                    label={c.label || c.id}
                    description={descFor(c.id)}
                    checked={selected.includes(c.id)}
                    onChange={bindToggleInList(setSelected, c.id)}
                  />
                ))}
              </div>
              <FormActions>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  disabled={!selected.length}
                  onClick={bindApiRefresh1(
                    run,
                    systemApi.fail2banApply,
                    {
                      apply: false,
                      jails: selected,
                      bantime: normalizeDurationPreset(bantime, '1h'),
                      findtime: normalizeDurationPreset(findtime, '10m'),
                      maxretry: clampMaxretry(maxretry) },
                    null,
                    t('fail2ban.writtenOnlyMsg'),
                  )}
                >
                  {t('fail2ban.writeOnly')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!selected.length}
                  onClick={bindApiRefresh1(
                    run,
                    systemApi.fail2banApply,
                    {
                      apply: true,
                      jails: selected,
                      bantime: normalizeDurationPreset(bantime, '1h'),
                      findtime: normalizeDurationPreset(findtime, '10m'),
                      maxretry: clampMaxretry(maxretry) },
                    refresh,
                    t('fail2ban.appliedOk'),
                  )}
                >
                  {t('fail2ban.applyToSystem')}
                </Button>
              </FormActions>
            </div>
          </div>
        ) : null}

        {panel === 'service' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('fail2ban.systemdTitle')}</h3>
                <p className="def-section-head__desc">
                  {t('fail2ban.serviceStateLine', {
                    unit: 'fail2ban',
                    state: running ? t('common.running') : t('common.stopped'),
                    boot:
                      status?.enabled === 'enabled'
                        ? t('common.enabled')
                        : t('common.disabled'),
                  })}
                </p>
              </div>
              <ServiceLifecycleBar
                unit="fail2ban"
                label="fail2ban"
                installed={Boolean(status?.installed)}
                running={running}
                actions={['start', 'stop', 'restart', 'reload']}
                danger="fail2ban"
                onDone={refresh}
              />
              {!running && status?.installed ? (
                <FormActions>
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    onClick={bindApiRefresh1(
                      run,
                      systemApi.fail2banService,
                      'enable',
                      refresh,
                      t('fail2ban.actionOk.enable'),
                    )}
                  >
                    {t('fail2ban.enableAndStart')}
                  </Button>
                </FormActions>
              ) : null}
              <FormHint>
                {t('fail2ban.serviceHint')}{' '}
                <Link to="/protection">{t('nav.protection')}</Link>
                {t('fail2ban.serviceHintSuffix')}
              </FormHint>
            </div>
          </div>
        ) : null}

        {panel === 'stack' ? (
          <div className="tab-panel stack">
            <SoftwareInstallBanner feature="fail2ban" title={t('fail2ban.notInstalled')} showReadyActions={false} />
            <SoftwareVersionBar softwareId="fail2ban" />
          </div>
        ) : null}

        {panel === 'about' ? <PageGuide guideId="fail2ban" /> : null}
      </PageTabs>

      {result && resultTab === tab ? (
        <OpsResultPanel result={result} message={msg} busy={busy} />
      ) : null}
    </FeaturePageLayout>
  );
}
