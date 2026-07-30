/**
 * Firewall (UFW) — port policy & permanent deny.
 * Not fail2ban (log bans) · not Defense Center (attack orchestration).
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
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
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { usePageTab } from '../../shared/hooks/usePageTab';

const FW_TABS = ['rules', 'ports', 'deny', 'profiles'] as const;

type FwStatus = Awaited<ReturnType<typeof systemApi.firewallStatus>>;

const PROFILES = [
  {
    id: 'web',
    label: 'Web 主機',
    short: 'SSH · 80 · 443',
    allowSmtp: false,
    extra: '',
  },
  {
    id: 'mail',
    label: 'Web + 郵件',
    short: '另開 25/465/587/993',
    allowSmtp: true,
    extra: '',
  },
  {
    id: 'ftps',
    label: 'Web + FTPS',
    short: '21 + PASV 30000–30100',
    allowSmtp: false,
    extra: '21,30000:30100',
  },
] as const;

function parsePorts(extraPorts: string): number[] {
  const out: number[] = [];
  for (const part of extraPorts.split(/[,\s]+/).filter(Boolean)) {
    if (part.includes(':')) {
      const [a, b] = part.split(':').map(Number);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let p = Math.min(a, b); p <= Math.max(a, b) && out.length < 40; p++) out.push(p);
      }
    } else {
      const n = Number(part);
      if (Number.isInteger(n) && n > 0 && n < 65536) out.push(n);
    }
  }
  return [...new Set(out)].slice(0, 40);
}

export function FirewallPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(FW_TABS, 'rules');
  const [status, setStatus] = useState<FwStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [extraPorts, setExtraPorts] = useState('21,30000:30100');
  const [allowSmtp, setAllowSmtp] = useState(false);
  const [denyIp, setDenyIp] = useState('');
  const [portInput, setPortInput] = useState('8080');
  const [portProto, setPortProto] = useState<'tcp' | 'udp'>('tcp');
  const [delRuleNum, setDelRuleNum] = useState<number | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      setStatus(await systemApi.firewallStatus());
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const active = status?.active === 'active';

  async function applyProfile(p: (typeof PROFILES)[number]) {
    await run(async () => {
      const r = (await systemApi.firewallApply({
        allowSmtp: p.allowSmtp,
        apply: true,
        extraTcpPorts: parsePorts(p.extra),
      })) as OpsResultLike;
      await refresh();
      return r;
    }, `已套用設定檔：${p.label}`);
  }

  return (
    <FeaturePageLayout
      title={t('nav.firewall', { defaultValue: '防火牆' })}
      backTo="/protection"
      backLabel="防護中心"
      status={{
        pill: {
          label: status?.activeLabel ?? '—',
          tone: active ? 'ok' : status?.installed ? 'warn' : 'danger',
        },
        items: [
          {
            label: '規則',
            value: status?.rules?.length ?? status?.numberedRules?.length ?? 0,
          },
          {
            label: '永久拒 IP',
            value: status?.denyFromIps?.length ?? 0,
          },
          {
            label: '允許',
            value: status?.allowCount ?? 0,
          },
          {
            label: '拒絕',
            value: status?.denyCount ?? 0,
          },
          {
            label: '入站預設',
            value: status?.defaultIncoming ?? '—',
          },
          {
            label: 'EXECUTE',
            value: status?.executeEnabled ? '開' : '關',
            tone: status?.executeEnabled ? 'ok' : 'warn',
          },
        ],
      }}
      actions={<div className="def-head-actions">
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
            重新整理
          </Button>
          {status?.installed ? (
            <Button
              variant={active ? 'ghost' : 'primary'}
              size="sm"
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const r = (await systemApi.firewallEnable(!active)) as OpsResultLike;
                  await refresh();
                  return r;
                }, active ? '已停用 UFW' : '已啟用 UFW')
              }
            >
              {active ? '停用 UFW' : '啟用 UFW'}
            </Button>
          ) : null}
        </div>
      }
    >
      <SoftwareInstallBanner feature="firewall" title="UFW 尚未安裝" />

      <div className="stack-role">
        <Alert variant="info">
          <strong>分工：</strong> UFW = 埠／永久規則 ·{' '}
          <Link to="/fail2ban">fail2ban</Link> = 日誌臨時 ban ·{' '}
          <Link to="/protection">防護中心</Link> = 攻擊時總控（限速 + 自動 ban）
        </Alert>
      </div>

      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error ? <Alert variant="error">{error}</Alert> : null}
      {msg ? (
        <Alert variant="ok">
          {msg}{' '}
          <Button variant="ghost" size="sm" onClick={() => setMsg(null)}>
            關閉
          </Button>
        </Alert>
      ) : null}

      {!status?.executeEnabled ? (
        <Alert variant="info">
          系統變更未開 — 可睇狀態，改規則需 root + <code className="inline">YSK_EXECUTE=1</code>
        </Alert>
      ) : null}

      <PageTabs
        tabs={[
          {
            id: 'rules',
            label: '規則表',
            badge: status?.rules?.length || status?.numberedRules?.length || undefined,
          },
          { id: 'ports', label: '開埠' },
          { id: 'deny', label: '永久拒 IP', badge: status?.denyFromIps?.length || undefined },
          { id: 'profiles', label: '設定檔' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'rules' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">目前規則</h3>
                <span className="muted u-text-sm">ufw status numbered</span>
              </div>
              <DataTable
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
                    header: '動作',
                    nowrap: true,
                    render: (r) => (
                      <Badge
                        tone={
                          /DENY|REJECT/i.test(r.action)
                            ? 'danger'
                            : /ALLOW/i.test(r.action)
                              ? 'ok'
                              : 'neutral'
                        }
                      >
                        {r.action}
                      </Badge>
                    ),
                  },
                  {
                    key: 'to',
                    header: '目標',
                    render: (r) => (
                      <code className="inline">{r.to ?? r.raw}</code>
                    ),
                  },
                  {
                    key: 'from',
                    header: '來源',
                    className: 'u-text-sm',
                    render: (r) => r.from ?? '—',
                  },
                ]}
                rows={
                  status?.rules?.length
                    ? status.rules.map((r) => ({
                        num: r.num,
                        action: r.action,
                        to: r.to,
                        from: r.from,
                        raw: r.raw,
                      }))
                    : (status?.numberedRules ?? []).map((raw) => ({
                        num: undefined as number | undefined,
                        action: '?',
                        to: raw,
                        from: '—',
                        raw,
                      }))
                }
                rowKey={(r, i) => r.raw + i}
                rowActions={(r) =>
                  r.num ? (
                    <ActionBar align="end">
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() => setDelRuleNum(r.num!)}
                      >
                        刪
                      </Button>
                    </ActionBar>
                  ) : null
                }
                empty={
                  <EmptyState
                    title="無規則或無權讀取"
                    description={
                      status?.installed
                        ? 'UFW inactive 或需 root 讀取'
                        : '安裝 UFW 後再整理'
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
                <h3 className="def-section-head__title">允許埠</h3>
              </div>
              <FormLayout columns={2}>
                <Field label="協議" htmlFor="fw-proto" flush>
                  <SegRadio
                    name="fw-proto"
                    aria-label="協議"
                    value={portProto}
                    onChange={setPortProto}
                    options={[
                      { value: 'tcp', label: 'TCP' },
                      { value: 'udp', label: 'UDP' },
                    ]}
                    disabled={busy}
                  />
                </Field>
                <Field
                  label="埠"
                  htmlFor="fw-port"
                  flush
                  hint="揀常用埠，或下面自訂"
                >
                  <PresetChips
                    options={[
                      { value: '22', label: '22 SSH' },
                      { value: '80', label: '80 HTTP' },
                      { value: '443', label: '443 HTTPS' },
                      { value: '21', label: '21 FTP' },
                      { value: '25', label: '25 SMTP' },
                      { value: '587', label: '587' },
                      { value: '993', label: '993 IMAPS' },
                      { value: '3306', label: '3306 MySQL' },
                      { value: '5432', label: '5432 PG' },
                      { value: '6379', label: '6379 Redis' },
                      { value: '8080', label: '8080' },
                    ]}
                    value={portInput}
                    onChange={setPortInput}
                    allowCustom
                    customPlaceholder="自訂埠號"
                    disabled={busy}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="primary"
                  size="md"
                  loading={busy}
                  disabled={!portInput.trim() || !Number(portInput)}
                  onClick={() =>
                    void run(async () => {
                      const n = Number(portInput);
                      const r = (await systemApi.firewallAllowPort(
                        n,
                        portProto,
                      )) as OpsResultLike;
                      await refresh();
                      return r;
                    }, `已允許 ${portProto.toUpperCase()}/${portInput}`)
                  }
                >
                  允許此埠
                </Button>
              </FormActions>
              <FormHint>預設 Web 主機應保留 22／80／443；勿隨便 allow 全部。</FormHint>
            </div>
          </div>
        ) : null}

        {tab === 'deny' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">永久拒絕 IP</h3>
                <span className="muted u-text-sm">UFW DENY · 與 fail2ban 臨時 ban 不同</span>
              </div>
              <FormLayout columns={2}>
                <Field label="IP" htmlFor="fw-deny" flush>
                  <input
                    id="fw-deny"
                    value={denyIp}
                    onChange={(e) => setDenyIp(e.target.value)}
                    placeholder="要拒絕的 IPv4 或 IPv6"
                    spellCheck={false}
                  />
                </Field>
              </FormLayout>
              <FormActions>
                <Button
                  variant="danger"
                  size="md"
                  loading={busy}
                  disabled={!denyIp.trim()}
                  onClick={() =>
                    void run(async () => {
                      const r = (await systemApi.firewallDeny(denyIp.trim())) as OpsResultLike;
                      setDenyIp('');
                      await refresh();
                      return r;
                    }, '已永久拒絕')
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
                      <span className="muted">DENY</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busy}
                        onClick={() =>
                          void run(async () => {
                            const r = (await systemApi.firewallDeleteDeny(ip)) as OpsResultLike;
                            await refresh();
                            return r;
                          }, '已移除 DENY')
                        }
                      >
                        移除
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted u-text-sm u-mt-3">未有永久拒 IP 規則</p>
              )}
            </div>
          </div>
        ) : null}

        {tab === 'profiles' ? (
          <div className="tab-panel def-panel">
            <div className="def-section-head">
              <div>
                <h3 className="def-section-head__title">一鍵設定檔</h3>
                <p className="def-section-head__desc">
                  寫入管理腳本並套用 UFW（唔會裝 fail2ban — 請到 fail2ban 頁）
                </p>
              </div>
            </div>
            <div className="fw-profiles">
              {PROFILES.map((p) => (
                <article key={p.id} className="fw-profile">
                  <h4>{p.label}</h4>
                  <p>{p.short}</p>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    onClick={() => void applyProfile(p)}
                  >
                    套用
                  </Button>
                </article>
              ))}
            </div>
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">自訂套用</h3>
              </div>
              <label className="def-switch">
                <input
                  type="checkbox"
                  checked={allowSmtp}
                  onChange={(e) => setAllowSmtp(e.target.checked)}
                />
                <span>允許 SMTP／IMAP 埠</span>
              </label>
              <FormLayout columns={1}>
                <Field
                  label="額外 TCP 埠"
                  htmlFor="fw-extra"
                  flush
                  hint="點選預設組合；可再自訂逗號／範圍"
                >
                  <PresetChips
                    options={[
                      { value: '', label: '無額外' },
                      { value: '21', label: '21 FTP' },
                      { value: '21,30000:30100', label: 'FTPS+PASV' },
                      { value: '25,465,587,993', label: '郵件組' },
                      { value: '3306', label: 'MySQL' },
                      { value: '5432', label: 'Postgres' },
                      { value: '6379', label: 'Redis' },
                      { value: '8080,8443', label: 'Alt HTTP' },
                    ]}
                    value={extraPorts}
                    onChange={setExtraPorts}
                    allowCustom
                    customPlaceholder="自訂：8080,9000:9010"
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
                    }, '已套用自訂規則')
                  }
                >
                  套用到系統
                </Button>
              </FormActions>
            </div>
          </div>
        ) : null}
      </PageTabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />

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
          }, `已刪 #${n}`);
        }}
        title={`刪規則 #${delRuleNum ?? ''}？`}
        description="將從 UFW 移除該規則編號（需系統變更權限）。"
        confirmLabel="刪除"
        cancelLabel="取消"
        danger
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
