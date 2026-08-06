/**
 * vsftpd service page — professional console layout.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';
import {
  PageGuide,
  ActionBar,
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
  SoftwareVersionBar,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import { ftpApi, type FtpsSettings, type FtpsStatus } from '../../features/ftp';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { softwareApi } from '../../features/software';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';
import { bindSet } from '../bind-handlers';

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

export function statusLabel(s: FtpsStatus | null | undefined, t: (k: string) => string): { text: string; tone: 'ok' | 'warn' | 'danger' | 'neutral' } {
  if (!s) return { text: t('common.loading'), tone: 'neutral' };
  if (!s.installed) return { text: t('common.notInstalled'), tone: 'danger' };
  if (s.active === 'active') return { text: t('common.running'), tone: 'ok' };
  if (s.active === 'inactive') return { text: t('common.stopped'), tone: 'warn' };
  return { text: s.active || t('common.installed'), tone: 'warn' };
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
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
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
      return { ok: true, notes: [t('ftp.settingsSaved')] };
    }, t('common.savedOk'));
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
              t('ftp.installIncomplete'),
            notes,
          } satisfies OpsResultLike;
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : t('common.installFailed');
        return {
          ok: false,
          blocked: looksLikeBlockedMessage(m),
          blockMessage: m,
          notes: [m],
        } satisfies OpsResultLike;
      }
      const r = await ftpApi.apply({ settings, applySystem: true });
      await refresh();
      return r as unknown as OpsResultLike;
    }, t('ftp.ftpsReady'));
  }

  async function onApplySettings() {
    await run(async () => {
      const r = await ftpApi.apply({ settings, applySystem: true });
      await refresh();
      return r as unknown as OpsResultLike;
    }, t('ftp.settingsApplied'));
  }

  const st = statusLabel(status, t);
  const installed = Boolean(status?.installed);

  const tabs = [
    { id: 'lifecycle', label: t('common.lifecycle') },
    { id: 'overview', label: t('publicFiles.overview') },
    { id: 'network', label: t('system.network') },
    { id: 'security', label: t('nav.sections.security') },
    { id: 'about', label: t('common.about') },
  ];

  return (
    <FeaturePageLayout
      title={t('nav.ftpService', { defaultValue: t('nav.ftpService') })}
      status={{
        pill: {
          label: st.text,
          tone: st.tone === 'neutral' ? 'warn' : st.tone,
        },
        items: [
          {
            label: t('common.status'),
            value: st.text,
            tone: st.tone === 'neutral' ? 'neutral' : st.tone,
          },
          { label: t('common.port'), value: String(settings.listenPort) },
          {
            label: t('ftp.accounts'),
            value: status?.accountCount != null ? String(status.accountCount) : '—',
          },
          {
            label: 'FTPS',
            value: settings.sslEnable ? t('common.on') : t('common.off'),
            tone: settings.sslEnable ? 'ok' : 'warn',
          },
        ],
      }}
      actions={<ActionBar>
          <Link to="/ftp">
            <Button variant="secondary" size="sm">
              {t('ftp.accounts')}
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
            {t('common.refresh')}
          </Button>
        </ActionBar>
      }
    >
      <SoftwareInstallBanner
        feature="ftp"
        title={t('ftp.softwareMissingService')}
        onInstalled={() => void refresh()}
      />
      <SoftwareVersionBar softwareId="vsftpd" />
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error && !result ? <Alert variant="error">{error}</Alert> : null}
      <PageTabs tabs={tabs} active={tab} onChange={setTab} variant="scroll">
        {tab === 'lifecycle' ? (
          <Card>
            <CardSection title={t('common.lifecycle')} description={t('ftp.installStart')}>
              <div className="lifecycle-toolbar">
                {!installed ? (
                  <p className="muted u-text-sm u-mb-0">
                    {t('ftp.installFtpsBanner')}
                  </p>
                ) : status?.active !== 'active' ? (
                  <Button variant="primary" size="md" loading={busy} onClick={onApplySettings}>
                    {t('fail2ban.startService')}
                  </Button>
                ) : (
                  <Button variant="secondary" size="md" loading={busy} onClick={onApplySettings}>
                    {t('ftp.applyRestart')}
                  </Button>
                )}
              </div>
              {!installed ? (
                <p className="muted u-text-sm u-mt-3">
                  {t('ftp.afterInstall')}
                </p>
              ) : null}
            </CardSection>
          </Card>
        ) : null}

        {tab === 'overview' ? (
          <Card>
            <CardSection title={t('db.serviceOverview')} description={t('db.readonlyStatus')}>
              <DescriptionList
                columns={2}
                items={[
                  { label: t('common.status'), value: <Badge tone={st.tone}>{st.text}</Badge> },
                  { label: t('ftp.listenPort'), value: String(settings.listenPort) },
                  { label: t('ftp.accountCount'), value: status?.accountCount != null ? String(status.accountCount) : '—' },
                  { label: t('ftp.loginBanner'), value: settings.banner || '—' },
                  { label: t('ftp.sslDomain'), value: settings.sslDomain || '—' },
                  { label: t('ftp.pasvRange'), value: `${settings.pasvMin}–${settings.pasvMax}` },
                  { label: 'FTPS', value: settings.sslEnable ? t('common.open') : t('common.close') },
                  { label: t('ftp.forceTls'), value: settings.forceSsl ? t('common.yes') : t('common.no') },
                  { label: t('ftp.allowWrite'), value: settings.writeEnable ? t('common.yes') : t('common.no') },
                  { label: 'Chroot', value: settings.chrootLocalUser ? t('common.yes') : t('common.no') },
                ]}
              />
            </CardSection>
          </Card>
        ) : null}

        {tab === 'network' ? (
          <Card>
            <CardSection
              title={t('ftp.networkTitle')}
              description={t('ftp.networkDesc')}
            >
              <form
                onSubmit={(e) => {
                  void onSave(e);
                }}
              >
                <FormLayout columns={2}>
                  <Field
                    label={t('ftp.listenPort')}
                    htmlFor="listenPort"
                    flush
                    required
                    hint={t('ftp.listenPortHint')}
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
                      customPlaceholder={t('ftp.customPort')}
                    />
                  </Field>
                  <Field
                    label={t('ftp.ipStack')}
                    htmlFor="listenStack"
                    flush
                    hint={t('ftp.ipStackHint')}
                  >
                    <SegRadio
                      name="listenStack"
                      aria-label={t('ftp.ipStack')}
                      value={settings.listenIpv6 ? 'ipv6' : 'ipv4'}
                      onChange={(v) => {
                        setSettings((prev) =>
                          v === 'ipv6'
                            ? { ...prev, listenIpv6: true, listen: false }
                            : { ...prev, listenIpv6: false, listen: true },
                        );
                      }}
                      options={[
                        { value: 'ipv4', label: t('ftp.ipv4Only') },
                        { value: 'ipv6', label: t('ftp.ipv6Mapped') },
                      ]}
                    />
                  </Field>
                  <Field
                    label={t('ftp.loginBanner')}
                    htmlFor="banner"
                    flush
                    hint={t('ftp.bannerHint')}
                  >
                    <input
                      id="banner"
                      value={settings.banner}
                      onChange={(e) => patch('banner', e.target.value)}
                      placeholder="YSK FTPS"
                    />
                  </Field>
                  <Field
                    label={t('ftp.pasvStart')}
                    htmlFor="pasvMin"
                    flush
                    hint={t('ftp.pasvStartHint')}
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
                      customPlaceholder={t('ftp.customStart')}
                    />
                  </Field>
                  <Field
                    label={t('ftp.pasvEnd')}
                    htmlFor="pasvMax"
                    flush
                    hint={t('ftp.pasvEndHint')}
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
                      customPlaceholder={t('ftp.customEnd')}
                    />
                  </Field>
                  <Field
                    label={t('ftp.pasvPublicIp')}
                    htmlFor="pasvAddress"
                    fullWidth
                    flush
                    hint={t('ftp.pasvPublicIpHint')}
                  >
                    <input
                      id="pasvAddress"
                      value={settings.pasvAddress ?? ''}
                      onChange={(e) => patch('pasvAddress', e.target.value || undefined)}
                      placeholder={t('ftp.optionalEmpty')}
                      spellCheck={false}
                    />
                  </Field>
                </FormLayout>
                <FormActions>
                  <Button type="submit" variant="secondary" size="md" loading={busy}>
                    {t('ftp.saveSettings')}
                  </Button>
                  {installed ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={onApplySettings}
                    >
                      {t('ftp.applyRestart')}
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
              title={t('ftp.securityTitle')}
              description={t('ftp.securityDesc')}
            >
              <form
                onSubmit={(e) => {
                  void onSave(e);
                }}
              >
                <FormLayout columns={2}>
                  <Field
                    label={t('ftp.sslCertDomain')}
                    htmlFor="sslDomain"
                    fullWidth
                    flush
                    hint={t('ftp.sslCertDomainHint')}
                  >
                    <select
                      id="sslDomain"
                      value={settings.sslDomain}
                      onChange={(e) => patch('sslDomain', e.target.value)}
                    >
                      <option value="">{t('security.ssh.selectOption')}</option>
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
                    label={t('ftp.enableFtps')}
                    description={t('ftp.enableFtpsDesc')}
                    checked={settings.sslEnable}
                    onChange={(v) => patch('sslEnable', v)}
                  />
                  <CheckboxField
                    id="forceSsl"
                    label={t('ftp.forceTlsLogin')}
                    description={t('ftp.forceTlsLoginDesc')}
                    checked={settings.forceSsl}
                    onChange={(v) => patch('forceSsl', v)}
                  />
                  <CheckboxField
                    id="writeEnable"
                    label={t('ftp.allowWrite')}
                    description={t('ftp.allowWriteDesc')}
                    checked={settings.writeEnable}
                    onChange={(v) => patch('writeEnable', v)}
                  />
                  <CheckboxField
                    id="chrootLocalUser"
                    label={t('ftp.chrootUsers')}
                    description={t('ftp.chrootUsersDesc')}
                    checked={settings.chrootLocalUser}
                    onChange={(v) => patch('chrootLocalUser', v)}
                  />
                  <CheckboxField
                    id="allowWriteableChroot"
                    label={t('ftp.writableChroot')}
                    description={t('ftp.writableChrootDesc')}
                    checked={settings.allowWriteableChroot}
                    onChange={(v) => patch('allowWriteableChroot', v)}
                  />
                </div>
                <FormHint>{t('ftp.saveApplyHint')}</FormHint>
                <FormActions>
                  <Button type="submit" variant="secondary" size="md" loading={busy}>
                    {t('ftp.saveSettings')}
                  </Button>
                  {installed ? (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      loading={busy}
                      onClick={onApplySettings}
                    >
                      {t('ftp.applyRestart')}
                    </Button>
                  ) : null}
                </FormActions>
              </form>
            </CardSection>
          </Card>
        ) : null}
      
        {tab === 'about' ? <PageGuide guideId="ftpService" /> : null}
      </PageTabs>

      <OpsResultPanel
        title={t('systemd.opsResult')}
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
