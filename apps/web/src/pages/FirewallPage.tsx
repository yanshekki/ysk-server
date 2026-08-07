/**
 * Firewall (UFW) — port policy & permanent deny.
 * Not fail2ban (log bans) · not Defense Center (attack orchestration).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  listFirewallPortChips,
  parsePortChipValue,
} from '@ysk/shared';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  PresetChips,
  SegRadio,
  SoftwareInstallBanner,
  PageTabs,
  ConfirmDialog,
  ServerListFilters,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { useCapabilities } from '../../shared/hooks/useCapabilities';
import { bindSet, bindInput, bindCheck, bindCall1 } from '../bind-handlers';

const FW_TABS = ['rules', 'ports', 'deny', 'profiles', 'about'] as const;

type FwStatus = Awaited<ReturnType<typeof systemApi.firewallStatus>>;

const PROFILE_DEFS = [
  { id: 'web' as const, allowSmtp: false, extra: '' },
  { id: 'mail' as const, allowSmtp: true, extra: '' },
  { id: 'ftps' as const, allowSmtp: false, extra: '21,30000:30100' },
];

/** YSK service ports for open-port chips (SSOT from @ysk/shared). */
const SERVICE_PORT_CHIPS = listFirewallPortChips();

/**
 * Expand "21,30000:30100" into port numbers for legacy planFirewall(extraTcpPorts).
 * Cap at 200 ports (matches firewallAllowPort range limit) so FTPS PASV 30000–30100
 * is fully covered — previously capped at 40 and dropped most PASV ports.
 */
export function parsePorts(extraPorts: string): number[] {
  const out: number[] = [];
  const maxPorts = 200;
  for (const part of extraPorts.split(/[,\s]+/).filter(Boolean)) {
    if (out.length >= maxPorts) break;
    if (part.includes(':')) {
      const [a, b] = part.split(':').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let p = Math.min(a, b); p <= Math.max(a, b) && out.length < maxPorts; p++)
          out.push(p);
      }
    } else {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0 && n < 65536) out.push(n);
    }
  }
  return [...new Set(out)].slice(0, maxPorts);
}

/** Badge tone for a UFW rule action string. */
export function firewallActionTone(
  action: string | undefined,
): 'ok' | 'danger' | 'neutral' {
  if (!action) return 'neutral';
  if (/DENY|REJECT/i.test(action)) return 'danger';
  if (/ALLOW/i.test(action)) return 'ok';
  return 'neutral';
}

/** Active pill tone from UFW status. */
export function firewallActiveTone(
  active: boolean,
  installed: boolean | undefined,
): 'ok' | 'warn' | 'danger' {
  if (active) return 'ok';
  if (installed) return 'warn';
  return 'danger';
}

/**
 * Normalize port input for allow-port.
 * Accepts `80`, `80/tcp`, `30000:30100`, `30000:30100/tcp`.
 * Returns a UFW-friendly port string (single or range), not only a number.
 */
export function parsePortInput(raw: string): string | null {
  const parsed = parsePortChipValue(raw);
  if (!parsed) return null;
  return parsed.from === parsed.to
    ? String(parsed.from)
    : `${parsed.from}:${parsed.to}`;
}

/** @deprecated use parsePortInput — kept for tests expecting number|null on plain digits */
export function parsePortInputNumber(raw: string): number | null {
  const p = parsePortChipValue(raw);
  if (!p || p.from !== p.to) return null;
  return p.from;
}

/** Whether a deny IP string looks usable. */
export function isValidDenyIp(ip: string): boolean {
  const s = ip.trim();
  if (!s) return false;
  return /^[\d.a-fA-F:/]+$/.test(s) && s.length >= 3;
}

/** Map raw rule rows into table-friendly shape. */
export function mapFirewallRules(
  rules:
    | Array<{
        num?: number;
        action?: string;
        to?: string;
        from?: string;
        raw?: string;
      }>
    | undefined,
  numbered:
    | Array<{
        num?: number;
        action?: string;
        to?: string;
        from?: string;
        raw?: string;
      } | string>
    | undefined,
): Array<{
  num: number | undefined;
  action: string;
  to: string;
  from: string;
  raw: string;
}> {
  if (rules?.length) {
    return rules.map((r) => ({
      num: r.num,
      action: r.action ?? '?',
      to: r.to ?? r.raw ?? '—',
      from: r.from ?? '—',
      raw: r.raw ?? `${r.num ?? ''}`,
    }));
  }
  return (numbered ?? []).map((raw) => {
    if (typeof raw === 'string') {
      return {
        num: undefined as number | undefined,
        action: '?',
        to: raw,
        from: '—',
        raw,
      };
    }
    return {
      num: raw.num,
      action: raw.action ?? '?',
      to: raw.to ?? raw.raw ?? '—',
      from: raw.from ?? '—',
      raw: raw.raw ?? `${raw.num ?? ''}`,
    };
  });
}

export function FirewallPage() {
  const { t } = useTranslation();
  const { can } = useCapabilities();
  const canEdit = can('firewall.edit');
  const canFlush = can('firewall.flush');
  const [tab, setTab] = usePageTab(FW_TABS, 'rules');
  const [status, setStatus] = useState<FwStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extraPorts, setExtraPorts] = useState('21,30000:30100');
  const [allowSmtp, setAllowSmtp] = useState(false);
  const [denyIp, setDenyIp] = useState('');
  const [portInput, setPortInput] = useState('80/tcp');
  const [portProto, setPortProto] = useState<'tcp' | 'udp' | 'both'>('tcp');

  const onPortChipChange = useCallback((v: string) => {
    setPortInput(v);
    const parsed = parsePortChipValue(v);
    // Chip may pin tcp/udp; leave "both" when user already chose it unless chip specifies
    if (parsed?.proto) setPortProto(parsed.proto);
  }, []);
  const [delRuleNum, setDelRuleNum] = useState<number | null>(null);
  const [ruleQ, setRuleQ] = useState('');
  const [debouncedRuleQ, setDebouncedRuleQ] = useState('');
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  useEffect(() => {
    const tmr = window.setTimeout(() => setDebouncedRuleQ(ruleQ.trim()), 300);
    return () => window.clearTimeout(tmr);
  }, [ruleQ]);

  const profiles = useMemo(
    () =>
      PROFILE_DEFS.map((p) => ({
        ...p,
        label: t(`firewall.profiles.${p.id}.label`),
        short: t(`firewall.profiles.${p.id}.short`),
      })),
    [t],
  );

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const q = debouncedRuleQ
        ? `?q=${encodeURIComponent(debouncedRuleQ)}`
        : '';
      // Prefer query-aware GET when searching
      if (q) {
        const { api } = await import('../../shared/services/api');
        setStatus(
          await api.requestRaw(`/api/v1/system/firewall/status${q}`),
        );
      } else {
        setStatus(await systemApi.firewallStatus());
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t, debouncedRuleQ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = status?.active === 'active';
  const tableRules = useMemo(
    () => mapFirewallRules(status?.rules, status?.numberedRules as never),
    [status?.rules, status?.numberedRules],
  );

  async function applyProfile(p: (typeof profiles)[number]) {
    await run(async () => {
      const r = (await systemApi.firewallApply({
        allowSmtp: p.allowSmtp,
        apply: true,
        extraTcpPorts: parsePorts(p.extra),
      })) as OpsResultLike;
      await refresh();
      return r;
    }, t('firewall.appliedProfile', { label: p.label }));
  }

  return (
    <FeaturePageLayout
      title={t('nav.firewall')}
      backTo="/protection"
      backLabel={t('firewall.backToProtection')}
      status={{
        pill: {
          label: status?.activeLabel ?? '—',
          tone: firewallActiveTone(active, status?.installed),
        },
        items: [
          {
            label: t('firewall.statRules'),
            value: status?.rules?.length ?? status?.numberedRules?.length ?? 0,
          },
          {
            label: t('firewall.statDenyIps'),
            value: status?.denyFromIps?.length ?? 0,
          },
          {
            label: t('firewall.statAllow'),
            value: status?.allowCount ?? 0,
          },
          {
            label: t('firewall.statDeny'),
            value: status?.denyCount ?? 0,
          },
          {
            label: t('firewall.statDefaultIn'),
            value: status?.defaultIncoming ?? '—',
          },
          {
            label: 'EXECUTE',
            value: status?.executeEnabled
              ? t('firewall.executeOn')
              : t('firewall.executeOff'),
            tone: status?.executeEnabled ? 'ok' : 'warn',
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
          {status?.installed && canFlush ? (
            <Button
              variant={active ? 'ghost' : 'primary'}
              size="sm"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = (await systemApi.firewallEnable(!active)) as OpsResultLike;
                  await refresh();
                  return r;
                }, active ? t('firewall.ufwDisabled') : t('firewall.ufwEnabled'))
              }
            >
              {active ? t('firewall.disableUfw') : t('firewall.enableUfw')}
            </Button>
          ) : null}
        </div>
      }
    >
      <SoftwareInstallBanner feature="firewall" title={t('firewall.notInstalled')} />

      <div className="stack-role">
        <Alert variant="info">
          <strong>{t('firewall.toolHintPrefix')}</strong> {t('firewall.toolHintBody')}{' '}
          <Link to="/protection">{t('nav.protection')}</Link>
          {' · '}
          <Link to="/protection/fail2ban">fail2ban</Link> = {t('firewall.toolHintFail2ban')}
        </Alert>
      </div>

      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {!status?.executeEnabled ? (
        <Alert variant="info">{t('firewall.executeOffHint')}</Alert>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: 'rules',
            label: t('firewall.tabs.rules'),
            badge: status?.rules?.length || status?.numberedRules?.length || undefined,
          },
          { id: 'ports', label: t('firewall.tabs.ports') },
          {
            id: 'deny',
            label: t('firewall.tabs.deny'),
            badge: status?.denyFromIps?.length || undefined,
          },
          { id: 'profiles', label: t('firewall.tabs.profiles') },
          { id: 'about', label: t('firewall.tabs.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'rules' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('firewall.currentRules')}</h3>
                <span className="muted u-text-sm">{t('firewall.rulesSourceHint')}</span>
              </div>
              <DataTable
                filters={
                  <ServerListFilters
                    q={ruleQ}
                    setQ={setRuleQ}
                    searching={Boolean(ruleQ && ruleQ !== debouncedRuleQ)}
                    loading={busy}
                    total={
                      (status as { rulesMeta?: { total?: number } } | null)?.rulesMeta
                        ?.total ??
                      status?.numberedRules?.length ??
                      0
                    }
                    shown={status?.numberedRules?.length ?? 0}
                    activeFilterCount={ruleQ.trim() ? 1 : 0}
                    clear={() => {
                      setRuleQ('');
                      setDebouncedRuleQ('');
                    }}
                  />
                }
                columns={[
                  {
                    key: 'num',
                    header: '#',
                    className: 'muted',
                    nowrap: true,
                    render: (r) => r.num ?? '—',
                  },
                  {
                    key: 'action',
                    header: t('firewall.colAction'),
                    nowrap: true,
                    render: (r) => (
                      <Badge tone={firewallActionTone(r.action)}>{r.action}</Badge>
                    ),
                  },
                  {
                    key: 'to',
                    header: t('firewall.colTo'),
                    render: (r) => <code className="inline">{r.to ?? r.raw}</code>,
                  },
                  {
                    key: 'from',
                    header: t('firewall.colFrom'),
                    className: 'u-text-sm',
                    render: (r) => r.from ?? '—',
                  },
                ]}
                rows={tableRules}
                rowKey={(r, i) => r.raw + i}
                rowActions={(r) =>
                  r.num ? (
                    <ActionBar align="end">
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() => setDelRuleNum(r.num!)}
                      >
                        {t('common.delete')}
                      </Button>
                    </ActionBar>
                  ) : null
                }
                empty={
                  <EmptyState
                    title={t('firewall.emptyRulesTitle')}
                    description={
                      status?.installed
                        ? t('firewall.emptyRulesInstalled')
                        : t('firewall.emptyRulesNotInstalled')
                    }
                  />
                }
              />
            </div>
          </div>
        ) : null}

        {tab === 'ports' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('firewall.allowPortTitle')}</h3>
              </div>
              <FormLayout columns={2}>
                <Field label={t('firewall.protocol')} htmlFor="fw-proto" flush>
                  <SegRadio
                    name="fw-proto"
                    aria-label={t('firewall.protocol')}
                    value={portProto}
                    onChange={setPortProto}
                    options={[
                      { value: 'tcp', label: 'TCP' },
                      { value: 'udp', label: 'UDP' },
                      { value: 'both', label: t('firewall.protoBoth') },
                    ]}
                    disabled={busy}
                  />
                </Field>
                <Field
                  label={t('firewall.port')}
                  htmlFor="fw-port"
                  flush
                  hint={t('firewall.portHintYsk')}
                >
                  <PresetChips
                    options={SERVICE_PORT_CHIPS.map((c) => ({
                      value: c.value,
                      label: c.label,
                    }))}
                    value={portInput}
                    onChange={onPortChipChange}
                    allowCustom
                    customPlaceholder={t('firewall.customPort')}
                    disabled={busy}
                  />
                </Field>
              </FormLayout>
              {(() => {
                const chip = SERVICE_PORT_CHIPS.find((c) => c.value === portInput);
                if (!chip?.privateRecommended) return null;
                return (
                  <Alert variant="warn" className="u-mt-2">
                    {t('firewall.privatePortWarn', {
                      service: chip.label,
                    })}
                  </Alert>
                );
              })()}
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!canEdit || parsePortInput(portInput) == null}
                  title={!canEdit ? t('rbac.cap.firewallEdit') : undefined}
                  onClick={() =>
                    void run(async () => {
                      const n = parsePortInput(portInput);
                      if (n == null) return { ok: false, notes: ['bad port'] };
                      const r = (await systemApi.firewallAllowPort(
                        n,
                        portProto,
                      )) as OpsResultLike;
                      await refresh();
                      return r;
                    }, t('firewall.allowedPort', {
                      proto:
                        portProto === 'both'
                          ? t('firewall.protoBothLabel')
                          : portProto.toUpperCase(),
                      port: parsePortInput(portInput) ?? portInput,
                    }))
                  }
                >
                  {t('firewall.allowThisPort')}
                </Button>
              </FormActions>
              <FormHint>{t('firewall.allowPortHint')}</FormHint>
            </div>
          </div>
        ) : null}

        {tab === 'deny' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('firewall.denyTitle')}</h3>
                <span className="muted u-text-sm">{t('firewall.denySub')}</span>
              </div>
              <FormLayout columns={2}>
                <Field label="IP" htmlFor="fw-deny" flush>
                  <input
                    id="fw-deny"
                    value={denyIp}
                    onChange={bindInput(setDenyIp)}
                    placeholder={t('firewall.denyPlaceholder')}
                    spellCheck={false}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="danger"
                  size="md"
                  loading={busy}
                  disabled={!canFlush || !isValidDenyIp(denyIp)}
                  title={!canFlush ? t('rbac.cap.firewallFlush') : undefined}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.firewallDeny(
                        denyIp.trim(),
                      )) as OpsResultLike;
                      setDenyIp('');
                      await refresh();
                      return r;
                    }, t('firewall.deniedOk'))
                  }
                >
                  DENY from IP
                </Button>
              </FormActions>
              {(status?.denyFromIps?.length ?? 0) > 0 ? (
                <ul className="def-ban-list u-mt-3">
                  {status!.denyFromIps.map((ip) => (
                    <li key={ip}>
                      <code>{ip}</code>
                      <span className="muted">{t('firewall.denyBadge')}</span>
                      <Button
                        variant="danger"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            const r = (await systemApi.firewallDeleteDeny(
                              ip,
                            )) as OpsResultLike;
                            await refresh();
                            return r;
                          }, t('firewall.removedDeny'))
                        }
                      >
                        {t('common.delete')}
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted u-text-sm u-mt-3">{t('firewall.noDenyRules')}</p>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'profiles' ? (
          <div className="tab-panel def-panel">
            <div className="def-section-head">
              <div>
                <h3 className="def-section-head__title">
                  {t('firewall.oneClickProfiles')}
                </h3>
                <p className="def-section-head__desc">{t('firewall.oneClickDesc')}</p>
              </div>
            </div>
            <div className="fw-profiles">
              {profiles.map((p) => (
                <article key={p.id} className="fw-profile">
                  <h4>{p.label}</h4>
                  <p>{p.short}</p>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={bindCall1(applyProfile, p)}
                  >
                    {t('common.apply')}
                  </Button>
                </article>
              ))}
            </div>
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">{t('firewall.customApply')}</h3>
              </div>
              <label className="def-switch">
                <input
                  type="checkbox"
                  checked={allowSmtp}
                  onChange={bindCheck(setAllowSmtp)}
                />
                <span>{t('firewall.allowSmtp')}</span>
              </label>
              <FormLayout columns={1}>
                <Field
                  label={t('firewall.extraTcp')}
                  htmlFor="fw-extra"
                  flush
                  hint={t('firewall.extraTcpHint')}
                >
                  <PresetChips
                    options={[
                      { value: '', label: t('firewall.noExtra') },
                      { value: '21', label: '21 FTP' },
                      { value: '21,30000:30100', label: 'FTPS+PASV' },
                      { value: '25,465,587,993', label: t('firewall.mailGroup') },
                      { value: '3306', label: 'MySQL' },
                      { value: '5432', label: 'Postgres' },
                      { value: '6379', label: 'Redis' },
                      { value: '8080,8443', label: 'Alt HTTP' },
                    ]}
                    value={extraPorts}
                    onChange={setExtraPorts}
                    allowCustom
                    customPlaceholder={t('firewall.customExtraPlaceholder')}
                    disabled={busy}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="secondary"
                  size="md"
                  loading={busy}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.firewallApply({
                        allowSmtp,
                        apply: true,
                        extraTcpPorts: parsePorts(extraPorts),
                      })) as OpsResultLike;
                      await refresh();
                      return r;
                    }, t('firewall.appliedCustom'))
                  }
                >
                  {t('firewall.applyToSystem')}
                </Button>
              </FormActions>
            </div>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="firewall" /> : null}
      </PageTabs>

      {/* When page already shows ok/error Alert, skip duplicate 操作結果 panel */}
      {result && !msg && !error ? (
        <OpsResultPanel result={result} busy={busy} />
      ) : null}

      <ConfirmDialog
        open={delRuleNum != null}
        onClose={() => !busy && setDelRuleNum(null)}
        onConfirm={() => {
          const n = delRuleNum;
          setDelRuleNum(null);
          if (n == null) return;
          void run(async () => {
            const res = (await systemApi.firewallDeleteRule(n)) as OpsResultLike;
            await refresh();
            return res;
          }, t('firewall.deletedRule', { n }));
        }}
        title={t('firewall.deleteRuleTitle', { n: delRuleNum ?? '' })}
        description={t('firewall.deleteRuleDesc')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
