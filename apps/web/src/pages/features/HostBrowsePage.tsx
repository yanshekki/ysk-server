/**
 * Host-mediated proxy browser — dual engine:
 *  - proxy: rewritten HTML iframe
 *  - browser: host Chromium screencast + input
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  EmptyState,
  FeaturePageLayout,
  Field,
  FormActions,
  FormLayout,
  PageGuide,
  PageTabs,
  SegRadio,
  SoftwareInstallBanner,
  SoftwareVersionBar,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { ApiError } from '../../shared/services/api';
import {
  hostBrowseApi,
  hostBrowseLiveWsUrl,
  type HostBrowseCapabilities,
  type HostBrowseEngine,
  type HostBrowseEnginePref,
  type HostBrowseMode,
  type HostBrowseNavigateResult,
  type HostBrowsePanelSettings,
  type HostBrowseSession,
} from '../../features/host-browse/api';
import { notifyInfo, notifyOk } from '../../shared/lib/notify';

const TABS = ['browse', 'stack', 'settings', 'about'] as const;

export function HostBrowsePage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'browse');

  const [mode, setMode] = useState<HostBrowseMode>('internet');
  const [engine, setEngine] = useState<HostBrowseEngine>('proxy');
  const [caps, setCaps] = useState<HostBrowseCapabilities | null>(null);
  const [session, setSession] = useState<HostBrowseSession | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [last, setLast] = useState<HostBrowseNavigateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [liveImg, setLiveImg] = useState<string | null>(null);
  const [liveSize, setLiveSize] = useState({ w: 1280, h: 800 });
  const [settingsDraft, setSettingsDraft] = useState<HostBrowsePanelSettings>({
    engine: 'auto',
    chromePath: '',
    allowLoopback: false,
    noSandbox: false,
  });
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [envHints, setEnvHints] = useState<Record<string, string | null>>({});

  const abortRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const liveRef = useRef<HTMLImageElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const loadCapsAndSettings = useCallback(async () => {
    try {
      const s = await hostBrowseApi.getSettings();
      setCaps(s.capabilities);
      setSettingsDraft({
        engine: (s.settings.engine as HostBrowseEnginePref) || 'auto',
        chromePath: s.settings.chromePath || '',
        allowLoopback: Boolean(s.settings.allowLoopback),
        noSandbox: Boolean(s.settings.noSandbox),
      });
      setEnvHints(s.envHints ?? {});
      if (s.capabilities.defaultEngine) setEngine(s.capabilities.defaultEngine);
    } catch {
      try {
        const c = await hostBrowseApi.capabilities();
        setCaps(c);
        if (c.defaultEngine) setEngine(c.defaultEngine);
      } catch {
        /* default proxy */
      }
    }
  }, []);

  useEffect(() => {
    void loadCapsAndSettings();
  }, [loadCapsAndSettings]);

  const saveSettings = useCallback(async () => {
    setSettingsBusy(true);
    setError(null);
    try {
      const r = await hostBrowseApi.saveSettings(settingsDraft);
      setCaps(r.capabilities);
      setSettingsDraft({
        engine: (r.settings.engine as HostBrowseEnginePref) || 'auto',
        chromePath: r.settings.chromePath || '',
        allowLoopback: Boolean(r.settings.allowLoopback),
        noSandbox: Boolean(r.settings.noSandbox),
      });
      if (r.capabilities.defaultEngine) setEngine(r.capabilities.defaultEngine);
      notifyOk(t('hostBrowse.settingsSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setSettingsBusy(false);
    }
  }, [settingsDraft, t]);

  const closeLive = useCallback(() => {
    try {
      wsRef.current?.close();
    } catch {
      /* */
    }
    wsRef.current = null;
    setLiveImg(null);
  }, []);

  const openLive = useCallback(
    async (sessionId: string) => {
      closeLive();
      try {
        const ticket = await hostBrowseApi.liveTicket(sessionId);
        const ws = new WebSocket(hostBrowseLiveWsUrl(ticket.wsPath));
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              t?: string;
              mime?: string;
              data?: string;
              w?: number;
              h?: number;
              url?: string;
              title?: string;
              message?: string;
            };
            if (msg.t === 'frame' && msg.data) {
              setLiveImg(`data:${msg.mime || 'image/jpeg'};base64,${msg.data}`);
              if (msg.w && msg.h) setLiveSize({ w: msg.w, h: msg.h });
            } else if (msg.t === 'meta' && msg.url) {
              setUrlDraft(msg.url);
            } else if (msg.t === 'err') {
              setError(msg.message || t('hostBrowse.loadFailed'));
            }
          } catch {
            /* */
          }
        };
        ws.onerror = () => {
          setError(t('hostBrowse.liveError'));
        };
      } catch (e) {
        setError(e instanceof Error ? e.message : t('hostBrowse.liveError'));
      }
    },
    [closeLive, t],
  );

  useEffect(() => () => closeLive(), [closeLive]);

  const ensureSession = useCallback(
    async (m: HostBrowseMode, eng: HostBrowseEngine): Promise<HostBrowseSession> => {
      if (session && session.mode === m && session.engine === eng) return session;
      // Close previous
      if (session) {
        try {
          await hostBrowseApi.deleteSession(session.sessionId);
        } catch {
          /* */
        }
        closeLive();
      }
      const created = await hostBrowseApi.createSession({ mode: m, engine: eng });
      setSession(created);
      setLast(null);
      setFrameSrc(null);
      return created;
    },
    [session, closeLive],
  );

  const applyNav = useCallback(
    (s: HostBrowseSession, result: HostBrowseNavigateResult) => {
      setLast(result);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              currentUrl: result.finalUrl || prev.currentUrl,
              historyIndex: result.historyIndex ?? prev.historyIndex,
              historyLength: result.historyLength ?? prev.historyLength,
              cookieCount: result.cookieCount ?? prev.cookieCount,
              canGoBack: result.canGoBack ?? prev.canGoBack,
              canGoForward: result.canGoForward ?? prev.canGoForward,
            }
          : prev,
      );
      if (result.finalUrl) setUrlDraft(result.finalUrl);
      if (result.blocked) {
        setError(t('hostBrowse.ssrfBlocked'));
      } else if (!result.ok && result.status === 0) {
        setError(t('hostBrowse.loadFailed'));
      } else {
        setError(null);
      }

      if (s.engine === 'proxy' && result.contentPath && !result.blocked) {
        setFrameSrc(result.contentPath);
        if (iframeRef.current) iframeRef.current.src = result.contentPath;
      }
    },
    [t],
  );

  const runNavigate = useCallback(
    async (body: {
      url?: string;
      action?: 'goto' | 'reload' | 'back' | 'forward';
    }) => {
      setBusy(true);
      setError(null);
      abortRef.current = false;
      try {
        const s = await ensureSession(mode, engine);
        if (abortRef.current) return;
        const result = await hostBrowseApi.navigate(s.sessionId, body);
        if (abortRef.current) return;
        try {
          const meta = await hostBrowseApi.getSession(s.sessionId);
          setSession(meta);
        } catch {
          /* */
        }
        applyNav(s, result);

        // Browser engine: open live stream after first successful nav
        if (s.engine === 'browser' && !result.blocked) {
          await openLive(s.sessionId);
        }
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : t('common.loadFailed');
        setError(msg);
        if (e instanceof ApiError && e.code === 'YSK_HOST_BROWSE_NEED_CHROME') {
          setEngine('proxy');
          notifyInfo(t('hostBrowse.needChromeFallback'));
        }
      } finally {
        setBusy(false);
      }
    },
    [applyNav, ensureSession, mode, engine, openLive, t],
  );

  const onGo = useCallback(() => {
    const raw = urlDraft.trim();
    if (!raw) return;
    void runNavigate({ url: raw, action: 'goto' });
  }, [runNavigate, urlDraft]);

  const onModeChange = useCallback(
    (m: HostBrowseMode) => {
      if (m === mode) return;
      setMode(m);
      setSession(null);
      setLast(null);
      setError(null);
      setFrameSrc(null);
      closeLive();
      notifyInfo(t('hostBrowse.modeSwitchHint'));
    },
    [mode, t, closeLive],
  );

  const onEngineChange = useCallback(
    (eng: HostBrowseEngine) => {
      if (eng === engine) return;
      if (eng === 'browser' && caps && !caps.chromeAvailable) {
        setError(t('hostBrowse.needChrome'));
        return;
      }
      setEngine(eng);
      setSession(null);
      setLast(null);
      setFrameSrc(null);
      closeLive();
      notifyInfo(t('hostBrowse.engineSwitchHint'));
    },
    [engine, caps, t, closeLive],
  );

  const onClearCookies = useCallback(async () => {
    if (!session) return;
    try {
      const meta = await hostBrowseApi.clearCookies(session.sessionId);
      setSession(meta);
      notifyOk(t('hostBrowse.clearCookies'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [session, t]);

  const onCloseSession = useCallback(async () => {
    if (!session) return;
    try {
      await hostBrowseApi.deleteSession(session.sessionId);
    } catch {
      /* */
    }
    closeLive();
    setSession(null);
    setLast(null);
    setFrameSrc(null);
  }, [session, closeLive]);

  const onCopyUrl = useCallback(async () => {
    const u = last?.finalUrl || session?.currentUrl || urlDraft;
    if (!u) return;
    try {
      await navigator.clipboard.writeText(u);
      notifyOk(t('hostBrowse.copied'));
    } catch {
      /* */
    }
  }, [last, session, t, urlDraft]);

  const onStop = useCallback(() => {
    abortRef.current = true;
    setBusy(false);
    if (session) {
      void hostBrowseApi.abort(session.sessionId).catch(() => undefined);
    }
  }, [session]);

  const onLivePointer = useCallback(
    (type: 'click' | 'move' | 'down' | 'up' | 'wheel', e: React.MouseEvent | React.WheelEvent) => {
      const el = liveRef.current;
      const ws = wsRef.current;
      if (!el || !ws || ws.readyState !== WebSocket.OPEN) return;
      const rect = el.getBoundingClientRect();
      const scaleX = liveSize.w / rect.width;
      const scaleY = liveSize.h / rect.height;
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      if (type === 'wheel' && 'deltaY' in e) {
        ws.send(
          JSON.stringify({
            t: 'mouse',
            type: 'wheel',
            x,
            y,
            deltaY: (e as React.WheelEvent).deltaY,
          }),
        );
        return;
      }
      ws.send(JSON.stringify({ t: 'mouse', type, x, y, button: 'left' }));
    },
    [liveSize],
  );

  const onLiveKey = useCallback((e: React.KeyboardEvent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    e.preventDefault();
    ws.send(
      JSON.stringify({
        t: 'key',
        type: e.type === 'keydown' ? 'down' : 'up',
        key: e.key,
      }),
    );
  }, []);

  const canBack = Boolean(session?.canGoBack ?? (session && session.historyIndex > 0));
  const canForward = Boolean(
    session?.canGoForward ??
      (session &&
        session.historyIndex >= 0 &&
        session.historyIndex < session.historyLength - 1),
  );

  const statusPill = useMemo(() => {
    if (busy) return { label: t('hostBrowse.loading'), tone: 'warn' as const };
    if (error || last?.blocked)
      return { label: t('hostBrowse.ssrfBlocked'), tone: 'danger' as const };
    if (session) return { label: t('hostBrowse.sessionReady'), tone: 'ok' as const };
    return { label: t('hostBrowse.noSession'), tone: 'neutral' as const };
  }, [busy, error, last, session, t]);

  const lockLabel = useMemo(() => {
    const u = last?.finalUrl || session?.currentUrl || '';
    if (u.startsWith('https:')) return t('hostBrowse.locked');
    if (u.startsWith('http:')) return t('hostBrowse.insecure');
    return '—';
  }, [last, session, t]);

  const isBrowser = (session?.engine ?? engine) === 'browser';
  const hasProxyContent = Boolean(frameSrc && !last?.blocked && !isBrowser);
  const hasLive = Boolean(liveImg && isBrowser);

  return (
    <FeaturePageLayout
      title={t('nav.hostBrowse')}
      subtitle={t('hostBrowse.subtitle')}
      status={{
        pill: statusPill,
        items: [
          {
            label: t('hostBrowse.viaHost'),
            value: t('hostBrowse.privacyOn'),
            tone: 'ok',
          },
          {
            label: t('hostBrowse.engineLabel'),
            value:
              (session?.engine ?? engine) === 'browser'
                ? t('hostBrowse.engineBrowser')
                : t('hostBrowse.engineProxy'),
          },
          {
            label: t('hostBrowse.cookies'),
            value: String(session?.cookieCount ?? 0),
          },
          {
            label: t('hostBrowse.latency'),
            value: last ? `${last.latencyMs} ms` : '—',
          },
        ],
      }}
      actions={
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onCloseSession()}
          disabled={!session || busy}
        >
          {t('hostBrowse.closeSession')}
        </Button>
      }
    >
      <PageTabs
        tabs={[
          { id: 'browse', label: t('hostBrowse.tabBrowse') },
          { id: 'stack', label: t('tabs.stack') },
          { id: 'settings', label: t('hostBrowse.tabSettings') },
          { id: 'about', label: t('tabs.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {tab === 'browse' ? (
          <div className="hb-page tab-panel">
            {error ? (
              <Alert variant="error">
                {error}
                {last?.blockReason ? ` (${String(last.blockReason)})` : ''}
              </Alert>
            ) : null}
            {caps && !caps.chromeAvailable ? (
              <Alert variant="info">
                {t('hostBrowse.needChrome')}{' '}
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setTab('stack')}
                >
                  {t('hostBrowse.goInstallChrome')}
                </button>
              </Alert>
            ) : null}

            <div className="hb-chrome">
              <div className="hb-toolbar">
                <div className="hb-toolbar__mode">
                  <SegRadio
                    name="hb-mode"
                    size="sm"
                    aria-label={t('hostBrowse.modeHint')}
                    value={mode}
                    onChange={(v) => onModeChange(v as HostBrowseMode)}
                    options={[
                      { value: 'internet', label: t('hostBrowse.modeInternet') },
                      { value: 'intranet', label: t('hostBrowse.modeIntranet') },
                    ]}
                    disabled={busy}
                  />
                </div>
                <div className="hb-toolbar__mode">
                  <SegRadio
                    name="hb-engine"
                    size="sm"
                    aria-label={t('hostBrowse.engineLabel')}
                    value={engine}
                    onChange={(v) => onEngineChange(v as HostBrowseEngine)}
                    options={[
                      { value: 'proxy', label: t('hostBrowse.engineProxy') },
                      { value: 'browser', label: t('hostBrowse.engineBrowser') },
                    ]}
                    disabled={busy}
                  />
                </div>
                <div className="hb-toolbar__nav">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'back' })}
                    disabled={busy || !session || !canBack}
                    aria-label={t('hostBrowse.back')}
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'forward' })}
                    disabled={busy || !session || !canForward}
                    aria-label={t('hostBrowse.forward')}
                  >
                    →
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'reload' })}
                    disabled={busy || !session?.currentUrl}
                    aria-label={t('hostBrowse.reload')}
                  >
                    ↻
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onStop}
                    disabled={!busy && !session}
                    aria-label={t('hostBrowse.stop')}
                  >
                    ⏹
                  </Button>
                </div>
                <div className="hb-toolbar__url">
                  <span className="hb-lock" title={lockLabel}>
                    {lockLabel === t('hostBrowse.locked') ? '🔒' : '🔓'}
                  </span>
                  <label className="hb-url-field" htmlFor="hb-url">
                    <span className="visually-hidden">URL</span>
                    <input
                      id="hb-url"
                      type="text"
                      value={urlDraft}
                      onChange={(e) => setUrlDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          onGo();
                        }
                      }}
                      placeholder={t('hostBrowse.urlPlaceholder')}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={busy}
                    />
                  </label>
                  <Button size="sm" onClick={onGo} disabled={busy || !urlDraft.trim()}>
                    {t('hostBrowse.go')}
                  </Button>
                </div>
                <div className="hb-toolbar__nav">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onClearCookies()}
                    disabled={!session || busy}
                  >
                    {t('hostBrowse.clearCookies')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onCopyUrl()}
                    disabled={!urlDraft && !last?.finalUrl}
                  >
                    {t('hostBrowse.copyUrl')}
                  </Button>
                </div>
              </div>

              <div className="hb-progress" aria-hidden={!busy}>
                <div className={`hb-progress__bar${busy ? '' : ' is-done'}`} />
              </div>

              <div
                className={`hb-frame-wrap${hasProxyContent || hasLive ? '' : ' is-empty'}`}
              >
                {!hasProxyContent && !hasLive ? (
                  <div className="hb-empty">
                    <EmptyState
                      title={t('hostBrowse.emptyTitle')}
                      description={t('hostBrowse.emptyBody')}
                    />
                  </div>
                ) : null}

                {/* Proxy iframe */}
                {!isBrowser ? (
                  <iframe
                    ref={iframeRef}
                    className="hb-frame"
                    title={t('nav.hostBrowse')}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                    referrerPolicy="no-referrer"
                    src={frameSrc ?? undefined}
                  />
                ) : null}

                {/* Live browser surface */}
                {isBrowser ? (
                  <div
                    className="hb-live"
                    tabIndex={0}
                    onKeyDown={onLiveKey}
                    onKeyUp={onLiveKey}
                  >
                    {liveImg ? (
                      // eslint-disable-next-line jsx-a11y/alt-text
                      <img
                        ref={liveRef}
                        className="hb-live__img"
                        src={liveImg}
                        draggable={false}
                        onClick={(e) => onLivePointer('click', e)}
                        onMouseMove={(e) => {
                          if (e.buttons === 1) onLivePointer('move', e);
                        }}
                        onWheel={(e) => onLivePointer('wheel', e)}
                      />
                    ) : (
                      <div className="hb-live__wait">{t('hostBrowse.liveWaiting')}</div>
                    )}
                  </div>
                ) : null}
              </div>

              <div className="hb-status">
                <span
                  className={`hb-status__dot${
                    last?.blocked ? ' is-danger' : busy ? ' is-warn' : ''
                  }`}
                />
                <span>
                  {last
                    ? t('hostBrowse.statusLine', {
                        status: last.blocked ? 'blocked' : last.status,
                        ms: last.latencyMs,
                        type: last.contentType || (isBrowser ? 'browser' : '—'),
                      })
                    : t('hostBrowse.viaHost')}
                </span>
                {session?.userAgent ? (
                  <Badge tone="neutral">{session.userAgent.slice(0, 28)}…</Badge>
                ) : null}
                {last?.rewritten ? <Badge tone="ok">rewrite</Badge> : null}
                {isBrowser ? <Badge tone="ok">chromium</Badge> : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'stack' ? (
          <div className="tab-panel stack">
            <SoftwareInstallBanner
              feature="hostBrowse"
              title={t('hostBrowse.softwareNeeded')}
              onInstalled={() => {
                void loadCapsAndSettings();
              }}
            />
            <SoftwareVersionBar softwareId="chromium" />
            <Alert variant="info">{t('hostBrowse.softwareHint')}</Alert>
          </div>
        ) : null}

        {tab === 'settings' ? (
          <div className="tab-panel stack">
            <p className="muted u-text-sm">{t('hostBrowse.settingsIntro')}</p>
            <FormLayout>
              <Field label={t('hostBrowse.settingsEngine')} htmlFor="hb-set-engine">
                <SegRadio
                  name="hb-set-engine"
                  size="sm"
                  value={settingsDraft.engine}
                  onChange={(v) =>
                    setSettingsDraft((d) => ({
                      ...d,
                      engine: v as HostBrowseEnginePref,
                    }))
                  }
                  options={[
                    { value: 'auto', label: t('hostBrowse.engineAuto') },
                    { value: 'proxy', label: t('hostBrowse.engineProxy') },
                    { value: 'browser', label: t('hostBrowse.engineBrowser') },
                  ]}
                />
              </Field>
              <Field
                label={t('hostBrowse.settingsChromePath')}
                htmlFor="hb-chrome-path"
                hint={t('hostBrowse.settingsChromePathHint')}
              >
                <input
                  id="hb-chrome-path"
                  type="text"
                  value={settingsDraft.chromePath}
                  onChange={(e) =>
                    setSettingsDraft((d) => ({ ...d, chromePath: e.target.value }))
                  }
                  placeholder="/usr/bin/google-chrome"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <CheckboxField
                id="hb-loopback"
                label={t('hostBrowse.settingsLoopback')}
                checked={settingsDraft.allowLoopback}
                onChange={(c) =>
                  setSettingsDraft((d) => ({ ...d, allowLoopback: c }))
                }
              />
              <CheckboxField
                id="hb-nosandbox"
                label={t('hostBrowse.settingsNoSandbox')}
                checked={settingsDraft.noSandbox}
                onChange={(c) =>
                  setSettingsDraft((d) => ({ ...d, noSandbox: c }))
                }
              />
              <FormActions>
                <Button
                  size="md"
                  loading={settingsBusy}
                  onClick={() => void saveSettings()}
                >
                  {t('hostBrowse.settingsSave')}
                </Button>
              </FormActions>
            </FormLayout>
            {Object.keys(envHints).length > 0 ? (
              <div className="stack u-mt-3">
                <div className="muted u-text-sm">{t('hostBrowse.envHintsTitle')}</div>
                <ul className="muted u-text-sm">
                  {Object.entries(envHints).map(([k, v]) => (
                    <li key={k}>
                      <code>{k}</code>={v ?? '—'}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="hostBrowse" /> : null}
      </PageTabs>
    </FeaturePageLayout>
  );
}
