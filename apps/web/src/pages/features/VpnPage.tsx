/**
 * VPN — server (issue clients + QR) and client (import + connect).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormLayout,
  LoadingBlock,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  type OpsResultLike,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { api } from '../../shared/services/api';
import { notifyOk, notifyWarn } from '../../shared/lib/notify';
import {
  vpnApi,
  type VpnClientProfile,
  type VpnEngineStatus,
  type VpnPortPreset,
  type VpnServerPeer,
  type VpnStatusResponse,
} from '../../features/vpn/api';

const TABS = ['overview', 'server', 'client', 'install', 'about'] as const;

export function VpnPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VpnStatusResponse | null>(null);
  const [lastOps, setLastOps] = useState<OpsResultLike | null>(null);

  // Server form
  const [endpoint, setEndpoint] = useState('');
  const [listenPort, setListenPort] = useState(51820);
  const [peerName, setPeerName] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLabel, setQrLabel] = useState('');
  const [lastConfig, setLastConfig] = useState<string | null>(null);

  // Client form
  const [importName, setImportName] = useState('');
  const [importConf, setImportConf] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await vpnApi.status();
      setStatus(s);
      if (s.endpointHint) setEndpoint((e) => e || s.endpointHint || '');
      const wg = s.engines.find((e) => e.engine === 'wireguard');
      if (wg?.serverPort) setListenPort(wg.serverPort);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const wg = useMemo(
    () => status?.engines.find((e) => e.engine === 'wireguard') ?? null,
    [status],
  );
  const peers: VpnServerPeer[] = status?.serverPeers ?? [];
  const profiles: VpnClientProfile[] = status?.clientProfiles ?? [];
  const presets: VpnPortPreset[] =
    status?.portPresets?.filter((p) => p.engine === 'wireguard') ?? [];

  const runOps = async (
    fn: () => Promise<{
      ok: boolean;
      notes?: string[];
      blocked?: boolean;
      requiresExecute?: boolean;
      config?: string;
      peer?: VpnServerPeer;
    }>,
  ) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setLastOps({
        ok: r.ok,
        notes: r.notes,
        blocked: r.blocked,
        requiresExecute: r.requiresExecute,
      });
      if (r.ok) notifyOk(r.notes?.[0] || t('common.completed'));
      else notifyWarn(r.notes?.[0] || t('common.opFailed'));
      if (r.config) {
        setLastConfig(r.config);
        setQrLabel(r.peer?.name || 'client');
        try {
          const url = await QRCode.toDataURL(r.config, {
            errorCorrectionLevel: 'M',
            margin: 1,
            width: 280,
          });
          setQrDataUrl(url);
        } catch {
          setQrDataUrl(null);
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  };

  const engineBadge = (e: VpnEngineStatus) => (
    <div key={e.engine} className="vpn-engine-card">
      <div className="vpn-engine-card__head">
        <strong>{e.title}</strong>
        <Badge tone={e.installed ? 'ok' : 'warn'}>
          {e.installed ? t('vpn.installed') : t('vpn.notInstalled')}
        </Badge>
        {e.serverActive ? <Badge tone="ok">{t('vpn.serverUp')}</Badge> : null}
      </div>
      <p className="muted u-text-sm u-mb-0">
        {t('vpn.engineSummary', {
          port: e.serverPort ?? '—',
          peers: e.peerCount,
          clients: e.clientProfileCount,
          up: e.clientConnectedCount,
        })}
      </p>
      {e.notes?.[0] ? <p className="muted u-text-xs">{e.notes[0]}</p> : null}
    </div>
  );

  return (
    <FeaturePageLayout title={t('nav.vpn')} subtitle={t('vpn.pageDesc')}>
      <PageTabs
        tabs={TABS.map((id) => ({ id, label: t(`vpn.tab.${id}`) }))}
        active={tab}
        onChange={(id) => setTab(id as (typeof TABS)[number])}
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        {lastOps ? (
          <OpsResultPanel title={t('vpn.result')} result={lastOps} />
        ) : null}

        {tab === 'overview' ? (
          <div className="stack">
            {!status ? (
              <LoadingBlock />
            ) : (
              <>
                <Alert variant="info">
                  {status.executeEnabled
                    ? t('vpn.executeOn')
                    : t('vpn.executeOff')}
                </Alert>
                <div className="vpn-engine-grid">
                  {status.engines.map(engineBadge)}
                </div>
                <div className="u-flex-gap">
                  <Button size="sm" onClick={() => setTab('server')}>
                    {t('vpn.goServer')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setTab('client')}>
                    {t('vpn.goClient')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
                    {t('common.refresh')}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {tab === 'server' ? (
          <div className="stack">
            <SoftwareInstallBanner feature="wireguard" title={t('vpn.needWireGuard')} />
            <SoftwareVersionBar softwareId="wireguard" />

            <FormLayout>
              <Field label={t('vpn.listenPort')} htmlFor="vpn-port">
                <input
                  id="vpn-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={listenPort}
                  onChange={(e) => setListenPort(Number(e.target.value) || 51820)}
                />
              </Field>
              <div className="u-flex-gap u-flex-wrap">
                {presets.map((p) => (
                  <Button
                    key={`${p.port}-${p.proto}`}
                    size="sm"
                    variant={listenPort === p.port ? 'primary' : 'ghost'}
                    onClick={() => setListenPort(p.port)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
              <Field
                label={t('vpn.endpoint')}
                htmlFor="vpn-endpoint"
                hint={t('vpn.endpointHint')}
              >
                <input
                  id="vpn-endpoint"
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="vpn.example.com:51820"
                  autoComplete="off"
                />
              </Field>
              <FormActions>
                <Button
                  loading={busy}
                  onClick={() =>
                    void runOps(() =>
                      vpnApi.ensureServer({
                        engine: 'wireguard',
                        listenPort,
                        endpoint: endpoint || undefined,
                      }),
                    )
                  }
                >
                  {t('vpn.ensureServer')}
                </Button>
                <Button
                  variant="secondary"
                  loading={busy}
                  onClick={() =>
                    void runOps(() =>
                      vpnApi.openFirewall({ port: listenPort, proto: 'udp' }),
                    )
                  }
                >
                  {t('vpn.openFirewall', { port: listenPort })}
                </Button>
              </FormActions>
            </FormLayout>

            <h3 className="u-text-md">{t('vpn.peersTitle')}</h3>
            <FormLayout>
              <Field label={t('vpn.peerName')} htmlFor="vpn-peer-name">
                <input
                  id="vpn-peer-name"
                  type="text"
                  value={peerName}
                  onChange={(e) => setPeerName(e.target.value)}
                  placeholder="phone"
                />
              </Field>
              <FormActions>
                <Button
                  loading={busy}
                  disabled={!peerName.trim()}
                  onClick={() =>
                    void runOps(() =>
                      vpnApi.addPeer({ name: peerName.trim(), engine: 'wireguard' }),
                    )
                  }
                >
                  {t('vpn.addPeer')}
                </Button>
              </FormActions>
            </FormLayout>

            {peers.length === 0 ? (
              <EmptyState title={t('vpn.noPeers')} description={t('vpn.noPeersHint')} />
            ) : (
              <ul className="vpn-list">
                {peers.map((p) => (
                  <li key={p.id} className="vpn-list__item">
                    <div>
                      <strong>{p.name}</strong>
                      <span className="muted u-text-xs"> · {p.address}</span>
                    </div>
                    <div className="u-flex-gap">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void api
                            .downloadAuthenticated(
                              vpnApi.peerConfigPath(p.id),
                              `${p.name}.conf`,
                            )
                            .then(() => notifyOk(t('vpn.downloaded')))
                            .catch((e) =>
                              setError(
                                e instanceof Error ? e.message : t('common.loadFailed'),
                              ),
                            );
                        }}
                      >
                        {t('vpn.downloadKey')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          void (async () => {
                            try {
                              const text = await vpnApi.peerConfigText(p.id);
                              setLastConfig(text);
                              setQrLabel(p.name);
                              const url = await QRCode.toDataURL(text, {
                                errorCorrectionLevel: 'M',
                                margin: 1,
                                width: 280,
                              });
                              setQrDataUrl(url);
                              notifyOk(t('vpn.qrReady'));
                            } catch (e) {
                              setError(
                                e instanceof Error ? e.message : t('common.loadFailed'),
                              );
                            }
                          })();
                        }}
                      >
                        {t('vpn.showQr')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void runOps(() => vpnApi.deletePeer(p.id))
                        }
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {qrDataUrl ? (
              <div className="vpn-qr">
                <h3 className="u-text-md">{t('vpn.qrTitle', { name: qrLabel })}</h3>
                <img src={qrDataUrl} alt="WireGuard QR" width={280} height={280} />
                <p className="muted u-text-xs">{t('vpn.qrHint')}</p>
              </div>
            ) : null}
            {lastConfig ? (
              <details className="vpn-conf">
                <summary>{t('vpn.showConf')}</summary>
                <pre className="vpn-conf__pre">{lastConfig}</pre>
              </details>
            ) : null}
          </div>
        ) : null}

        {tab === 'client' ? (
          <div className="stack">
            <SoftwareInstallBanner feature="wireguard" title={t('vpn.needWireGuard')} />
            <Alert variant="info">{t('vpn.clientIntro')}</Alert>
            <FormLayout>
              <Field label={t('vpn.profileName')} htmlFor="vpn-import-name">
                <input
                  id="vpn-import-name"
                  type="text"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="office"
                />
              </Field>
              <Field label={t('vpn.pasteConf')} htmlFor="vpn-import-conf">
                <textarea
                  id="vpn-import-conf"
                  rows={8}
                  value={importConf}
                  onChange={(e) => setImportConf(e.target.value)}
                  placeholder="[Interface]&#10;PrivateKey = …"
                  spellCheck={false}
                  className="vpn-textarea"
                />
              </Field>
              <FormActions>
                <Button
                  loading={busy}
                  disabled={!importName.trim() || !importConf.trim()}
                  onClick={() =>
                    void runOps(() =>
                      vpnApi.importClient({
                        name: importName.trim(),
                        conf: importConf,
                        engine: 'wireguard',
                      }),
                    )
                  }
                >
                  {t('vpn.importProfile')}
                </Button>
              </FormActions>
            </FormLayout>

            {profiles.length === 0 ? (
              <EmptyState
                title={t('vpn.noProfiles')}
                description={t('vpn.noProfilesHint')}
              />
            ) : (
              <ul className="vpn-list">
                {profiles.map((p) => (
                  <li key={p.id} className="vpn-list__item">
                    <div>
                      <strong>{p.name}</strong>
                      <span className="muted u-text-xs"> · {p.iface}</span>
                      <Badge
                        tone={
                          p.status === 'up'
                            ? 'ok'
                            : p.status === 'down'
                              ? 'neutral'
                              : 'warn'
                        }
                      >
                        {p.status}
                      </Badge>
                    </div>
                    <div className="u-flex-gap">
                      <Button
                        size="sm"
                        onClick={() => void runOps(() => vpnApi.clientUp(p.id))}
                        disabled={busy || p.status === 'up'}
                      >
                        {t('vpn.connect')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void runOps(() => vpnApi.clientDown(p.id))}
                        disabled={busy}
                      >
                        {t('vpn.disconnect')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void runOps(() => vpnApi.deleteClient(p.id))}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {tab === 'install' ? (
          <div className="stack">
            <SoftwareInstallBanner feature="wireguard" title={t('vpn.needWireGuard')} />
            <SoftwareVersionBar softwareId="wireguard" />
            <SoftwareInstallBanner feature="openvpn" title={t('vpn.needOpenVpn')} />
            <SoftwareVersionBar softwareId="openvpn" />
            <Alert variant="info">{t('vpn.installNote')}</Alert>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="vpn" /> : null}
      </PageTabs>
    </FeaturePageLayout>
  );
}
