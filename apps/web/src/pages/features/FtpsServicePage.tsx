/**
 * vsftpd service page — professional console layout.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  DescriptionList,
  FeaturePageLayout,
  OpsResultPanel,
  SettingField,
  SettingFieldList,
  SummaryStrip,
  Tabs,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ftpApi, type FtpsSettings, type FtpsStatus } from '../../features/ftp';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { softwareApi } from '../../features/software';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

const empty: FtpsSettings = {
  listen: true,
  listenPort: 21,
  sslEnable: true,
  forceSsl: true,
  sslDomain: '',
  pasvMin: 30000,
  pasvMax: 30100,
  writeEnable: true,
  chrootLocalUser: true,
  allowWriteableChroot: true,
  banner: 'YSK FTPS',
  guestUsername: 'ftp',
};

function statusLabel(s?: FtpsStatus | null): { text: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (!s) return { text: '載入中', tone: 'neutral' };
  if (!s.installed) return { text: '未安裝', tone: 'danger' };
  if (s.active === 'active') return { text: '運行中', tone: 'ok' };
  if (s.active === 'inactive') return { text: '已停止', tone: 'warn' };
  return { text: s.active || '已安裝', tone: 'warn' };
}

export function FtpsServicePage() {
  const [settings, setSettings] = useState<FtpsSettings>(empty);
  const [status, setStatus] = useState<FtpsStatus | null>(null);
  const [domains, setDomains] = useState<Array<{ value: string; label: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState('lifecycle');
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, o] = await Promise.all([ftpApi.settings(), ftpApi.options()]);
      setSettings({ ...empty, ...s.settings });
      setStatus(s.status);
      setDomains(o.domains);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入失敗');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function patch<K extends keyof FtpsSettings>(key: K, value: FtpsSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      const r = await ftpApi.saveSettings(settings);
      setSettings(r.settings);
      await refresh();
      return { ok: true, notes: ['已儲存設定'] };
    }, '已儲存');
  }

  async function onInstallAndStart() {
    await run(async () => {
      try {
        const inst = await softwareApi.installFeature('ftp');
        if (!inst.ok) {
          const notes = sanitizeOperatorNotes(inst.notes);
          return {
            ok: false,
            blocked: Boolean(inst.blocked ?? inst.results?.some((r) => r.blocked)),
            blockMessage:
              inst.blockMessage ??
              inst.results?.find((r) => r.blockMessage)?.blockMessage ??
              notes[0] ??
              '無法完成安裝',
            notes,
          } satisfies OpsResultLike;
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : '安裝失敗';
        return {
          ok: false,
          blocked: /權限|系統變更|管理員/.test(m),
          blockMessage: m,
          notes: [m],
        } satisfies OpsResultLike;
      }
      const r = await ftpApi.apply({ settings, applySystem: true });
      await refresh();
      return r as unknown as OpsResultLike;
    }, 'FTPS 已就緒');
  }

  async function onApplySettings() {
    await run(async () => {
      const r = await ftpApi.apply({ settings, applySystem: true });
      await refresh();
      return r as unknown as OpsResultLike;
    }, '已套用設定');
  }

  const st = statusLabel(status);
  const installed = Boolean(status?.installed);

  const tabs = [
    { id: 'lifecycle', label: '生命週期' },
    { id: 'overview', label: '概覽' },
    { id: 'network', label: '網絡' },
    { id: 'security', label: '安全' },
  ];

  return (
    <FeaturePageLayout
      title="vsftpd 服務"
      subtitle="FTPS 服務控制台"
      actions={
        <div className="btn-row">
          <Link to="/ftp">
            <Button variant="secondary" size="md">
              帳戶
            </Button>
          </Link>
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
        </div>
      }
    >
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error && !result ? <Alert variant="error">{error}</Alert> : null}
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
          { label: '狀態', value: st.text, tone: st.tone === 'neutral' ? 'default' : st.tone },
          { label: '埠', value: String(settings.listenPort) },
          {
            label: '帳戶',
            value: status?.accountCount != null ? String(status.accountCount) : '—',
          },
          {
            label: 'FTPS',
            value: settings.sslEnable ? '開啟' : '關閉',
            tone: settings.sslEnable ? 'ok' : 'warn',
          },
        ]}
      />

      <Tabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'lifecycle' ? (
          <Card>
            <CardSection title="生命週期" description="安裝與啟動">
              <div className="lifecycle-toolbar">
                {!installed ? (
                  <Button variant="primary" size="lg" loading={busy} onClick={() => void onInstallAndStart()}>
                    一鍵安裝並啟動
                  </Button>
                ) : status?.active !== 'active' ? (
                  <Button variant="primary" size="md" loading={busy} onClick={() => void onApplySettings()}>
                    啟動服務
                  </Button>
                ) : (
                  <Button variant="secondary" size="md" loading={busy} onClick={() => void onApplySettings()}>
                    套用並重啟
                  </Button>
                )}
              </div>
              {!installed ? (
                <p className="muted u-text-sm u-mt-3" style={{ marginBottom: 0 }}>
                  安裝後即可使用 FTPS 帳戶登入。需系統管理員權限才能完成安裝。
                </p>
              ) : null}
            </CardSection>
          </Card>
        ) : null}

        {tab === 'overview' ? (
          <Card>
            <CardSection title="服務概覽" description="唯讀狀態">
              <DescriptionList
                columns={2}
                items={[
                  { label: '狀態', value: <Badge tone={st.tone}>{st.text}</Badge> },
                  { label: '監聽埠', value: String(settings.listenPort) },
                  { label: '帳戶數', value: status?.accountCount != null ? String(status.accountCount) : '—' },
                  { label: 'Banner', value: settings.banner || '—' },
                  { label: 'SSL 網域', value: settings.sslDomain || '—' },
                  { label: 'PASV 範圍', value: `${settings.pasvMin}–${settings.pasvMax}` },
                  { label: 'FTPS', value: settings.sslEnable ? '開啟' : '關閉' },
                  { label: '強制 TLS', value: settings.forceSsl ? '是' : '否' },
                  { label: '允許寫入', value: settings.writeEnable ? '是' : '否' },
                  { label: 'Chroot', value: settings.chrootLocalUser ? '是' : '否' },
                ]}
              />
            </CardSection>
          </Card>
        ) : null}

        {tab === 'network' ? (
          <Card>
            <CardSection title="網絡設定">
              <form
                onSubmit={(e) => {
                  void onSave(e);
                }}
              >
                <SettingFieldList>
                  <SettingField label="監聽埠" techKey="listen_port" htmlFor="listenPort">
                    <input
                      id="listenPort"
                      type="number"
                      min={1}
                      max={65535}
                      value={settings.listenPort}
                      onChange={(e) => patch('listenPort', Number(e.target.value) || 21)}
                    />
                  </SettingField>
                  <SettingField label="Banner" techKey="ftpd_banner" htmlFor="banner">
                    <input
                      id="banner"
                      value={settings.banner}
                      onChange={(e) => patch('banner', e.target.value)}
                    />
                  </SettingField>
                  <SettingField label="PASV 起始" techKey="pasv_min_port" htmlFor="pasvMin">
                    <input
                      id="pasvMin"
                      type="number"
                      value={settings.pasvMin}
                      onChange={(e) => patch('pasvMin', Number(e.target.value) || 30000)}
                    />
                  </SettingField>
                  <SettingField label="PASV 結束" techKey="pasv_max_port" htmlFor="pasvMax">
                    <input
                      id="pasvMax"
                      type="number"
                      value={settings.pasvMax}
                      onChange={(e) => patch('pasvMax', Number(e.target.value) || 30100)}
                    />
                  </SettingField>
                  <SettingField
                    label="PASV 公網 IP"
                    techKey="pasv_address"
                    description="可選；NAT 環境填公網 IP"
                    htmlFor="pasvAddress"
                  >
                    <input
                      id="pasvAddress"
                      value={settings.pasvAddress ?? ''}
                      onChange={(e) => patch('pasvAddress', e.target.value || undefined)}
                      placeholder="可選"
                    />
                  </SettingField>
                </SettingFieldList>
                <div className="setting-actions-bar">
                  <Button type="submit" variant="secondary" size="md" loading={busy}>
                    儲存
                  </Button>
                  {installed ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={() => void onApplySettings()}
                    >
                      套用並重啟
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardSection>
          </Card>
        ) : null}

        {tab === 'security' ? (
          <Card>
            <CardSection title="安全設定">
              <form
                onSubmit={(e) => {
                  void onSave(e);
                }}
              >
                <SettingFieldList>
                  <SettingField label="SSL 網域" techKey="rsa_cert" htmlFor="sslDomain">
                    <select
                      id="sslDomain"
                      value={settings.sslDomain}
                      onChange={(e) => patch('sslDomain', e.target.value)}
                    >
                      <option value="">— 選擇 —</option>
                      {domains.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                  </SettingField>
                  {(
                    [
                      ['sslEnable', '啟用 FTPS (SSL)', 'ssl_enable'],
                      ['forceSsl', '強制 TLS', 'force_local_logins_ssl'],
                      ['writeEnable', '允許寫入', 'write_enable'],
                      ['chrootLocalUser', 'Chroot 用戶', 'chroot_local_user'],
                      ['allowWriteableChroot', '可寫 chroot', 'allow_writeable_chroot'],
                    ] as const
                  ).map(([key, label, tech]) => (
                    <SettingField key={key} label={label} techKey={tech} htmlFor={key}>
                      <select
                        id={key}
                        value={settings[key] ? 'yes' : 'no'}
                        onChange={(e) => patch(key, e.target.value === 'yes')}
                      >
                        <option value="yes">是</option>
                        <option value="no">否</option>
                      </select>
                    </SettingField>
                  ))}
                </SettingFieldList>
                <div className="setting-actions-bar">
                  <Button type="submit" variant="secondary" size="md" loading={busy}>
                    儲存
                  </Button>
                  {installed ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={() => void onApplySettings()}
                    >
                      套用並重啟
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardSection>
          </Card>
        ) : null}
      </Tabs>

      <OpsResultPanel
        title="操作結果"
        result={result}
        message={msg}
        onRetry={!installed ? () => void onInstallAndStart() : undefined}
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
