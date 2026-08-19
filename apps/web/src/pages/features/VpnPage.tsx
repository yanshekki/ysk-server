/**
 * VPN — per-engine server tabs (WG / OpenVPN / SS) + local client + about.
 * Port changes keep public endpoint host:port in sync.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'qrcode';
import {
  ActionBar,
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormLayout,
  Modal,
  OpsResultPanel,
  PageGuide,
  PageTabs,
  SegRadio,
  SoftwareInstallBanner,
  SoftwareVersionBar,
  type OpsResultLike,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { isCidr } from 'ysk-server-shared';
import { api } from '../../shared/services/api';
import { notifyError, notifyOk, notifyWarn } from '../../shared/lib/notify';
import { formatDateTime } from '../../shared/lib/datetime';
import { hostTimeZoneOpts } from '../../shared/lib/host-timezone';
import {
  vpnApi,
  type VpnClientProfile,
  type VpnEngineId,
  type VpnEngineStatus,
  type VpnMonitorResponse,
  type VpnPortPreset,
  type VpnPresence,
  type VpnServerPeer,
  type VpnStatusResponse,
} from '../../features/vpn/api';
import {
  buildEndpoint,
  confDownloadName,
  defaultPortForEngine,
  detectClientEngine,
  firewallProtoForEngine,
  hostFromEndpoint,
  isVpnPeerName,
  parseListenPortInput,
  previewVpnPeerName,
  syncEndpointPort,
  type VpnEngineTab,
} from '../../features/vpn/endpoint-sync';
import { ServiceAccessStrip } from '../../features/network/service-exposure';
import { ServiceLifecycleBar } from '../../features/system/ServiceLifecycleBar';
import {
  formatVpnBytes,
  formatVpnRate,
  formatVpnWhen,
} from '../../features/vpn/format';

const TABS = [
  'wireguard',
  'openvpn',
  'outline',
  'client',
  'monitor',
  'software',
  'about',
] as const;
type TabId = (typeof TABS)[number];

const MONITOR_POLL_MS = 3000;

function presenceTone(
  p: VpnPresence,
): 'ok' | 'warn' | 'neutral' | 'danger' {
  if (p === 'online') return 'ok';
  if (p === 'idle') return 'warn';
  if (p === 'offline' || p === 'never') return 'neutral';
  return 'neutral';
}

function engineLabel(e: VpnEngineId): string {
  if (e === 'openvpn') return 'OpenVPN';
  if (e === 'outline') return 'Shadowsocks';
  return 'WireGuard';
}

function isServerTab(t: TabId): t is VpnEngineTab {
  return t === 'wireguard' || t === 'openvpn' || t === 'outline';
}

function engineStatus(
  status: VpnStatusResponse | null,
  engine: VpnEngineId,
): VpnEngineStatus | undefined {
  return status?.engines.find((e) => e.engine === engine);
}

function formatWhen(iso?: string): string {
  return formatDateTime(iso, { withOffset: true, ...hostTimeZoneOpts({ withOffset: true }) });
}

export function maskVpnPrivateKeys(text: string): string {
  return String(text ?? '').replace(/^(\s*PrivateKey\s*=\s*).+$/gim, '$1••••••••');
}

export function VpnPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'wireguard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<VpnStatusResponse | null>(null);
  const [lastOps, setLastOps] = useState<OpsResultLike | null>(null);
  const [resultTab, setResultTab] = useState<TabId | null>(null);

  // Shared server form (values follow active engine tab)
  const [endpoint, setEndpoint] = useState('');
  const [listenPort, setListenPort] = useState(51820);
  const [listenPortText, setListenPortText] = useState('51820');
  const [portError, setPortError] = useState<string | null>(null);
  const [ovpnProto, setOvpnProto] = useState<'udp' | 'tcp'>('udp');
  const [accessMode, setAccessMode] = useState<'full' | 'lan' | 'custom'>('full');
  const [lanCidrs, setLanCidrs] = useState<string[]>([
    '10.0.0.0/8',
    '172.16.0.0/12',
    '192.168.0.0/16',
  ]);
  const [customCidrInput, setCustomCidrInput] = useState('');
  const [customCidrs, setCustomCidrs] = useState<string[]>([]);
  const [cidrError, setCidrError] = useState<string | null>(null);
  const [peerName, setPeerName] = useState('');
  const [peerNameTouched, setPeerNameTouched] = useState(false);

  // QR / conf modal
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgLabel, setCfgLabel] = useState('');
  const [cfgText, setCfgText] = useState('');
  const [cfgQr, setCfgQr] = useState<string | null>(null);
  const [cfgEngine, setCfgEngine] = useState<VpnEngineTab>('wireguard');
  const [cfgRevealKey, setCfgRevealKey] = useState(false);
  const [cfgQrTried, setCfgQrTried] = useState(false);
  const [pendingPeer, setPendingPeer] = useState<VpnServerPeer | null>(null);

  // Client import modal
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState('');
  const [importConf, setImportConf] = useState('');
  const [clientEngine, setClientEngine] = useState<'wireguard' | 'openvpn' | 'auto'>(
    'auto',
  );

  // Monitor
  const [monitor, setMonitor] = useState<VpnMonitorResponse | null>(null);
  const [monFilter, setMonFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [monEngine, setMonEngine] = useState<'all' | VpnEngineId>('all');
  const [monBusy, setMonBusy] = useState(false);

  const hintHost = useMemo(() => {
    const h = status?.endpointHint ?? '';
    return hostFromEndpoint(h, h) || '';
  }, [status?.endpointHint]);

  const activeEngine: VpnEngineTab = isServerTab(tab as TabId)
    ? (tab as VpnEngineTab)
    : 'wireguard';

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await vpnApi.status();
      setStatus(s);
      setEndpoint((prev) => {
        const hint = (s.endpointHint || '').trim();
        const prevHost = hostFromEndpoint(prev, '');
        // Drop invalid digit-only host typos (e.g. 51820:1194)
        if (prev.trim() && !prevHost) {
          return hint || '';
        }
        if (prevHost && prevHost !== 'vpn.example.com') return prev;
        if (!hint) return prevHost === 'vpn.example.com' ? '' : prev;
        if (!/:\d+$/.test(hint) && !hint.startsWith('[')) {
          return `${hint}:51820`;
        }
        return hint;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMonitor = useCallback(async () => {
    try {
      setMonBusy(true);
      const m = await vpnApi.monitor();
      setMonitor(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setMonBusy(false);
    }
  }, [t]);

  // Poll while Monitor tab is active and page visible
  useEffect(() => {
    if (tab !== 'monitor') return;
    void loadMonitor();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadMonitor();
    }, MONITOR_POLL_MS);
    return () => window.clearInterval(id);
  }, [tab, loadMonitor]);

  // Engine tab switch (or first status load): port defaults + endpoint :port sync
  const statusReady = Boolean(status);
  useEffect(() => {
    if (!isServerTab(tab as TabId)) return;
    const eng = tab as VpnEngineTab;
    const st = engineStatus(status, eng);
    const nextPort =
      st?.serverPort && st.serverPort > 0
        ? st.serverPort
        : defaultPortForEngine(eng, ovpnProto);
    setListenPort(nextPort);
    setListenPortText(String(nextPort));
    setPortError(null);
    if (st?.serverProto === 'tcp' || st?.serverProto === 'udp') {
      setOvpnProto(st.serverProto);
    }
    setEndpoint((prev) => syncEndpointPort(prev, nextPort, hintHost));
    // statusReady: re-run once when status first arrives; not on every refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, statusReady, hintHost]);

  const setPort = (port: number, proto?: 'udp' | 'tcp') => {
    if (!Number.isInteger(port) || port < 1 || port > 65535) return;
    setListenPort(port);
    setListenPortText(String(port));
    setPortError(null);
    if (proto) setOvpnProto(proto);
    setEndpoint((prev) => syncEndpointPort(prev, port, hintHost));
  };

  const peers: VpnServerPeer[] = useMemo(
    () =>
      (status?.serverPeers ?? []).filter((p) =>
        isServerTab(tab as TabId) ? p.engine === tab : false,
      ),
    [status?.serverPeers, tab],
  );

  const profiles: VpnClientProfile[] = status?.clientProfiles ?? [];
  const presets: VpnPortPreset[] = useMemo(
    () =>
      (status?.portPresets ?? []).filter((p) =>
        isServerTab(tab as TabId) ? p.engine === tab : false,
      ),
    [status?.portPresets, tab],
  );

  const engSt = isServerTab(tab as TabId)
    ? engineStatus(status, tab as VpnEngineId)
    : undefined;

  const fwProto = firewallProtoForEngine(
    isServerTab(tab as TabId) ? (tab as VpnEngineTab) : 'wireguard',
    ovpnProto,
  );

  const openConfigModal = async (
    engine: VpnEngineTab,
    name: string,
    text: string,
  ) => {
    setCfgEngine(engine);
    setCfgLabel(name);
    setCfgText(text);
    setCfgRevealKey(false);
    setCfgQr(null);
    setCfgQrTried(false);
    setCfgOpen(true);
  };

  useEffect(() => {
    if (!cfgOpen || !cfgText) {
      setCfgQr(null);
      setCfgQrTried(false);
      return;
    }
    if (cfgEngine !== 'wireguard' && cfgEngine !== 'outline') {
      setCfgQr(null);
      setCfgQrTried(true);
      return;
    }
    let cancelled = false;
    setCfgQrTried(false);
    const toDataUrl =
      typeof QRCode.toDataURL === 'function'
        ? QRCode.toDataURL.bind(QRCode)
        : (
            QRCode as { default?: { toDataURL?: typeof QRCode.toDataURL } }
          ).default?.toDataURL?.bind(
            (QRCode as { default?: unknown }).default ?? QRCode,
          );
    if (!toDataUrl) {
      setCfgQr(null);
      setCfgQrTried(true);
      return;
    }
    void toDataUrl(cfgText, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 280,
    })
      .catch(() =>
        toDataUrl(cfgText, {
          errorCorrectionLevel: 'L',
          margin: 1,
          width: 280,
        }),
      )
      .then((url) => {
        if (!cancelled) {
          setCfgQr(typeof url === 'string' && url ? url : null);
          setCfgQrTried(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCfgQr(null);
          setCfgQrTried(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cfgOpen, cfgText, cfgEngine]);

  const runOps = async (
    fn: () => Promise<{
      ok: boolean;
      notes?: string[];
      blocked?: boolean;
      requiresExecute?: boolean;
      config?: string;
      peer?: VpnServerPeer;
    }>,
    opts?: { openConfig?: boolean; engine?: VpnEngineTab },
  ) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setResultTab(tab as TabId);
      setLastOps({
        ok: r.ok,
        notes: r.notes,
        blocked: r.blocked,
        requiresExecute: r.requiresExecute,
      });
      if (r.ok) notifyOk(r.notes?.[0] || t('common.completed'));
      else {
        const fail = (r.notes ?? []).map(String).filter(Boolean).join(' · ') || t('common.opFailed');
        setError(fail);
        notifyWarn(fail);
      }
      if (r.config && opts?.openConfig !== false) {
        await openConfigModal(
          opts?.engine ?? activeEngine,
          r.peer?.name || 'client',
          r.config,
        );
      }
      await load();
      return r;
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.loadFailed');
      setResultTab(tab as TabId);
      setError(msg);
      notifyError(msg);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const downloadPeer = (p: VpnServerPeer) => {
    const eng = p.engine as VpnEngineTab;
    void api
      .downloadAuthenticated(
        vpnApi.peerConfigPath(p.id),
        confDownloadName(eng, p.name),
      )
      .then(() => notifyOk(t('vpn.downloaded')))
      .catch((e) =>
        setError(e instanceof Error ? e.message : t('common.loadFailed')),
      );
  };

  const showPeerQr = async (p: VpnServerPeer) => {
    try {
      const text = await vpnApi.peerConfigText(p.id);
      await openConfigModal(p.engine as VpnEngineTab, p.name, text);
      notifyOk(t('vpn.qrReady'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifyOk(t('vpn.copied'));
    } catch {
      notifyWarn(t('common.opFailed'));
    }
  };

  const peersTitleKey =
    tab === 'openvpn'
      ? 'vpn.peersTitleOvpn'
      : tab === 'outline'
        ? 'vpn.peersTitleSs'
        : 'vpn.peersTitleWg';

  const addPeerLabel =
    tab === 'openvpn'
      ? t('vpn.addPeerOvpn')
      : tab === 'outline'
        ? t('vpn.addPeerSs')
        : t('vpn.addPeerWg');

  const portLabel =
    tab === 'openvpn'
      ? ovpnProto === 'tcp'
        ? t('vpn.listenPortTcp')
        : t('vpn.listenPortUdp')
      : tab === 'wireguard'
        ? t('vpn.listenPortUdp')
        : t('vpn.listenPort');

  const statusPill = (() => {
    if (!status) {
      return { label: '…', tone: 'neutral' as const };
    }
    if (tab === 'software') {
      const installed = (status?.engines ?? []).filter((e) => e.installed).length;
      const running = (status?.engines ?? []).filter((e) => e.serverActive).length;
      return {
        label: t('vpn.engineSummarySoftware', { installed, running }),
        tone: (running > 0 ? 'ok' : installed > 0 ? 'warn' : 'neutral') as
          | 'ok'
          | 'warn'
          | 'neutral',
      };
    }
    if (!isServerTab(tab as TabId)) {
      const up = profiles.filter((p) => p.status === 'up').length;
      return {
        label: t('vpn.engineSummaryClient', {
          count: profiles.length,
          up,
        }),
        tone: (up > 0 ? 'ok' : profiles.length ? 'warn' : 'neutral') as
          | 'ok'
          | 'warn'
          | 'neutral',
      };
    }
    const up = Boolean(engSt?.serverActive);
    const appliedPort =
      engSt?.serverPort && engSt.serverPort > 0 ? engSt.serverPort : null;
    return {
      label: t('vpn.statusLine', {
        state: up ? t('vpn.serverUp') : t('vpn.serverDown'),
        port: appliedPort ?? '—',
        proto: fwProto === 'both' ? 'tcp+udp' : fwProto,
        peers: peers.length,
      }),
      tone: (up ? 'ok' : engSt?.installed ? 'warn' : 'neutral') as
        | 'ok'
        | 'warn'
        | 'neutral',
    };
  })();

  const renderServerPanel = (engine: VpnEngineTab) => (
    <div className="stack vpn-tab-section">
      {engine === 'outline' ? (
        <Alert variant="info">{t('vpn.ssHonestUi')}</Alert>
      ) : null}
      {status && !engSt?.installed ? (
        <Alert variant="warn">{t('vpn.engineNotInstalled')}</Alert>
      ) : status && !engSt?.serverActive ? (
        <Alert variant="warn">
          {t('vpn.serverNotListening', {
            port: listenPort,
          })}
        </Alert>
      ) : null}

      <section className="stack vpn-server-settings" aria-label={t('vpn.serverSettings')}>
        <FormLayout columns={2}>
          <Field
            label={portLabel}
            htmlFor={`vpn-port-${engine}`}
            error={portError ?? undefined}
            flush
          >
            <input
              id={`vpn-port-${engine}`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={listenPortText}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, '');
                setListenPortText(raw);
                const n = parseListenPortInput(raw);
                if (n != null) {
                  setPort(n);
                } else {
                  setPortError(
                    raw ? t('vpn.portInvalid') : t('vpn.portRequired'),
                  );
                }
              }}
            />
          </Field>
          {engine === 'openvpn' ? (
            <Field label={t('vpn.proto')} htmlFor="vpn-proto" flush>
              <SegRadio
                name="vpn-proto"
                aria-label={t('vpn.proto')}
                value={ovpnProto}
                onChange={(v) => {
                  const proto = v as 'udp' | 'tcp';
                  setOvpnProto(proto);
                  // Suggest conventional port when switching proto
                  const suggested = defaultPortForEngine('openvpn', proto);
                  setPort(suggested, proto);
                }}
                options={[
                  { value: 'udp', label: t('vpn.protoUdp') },
                  { value: 'tcp', label: t('vpn.protoTcp') },
                ]}
              />
            </Field>
          ) : null}
          <Field
            label={t('vpn.endpoint')}
            htmlFor={`vpn-endpoint-${engine}`}
            hint={t('vpn.endpointHint')}
            fullWidth
            flush
          >
            <input
              id={`vpn-endpoint-${engine}`}
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={`vpn.example.com:${listenPort}`}
              autoComplete="off"
            />
          </Field>
        </FormLayout>

        {presets.length > 0 ? (
          <div className="u-flex-gap u-flex-wrap" role="group" aria-label={t('vpn.presets')}>
            {presets.map((p) => (
              <Button
                key={`${p.port}-${p.proto}`}
                size="sm"
                variant={
                  listenPort === p.port &&
                  (engine !== 'openvpn' ||
                    p.proto === 'both' ||
                    p.proto === ovpnProto)
                    ? 'primary'
                    : 'ghost'
                }
                title={t(`vpn.portHint.${p.port}`, {
                  defaultValue: p.label,
                })}
                onClick={() => {
                  const proto =
                    p.proto === 'tcp' || p.proto === 'udp' ? p.proto : undefined;
                  setPort(p.port, proto);
                }}
              >
                {p.label}
              </Button>
            ))}
          </div>
        ) : null}

        {engine === 'openvpn' || engine === 'wireguard' ? (
          <div className="stack vpn-access-block">
            <Field label={t('vpn.access.label')} htmlFor={`vpn-access-${engine}`} flush>
              <SegRadio
                name={`vpn-access-${engine}`}
                aria-label={t('vpn.access.label')}
                value={accessMode}
                onChange={(v) => setAccessMode(v as 'full' | 'lan' | 'custom')}
                options={[
                  { value: 'full', label: t('vpn.access.full') },
                  { value: 'lan', label: t('vpn.access.lan') },
                  { value: 'custom', label: t('vpn.access.custom') },
                ]}
              />
            </Field>
            <p className="muted u-text-xs vpn-access-hint">
              {accessMode === 'full'
                ? t('vpn.access.fullHint')
                : accessMode === 'lan'
                  ? t('vpn.access.lanHint')
                  : t('vpn.access.customHint')}
            </p>
            {accessMode === 'lan' ? (
              <div className="u-flex-gap u-flex-wrap" role="group" aria-label={t('vpn.access.lanCidrs')}>
                {['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'].map((c) => {
                  const on = lanCidrs.includes(c);
                  return (
                    <Button
                      key={c}
                      size="sm"
                      variant={on ? 'primary' : 'ghost'}
                      onClick={() =>
                        setLanCidrs((prev) =>
                          on ? prev.filter((x) => x !== c) : [...prev, c],
                        )
                      }
                    >
                      {c}
                    </Button>
                  );
                })}
              </div>
            ) : null}
            {accessMode === 'custom' ? (
              <form
                noValidate
                className="stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  const c = customCidrInput.trim();
                  if (!c) {
                    setCidrError(t('vpn.access.cidrRequired'));
                    return;
                  }
                  if (!isCidr(c)) {
                    setCidrError(t('vpn.access.cidrInvalid'));
                    return;
                  }
                  setCustomCidrs((prev) =>
                    prev.includes(c) ? prev : [...prev, c],
                  );
                  setCustomCidrInput('');
                  setCidrError(null);
                }}
              >
                <Field
                  label={t('vpn.access.customCidr')}
                  htmlFor={`vpn-cidr-${engine}`}
                  required
                  error={cidrError ?? undefined}
                  flush
                >
                  <div className="u-flex u-gap-2 u-flex-wrap u-items-center">
                    <input
                      id={`vpn-cidr-${engine}`}
                      className="u-input u-w-control-sm"
                      value={customCidrInput}
                      onChange={(e) => {
                        setCustomCidrInput(e.target.value);
                        if (cidrError) setCidrError(null);
                      }}
                      placeholder="192.168.1.0/24"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="secondary"
                      disabled={!customCidrInput.trim()}
                      title={
                        !customCidrInput.trim()
                          ? t('vpn.access.cidrRequired')
                          : undefined
                      }
                    >
                      {t('vpn.access.addCidr')}
                    </Button>
                  </div>
                </Field>
                <div className="u-flex u-gap-2 u-flex-wrap">
                  {customCidrs.map((c) => (
                    <Button
                      key={c}
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setCustomCidrs((p) => p.filter((x) => x !== c))
                      }
                    >
                      {c} ×
                    </Button>
                  ))}
                </div>
              </form>
            ) : null}
          </div>
        ) : null}

        <ActionBar>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={!engSt?.installed || parseListenPortInput(listenPortText) == null}
            title={
              !engSt?.installed
                ? t('vpn.engineNotInstalled')
                : parseListenPortInput(listenPortText) == null
                  ? t('vpn.portInvalid')
                  : undefined
            }
            onClick={() => {
              const port = parseListenPortInput(listenPortText);
              if (port == null) {
                setPortError(t('vpn.portInvalid'));
                return;
              }
              if (
                (engine === 'openvpn' || engine === 'wireguard') &&
                accessMode === 'custom' &&
                customCidrs.length === 0
              ) {
                setCidrError(t('vpn.access.cidrRequired'));
                return;
              }
              void runOps(
                () =>
                  vpnApi.ensureServer({
                    engine,
                    listenPort: port,
                    // Never send digit-only host typos like "51820:1194"
                    endpoint: (() => {
                      const h = hostFromEndpoint(endpoint, '');
                      return h
                        ? buildEndpoint(h, port) || undefined
                        : undefined;
                    })(),
                    proto: engine === 'openvpn' ? ovpnProto : undefined,
                    accessMode:
                      engine === 'openvpn' || engine === 'wireguard'
                        ? accessMode
                        : undefined,
                    lanCidrs:
                      (engine === 'openvpn' || engine === 'wireguard') &&
                      accessMode === 'lan'
                        ? lanCidrs
                        : undefined,
                    customCidrs:
                      (engine === 'openvpn' || engine === 'wireguard') &&
                      accessMode === 'custom'
                        ? customCidrs
                        : undefined,
                  }),
                { openConfig: false },
              );
            }}
          >
            {t('vpn.ensureServer')}
          </Button>
          <Button variant="ghost" size="sm" loading={busy} onClick={() => void load()}>
            {t('vpn.refresh')}
          </Button>
          <ServiceLifecycleBar
            unit={
              engine === 'openvpn'
                ? 'openvpn-server@ysk'
                : engine === 'outline'
                  ? 'ysk-ss-server'
                  : 'wg-quick@wg0'
            }
            label={engineLabel(engine)}
            installed={Boolean(engineStatus(status, engine)?.installed)}
            running={Boolean(engineStatus(status, engine)?.serverActive)}
            actions={['stop']}
            size="sm"
            onAction={(action) => {
              if (action !== 'stop') return Promise.resolve({ ok: true });
              return vpnApi.stopServer({ engine });
            }}
            onDone={() => void load()}
          />
        </ActionBar>
        <div className="u-mt-3">
          <ServiceAccessStrip
            serviceId={engine}
            ports={[
              {
                role: 'listen',
                port: String(listenPort),
                proto: fwProto === 'both' ? 'both' : fwProto,
              },
            ]}
            compact
            serviceInstalled={
              status ? Boolean(engineStatus(status, engine)?.installed) : undefined
            }
            serviceRunning={
              status ? Boolean(engineStatus(status, engine)?.serverActive) : undefined
            }
          />
        </div>
      </section>

      <DataTable
        rowKey={(r) => r.id}
        title={t(peersTitleKey)}
        description={t('vpn.noPeersHint')}
        toolbar={
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const name = peerName.trim();
              setPeerNameTouched(true);
              if (!isVpnPeerName(name)) return;
              void runOps(
                () => vpnApi.addPeer({ name, engine }),
                { openConfig: true, engine },
              ).then((r) => {
                if (r?.ok) {
                  setPeerName('');
                  setPeerNameTouched(false);
                }
              });
            }}
          >
            <ActionBar>
              <Field
                label={t('vpn.peerName')}
                htmlFor={`vpn-peer-${engine}`}
                required
                hint={
                  peerName.trim() && !isVpnPeerName(peerName)
                    ? undefined
                    : t('vpn.peerNameHint')
                }
                error={
                  peerNameTouched && peerName.trim() && !isVpnPeerName(peerName)
                    ? t('vpn.peerNameInvalid', {
                        preview: previewVpnPeerName(peerName),
                      })
                    : undefined
                }
                flush
              >
                <input
                  id={`vpn-peer-${engine}`}
                  className="u-input u-w-control-xs"
                  value={peerName}
                  onChange={(e) => {
                    setPeerName(e.target.value);
                    if (!peerNameTouched) setPeerNameTouched(true);
                  }}
                  placeholder={t('vpn.peerNamePlaceholder')}
                  disabled={
                    !engineStatus(status, engine)?.installed ||
                    !engineStatus(status, engine)?.serverActive
                  }
                  title={
                    !engineStatus(status, engine)?.installed
                      ? t('vpn.installEngineFirst')
                      : !engineStatus(status, engine)?.serverActive
                        ? t('vpn.needServerRunning', { engine: engineLabel(engine) })
                        : undefined
                  }
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                loading={busy}
                disabled={
                  !isVpnPeerName(peerName) ||
                  !engineStatus(status, engine)?.installed ||
                  !engineStatus(status, engine)?.serverActive
                }
                title={
                  !engineStatus(status, engine)?.installed
                    ? t('vpn.installEngineFirst')
                    : !engineStatus(status, engine)?.serverActive
                      ? t('vpn.needServerRunning', { engine: engineLabel(engine) })
                      : peerName.trim() && !isVpnPeerName(peerName)
                        ? t('vpn.peerNameInvalid', {
                            preview: previewVpnPeerName(peerName),
                          })
                        : !peerName.trim()
                          ? t('vpn.peerNameHint')
                          : undefined
                }
              >
                {addPeerLabel}
              </Button>
            </ActionBar>
          </form>
        }
        columns={[
          {
            key: 'name',
            header: t('vpn.colName'),
            render: (r) => <strong>{r.name}</strong>,
          },
          {
            key: 'addr',
            header: t('vpn.colAddress'),
            render: (r) => <code className="inline">{r.address || '—'}</code>,
          },
          {
            key: 'created',
            header: t('vpn.colCreated'),
            nowrap: true,
            render: (r) => (
              <span className="muted u-text-xs">{formatWhen(r.createdAt)}</span>
            ),
          },
        ]}
        rows={peers}
        empty={<EmptyState title={t('vpn.noPeers')} description={t('vpn.noPeersHint')} />}
        rowActions={(r) => (
          <ActionBar>
            <Button size="sm" variant="secondary" onClick={() => downloadPeer(r)}>
              {t('vpn.downloadKey')}
            </Button>
            {engine === 'wireguard' || engine === 'outline' ? (
              <Button size="sm" variant="ghost" onClick={() => void showPeerQr(r)}>
                {t('vpn.showQr')}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void vpnApi
                    .peerConfigText(r.id)
                    .then((text) => openConfigModal('openvpn', r.name, text))
                    .catch((e) =>
                      setError(
                        e instanceof Error ? e.message : t('common.loadFailed'),
                      ),
                    )
                }
              >
                {t('vpn.showConf')}
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              data-confirm={r.name}
              onClick={() => setPendingPeer(r)}
            >
              {t('common.delete')}
            </Button>
          </ActionBar>
        )}
      />
    </div>
  );

  const clientUpCount = profiles.filter((p) => p.status === 'up').length;

  return (
    <FeaturePageLayout
      title={t('nav.vpn')}
      subtitle={t('vpn.pageDesc')}
      status={{ pill: statusPill }}
      actions={
        <ActionBar>
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void load()}>
            {t('vpn.refresh')}
          </Button>
        </ActionBar>
      }
    >
      <PageTabs
        tabs={TABS.map((id) => ({ id, label: t(`vpn.tab.${id}`) }))}
        active={tab}
        onChange={(id) => setTab(id as TabId)}
      >
        <div className="stack vpn-tab-body">
        {error && resultTab === tab ? <Alert variant="error">{error}</Alert> : null}
        {lastOps && resultTab === tab ? (
          <OpsResultPanel
            title={t('vpn.result')}
            result={lastOps}
            defaultShowTechnical={!lastOps.ok || Boolean(lastOps.blocked)}
          />
        ) : null}

        {tab === 'wireguard' ? renderServerPanel('wireguard') : null}
        {tab === 'openvpn' ? renderServerPanel('openvpn') : null}
        {tab === 'outline' ? renderServerPanel('outline') : null}

        {tab === 'monitor' ? (
          <div className="stack vpn-tab-section">
            {monitor?.blocked || monitor?.requiresExecute || monitor?.requiresRoot ? (
              <Alert variant="warn">
                {monitor.notes?.[0] || t('vpn.monitor.needLive')}
              </Alert>
            ) : null}
            {monitor?.notes
              ?.filter((n) => !/need root|YSK_EXECUTE|Live metrics/i.test(n))
              .slice(0, 3)
              .map((n) => (
                <Alert key={n} variant="info">
                  {n}
                </Alert>
              ))}

            {/* Compact status strip — one line per engine, not tall cards */}
            <div className="vpn-monitor-strip" role="status">
              {(monitor?.engines ?? []).map((e) => (
                <div key={e.engine} className="vpn-monitor-strip__item">
                  <span className="vpn-monitor-strip__name">{engineLabel(e.engine)}</span>
                  <Badge tone={e.serverActive ? 'ok' : 'warn'}>
                    {e.serverActive ? t('vpn.serverUp') : t('vpn.serverDown')}
                  </Badge>
                  <span className="vpn-monitor-strip__meta">
                    {e.onlineCount}/{e.peerCount}
                  </span>
                  <span className="vpn-monitor-strip__meta muted">
                    ↓{formatVpnBytes(e.transferRx)} ↑{formatVpnBytes(e.transferTx)}
                  </span>
                  <span className="vpn-monitor-strip__meta">
                    ↓{formatVpnRate(e.rxRateBps)} ↑{formatVpnRate(e.txRateBps)}
                  </span>
                </div>
              ))}
            </div>

            <DataTable
              rowKey={(r) => r.id}
              title={t('vpn.monitor.peersTitle', {
                count: (monitor?.peers ?? []).filter((p) => {
                  if (monEngine !== 'all' && p.engine !== monEngine) return false;
                  if (monFilter === 'online') return p.online;
                  if (monFilter === 'offline') return !p.online;
                  return true;
                }).length,
              })}
              filters={
                <div
                  className={`vpn-monitor-bar${monBusy ? ' vpn-monitor-bar--busy' : ''}`}
                >
                  <SegRadio
                    name="mon-eng"
                    size="sm"
                    aria-label={t('vpn.monitor.filterEngine')}
                    value={monEngine}
                    onChange={(v) => setMonEngine(v as 'all' | VpnEngineId)}
                    options={[
                      { value: 'all', label: t('vpn.monitor.engineAll') },
                      { value: 'wireguard', label: 'WireGuard' },
                      { value: 'openvpn', label: 'OpenVPN' },
                      { value: 'outline', label: 'Shadowsocks' },
                    ]}
                  />
                  <SegRadio
                    name="mon-pres"
                    size="sm"
                    aria-label={t('vpn.monitor.filterPresence')}
                    value={monFilter}
                    onChange={(v) => setMonFilter(v as 'all' | 'online' | 'offline')}
                    options={[
                      { value: 'all', label: t('vpn.monitor.presenceAll') },
                      { value: 'online', label: t('vpn.monitor.presenceOnline') },
                      { value: 'offline', label: t('vpn.monitor.presenceOffline') },
                    ]}
                  />
                  <span className="vpn-monitor-bar__spacer" aria-hidden />
                  <span
                    className="vpn-monitor-bar__live"
                    title={t('vpn.monitor.autoRefresh')}
                  >
                    <span
                      className={`vpn-monitor-bar__dot${monBusy ? ' is-busy' : ''}`}
                      aria-hidden
                    />
                    {t('vpn.monitor.autoRefresh')}
                    {monitor?.sampledAt ? (
                      <span className="muted">
                        {' · '}
                        {formatVpnWhen(monitor.sampledAt)}
                      </span>
                    ) : null}
                  </span>
                  {/* Keep label fixed — never swap to「處理中」on a new line */}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={monBusy}
                    onClick={() => void loadMonitor()}
                  >
                    {t('vpn.refresh')}
                  </Button>
                </div>
              }
              columns={[
                {
                  key: 'name',
                  header: t('vpn.colName'),
                  render: (r) => <strong>{r.name}</strong>,
                },
                {
                  key: 'engine',
                  header: t('vpn.colEngine'),
                  nowrap: true,
                  render: (r) => (
                    <Badge tone="neutral">{engineLabel(r.engine)}</Badge>
                  ),
                },
                {
                  key: 'addr',
                  header: t('vpn.colAddress'),
                  render: (r) => <code className="inline">{r.address}</code>,
                },
                {
                  key: 'ep',
                  header: t('vpn.monitor.colEndpoint'),
                  render: (r) => (
                    <code className="inline">{r.endpoint || '—'}</code>
                  ),
                },
                {
                  key: 'pres',
                  header: t('vpn.colStatus'),
                  nowrap: true,
                  render: (r) => (
                    <Badge tone={presenceTone(r.presence)}>
                      {t(`vpn.monitor.presence.${r.presence}`)}
                    </Badge>
                  ),
                },
                {
                  key: 'seen',
                  header: t('vpn.monitor.colLastSeen'),
                  nowrap: true,
                  render: (r) => (
                    <span className="muted u-text-xs">
                      {formatVpnWhen(r.lastHandshakeAt || r.connectedSince)}
                    </span>
                  ),
                },
                {
                  key: 'rx',
                  header: t('vpn.monitor.colRx'),
                  nowrap: true,
                  render: (r) => formatVpnBytes(r.transferRx),
                },
                {
                  key: 'tx',
                  header: t('vpn.monitor.colTx'),
                  nowrap: true,
                  render: (r) => formatVpnBytes(r.transferTx),
                },
                {
                  key: 'rxr',
                  header: t('vpn.monitor.colRxRate'),
                  nowrap: true,
                  render: (r) => formatVpnRate(r.rxRateBps),
                },
                {
                  key: 'txr',
                  header: t('vpn.monitor.colTxRate'),
                  nowrap: true,
                  render: (r) => formatVpnRate(r.txRateBps),
                },
              ]}
              rows={(monitor?.peers ?? []).filter((p) => {
                if (monEngine !== 'all' && p.engine !== monEngine) return false;
                if (monFilter === 'online') return p.online;
                if (monFilter === 'offline') return !p.online;
                return true;
              })}
              empty={
                <EmptyState
                  title={t('vpn.monitor.emptyPeers')}
                  description={t('vpn.monitor.emptyPeersHint')}
                />
              }
            />

            {(monitor?.localClients?.length ?? 0) > 0 ? (
              <DataTable
                rowKey={(r) => r.id}
                title={t('vpn.monitor.localTitle')}
                columns={[
                  {
                    key: 'name',
                    header: t('vpn.colName'),
                    render: (r) => <strong>{r.name}</strong>,
                  },
                  {
                    key: 'engine',
                    header: t('vpn.colEngine'),
                    render: (r) => engineLabel(r.engine),
                  },
                  {
                    key: 'st',
                    header: t('vpn.colStatus'),
                    render: (r) => (
                      <Badge
                        tone={
                          r.status === 'up'
                            ? 'ok'
                            : r.status === 'down'
                              ? 'neutral'
                              : 'warn'
                        }
                      >
                        {t(`vpn.clientStatus.${r.status}`, {
                          defaultValue: r.status,
                        })}
                      </Badge>
                    ),
                  },
                  {
                    key: 'if',
                    header: t('vpn.colIface'),
                    render: (r) => <code className="inline">{r.iface}</code>,
                  },
                  {
                    key: 'rx',
                    header: t('vpn.monitor.colRx'),
                    render: (r) => formatVpnBytes(r.transferRx),
                  },
                  {
                    key: 'tx',
                    header: t('vpn.monitor.colTx'),
                    render: (r) => formatVpnBytes(r.transferTx),
                  },
                  {
                    key: 'rxr',
                    header: t('vpn.monitor.colRxRate'),
                    render: (r) => formatVpnRate(r.rxRateBps),
                  },
                  {
                    key: 'txr',
                    header: t('vpn.monitor.colTxRate'),
                    render: (r) => formatVpnRate(r.txRateBps),
                  },
                ]}
                rows={monitor?.localClients ?? []}
              />
            ) : null}
          </div>
        ) : null}

        {tab === 'software' ? (
          <div className="stack vpn-tab-section">
            <Alert variant="info">{t('vpn.softwareIntro')}</Alert>
            <div className="vpn-software-stack">
              <section className="vpn-software-card" aria-label="WireGuard">
                <div className="vpn-software-card__head">
                  <strong>WireGuard</strong>
                  {engineStatus(status, 'wireguard')?.installed ? (
                    <Badge tone="ok">{t('vpn.installed')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('vpn.notInstalled')}</Badge>
                  )}
                </div>
                <SoftwareInstallBanner
                  feature="wireguard"
                  title={t('vpn.needWireGuard')}
                  showReadyActions={false}
                  onInstalled={() => void load()}
                />
                <SoftwareVersionBar
                  softwareId="wireguard"
                  onResult={(r) => {
                    setLastOps(r);
                    setResultTab('software');
                  }}
                />
              </section>
              <section className="vpn-software-card" aria-label="OpenVPN">
                <div className="vpn-software-card__head">
                  <strong>OpenVPN</strong>
                  {engineStatus(status, 'openvpn')?.installed ? (
                    <Badge tone="ok">{t('vpn.installed')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('vpn.notInstalled')}</Badge>
                  )}
                </div>
                <SoftwareInstallBanner
                  feature="openvpn"
                  title={t('vpn.needOpenVpn')}
                  showReadyActions={false}
                  onInstalled={() => void load()}
                />
                <SoftwareVersionBar
                  softwareId="openvpn"
                  onResult={(r) => {
                    setLastOps(r);
                    setResultTab('software');
                  }}
                />
              </section>
              <section className="vpn-software-card" aria-label="Shadowsocks">
                <div className="vpn-software-card__head">
                  <strong>Shadowsocks</strong>
                  {engineStatus(status, 'outline')?.installed ? (
                    <Badge tone="ok">{t('vpn.installed')}</Badge>
                  ) : (
                    <Badge tone="warn">{t('vpn.notInstalled')}</Badge>
                  )}
                </div>
                <SoftwareInstallBanner
                  feature="outline"
                  title={t('vpn.needSs')}
                  showReadyActions={false}
                  onInstalled={() => void load()}
                />
                <SoftwareVersionBar
                  softwareId="shadowsocks"
                  onResult={(r) => {
                    setLastOps(r);
                    setResultTab('software');
                  }}
                />
              </section>
            </div>
          </div>
        ) : null}

        {tab === 'client' ? (
          <div className="stack vpn-tab-section">
            <Alert variant="info">{t('vpn.clientIntro')}</Alert>

            <DataTable
              rowKey={(r) => r.id}
              title={t('vpn.engineSummaryClient', {
                count: profiles.length,
                up: clientUpCount,
              })}
              toolbar={
                <ActionBar>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setImportName('');
                      setImportConf('');
                      setClientEngine('auto');
                      setImportOpen(true);
                    }}
                  >
                    {t('vpn.importOpen')}
                  </Button>
                </ActionBar>
              }
              columns={[
                {
                  key: 'name',
                  header: t('vpn.colName'),
                  render: (r) => <strong>{r.name}</strong>,
                },
                {
                  key: 'engine',
                  header: t('vpn.colEngine'),
                  nowrap: true,
                  render: (r) => <Badge tone="neutral">{r.engine}</Badge>,
                },
                {
                  key: 'iface',
                  header: t('vpn.colIface'),
                  render: (r) => <code className="inline">{r.iface}</code>,
                },
                {
                  key: 'status',
                  header: t('vpn.colStatus'),
                  nowrap: true,
                  render: (r) => (
                    <Badge
                      tone={
                        r.status === 'up'
                          ? 'ok'
                          : r.status === 'down'
                            ? 'neutral'
                            : 'warn'
                      }
                    >
                      {t(`vpn.clientStatus.${r.status}`, {
                        defaultValue: r.status,
                      })}
                    </Badge>
                  ),
                },
              ]}
              rows={profiles}
              empty={
                <EmptyState
                  title={t('vpn.noProfiles')}
                  description={t('vpn.noProfilesHint')}
                />
              }
              rowActions={(r) => (
                <ActionBar>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy}
                    disabled={r.status === 'up'}
                    onClick={() =>
                      void runOps(() => vpnApi.clientUp(r.id), {
                        openConfig: false,
                      })
                    }
                  >
                    {t('vpn.connect')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={busy}
                    onClick={() =>
                      void runOps(() => vpnApi.clientDown(r.id), {
                        openConfig: false,
                      })
                    }
                  >
                    {t('vpn.disconnect')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy}
                    onClick={() =>
                      void runOps(() => vpnApi.deleteClient(r.id), {
                        openConfig: false,
                      })
                    }
                  >
                    {t('common.delete')}
                  </Button>
                </ActionBar>
              )}
            />
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="vpn" /> : null}
        </div>
      </PageTabs>

      {/* Config / QR modal — high-contrast conf + QR plate */}
      <Modal
        open={cfgOpen}
        onClose={() => setCfgOpen(false)}
        title={
          cfgEngine === 'openvpn'
            ? t('vpn.cfgTitle', { name: cfgLabel })
            : t('vpn.qrTitle', { name: cfgLabel })
        }
        size="lg"
        className="vpn-cfg-modal"
        footer={
          <>
            <Button variant="secondary" size="md" onClick={() => setCfgOpen(false)}>
              {t('vpn.close')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() =>
                void copyText(cfgRevealKey ? cfgText : maskVpnPrivateKeys(cfgText))
              }
            >
              {t('vpn.copyConf')}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                const blob = new Blob([cfgText], { type: 'text/plain' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = confDownloadName(cfgEngine, cfgLabel);
                a.click();
                URL.revokeObjectURL(a.href);
                notifyOk(t('vpn.downloaded'));
              }}
            >
              {t('vpn.downloadKey')}
            </Button>
          </>
        }
      >
        <div className="vpn-cfg">
          {cfgQr ? (
            <div className="vpn-cfg__qr-wrap">
              <div className="vpn-cfg__qr-plate">
                <img
                  src={cfgQr}
                  alt={t('vpn.qrTitle', { name: cfgLabel })}
                  width={240}
                  height={240}
                />
              </div>
              <p className="vpn-cfg__hint">
                {cfgEngine === 'outline' ? t('vpn.qrHintSs') : t('vpn.qrHintWg')}
              </p>
            </div>
          ) : cfgQrTried &&
            (cfgEngine === 'wireguard' || cfgEngine === 'outline') ? (
            <Alert variant="warn">{t('vpn.qrFailed')}</Alert>
          ) : null}

          <div className="vpn-cfg__section">
            <div className="vpn-cfg__section-head">
              <h4 className="vpn-cfg__section-title">{t('vpn.showConf')}</h4>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void copyText(cfgRevealKey ? cfgText : maskVpnPrivateKeys(cfgText))
                }
              >
                {t('vpn.copyConf')}
              </Button>
            </div>
            {/PrivateKey\s*=/i.test(cfgText) ? (
              <Alert variant="warn">{t('vpn.privateKeyOnce')}</Alert>
            ) : null}
            {/PrivateKey\s*=/i.test(cfgText) && !cfgRevealKey ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCfgRevealKey(true)}
              >
                {t('vpn.showPrivateKey')}
              </Button>
            ) : null}
            <pre className="vpn-conf__pre" tabIndex={0}>
              {cfgRevealKey ? cfgText : maskVpnPrivateKeys(cfgText)}
            </pre>
          </div>
        </div>
      </Modal>

      {/* Import client modal */}
      <Modal
        open={importOpen}
        onClose={() => !busy && setImportOpen(false)}
        title={t('vpn.importOpen')}
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setImportOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              form="vpn-import"
              variant="primary"
              size="md"
              loading={busy}
              disabled={!importName.trim() || !importConf.trim()}
            >
              {t('vpn.importProfile')}
            </Button>
          </>
        }
      >
        <form
          id="vpn-import"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const detected =
              clientEngine === 'auto'
                ? detectClientEngine(importConf)
                : clientEngine;
            if (!detected) {
              notifyWarn(t('vpn.importInvalid'));
              return;
            }
            void runOps(
              () =>
                vpnApi.importClient({
                  name: importName.trim(),
                  conf: importConf,
                  engine: detected,
                }),
              { openConfig: false },
            ).then((r) => {
              if (r?.ok) setImportOpen(false);
            });
          }}
        >
        <FormLayout columns={1}>
          <Field label={t('vpn.profileName')} htmlFor="vpn-import-name" flush required>
            <input
              id="vpn-import-name"
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="office"
            />
          </Field>
          <Field label={t('vpn.clientEngine')} htmlFor="vpn-cli-eng" flush>
            <SegRadio
              name="vpn-cli-eng"
              aria-label={t('vpn.clientEngine')}
              value={clientEngine}
              onChange={(v) =>
                setClientEngine(v as 'wireguard' | 'openvpn' | 'auto')
              }
              options={[
                { value: 'auto', label: t('vpn.engineAuto') },
                { value: 'wireguard', label: 'WireGuard' },
                { value: 'openvpn', label: 'OpenVPN' },
              ]}
            />
          </Field>
          <Field label={t('vpn.pasteConf')} htmlFor="vpn-import-conf" flush required>
            <textarea
              id="vpn-import-conf"
              rows={10}
              value={importConf}
              onChange={(e) => {
                setImportConf(e.target.value);
                if (!importName.trim()) {
                  // soft suggest name from first non-empty line comment
                  const line = e.target.value
                    .split('\n')
                    .map((l) => l.trim())
                    .find((l) => l && !l.startsWith('#'));
                  if (line && line.length < 40) {
                    /* keep empty — user types name */
                  }
                }
              }}
              placeholder="[Interface] …  /  client + remote …"
              spellCheck={false}
              className="vpn-textarea"
            />
          </Field>
        </FormLayout>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingPeer)}
        onClose={() => setPendingPeer(null)}
        title={
          pendingPeer?.engine === 'openvpn'
            ? t('vpn.deleteClientTitle', { name: pendingPeer?.name ?? '' })
            : pendingPeer?.engine === 'outline'
              ? t('vpn.deleteKeyTitle', { name: pendingPeer?.name ?? '' })
              : t('vpn.deletePeerTitle', { name: pendingPeer?.name ?? '' })
        }
        description={
          pendingPeer?.engine === 'openvpn'
            ? t('vpn.deleteClientDesc', {
                name: pendingPeer?.name ?? '',
                address: pendingPeer?.address || pendingPeer?.id || '—',
              })
            : pendingPeer?.engine === 'outline'
              ? t('vpn.deleteKeyDesc', {
                  name: pendingPeer?.name ?? '',
                  address: pendingPeer?.address || pendingPeer?.id || '—',
                })
              : t('vpn.deletePeerDesc', {
                  name: pendingPeer?.name ?? '',
                  address: pendingPeer?.address || pendingPeer?.id || '—',
                })
        }
        confirmLabel={t('common.delete')}
        severity="destructive"
        busy={busy}
        dataConfirm={pendingPeer?.name}
        onConfirm={() => {
          const id = pendingPeer?.id;
          const name = pendingPeer?.name ?? '';
          setPendingPeer(null);
          if (!id) return;
          void runOps(() => vpnApi.deletePeer(id), { openConfig: false }).then(
            (r) => {
              if (!r) return;
              const named = t('vpn.deleteResult', { name });
              const notes = (r.notes ?? []).filter(Boolean);
              if (!notes.some((n) => n.includes(name))) notes.unshift(named);
              setLastOps({
                ok: r.ok,
                notes,
                blocked: r.blocked,
                requiresExecute: r.requiresExecute,
              });
            },
          );
        }}
      />
    </FeaturePageLayout>
  );
}
