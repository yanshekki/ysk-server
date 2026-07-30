/**
 * vsftpd service page — professional console layout.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ActionBar,
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
  PresetChips,
  SegRadio,
  PageTabs,
  SoftwareInstallBanner,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ftpApi, type FtpsSettings, type FtpsStatus } from '../../features/ftp';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { softwareApi } from '../../features/software';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

const empty: FtpsSettings = {
  listen: true,
  listenIpv6: false,
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
  const { t } = useTranslation();
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
      title={t('nav.ftpService', { defaultValue: 'vsftpd 服務' })}
      status={{
        pill: {
          label: st.text,
          tone: st.tone === 'neutral' ? 'warn' : st.tone,
        },
        items: [
          {
            label: '狀態',
            value: st.text,
            tone: st.tone === 'neutral' ? 'neutral' : st.tone,
          },
          { label: '埠', value: String(settings.listenPort) },
          {
            label: '帳戶',
            value: status?.accountCount != null ? String(status.accountCount) : '—',
          },
          {
            label: 'FTPS',
            value: settings.sslEnable ? '開' : '關',
            tone: settings.sslEnable ? 'ok' : 'warn',
          },
        ],
      }}
      actions={<ActionBar>
          <Link to="/ftp">
            <Button variant="secondary" size="sm">
              帳戶
            </Button>
          </Link>
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
        </ActionBar>
      }
    >
      <SoftwareInstallBanner
        feature="ftp"
        title="FTPS 所需軟件尚未安裝"
        onInstalled={() => void refresh()}
      />
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

      <PageTabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'lifecycle' ? (
          <Card>
            <CardSection title="生命週期" description="安裝與啟動">
              <div className="lifecycle-toolbar">
                {!installed ? (
                  <p className="muted u-text-sm u-mb-0">
                    請使用上方橫幅「一鍵安裝」安裝 FTPS，完成後再啟動服務。
                  </p>
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
                  { label: '登入橫幅', value: settings.banner || '—' },
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
            <CardSection
              title="網絡設定"
              description="監聽埠與 PASV 被動模式；儲存只改管理設定，套用才寫入 vsftpd 並重啟"
            >
              <form
                onSubmit={(e) => {
                  void onSave(e);
                }}
              >
                <FormLayout columns={2}>
                  <Field
                    label="監聽埠"
                    htmlFor="listenPort"
                    flush
                    required
                    hint="預設 21；若防火牆另開埠請一併放行"
                  >
                    <PresetChips
                      options={[
                        { value: '21', label: '21' },
                        { value: '2121', label: '2121' },
                        { value: '990', label: '990 FTPS' },
                      ]}
                      value={String(settings.listenPort)}
                      onChange={(v) => patch('listenPort', Number(v) || 21)}
                      allowCustom
                      customPlaceholder="自訂埠"
                    />
                  </Field>
                  <Field
                    label="IP 棧"
                    htmlFor="listenStack"
                    flush
                    hint="vsftpd 多數版本 listen 與 listen_ipv6 互斥；IPv6 用 listen_ipv6=YES"
                  >
                    <SegRadio
                      name="listenStack"
                      aria-label="IP 棧"
                      value={settings.listenIpv6 ? 'ipv6' : 'ipv4'}
                      onChange={(v) => {
                        setSettings((prev) =>
                          v === 'ipv6'
                            ? { ...prev, listenIpv6: true, listen: false }
                            : { ...prev, listenIpv6: false, listen: true },
                        );
                      }}
                      options={[
                        { value: 'ipv4', label: '僅 IPv4' },
                        { value: 'ipv6', label: 'IPv6（可 mapped）' },
                      ]}
                    />
                  </Field>
                  <Field
                    label="登入橫幅"
                    htmlFor="banner"
                    flush
                    hint="連線成功後客戶端可見的歡迎字串"
                  >
                    <input
                      id="banner"
                      value={settings.banner}
                      onChange={(e) => patch('banner', e.target.value)}
                      placeholder="YSK FTPS"
                    />
                  </Field>
                  <Field
                    label="PASV 起始埠"
                    htmlFor="pasvMin"
                    flush
                    hint="被動模式資料通道起始"
                  >
                    <PresetChips
                      options={[
                        { value: '30000', label: '30000' },
                        { value: '40000', label: '40000' },
                        { value: '50000', label: '50000' },
                      ]}
                      value={String(settings.pasvMin)}
                      onChange={(v) => patch('pasvMin', Number(v) || 30000)}
                      allowCustom
                      customPlaceholder="自訂起始"
                    />
                  </Field>
                  <Field
                    label="PASV 結束埠"
                    htmlFor="pasvMax"
                    flush
                    hint="需 ≥ 起始埠；防火牆需放行此範圍"
                  >
                    <PresetChips
                      options={[
                        { value: '30100', label: '30100' },
                        { value: '40100', label: '40100' },
                        { value: '50100', label: '50100' },
                      ]}
                      value={String(settings.pasvMax)}
                      onChange={(v) => patch('pasvMax', Number(v) || 30100)}
                      allowCustom
                      customPlaceholder="自訂結束"
                    />
                  </Field>
                  <Field
                    label="PASV 公網 IP"
                    htmlFor="pasvAddress"
                    fullWidth
                    flush
                    hint="NAT／雲主機可填公網 IP；本機可留空"
                  >
                    <input
                      id="pasvAddress"
                      value={settings.pasvAddress ?? ''}
                      onChange={(e) => patch('pasvAddress', e.target.value || undefined)}
                      placeholder="（可留空）"
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button type="submit" variant="secondary" size="md" loading={busy}>
                    儲存設定
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
                </FormActions>
              </form>
            </CardSection>
          </Card>
        ) : null}

        {tab === 'security' ? (
          <Card>
            <CardSection
              title="安全設定"
              description="TLS、寫入權限與 chroot；變更後請套用並重啟才會生效"
            >
              <form
                onSubmit={(e) => {
                  void onSave(e);
                }}
              >
                <FormLayout columns={2}>
                  <Field
                    label="SSL 憑證域名"
                    htmlFor="sslDomain"
                    fullWidth
                    flush
                    hint="選已上傳／申請的憑證網域"
                  >
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
                  </Field>
                </FormLayout>
                <div className="form-check-row u-mt-4">
                  <CheckboxField
                    id="sslEnable"
                    label="啟用 FTPS（SSL/TLS）"
                    description="以 TLS 加密控制通道；建議開啟"
                    checked={settings.sslEnable}
                    onChange={(v) => patch('sslEnable', v)}
                  />
                  <CheckboxField
                    id="forceSsl"
                    label="強制 TLS 登入"
                    description="拒絕明文 FTP；需客戶端支援 FTPS"
                    checked={settings.forceSsl}
                    onChange={(v) => patch('forceSsl', v)}
                  />
                  <CheckboxField
                    id="writeEnable"
                    label="允許寫入"
                    description="關閉則帳戶僅能下載／列目錄"
                    checked={settings.writeEnable}
                    onChange={(v) => patch('writeEnable', v)}
                  />
                  <CheckboxField
                    id="chrootLocalUser"
                    label="Chroot 用戶"
                    description="登入後鎖在家目錄，無法瀏覽系統其他路徑"
                    checked={settings.chrootLocalUser}
                    onChange={(v) => patch('chrootLocalUser', v)}
                  />
                  <CheckboxField
                    id="allowWriteableChroot"
                    label="允許可寫 chroot"
                    description="家目錄可寫時仍啟用 chroot（vsftpd 常見需求）"
                    checked={settings.allowWriteableChroot}
                    onChange={(v) => patch('allowWriteableChroot', v)}
                  />
                </div>
                <FormHint>儲存只更新面板設定；「套用並重啟」才寫入 vsftpd.conf 並重載服務。</FormHint>
                <FormActions>
                  <Button type="submit" variant="secondary" size="md" loading={busy}>
                    儲存設定
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
                </FormActions>
              </form>
            </CardSection>
          </Card>
        ) : null}
      </PageTabs>

      <OpsResultPanel
        title="操作結果"
        result={result}
        message={msg}
        onRetry={
          installed && status?.active !== 'active'
            ? () => void onApplySettings()
            : undefined
        }
        busy={busy}
      />
    </FeaturePageLayout>
  );
}
