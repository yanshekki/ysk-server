/**
 * fail2ban — live jails/status + panel apply.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  DescriptionList,
  FeaturePageLayout,
  Field,
  FormActions,
  FormHint,
  FormLayout,
  OpsResultPanel,
  SoftwareInstallBanner,
  SummaryStrip,
  Tabs,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';

const F2B_TABS = ['overview', 'jails', 'settings'] as const;
import type { OpsResultLike } from '../../shared/components/ui';
import { systemApi } from '../../features/system';
import { useFeatureAction } from '../../features/system/useFeatureAction';

const FALLBACK_JAILS = ['sshd', 'nginx-http-auth', 'postfix', 'dovecot'];

export function Fail2banPage() {
  const [status, setStatus] = useState<{
    installed: boolean;
    active: string;
    enabled: string;
    jails: Array<{ name: string; currentlyBanned?: number; totalBanned?: number }>;
    executeEnabled: boolean;
    isRoot: boolean;
    defaultJails: string[];
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [banned, setBanned] = useState<Array<{ jail: string; ip: string }>>([]);
  const [ignoreIp, setIgnoreIp] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const s = await systemApi.fail2banStatus();
      setStatus(s);
      setSelected((prev) =>
        prev.length ? prev : [...(s.defaultJails?.length ? s.defaultJails : FALLBACK_JAILS)],
      );
      try {
        const b = await systemApi.fail2banBanned();
        setBanned(b.items ?? []);
      } catch {
        setBanned([]);
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const jailOptions = status?.defaultJails?.length ? status.defaultJails : FALLBACK_JAILS;
  const running = status?.active === 'active';

  function toggleJail(name: string) {
    setSelected((prev) =>
      prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name],
    );
  }

  async function onApply() {
    await run(async () => {
      try {
        const r = await systemApi.fail2banApply({
          apply: true,
          jails: selected.length ? selected : jailOptions,
        });
        await refresh();
        return r as OpsResultLike;
      } catch (e) {
        const m = e instanceof Error ? e.message : '套用失敗';
        return { ok: false, blocked: true, blockMessage: m, notes: [m] };
      }
    }, '已套用 fail2ban');
  }

  const [tab, setTab] = usePageTab(F2B_TABS, 'overview');

  return (
    <FeaturePageLayout
      title="fail2ban"
      subtitle="入侵封鎖 — 即時狀態與 jail 設定"
      actions={
        <Button
          variant="secondary"
          size="md"
          loading={busy}
          onClick={() => {
            setError(null);
            setMsg(null);
            void refresh();
          }}
        >
          重新整理
        </Button>
      }
    >
      <SoftwareInstallBanner feature="fail2ban" title="fail2ban 尚未安裝" />
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

      <SummaryStrip
        items={[
          {
            label: '狀態',
            value: status?.installed ? status.active : '未安裝',
            tone: running ? 'ok' : status?.installed ? 'warn' : 'danger',
          },
          { label: 'Jail 數', value: String(status?.jails?.length ?? 0) },
          {
            label: '系統變更',
            value: status?.executeEnabled ? '已開啟' : '未開啟',
            tone: status?.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: '管理員',
            value: status?.isRoot ? '是' : '否',
            tone: status?.isRoot ? 'ok' : 'warn',
          },
        ]}
      />

      <Tabs
        tabs={[
          { id: 'overview', label: '概覽' },
          { id: 'jails', label: 'Jail / 封鎖' },
          { id: 'settings', label: '設定' },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'overview' ? (
          <div className="tab-panel">
      <Card>
        <CardSection title="服務概覽" description="systemctl + fail2ban-client 探測">
          <DescriptionList
            columns={2}
            items={[
              {
                label: '狀態',
                value: (
                  <Badge tone={running ? 'ok' : status?.installed ? 'warn' : 'danger'}>
                    {status?.installed ? status.active : '未安裝'}
                  </Badge>
                ),
              },
              { label: '開機自啟', value: status?.enabled ?? '—' },
              {
                label: '系統變更',
                value: status?.executeEnabled ? '已開啟' : '未開啟',
              },
              { label: '管理員', value: status?.isRoot ? '是' : '否' },
            ]}
          />
        </CardSection>
      </Card>
          </div>
        ) : null}
        {tab === 'jails' ? (
          <div className="tab-panel">
      <Card>
        <CardSection title="作用中 Jail" description="目前已封鎖統計">
          {status?.jails?.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Jail</th>
                    <th>目前封鎖</th>
                    <th>累計封鎖</th>
                  </tr>
                </thead>
                <tbody>
                  {status.jails.map((j) => (
                    <tr key={j.name}>
                      <td>
                        <code className="inline">{j.name}</code>
                      </td>
                      <td>{j.currentlyBanned ?? '—'}</td>
                      <td>{j.totalBanned ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted u-text-sm" style={{ margin: 0 }}>
              {status?.installed ? '未讀到 jail（服務可能未啟動）' : '請先安裝 fail2ban'}
            </p>
          )}
        </CardSection>
      </Card>
      <Card>
        <CardSection title="已封鎖 IP" description="即時封鎖列表 · 可解除封鎖">
          {banned.length === 0 ? (
            <p className="muted u-text-sm">無已封鎖 IP 或無權限讀取</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Jail</th>
                    <th>IP</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {banned.map((b) => (
                    <tr key={`${b.jail}-${b.ip}`}>
                      <td>
                        <code className="inline">{b.jail}</code>
                      </td>
                      <td>
                        <code className="inline">{b.ip}</code>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={busy}
                          onClick={() =>
                            void run(async () => {
                              const r = await systemApi.fail2banUnban(b.jail, b.ip);
                              await refresh();
                              return r as OpsResultLike;
                            }, '已解除封鎖')
                          }
                        >
                          解除封鎖
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>
      </Card>
          </div>
        ) : null}
        {tab === 'settings' ? (
          <div className="tab-panel">
            <Card>
              <CardSection
                title="白名單（ignoreip）"
                description="寫入管理檔並嘗試套用到 sshd jail；永不封鎖這些 IP"
              >
                <FormLayout columns={2}>
                  <Field
                    label="IP 位址"
                    htmlFor="f2b-ignore"
                    flush
                    hint="單一 IPv4／IPv6 或 CIDR，例如 203.0.113.10"
                  >
                    <input
                      id="f2b-ignore"
                      value={ignoreIp}
                      onChange={(e) => setIgnoreIp(e.target.value)}
                      placeholder="203.0.113.10"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button
                    variant="secondary"
                    size="md"
                    loading={busy}
                    disabled={!ignoreIp.trim()}
                    onClick={() =>
                      void run(async () => {
                        const r = await systemApi.fail2banIgnoreIp(ignoreIp.trim(), 'add');
                        setIgnoreIp('');
                        return r as OpsResultLike;
                      }, '已加入白名單')
                    }
                  >
                    加入白名單
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
            <Card>
              <CardSection
                title="套用 Jail 設定"
                description="寫入管理 jail.local 並嘗試安裝／重載 fail2ban"
              >
                <FormHint>勾選要啟用的 jail；套用後 written ≠ 全部 jail 已在主機生效。</FormHint>
                <div className="form-check-row">
                  {jailOptions.map((name) => (
                    <CheckboxField
                      key={name}
                      id={`f2b-jail-${name}`}
                      label={name}
                      description={
                        name === 'sshd'
                          ? 'SSH 暴力破解防護'
                          : name === 'nginx-http-auth'
                            ? 'Nginx 基本認證失敗'
                            : name === 'postfix'
                              ? '郵件 SMTP 濫用'
                              : name === 'dovecot'
                                ? 'IMAP／POP3 登入失敗'
                                : undefined
                      }
                      checked={selected.includes(name)}
                      onChange={() => toggleJail(name)}
                    />
                  ))}
                </div>
                <FormActions>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    disabled={!selected.length}
                    onClick={() => void onApply()}
                  >
                    套用到系統
                  </Button>
                </FormActions>
              </CardSection>
            </Card>
          </div>
        ) : null}
      </Tabs>

      <OpsResultPanel title="操作結果" result={result} message={msg} busy={busy} />
    </FeaturePageLayout>
  );
}
