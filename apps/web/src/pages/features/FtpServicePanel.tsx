/**
 * vsftpd service panel — overview, network, security (used inside unified /ftp page).
 */
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { looksLikeBlockedMessage } from '../../shared/lib/operator-messages';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardSection,
  CheckboxField,
  DescriptionList,
  Field,
  FormActions,
  FormLayout,
  OpsResultPanel,
  PresetChips,
  SegRadio,
} from '../../shared/components/ui';
import type { OpsResultLike } from '../../shared/components/ui';
import {
  EMPTY_FTPS_SETTINGS,
  ftpApi,
  ftpsOpenPortList,
  statusLabel,
  type FtpsSettings,
  type FtpsStatus,
} from '../../features/ftp';
import { useFeatureAction } from '../../features/system/useFeatureAction';
import { softwareApi } from '../../features/software';
import { systemApi } from '../../features/system';
import { sanitizeOperatorNotes } from '../../shared/lib/operator-messages';

export type FtpServicePanelProps = {
  /** When parent already loads status (optional refresh hook-in) */
  onStatusChange?: (status: FtpsStatus | null) => void;
};

export function FtpServicePanel({ onStatusChange }: FtpServicePanelProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<FtpsSettings>(EMPTY_FTPS_SETTINGS);
  const [status, setStatus] = useState<FtpsStatus | null>(null);
  const [domains, setDomains] = useState<Array<{ value: string; label: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { busy, error, result, msg, run, setMsg, setError } = useFeatureAction();

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const [s, o] = await Promise.all([ftpApi.settings(), ftpApi.options()]);
      setSettings({ ...EMPTY_FTPS_SETTINGS, ...s.settings });
      setStatus(s.status);
      onStatusChange?.({ ...s.status, settings: s.settings });
      setDomains(o.domains);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t, onStatusChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function patch<K extends keyof FtpsSettings>(key: K, value: FtpsSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  const openPorts = useMemo(() => ftpsOpenPortList(settings), [settings]);
  const needPasvPublicIp = !String(settings.pasvAddress ?? '').trim();

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

  async function onOpenFirewallPorts() {
    await run(async () => {
      const notes: string[] = [];
      let ok = true;
      for (const port of openPorts) {
        const r = (await systemApi.firewallAllowPort(port, 'tcp')) as {
          ok?: boolean;
          notes?: string[];
          blockMessage?: string;
        };
        if (r.notes?.length) notes.push(...r.notes.map(String));
        if (r.ok === false) {
          ok = false;
          if (r.blockMessage) notes.push(r.blockMessage);
        }
      }
      return {
        ok,
        notes: notes.length
          ? notes
          : [t('ftp.firewallPortsApplied', { ports: openPorts.join(', ') })],
        blockMessage: ok ? undefined : notes[0],
      } satisfies OpsResultLike;
    }, t('ftp.firewallPortsApplied', { ports: openPorts.join(', ') }));
  }

  const st = statusLabel(status, t);
  const installed = Boolean(status?.installed);
  const running = status?.active === 'active';

  return (
    <div className="tab-panel ftp-service-panel">
      {loadError ? <Alert variant="error">{loadError}</Alert> : null}
      {error && !result ? <Alert variant="error">{error}</Alert> : null}

      <Card>
        <CardSection title={t('publicFiles.overview')}>
          <DescriptionList
            columns={2}
            items={[
              {
                label: t('common.status'),
                value: <Badge tone={st.tone}>{st.text}</Badge>,
              },
              {
                label: t('ftp.listenPort'),
                value: String(settings.listenPort),
              },
              {
                label: t('ftp.accountCount'),
                value:
                  status?.accountCount != null ? String(status.accountCount) : '—',
              },
              {
                label: t('ftp.pasvRange'),
                value: `${settings.pasvMin}–${settings.pasvMax}`,
              },
              {
                label: t('ftp.pasvPublicIp'),
                value: settings.pasvAddress?.trim() || (
                  <Badge tone="warn">{t('common.missing')}</Badge>
                ),
              },
              {
                label: 'FTPS',
                value: settings.sslEnable ? t('common.on') : t('common.off'),
              },
              {
                label: t('ftp.sslDomain'),
                value: settings.sslDomain || '—',
              },
              {
                label: t('ftp.allowWrite'),
                value: settings.writeEnable ? t('common.yes') : t('common.no'),
              },
            ]}
          />
          <div className="ftps-overview-actions">
            {!installed ? (
              <Button
                variant="primary"
                size="md"
                loading={busy}
                onClick={() => void onInstallAndStart()}
              >
                {t('ftp.installAndStart')}
              </Button>
            ) : (
              <Button
                variant={running ? 'secondary' : 'primary'}
                size="md"
                loading={busy}
                onClick={() => void onApplySettings()}
              >
                {running ? t('ftp.applyRestart') : t('fail2ban.startService')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="md"
              loading={busy}
              onClick={() => void onOpenFirewallPorts()}
            >
              {t('ftp.openFirewallPorts')}
            </Button>
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
              {t('common.refresh')}
            </Button>
          </div>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('system.network')}>
          <form
            onSubmit={(e) => {
              void onSave(e);
            }}
          >
            <FormLayout columns={2}>
              <Field label={t('ftp.listenPort')} htmlFor="listenPort" flush required>
                <PresetChips
                  options={[
                    { value: '21', label: '21' },
                    { value: '2121', label: '2121' },
                    { value: '990', label: '990' },
                  ]}
                  value={String(settings.listenPort)}
                  onChange={(v) => patch('listenPort', Number(v) || 21)}
                  allowCustom
                  customPlaceholder={t('ftp.customPort')}
                />
              </Field>
              <Field label={t('ftp.ipStack')} htmlFor="listenStack" flush>
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
                    { value: 'ipv4', label: 'IPv4' },
                    { value: 'ipv6', label: 'IPv6' },
                  ]}
                />
              </Field>
              <Field label={t('ftp.pasvStart')} htmlFor="pasvMin" flush>
                <input
                  id="pasvMin"
                  type="number"
                  value={settings.pasvMin}
                  onChange={(e) => patch('pasvMin', Number(e.target.value) || 30000)}
                />
              </Field>
              <Field label={t('ftp.pasvEnd')} htmlFor="pasvMax" flush>
                <input
                  id="pasvMax"
                  type="number"
                  value={settings.pasvMax}
                  onChange={(e) => patch('pasvMax', Number(e.target.value) || 30100)}
                />
              </Field>
              <Field
                label={t('ftp.pasvPublicIp')}
                htmlFor="pasvAddress"
                fullWidth
                flush
                required={needPasvPublicIp}
              >
                <input
                  id="pasvAddress"
                  value={settings.pasvAddress ?? ''}
                  onChange={(e) => patch('pasvAddress', e.target.value || undefined)}
                  placeholder="x.x.x.x"
                  spellCheck={false}
                />
              </Field>
              <Field label={t('ftp.loginBanner')} htmlFor="banner" flush>
                <input
                  id="banner"
                  value={settings.banner}
                  onChange={(e) => patch('banner', e.target.value)}
                />
              </Field>
            </FormLayout>
            <FormActions>
              <Button type="submit" variant="secondary" size="md" loading={busy}>
                {t('common.save')}
              </Button>
              {installed ? (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => void onApplySettings()}
                >
                  {t('ftp.applyRestart')}
                </Button>
              ) : null}
            </FormActions>
          </form>
        </CardSection>
      </Card>

      <Card>
        <CardSection title={t('nav.sections.security')}>
          <form
            onSubmit={(e) => {
              void onSave(e);
            }}
          >
            <FormLayout columns={2}>
              <Field label={t('ftp.sslCertDomain')} htmlFor="sslDomain" fullWidth flush>
                <select
                  id="sslDomain"
                  value={settings.sslDomain}
                  onChange={(e) => patch('sslDomain', e.target.value)}
                >
                  <option value="">{t('common.noneSelectedShort')}</option>
                  {domains.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </Field>
            </FormLayout>
            <div className="form-check-row u-mt-3">
              <CheckboxField
                id="sslEnable"
                label={t('ftp.enableFtps')}
                checked={settings.sslEnable}
                onChange={(v) => patch('sslEnable', v)}
              />
              <CheckboxField
                id="forceSsl"
                label={t('ftp.forceTlsLogin')}
                checked={settings.forceSsl}
                onChange={(v) => patch('forceSsl', v)}
              />
              <CheckboxField
                id="writeEnable"
                label={t('ftp.allowWrite')}
                checked={settings.writeEnable}
                onChange={(v) => patch('writeEnable', v)}
              />
              <CheckboxField
                id="chrootLocalUser"
                label={t('ftp.chrootUsers')}
                checked={settings.chrootLocalUser}
                onChange={(v) => patch('chrootLocalUser', v)}
              />
              <CheckboxField
                id="allowWriteableChroot"
                label={t('ftp.writableChroot')}
                checked={settings.allowWriteableChroot}
                onChange={(v) => patch('allowWriteableChroot', v)}
              />
            </div>
            <FormActions>
              <Button type="submit" variant="secondary" size="md" loading={busy}>
                {t('common.save')}
              </Button>
              {installed ? (
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  loading={busy}
                  onClick={() => void onApplySettings()}
                >
                  {t('ftp.applyRestart')}
                </Button>
              ) : null}
            </FormActions>
          </form>
        </CardSection>
      </Card>

      <OpsResultPanel
        title={t('systemd.opsResult')}
        result={result}
        message={msg}
        onRetry={installed && !running ? () => void onApplySettings() : undefined}
        busy={busy}
      />
    </div>
  );
}
