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
        return s.catalog?.slice(0, 4).map((c) => c.id) ?? [
          'sshd',
          'nginx-http-auth',
          'postfix',
          'dovecot',
        ];
      });
      if (s.jails?.[0]?.name) setBanJail((j) => j || s.jails[0].name);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = status?.active === 'active';
  const banned = status?.banned ?? [];

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
      title={t('nav.fail2ban', { defaultValue: 'fail2ban' })}
      backTo="/protection"
      backLabel="防護中心"
      status={{
        pill: {
          label: status?.activeLabel ?? '—',
          tone: running ? 'ok' : status?.installed ? 'warn' : 'danger',
        },
        items: [
          {
            label: '目前 ban',
            value:
              status?.jails?.reduce((a, j) => a + (j.currentlyBanned ?? 0), 0) ?? 0,
          },
          {
            label: '累計',
            value: status?.jails?.reduce((a, j) => a + (j.totalBanned ?? 0), 0) ?? 0,
          },
          { label: 'Jail', value: status?.jails?.length ?? 0 },
          { label: '封鎖列表', value: banned.length },
          { label: 'ignoreip', value: status?.ignoreIps?.length ?? 0 },
          {
            label: '開機',
            value: status?.installed ? (status.enabled ?? '—') : '未安裝',
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
                }, '已啟動 fail2ban')
              }
            >
              啟動服務
            </Button>
          ) : null}
        </div>
      }
    >
      <SoftwareInstallBanner feature="fail2ban" title="fail2ban 尚未安裝" />

      <Alert variant="info">
        <strong>分工：</strong> fail2ban = 掃 log 後<strong>臨時</strong> ban ·{' '}
        <Link to="/firewall">UFW</Link> = 埠／永久規則 ·{' '}
        <Link to="/protection">防護中心</Link> = 攻擊應變（可疑列表 + 自動 ban + Nginx 限速）
      </Alert>

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

      <PageTabs
        tabs={[
          { id: 'bans', label: '封鎖列表', badge: banned.length || undefined },
          {
            id: 'whitelist',
            label: '白名單',
            badge: status?.ignoreIps?.length || undefined,
          },
          { id: 'jails', label: 'Jail', badge: status?.jails?.length || undefined },
          { id: 'policy', label: '策略' },
          { id: 'service', label: '服務' },
        
          { id: 'about', label: '說明' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'bans' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">手動 ban（臨時）</h3>
              </div>
              <FormLayout columns={2}>
                <Field label="IP" htmlFor="f2b-ban-ip" flush required>
                  <input
                    id="f2b-ban-ip"
                    value={banIp}
                    onChange={(e) => setBanIp(e.target.value)}
                    placeholder="IPv4 或 IPv6"
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
                    }, '已 banip')
                  }
                >
                  banip
                </Button>
              </FormActions>
              <FormHint>
                臨時封鎖，過 bantime 會自動解；永久拒請用 UFW。白名單見「白名單」分頁。
              </FormHint>
            </div>

            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">
                  目前封鎖 <Badge tone="neutral">{banned.length}</Badge>
                </h3>
              </div>
              <DataTable
                title="Banned IPs（真實 fail2ban-client）"
                description="需能讀取 client；unban 需 YSK_EXECUTE"
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
                      複製
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
                        }, '已 unban')
                      }
                    >
                      解封
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy}
                      title="加入 ignoreip 白名單"
                      onClick={() =>
                        void run(async () => {
                          const r = (await systemApi.fail2banIgnoreIp(
                            b.ip,
                            'add',
                          )) as OpsResultLike;
                          await refresh();
                          return r;
                        }, '已加入白名單')
                      }
                    >
                      +白名單
                    </Button>
                  </ActionBar>
                )}
                empty={
                  <EmptyState
                    title="無封鎖中 IP"
                    description="或無權讀取 fail2ban-client"
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
                  <h3 className="def-section-head__title">ignoreip 白名單</h3>
                  <p className="def-section-head__desc">
                    永不被 ban 的 IP（管理檔 + 可選 live fail2ban-client）。建議加入你的辦公／家居 IP。
                  </p>
                </div>
              </div>
              <FormLayout columns={2}>
                <Field label="新增 IP" htmlFor="f2b-ignore" flush required>
                  <input
                    id="f2b-ignore"
                    value={ignoreIp}
                    onChange={(e) => setIgnoreIp(e.target.value)}
                    placeholder="IPv4 或 IPv6"
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
                    }, '已加入白名單')
                  }
                >
                  加入白名單
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
                    }, '已把 ignoreip 寫入 jail.local 並套用')
                  }
                >
                  套用策略（含 ignoreip）
                </Button>
              </FormActions>
              <FormHint>
                無 YSK_EXECUTE 時只寫管理檔（apply_status=written）；「套用策略」會重建
                jail.local 的 ignoreip= 行並 reload。
              </FormHint>
              <DataTable
                className="u-mt-4"
                title={`白名單 (${status?.ignoreIps?.length ?? 0})`}
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
                      複製
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
                        }, '已移除白名單')
                      }
                    >
                      移除
                    </Button>
                  </ActionBar>
                )}
                empty={
                  <EmptyState
                    title="尚未有白名單 IP"
                    description="加入管理 IP，避免自己被 ban"
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
                <h3 className="def-section-head__title">作用中 Jail</h3>
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
                    header: '目前',
                    nowrap: true,
                    render: (j) => j.currentlyBanned ?? '—',
                  },
                  {
                    key: 'total',
                    header: '累計',
                    nowrap: true,
                    render: (j) => j.totalBanned ?? '—',
                  },
                  {
                    key: 'desc',
                    header: '說明',
                    className: 'muted u-text-sm',
                    render: (j) => descFor(j.name) ?? '—',
                  },
                ]}
                rows={status?.jails ?? []}
                rowKey={(j) => j.name}
                empty={
                  <EmptyState
                    title="無 jail"
                    description="服務未啟動或尚未套用 jail.local"
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
                  <h3 className="def-section-head__title">Jail 策略</h3>
                  <p className="def-section-head__desc">
                    寫入管理 jail.local；套用時 copy + reload（唔經 UFW）
                  </p>
                </div>
              </div>
              <FormLayout columns={2}>
                <Field label="bantime" htmlFor="f2b-bt" flush hint="封鎖時長">
                  <PresetChips
                    options={[
                      { value: '10m', label: '10 分' },
                      { value: '1h', label: '1 時' },
                      { value: '6h', label: '6 時' },
                      { value: '24h', label: '24 時' },
                      { value: '1w', label: '1 週' },
                      { value: '3600', label: '3600s' },
                    ]}
                    value={bantime}
                    onChange={setBantime}
                    allowCustom
                    customPlaceholder="自訂，例 2h"
                  />
                </Field>
                <Field label="findtime" htmlFor="f2b-ft" flush hint="統計窗口">
                  <PresetChips
                    options={[
                      { value: '5m', label: '5 分' },
                      { value: '10m', label: '10 分' },
                      { value: '30m', label: '30 分' },
                      { value: '1h', label: '1 時' },
                      { value: '600', label: '600s' },
                    ]}
                    value={findtime}
                    onChange={setFindtime}
                    allowCustom
                    customPlaceholder="自訂，例 15m"
                  />
                </Field>
                <Field label="maxretry" htmlFor="f2b-mr" flush hint="窗口內最多失敗次數">
                  <PresetChips
                    options={[
                      { value: '3', label: '3' },
                      { value: '5', label: '5' },
                      { value: '8', label: '8' },
                      { value: '10', label: '10' },
                      { value: '15', label: '15' },
                    ]}
                    value={String(maxretry)}
                    onChange={(v) => setMaxretry(Math.max(1, Math.min(50, Number(v) || 5)))}
                    allowCustom
                    customPlaceholder="自訂 1–50"
                  />
                </Field>
              </FormLayout>
              <FormHint>啟用 jail（勾選後套用）：</FormHint>
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
                    }, '已寫管理檔（未套用系統）')
                  }
                >
                  只寫管理檔
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
                    }, '已套用 fail2ban')
                  }
                >
                  套用到系統
                </Button>
              </FormActions>
            </div>
          </div>
        ) : null}

        {tab === 'service' ? (
          <div className="tab-panel def-panel">
            <div className="def-panel-card">
              <div className="def-section-head">
                <h3 className="def-section-head__title">systemd 控制</h3>
              </div>
              <div className="def-head-actions">
                {(
                  [
                    ['enable', '啟用並啟動'],
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
                        const r = (await systemApi.fail2banService(action)) as OpsResultLike;
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
                攻擊應變請用 <Link to="/protection">防護中心</Link>
                （會呼叫本頁 jail + Nginx 限速，唔重複建第二套 UFW）。
              </FormHint>
            </div>
          </div>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="fail2ban" /> : null}
      </PageTabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
