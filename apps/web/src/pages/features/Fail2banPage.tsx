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
  PageTabs } from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ServiceLifecycleBar, systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
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

function isIpv4Octets(s: string): boolean {
  const parts = s.split('.');
  if (parts.length !== 4) return false;
  return parts.every((o) => {
    if (!/^\d{1,3}$/.test(o)) return false;
    const n = Number(o);
    return n >= 0 && n <= 255;
  });
}

function isIpv6Addr(s: string): boolean {
  if (!s || s.includes('%') || s.includes('/')) return false;
  if (!/^[0-9a-fA-F:]+$/.test(s)) return false;
  const halves = s.split('::');
  if (halves.length > 2) return false;
  const hexOk = (x: string) => !x || /^[0-9a-fA-F]{1,4}$/.test(x);
  if (halves.length === 1) {
    const segs = halves[0].split(':');
    return segs.length === 8 && segs.every(hexOk);
  }
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  return left.length + right.length < 8 && [...left, ...right].every(hexOk);
}

/** Strict IPv4 / IPv6 — rejects 999.999.999.999 and bare words. */
export function isValidBanIp(ip: string): boolean {
  const s = ip.trim();
  if (!s) return false;
  if (s.includes('.')) return isIpv4Octets(s);
  if (s.includes(':')) return isIpv6Addr(s);
  return false;
}

/** Ban IP or CIDR for ignoreip. */
export function isValidIgnoreIp(ip: string): boolean {
  const s = ip.trim();
  const slash = s.lastIndexOf('/');
  if (slash < 0) return isValidBanIp(s);
  const addr = s.slice(0, slash);
  const bits = Number(s.slice(slash + 1));
  if (!Number.isInteger(bits) || bits < 0) return false;
  if (isIpv4Octets(addr)) return bits <= 32;
  if (isIpv6Addr(addr)) return bits <= 128;
  return false;
}

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
  const [ignorePendingApply, setIgnorePendingApply] = useState(false);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

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

  function descFor(id: string): string {
    const raw = catalog.find((c) => c.id === id)?.desc;
    const key = raw?.startsWith('fail2ban.jail.') ? raw : `fail2ban.jail.${id}`;
    const translated = t(key, { defaultValue: '' });
    if (translated && translated !== key) return translated;
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
          label: status?.activeLabel ?? '—',
          tone: running ? 'ok' : status?.installed ? 'warn' : 'danger' },
        items: [
          {
            label: t('fail2ban.statCurrentBan'),
            value:
              status?.jails?.reduce((a, j) => a + (j.currentlyBanned ?? 0), 0) ?? 0 },
          {
            label: t('fail2ban.statTotal'),
            value: status?.jails?.reduce((a, j) => a + (j.totalBanned ?? 0), 0) ?? 0 },
          { label: 'Jail', value: status?.jails?.length ?? 0 },
          { label: t('fail2ban.statWhitelist'), value: status?.ignoreIps?.length ?? 0 },
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
            badge: banned.length || undefined },
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
                    onChange={bindInput(setBanIp)}
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
                  disabled={!isValidBanIp(banIp)}
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
                    clear={bindSet(setBanQ, '')}
                    searchPlaceholder="IP / jail"
                  />
                }
                columns={[
                  {
                    key: 'jail',
                    header: 'Jail',
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
                    async () => {
                      await refresh();
                      setIgnorePendingApply(false);
                    },
                    t('fail2ban.applyIgnoreipOk'),
                  )}
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
                description={t('fail2ban.ignoreipFile')}
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

        {tab === 'jails' ? (
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
                    description={c.desc}
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

        {tab === 'service' ? (
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
                danger="edge"
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

        {tab === 'stack' ? (
          <div className="tab-panel stack">
            <SoftwareInstallBanner feature="fail2ban" title={t('fail2ban.notInstalled')} showReadyActions={false} />
            <SoftwareVersionBar softwareId="fail2ban" />
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="fail2ban" /> : null}
      </PageTabs>

      <OpsResultPanel result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
