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
  ConfirmDialog,
  DataTable,
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
import { formatDateTime } from '../../shared/lib/datetime';
import { hostTimeZoneOpts } from '../../shared/lib/host-timezone';
import { api, ApiError } from '../../shared/services/api';
import {
  hostBrowseApi,
  hostBrowseLiveWsUrl,
  type HostBrowseCapabilities,
  type HostBrowseDownload,
  type HostBrowseEngine,
  type HostBrowseEnginePref,
  type HostBrowseLastSnapshot,
  type HostBrowseMode,
  type HostBrowseNavigateResult,
  type HostBrowsePanelSettings,
  type HostBrowseSafetyLevel,
  type HostBrowseSession,
  type HostBrowseTab,
} from '../../features/host-browse/api';
import { clientToPage } from '../../features/host-browse/live-geometry';
import { PcmPlayer } from '../../features/host-browse/pcm-player';
import { notifyInfo, notifyOk } from '../../shared/lib/notify';
import { useAuth } from '../../shared/hooks/useAuth';

type StreamPreset = 'smooth' | 'balanced' | 'sharp';
type ZoomMode = 'fit' | 'fill' | 'percent';
type LivePhase = 'idle' | 'connecting' | 'live' | 'error';

const TABS = ['browse', 'stack', 'settings', 'about'] as const;

export function HostBrowsePage() {
  const { t } = useTranslation();
  const { user } = useAuth();
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
  const [streamPreset, setStreamPreset] = useState<StreamPreset>('balanced');
  const [streamMeta, setStreamMeta] = useState<{ quality?: number; preset?: string } | null>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  const [zoomPercent, setZoomPercent] = useState(100);
  const [livePhase, setLivePhase] = useState<LivePhase>('idle');
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [warns, setWarns] = useState<string[]>([]);
  const [browserTabs, setBrowserTabs] = useState<HostBrowseTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [homeUrl, setHomeUrl] = useState('https://www.google.com/');
  const [bookmarked, setBookmarked] = useState(false);
  const [drawer, setDrawer] = useState<'none' | 'bookmarks' | 'history' | 'downloads'>('none');
  const [library, setLibrary] = useState<{
    bookmarks: Array<{ id: string; title: string; url: string }>;
    history: Array<{ id: string; title: string; url: string; at: string }>;
  }>({ bookmarks: [], history: [] });
  const [downloads, setDownloads] = useState<HostBrowseDownload[]>([]);
  const [resumeSnap, setResumeSnap] = useState<HostBrowseLastSnapshot | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<HostBrowsePanelSettings>({
    engine: 'auto',
    chromePath: '',
    allowLoopback: false,
    noSandbox: false,
    safetyLevel: 'standard',
    blockHosts: [],
    allowDangerousDownloads: false,
    audioBridge: false,
  });
  const [blockHostsText, setBlockHostsText] = useState('');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [stackProbeTick, setStackProbeTick] = useState(0);
  const [envHints, setEnvHints] = useState<Record<string, string | null>>({});
  const [audioStatus, setAudioStatus] = useState<{
    enabled: boolean;
    active: boolean;
    reason?: string;
  } | null>(null);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [dangerConfirm, setDangerConfirm] = useState<null | 'nosandbox' | 'dangerdl'>(
    null,
  );

  const abortRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const liveRef = useRef<HTMLImageElement | null>(null);
  const frameWrapRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastFrameAt = useRef(0);
  const noFrameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pcmPlayerRef = useRef<PcmPlayer | null>(null);

  const loadCapsAndSettings = useCallback(async () => {
    try {
      const s = await hostBrowseApi.getSettings();
      setCaps(s.capabilities);
      const safety: HostBrowseSafetyLevel =
        s.settings.safetyLevel === 'strict' ||
        s.settings.safetyLevel === 'relaxed' ||
        s.settings.safetyLevel === 'standard'
          ? s.settings.safetyLevel
          : 'standard';
      const hosts = Array.isArray(s.settings.blockHosts) ? s.settings.blockHosts : [];
      setSettingsDraft({
        engine: (s.settings.engine as HostBrowseEnginePref) || 'auto',
        chromePath: s.settings.chromePath || '',
        allowLoopback: Boolean(s.settings.allowLoopback),
        noSandbox: Boolean(s.settings.noSandbox),
        safetyLevel: safety,
        blockHosts: hosts,
        allowDangerousDownloads: Boolean(s.settings.allowDangerousDownloads),
        audioBridge: Boolean(s.settings.audioBridge),
      });
      setBlockHostsText(hosts.join('\n'));
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
    void hostBrowseApi.library().then((r) => {
      setHomeUrl(r.library.homeUrl || 'https://www.google.com/');
      setLibrary({
        bookmarks: r.library.bookmarks || [],
        history: r.library.history || [],
      });
      const snap = r.library.lastSnapshot;
      if (snap?.tabs?.length) setResumeSnap(snap);
    }).catch(() => undefined);
  }, [loadCapsAndSettings]);

  // Heartbeat while browser session live on this page
  useEffect(() => {
    if (!session || session.engine !== 'browser') return;
    const tick = () => {
      void hostBrowseApi.heartbeat(session.sessionId).catch(() => undefined);
    };
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, [session?.sessionId, session?.engine]);

  // Poll downloads for browser engine
  useEffect(() => {
    if (!session || session.engine !== 'browser') {
      setDownloads([]);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void hostBrowseApi
        .listDownloads(session.sessionId)
        .then((r) => {
          if (!cancelled) setDownloads(r.downloads || []);
        })
        .catch(() => undefined);
    };
    refresh();
    const id = setInterval(refresh, 4_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session?.sessionId, session?.engine]);

  // Leave page → end browser session (kill chrome / ephemeral user)
  useEffect(() => {
    return () => {
      if (session?.engine === 'browser') {
        void hostBrowseApi.deleteSession(session.sessionId).catch(() => undefined);
      }
    };
  }, [session?.sessionId, session?.engine]);


  const saveSettings = useCallback(async () => {
    setSettingsBusy(true);
    setError(null);
    try {
      const hosts = blockHostsText
        .split(/[\n,]+/)
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 200);
      const payload: HostBrowsePanelSettings = {
        ...settingsDraft,
        blockHosts: hosts,
      };
      const r = await hostBrowseApi.saveSettings(payload);
      setCaps(r.capabilities);
      const safety: HostBrowseSafetyLevel =
        r.settings.safetyLevel === 'strict' ||
        r.settings.safetyLevel === 'relaxed' ||
        r.settings.safetyLevel === 'standard'
          ? r.settings.safetyLevel
          : 'standard';
      const nextHosts = Array.isArray(r.settings.blockHosts)
        ? r.settings.blockHosts
        : hosts;
      setSettingsDraft({
        engine: (r.settings.engine as HostBrowseEnginePref) || 'auto',
        chromePath: r.settings.chromePath || '',
        allowLoopback: Boolean(r.settings.allowLoopback),
        noSandbox: Boolean(r.settings.noSandbox),
        safetyLevel: safety,
        blockHosts: nextHosts,
        allowDangerousDownloads: Boolean(r.settings.allowDangerousDownloads),
        audioBridge: Boolean(r.settings.audioBridge),
      });
      setBlockHostsText(nextHosts.join('\n'));
      if (r.capabilities.defaultEngine) setEngine(r.capabilities.defaultEngine);
      notifyOk(t('hostBrowse.settingsSaved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setSettingsBusy(false);
    }
  }, [settingsDraft, blockHostsText, t]);

  const clearNoFrameTimer = useCallback(() => {
    if (noFrameTimer.current) {
      clearTimeout(noFrameTimer.current);
      noFrameTimer.current = null;
    }
  }, []);

  const closeLive = useCallback(() => {
    clearNoFrameTimer();
    try {
      wsRef.current?.close();
    } catch {
      /* */
    }
    wsRef.current = null;
    setLiveImg(null);
    setLivePhase('idle');
    setAudioStatus(null);
    pcmPlayerRef.current?.dispose();
    pcmPlayerRef.current = null;
    setAudioUnlocked(false);
  }, [clearNoFrameTimer]);

  const sendWs = useCallback((obj: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }, []);

  const pushViewport = useCallback(() => {
    const el = frameWrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.max(320, Math.floor(r.width));
    const h = Math.max(240, Math.floor(r.height));
    sendWs({ t: 'resize', w, h });
  }, [sendWs]);

  const openLive = useCallback(
    async (sessionId: string) => {
      closeLive();
      setLivePhase('connecting');
      setErrorCode(null);
      try {
        const ticket = await hostBrowseApi.liveTicket(sessionId);
        const ws = new WebSocket(hostBrowseLiveWsUrl(ticket.wsPath));
        wsRef.current = ws;
        lastFrameAt.current = 0;
        pcmPlayerRef.current?.dispose();
        pcmPlayerRef.current = new PcmPlayer();
        setAudioUnlocked(false);
        clearNoFrameTimer();
        noFrameTimer.current = setTimeout(() => {
          if (Date.now() - lastFrameAt.current > 8000) {
            setLivePhase('error');
            setErrorCode('LIVE_NO_FRAME');
            setError(t('hostBrowse.err.LIVE_NO_FRAME'));
            sendWs({ t: 'reconnect_cast' });
          }
        }, 8000);

        ws.onopen = () => {
          // Measure panel and sync Chromium viewport
          requestAnimationFrame(() => pushViewport());
          sendWs({ t: 'stream', preset: streamPreset });
        };
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
              code?: string;
              stream?: { quality?: number; preset?: string };
              sampleRate?: number;
              enabled?: boolean;
              active?: boolean;
              reason?: string;
            };
            if (msg.t === 'frame' && msg.data) {
              lastFrameAt.current = Date.now();
              setLiveImg(`data:${msg.mime || 'image/jpeg'};base64,${msg.data}`);
              if (msg.w && msg.h) setLiveSize({ w: msg.w, h: msg.h });
              setLivePhase('live');
              setErrorCode(null);
            } else if (msg.t === 'audio' && msg.data) {
              pcmPlayerRef.current?.pushBase64S16le(
                msg.data,
                Number(msg.sampleRate) || 48000,
              );
            } else if (msg.t === 'audio_status') {
              setAudioStatus({
                enabled: Boolean(msg.enabled),
                active: Boolean(msg.active),
                reason: msg.reason,
              });
            } else if (msg.t === 'meta' && msg.url) {
              setUrlDraft(msg.url);
            } else if (msg.t === 'tabs' && Array.isArray((msg as { tabs?: HostBrowseTab[] }).tabs)) {
              const tabs = (msg as { tabs: HostBrowseTab[] }).tabs;
              setBrowserTabs(tabs);
              const act = tabs.find((x) => x.active) || tabs[0];
              setActiveTabId(act?.pageId ?? null);
              if (act?.url) setUrlDraft(act.url);
            } else if (msg.t === 'stream_ok' && msg.stream) {
              setStreamMeta({
                quality: msg.stream.quality,
                preset: msg.stream.preset,
              });
            } else if (msg.t === 'resize_ok' && msg.w && msg.h) {
              setLiveSize({ w: msg.w, h: msg.h });
            } else if (msg.t === 'err') {
              setLivePhase('error');
              setErrorCode(msg.code || 'LIVE_WS_FAIL');
              setError(msg.message || t('hostBrowse.liveError'));
            }
          } catch {
            /* */
          }
        };
        ws.onerror = () => {
          setLivePhase('error');
          setErrorCode('LIVE_WS_FAIL');
          setError(t('hostBrowse.liveError'));
        };
        ws.onclose = () => {
          setLivePhase((ph) => (ph === 'live' || ph === 'connecting' ? 'error' : ph));
        };
      } catch (e) {
        setLivePhase('error');
        setErrorCode('LIVE_WS_FAIL');
        setError(e instanceof Error ? e.message : t('hostBrowse.liveError'));
      }
    },
    [closeLive, t, streamPreset, pushViewport, sendWs, clearNoFrameTimer],
  );

  useEffect(() => () => closeLive(), [closeLive]);

  // Dynamic resize of live surface
  useEffect(() => {
    const el = frameWrapRef.current;
    if (!el || engine !== 'browser') return;
    const ro = new ResizeObserver(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) pushViewport();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [engine, pushViewport, session?.sessionId]);

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
      setWarns(result.warnings ?? []);
      if (result.errorCode) setErrorCode(result.errorCode);
      if (result.blocked) {
        setError(t('hostBrowse.ssrfBlocked'));
        setErrorCode(result.errorCode || 'SSRF_BLOCKED');
      } else if (!result.ok && result.status === 0) {
        setError(t('hostBrowse.loadFailed'));
        setErrorCode(result.errorCode || 'NAV_FAIL');
      } else if (result.warnings?.includes('possible_bot_challenge')) {
        setError(null);
        setErrorCode('BOT_CHALLENGE');
      } else {
        setError(null);
        if (!result.errorCode) setErrorCode(null);
      }

      if (s.engine === 'proxy' && result.contentPath && !result.blocked) {
        setFrameSrc(result.contentPath);
        if (iframeRef.current) iframeRef.current.src = result.contentPath;
      }
      if (s.engine === 'browser' && result.finalUrl && !result.blocked) {
        setBrowserTabs((prev) => {
          if (!prev.length) {
            return [
              {
                pageId: activeTabId || 'main',
                url: result.finalUrl,
                title: result.title || result.finalUrl,
                active: true,
              },
            ];
          }
          return prev.map((tb) =>
            tb.active || tb.pageId === activeTabId
              ? {
                  ...tb,
                  url: result.finalUrl,
                  title: result.title || result.finalUrl,
                  active: true,
                }
              : { ...tb, active: false },
          );
        });
      }
    },
    [t, activeTabId],
  );

  const syncTabsFromServer = useCallback(async (sessionId: string) => {
    try {
      const r = await hostBrowseApi.listTabs(sessionId);
      setBrowserTabs(r.tabs || []);
      const act = (r.tabs || []).find((x) => x.active) || r.tabs?.[0];
      setActiveTabId(act?.pageId ?? null);
      if (act?.url) setUrlDraft(act.url);
    } catch {
      /* ignore */
    }
  }, []);

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

        if (s.engine === 'browser' && !result.blocked) {
          setBookmarked(
            library.bookmarks.some((b) => b.url === result.finalUrl),
          );
          await openLive(s.sessionId);
          await syncTabsFromServer(s.sessionId);
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
    [applyNav, ensureSession, mode, engine, openLive, syncTabsFromServer, library.bookmarks, t],
  );

  const onGo = useCallback(() => {
    const raw = urlDraft.trim();
    if (!raw) return;
    void runNavigate({ url: raw, action: 'goto' });
  }, [runNavigate, urlDraft]);

  const dismissResume = useCallback(() => {
    setResumeSnap(null);
    void hostBrowseApi.clearLastSnapshot().catch(() => undefined);
  }, []);

  const onResume = useCallback(async () => {
    if (!resumeSnap?.tabs?.length) return;
    setBusy(true);
    setError(null);
    try {
      const m: HostBrowseMode =
        resumeSnap.mode === 'intranet' ? 'intranet' : 'internet';
      const eng: HostBrowseEngine =
        resumeSnap.engine === 'browser' && caps?.chromeAvailable
          ? 'browser'
          : resumeSnap.engine === 'proxy'
            ? 'proxy'
            : engine;
      setMode(m);
      setEngine(eng);
      const urls = resumeSnap.tabs.filter((tb) => tb.url).slice(0, 6);
      const idx = Math.min(
        Math.max(0, resumeSnap.activeIndex || 0),
        Math.max(0, urls.length - 1),
      );
      const activeUrl = urls[idx]?.url || urls[0]?.url;
      if (activeUrl) {
        setUrlDraft(activeUrl);
        const s = await ensureSession(m, eng);
        const result = await hostBrowseApi.navigate(s.sessionId, {
          url: activeUrl,
          action: 'goto',
        });
        applyNav(s, result);
        if (eng === 'browser') {
          // Open remaining snapshot URLs as real server tabs
          for (let i = 0; i < urls.length; i++) {
            if (i === idx) continue;
            const u = urls[i]?.url;
            if (u) {
              await hostBrowseApi.openTab(s.sessionId, { url: u }).catch(() => undefined);
            }
          }
          if (idx > 0) {
            const listed = await hostBrowseApi.listTabs(s.sessionId).catch(() => null);
            const want = listed?.tabs?.[idx];
            if (want) {
              await hostBrowseApi.switchTab(s.sessionId, want.pageId).catch(() => undefined);
            }
          }
          await openLive(s.sessionId);
          await syncTabsFromServer(s.sessionId);
        }
      }
      setResumeSnap(null);
      void hostBrowseApi.clearLastSnapshot().catch(() => undefined);
      notifyOk(t('hostBrowse.resumeDone'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.loadFailed'));
    } finally {
      setBusy(false);
    }
  }, [
    resumeSnap,
    caps?.chromeAvailable,
    engine,
    ensureSession,
    applyNav,
    openLive,
    syncTabsFromServer,
    t,
  ]);

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
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const mapped = clientToPage(
        relX,
        relY,
        rect.width,
        rect.height,
        liveSize.w,
        liveSize.h,
        zoomMode,
        zoomPercent,
      );
      if (!mapped.inside && type !== 'wheel') return;
      const { x, y } = mapped;
      if (type === 'wheel' && 'deltaY' in e) {
        e.preventDefault();
        const we = e as React.WheelEvent;
        let dy = we.deltaY;
        let dx = we.deltaX;
        if (we.deltaMode === 1) {
          dy *= 32;
          dx *= 32;
        }
        if (Math.abs(dy) < 4 && dy !== 0) dy = Math.sign(dy) * 40;
        // move cursor then wheel for reliable scroll targets
        ws.send(JSON.stringify({ t: 'mouse', type: 'move', x, y }));
        ws.send(
          JSON.stringify({
            t: 'mouse',
            type: 'wheel',
            x,
            y,
            deltaX: Math.round(dx),
            deltaY: Math.round(dy),
          }),
        );
        return;
      }
      ws.send(JSON.stringify({ t: 'mouse', type, x, y, button: 'left' }));
    },
    [liveSize, zoomMode, zoomPercent],
  );

  const onStreamPreset = useCallback(
    (preset: StreamPreset) => {
      setStreamPreset(preset);
      sendWs({ t: 'stream', preset });
    },
    [sendWs],
  );

  const retryLive = useCallback(() => {
    if (session) void openLive(session.sessionId);
  }, [session, openLive]);

  const retryNav = useCallback(() => {
    const u = last?.finalUrl || session?.currentUrl || urlDraft;
    if (u) void runNavigate({ url: u, action: 'goto' });
  }, [last, session, urlDraft, runNavigate]);

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

  // Scroll: non-passive wheel on live surface (prevent page scroll steal)
  useEffect(() => {
    const el = frameWrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if ((session?.engine ?? engine) !== 'browser') return;
      e.preventDefault();
      e.stopPropagation();
      const img = liveRef.current;
      const rect = (img ?? el).getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;
      const mapped = clientToPage(
        relX,
        relY,
        rect.width,
        rect.height,
        liveSize.w,
        liveSize.h,
        zoomMode,
        zoomPercent,
      );
      let dy = e.deltaY;
      let dx = e.deltaX;
      if (e.deltaMode === 1) {
        dy *= 32;
        dx *= 32;
      } else if (e.deltaMode === 2) {
        dy *= rect.height;
        dx *= rect.width;
      }
      // Amplify small trackpad deltas
      if (Math.abs(dy) < 4 && dy !== 0) dy = Math.sign(dy) * 40;
      ws.send(
        JSON.stringify({
          t: 'mouse',
          type: 'wheel',
          x: mapped.x,
          y: mapped.y,
          deltaX: Math.round(dx),
          deltaY: Math.round(dy),
        }),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [session?.engine, engine, liveSize, zoomMode, zoomPercent]);


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
  const hasNavigated = Boolean(last || session?.currentUrl);
  const hasLive = Boolean(isBrowser && hasNavigated);
  const showEmpty = !hasProxyContent && !hasLive;

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
            hint: t('hostBrowse.egressHint', { host: window.location.hostname }),
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
          title={!session ? t('hostBrowse.closeNoSession') : t('hostBrowse.closeSessionHint')}
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
            <Alert variant="info">
              {t('hostBrowse.egressHint', { host: window.location.hostname })}
            </Alert>

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
                    aria-label={
                      caps && !caps.chromeAvailable
                        ? t('hostBrowse.needChrome')
                        : t('hostBrowse.engineLabel')
                    }
                    value={engine}
                    onChange={(v) => onEngineChange(v as HostBrowseEngine)}
                    options={[
                      { value: 'proxy', label: t('hostBrowse.engineProxy') },
                      {
                        value: 'browser',
                        label:
                          caps && !caps.chromeAvailable
                            ? t('hostBrowse.engineBrowserNeedChrome')
                            : t('hostBrowse.engineBrowser'),
                      },
                    ]}
                    disabled={
                      busy ||
                      (engine !== 'browser' && Boolean(caps && !caps.chromeAvailable))
                    }
                  />
                </div>

                {isBrowser ? (
                  <>
                    <label className="hb-compact">
                      <span className="visually-hidden">{t('hostBrowse.stream.label')}</span>
                      <select
                        className="hb-compact__select"
                        value={streamPreset}
                        onChange={(e) => onStreamPreset(e.target.value as StreamPreset)}
                        title={t('hostBrowse.stream.label')}
                      >
                        <option value="smooth">{t('hostBrowse.stream.smooth')}</option>
                        <option value="balanced">{t('hostBrowse.stream.balanced')}</option>
                        <option value="sharp">{t('hostBrowse.stream.sharp')}</option>
                      </select>
                    </label>
                    <label className="hb-compact">
                      <span className="visually-hidden">{t('hostBrowse.zoom.label')}</span>
                      <select
                        className="hb-compact__select"
                        value={zoomMode === 'percent' ? String(zoomPercent) : zoomMode}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === 'fit' || v === 'fill') setZoomMode(v);
                          else {
                            setZoomMode('percent');
                            setZoomPercent(Number(v) || 100);
                          }
                        }}
                        title={t('hostBrowse.zoom.label')}
                      >
                        <option value="fit">{t('hostBrowse.zoom.fit')}</option>
                        <option value="100">100%</option>
                        <option value="125">125%</option>
                        <option value="75">75%</option>
                      </select>
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('hostBrowse.fullscreen')}
                      onClick={() => {
                        const el = frameWrapRef.current;
                        if (!el) return;
                        if (document.fullscreenElement) void document.exitFullscreen();
                        else void el.requestFullscreen();
                      }}
                    >
                      ⛶
                    </Button>
                  </>
                ) : null}

                <div className="hb-toolbar__nav">
                                    <Button
                    size="sm"
                    variant="ghost"
                    title={t('hostBrowse.home')}
                    onClick={() => {
                      setUrlDraft(homeUrl);
                      void runNavigate({ url: homeUrl, action: 'goto' });
                    }}
                    disabled={busy}
                  >
                    ⌂
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('hostBrowse.bookmarkAdd')}
                    aria-label={t('hostBrowse.bookmarkAdd')}
                    onClick={() => {
                      const u = last?.finalUrl || session?.currentUrl || urlDraft;
                      if (!u) return;
                      void hostBrowseApi
                        .toggleBookmark({ url: u, title: last?.title })
                        .then((r) => {
                          setLibrary((lib) => ({
                            ...lib,
                            bookmarks: r.library.bookmarks,
                          }));
                          setBookmarked(r.library.bookmarks.some((b) => b.url === u));
                          notifyOk(t('hostBrowse.bookmarkToggled'));
                        })
                        .catch((e) =>
                          setError(e instanceof Error ? e.message : t('common.loadFailed')),
                        );
                    }}
                    disabled={busy || !(last?.finalUrl || session?.currentUrl || urlDraft)}
                  >
                    {bookmarked ? '★' : '☆'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('hostBrowse.bookmarkList')}
                    aria-label={t('hostBrowse.bookmarkList')}
                    onClick={() =>
                      setDrawer((d) => (d === 'bookmarks' ? 'none' : 'bookmarks'))
                    }
                  >
                    ☰
                    {library.bookmarks.length > 0 ? (
                      <Badge tone="info">{library.bookmarks.length}</Badge>
                    ) : null}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('hostBrowse.history')}
                    aria-label={t('hostBrowse.history')}
                    onClick={() =>
                      setDrawer((d) => (d === 'history' ? 'none' : 'history'))
                    }
                  >
                    🕐
                  </Button>
                  {isBrowser ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      title={t('hostBrowse.downloads')}
                      onClick={() =>
                        setDrawer((d) => (d === 'downloads' ? 'none' : 'downloads'))
                      }
                    >
                      ↓
                      {downloads.length > 0 ? (
                        <Badge tone="info">{downloads.length}</Badge>
                      ) : null}
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'back' })}
                    disabled={busy || !session || !canBack}
                    title={!session ? t('hostBrowse.needUrl') : t('hostBrowse.back')}
                    aria-label={t('hostBrowse.back')}
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'forward' })}
                    disabled={busy || !session || !canForward}
                    title={!session ? t('hostBrowse.needUrl') : t('hostBrowse.forward')}
                    aria-label={t('hostBrowse.forward')}
                  >
                    →
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'reload' })}
                    disabled={busy || !session?.currentUrl}
                    title={!session ? t('hostBrowse.needUrl') : t('hostBrowse.reload')}
                    aria-label={t('hostBrowse.reload')}
                  >
                    ↻
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onStop}
                    disabled={!busy && !session}
                    title={!session ? t('hostBrowse.needUrl') : t('hostBrowse.stop')}
                    aria-label={t('hostBrowse.stop')}
                  >
                    ⏹
                  </Button>
                </div>
                <div className="hb-toolbar__url">
                  <span className="hb-lock" title={lockLabel} aria-label={lockLabel}>
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
                  <Button
                    size="sm"
                    onClick={onGo}
                    disabled={busy || !urlDraft.trim()}
                    title={
                      !urlDraft.trim() ? t('hostBrowse.needUrl') : t('hostBrowse.go')
                    }
                  >
                    {t('hostBrowse.go')}
                  </Button>
                </div>
                <div className="hb-toolbar__nav">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onClearCookies()}
                    disabled={!session || busy}
                    title={!session ? t('hostBrowse.needUrl') : t('hostBrowse.clearCookies')}
                  >
                    {t('hostBrowse.clearCookies')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void onCopyUrl()}
                    disabled={!urlDraft && !last?.finalUrl}
                    title={
                      !urlDraft && !last?.finalUrl
                        ? t('hostBrowse.needUrl')
                        : t('hostBrowse.copyUrl')
                    }
                  >
                    {t('hostBrowse.copyUrl')}
                  </Button>
                </div>
              </div>
              {!session ? (
                <p className="hb-toolbar-hint muted u-text-sm">{t('hostBrowse.needUrl')}</p>
              ) : null}

              <div className="hb-progress" aria-hidden={!busy}>
                <div className={`hb-progress__bar${busy ? '' : ' is-done'}`} />
              </div>

              {resumeSnap && resumeSnap.tabs.length > 0 && !session ? (
                <div className="hb-resume">
                  <Alert variant="info">
                    {t('hostBrowse.resumeHintOwned', {
                      user: user?.username || '—',
                      count: resumeSnap.tabs.length,
                      url: resumeSnap.tabs[0]?.url || '—',
                      when: resumeSnap.updatedAt
                        ? formatDateTime(resumeSnap.updatedAt, {
                            ...hostTimeZoneOpts({ withOffset: true }),
                          })
                        : '—',
                    })}
                  </Alert>
                  <div className="hb-resume__btns">
                    <Button size="sm" onClick={() => void onResume()} disabled={busy}>
                      {t('hostBrowse.resume')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={dismissResume}
                      disabled={busy}
                    >
                      {t('hostBrowse.resumeDismiss')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      title={t('hostBrowse.clearSessionData')}
                      onClick={dismissResume}
                      disabled={busy}
                    >
                      {t('hostBrowse.clearSessionData')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {(error || errorCode) && hasNavigated ? (
                <div className="hb-error-actions">
                  <Alert variant={errorCode === 'BOT_CHALLENGE' ? 'warn' : 'error'}>
                    {error ||
                      (errorCode ? t(`hostBrowse.err.${errorCode}`, { defaultValue: errorCode }) : '')}
                    {warns.length ? ` (${warns.join(', ')})` : ''}
                  </Alert>
                  <div className="hb-error-actions__btns">
                    <Button size="sm" variant="secondary" onClick={() => void retryNav()}>
                      {t('hostBrowse.retryNav')}
                    </Button>
                    {isBrowser ? (
                      <Button size="sm" variant="secondary" onClick={() => void retryLive()}>
                        {t('hostBrowse.retryLive')}
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEngine('proxy');
                        notifyInfo(t('hostBrowse.tryProxy'));
                      }}
                    >
                      {t('hostBrowse.tryProxy')}
                    </Button>
                  </div>
                </div>
              ) : null}

              {isBrowser && session ? (
                <div className="hb-tabs">
                  {browserTabs.map((tb) => (
                    <button
                      key={tb.pageId}
                      type="button"
                      className={`hb-tabs__chip${
                        tb.active || tb.pageId === activeTabId ? ' is-active' : ''
                      }`}
                      onClick={() => {
                        if (!session) return;
                        void (async () => {
                          try {
                            const r = await hostBrowseApi.switchTab(
                              session.sessionId,
                              tb.pageId,
                            );
                            setBrowserTabs(r.tabs || []);
                            setActiveTabId(r.pageId);
                            if (r.currentUrl) setUrlDraft(r.currentUrl);
                            sendWs({ t: 'tabs_list' });
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : t('common.loadFailed'),
                            );
                          }
                        })();
                      }}
                    >
                      <span className="hb-tabs__title">
                        {(tb.title || tb.url || t('hostBrowse.newTab')).slice(0, 24)}
                      </span>
                      <span
                        className="hb-tabs__x"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!session) return;
                          void (async () => {
                            try {
                              const r = await hostBrowseApi.closeTab(
                                session.sessionId,
                                tb.pageId,
                              );
                              setBrowserTabs(r.tabs || []);
                              setActiveTabId(r.activePageId);
                              if (r.currentUrl) setUrlDraft(r.currentUrl);
                            } catch (err) {
                              setError(
                                err instanceof Error
                                  ? err.message
                                  : t('common.loadFailed'),
                              );
                            }
                          })();
                        }}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="hb-tabs__add"
                    title={t('hostBrowse.newTab')}
                    disabled={browserTabs.length >= 6 || busy}
                    onClick={() => {
                      if (!session) return;
                      void (async () => {
                        try {
                          const r = await hostBrowseApi.openTab(session.sessionId, {
                            url: homeUrl,
                          });
                          setBrowserTabs(r.tabs || []);
                          setActiveTabId(r.pageId);
                          setUrlDraft(homeUrl);
                          sendWs({ t: 'tabs_list' });
                        } catch (e) {
                          setError(
                            e instanceof Error ? e.message : t('common.loadFailed'),
                          );
                        }
                      })();
                    }}
                  >
                    +
                  </button>
                </div>
              ) : null}

              {drawer === 'history' || drawer === 'bookmarks' ? (
                <div className="hb-drawer">
                  <div className="hb-drawer__head">
                    <strong>
                      {drawer === 'history'
                        ? t('hostBrowse.history')
                        : t('hostBrowse.bookmarks')}
                    </strong>
                    <Button size="sm" variant="ghost" onClick={() => setDrawer('none')}>
                      ×
                    </Button>
                  </div>
                  {(drawer === 'history' ? library.history : library.bookmarks).length === 0 ? (
                    <p className="muted u-text-sm">
                      {drawer === 'history'
                        ? t('hostBrowse.historyEmpty')
                        : t('hostBrowse.bookmarksEmpty')}
                    </p>
                  ) : null}
                  <ul className="hb-drawer__list">
                    {(drawer === 'history' ? library.history : library.bookmarks).map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="hb-drawer__item"
                          onClick={() => {
                            setUrlDraft(item.url);
                            setDrawer('none');
                            void runNavigate({ url: item.url, action: 'goto' });
                          }}
                        >
                          {item.title || item.url}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {drawer === 'downloads' ? (
                <div className="hb-drawer">
                  <div className="hb-drawer__head">
                    <strong>{t('hostBrowse.downloads')}</strong>
                    <Button size="sm" variant="ghost" onClick={() => setDrawer('none')}>
                      ×
                    </Button>
                  </div>
                  {downloads.length === 0 ? (
                    <p className="hb-drawer__empty">{t('hostBrowse.downloadsEmpty')}</p>
                  ) : (
                    <ul className="hb-drawer__list">
                      {downloads.map((d) => (
                        <li key={d.id} className="hb-drawer__dl">
                          <div className="hb-drawer__item">
                            <span className="hb-drawer__dl-name">{d.filename}</span>
                            <span className="hb-drawer__dl-meta">
                              {d.status === 'completed'
                                ? t('hostBrowse.downloadReady')
                                : d.status === 'blocked'
                                  ? t('hostBrowse.downloadBlocked')
                                  : d.status === 'pending'
                                    ? t('hostBrowse.downloadPending')
                                    : t('hostBrowse.downloadFailed')}
                              {d.size > 0 ? ` · ${Math.round(d.size / 1024)} KB` : ''}
                              {d.reason ? ` — ${d.reason}` : ''}
                            </span>
                          </div>
                          {d.hasFile && session ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                void api
                                  .downloadAuthenticated(
                                    hostBrowseApi.downloadFilePath(
                                      session.sessionId,
                                      d.id,
                                    ),
                                    d.filename,
                                  )
                                  .then(() => notifyOk(t('hostBrowse.downloadSave')))
                                  .catch((e) =>
                                    setError(
                                      e instanceof Error
                                        ? e.message
                                        : t('hostBrowse.downloadFailed'),
                                    ),
                                  );
                              }}
                            >
                              {t('hostBrowse.downloadSave')}
                            </Button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              <div
                ref={frameWrapRef}
                className={`hb-frame-wrap${showEmpty ? ' is-empty' : ''}`}
              >
                {showEmpty ? (
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
                    onError={() => setError(t('hostBrowse.frameBlocked'))}
                    referrerPolicy="no-referrer"
                    src={frameSrc ?? undefined}
                  />
                ) : null}

                {/* Live browser surface */}
                {isBrowser && hasNavigated ? (
                  <div
                    className={`hb-live hb-live--${zoomMode}`}
                    tabIndex={0}
                    onKeyDown={onLiveKey}
                    onKeyUp={onLiveKey}
                  >
                    {audioStatus?.enabled && !audioUnlocked ? (
                      <div className="hb-audio-unlock">
                        <Button
                          size="sm"
                          onClick={() => {
                            void (async () => {
                              if (!pcmPlayerRef.current) {
                                pcmPlayerRef.current = new PcmPlayer();
                              }
                              const ok = await pcmPlayerRef.current.unlock();
                              setAudioUnlocked(ok);
                              if (ok) notifyOk(t('hostBrowse.audioUnlocked'));
                            })();
                          }}
                        >
                          {t('hostBrowse.audioUnlock')}
                        </Button>
                        <span className="muted u-text-xs">
                          {t('hostBrowse.audioUnlockHint')}
                        </span>
                      </div>
                    ) : null}
                    {liveImg ? (
                      // eslint-disable-next-line jsx-a11y/alt-text
                      <img
                        ref={liveRef}
                        className="hb-live__img"
                        src={liveImg}
                        draggable={false}
                        style={
                          zoomMode === 'percent'
                            ? { maxWidth: `${zoomPercent}%`, maxHeight: `${zoomPercent}%` }
                            : undefined
                        }
                        onClick={(e) => {
                          if (audioStatus?.enabled && !audioUnlocked) {
                            void pcmPlayerRef.current?.unlock().then((ok) => {
                              setAudioUnlocked(ok);
                            });
                          }
                          onLivePointer('click', e);
                        }}
                        onMouseMove={(e) => {
                          if (e.buttons === 1) onLivePointer('move', e);
                        }}
                        onWheel={(e) => onLivePointer('wheel', e)}
                      />
                    ) : (
                      <div className="hb-live__wait">
                        {livePhase === 'connecting' || livePhase === 'idle'
                          ? t('hostBrowse.liveWaiting')
                          : t('hostBrowse.err.LIVE_NO_FRAME')}
                      </div>
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
                {livePhase === 'live' ? <Badge tone="ok">live</Badge> : null}
                {isBrowser ? (
                  audioStatus?.enabled ? (
                    <span title={audioStatus.reason || t('hostBrowse.audioBridgedHint')}>
                      <Badge tone={audioUnlocked ? 'ok' : 'warn'}>
                        {audioUnlocked
                          ? t('hostBrowse.audioPlaying')
                          : t('hostBrowse.audioNeedsUnlock')}
                      </Badge>
                    </span>
                  ) : (
                    <span title={t('hostBrowse.audioNotBridgedHint')}>
                      <Badge tone="warn">{t('hostBrowse.audioNotBridged')}</Badge>
                    </span>
                  )
                ) : null}
                {errorCode ? <Badge tone="danger">{errorCode}</Badge> : null}
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
                setStackProbeTick((n) => n + 1);
              }}
              showReadyActions={false} />
            <SoftwareVersionBar key={stackProbeTick} softwareId="chromium" />
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
                description={t('hostBrowse.settingsNoSandboxWarn')}
                checked={settingsDraft.noSandbox}
                onChange={(c) => {
                  if (c && !settingsDraft.noSandbox) {
                    setDangerConfirm('nosandbox');
                    return;
                  }
                  setSettingsDraft((d) => ({ ...d, noSandbox: c }));
                }}
              />
              <Field
                label={t('hostBrowse.settingsSafety')}
                htmlFor="hb-safety"
                hint={t('hostBrowse.settingsSafetyHint')}
              >
                <SegRadio
                  name="hb-safety"
                  size="sm"
                  value={settingsDraft.safetyLevel}
                  onChange={(v) =>
                    setSettingsDraft((d) => ({
                      ...d,
                      safetyLevel: v as HostBrowseSafetyLevel,
                    }))
                  }
                  options={[
                    { value: 'strict', label: t('hostBrowse.safetyStrict') },
                    { value: 'standard', label: t('hostBrowse.safetyStandard') },
                    { value: 'relaxed', label: t('hostBrowse.safetyRelaxed') },
                  ]}
                />
              </Field>
              <Field
                label={t('hostBrowse.settingsBlockHosts')}
                htmlFor="hb-block-hosts"
                hint={t('hostBrowse.settingsBlockHostsHint')}
              >
                <textarea
                  id="hb-block-hosts"
                  rows={4}
                  value={blockHostsText}
                  onChange={(e) => setBlockHostsText(e.target.value)}
                  placeholder="example.bad&#10;malware.test"
                  spellCheck={false}
                  className="hb-textarea"
                />
              </Field>
              <CheckboxField
                id="hb-danger-dl"
                label={t('hostBrowse.settingsAllowDangerousDownloads')}
                description={t('hostBrowse.settingsDangerDlWarn')}
                checked={settingsDraft.allowDangerousDownloads}
                onChange={(c) => {
                  if (c && !settingsDraft.allowDangerousDownloads) {
                    setDangerConfirm('dangerdl');
                    return;
                  }
                  setSettingsDraft((d) => ({
                    ...d,
                    allowDangerousDownloads: c,
                  }));
                }}
              />
              <CheckboxField
                id="hb-audio-bridge"
                label={t('hostBrowse.settingsAudioBridge')}
                checked={settingsDraft.audioBridge}
                onChange={(c) =>
                  setSettingsDraft((d) => ({ ...d, audioBridge: c }))
                }
              />
              <p className="muted u-text-xs">{t('hostBrowse.settingsAudioBridgeHint')}</p>
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
            <div className="hb-media-card">
              <h3 className="hb-media-card__title">{t('hostBrowse.mediaPolicyTitle')}</h3>
              <ul className="hb-media-card__list">
                <li>
                  <strong>{t('hostBrowse.mediaVideoLabel')}</strong>
                  {' — '}
                  {t('hostBrowse.mediaVideoDesc')}
                </li>
                <li>
                  <strong>{t('hostBrowse.mediaAudioLabel')}</strong>
                  {' — '}
                  {t('hostBrowse.mediaAudioDesc')}
                </li>
                <li>
                  <strong>{t('hostBrowse.mediaPolicyLabel')}</strong>
                  {' — '}
                  {t('hostBrowse.mediaPolicyDesc')}
                </li>
              </ul>
              <Alert variant="info">{t('hostBrowse.mediaNote')}</Alert>
            </div>
            <Alert variant="info">{t('hostBrowse.isolationNote')}</Alert>
            {Object.keys(envHints).length > 0 ? (
              <div className="stack u-mt-3">
                <div className="muted u-text-sm">{t('hostBrowse.envHintsTitle')}</div>
                <DataTable
                  columns={[
                    {
                      key: 'k',
                      header: t('hostBrowse.envColVar'),
                      render: (row) => <code>{row.k}</code>,
                    },
                    {
                      key: 'host',
                      header: t('hostBrowse.envColHost'),
                      render: (row) => <code>{row.host}</code>,
                    },
                    {
                      key: 'panel',
                      header: t('hostBrowse.envColPanel'),
                      render: (row) => <code>{row.panel}</code>,
                    },
                    {
                      key: 'effective',
                      header: t('hostBrowse.envColEffective'),
                      render: (row) => <code>{row.effective}</code>,
                    },
                  ]}
                  rows={Object.entries(envHints).map(([k, v]) => {
                    const unset = t('hostBrowse.envUnset');
                    const hostVal = v ?? unset;
                    const panelRaw =
                      k === 'YSK_HOST_BROWSE_ENGINE'
                        ? settingsDraft.engine
                        : k === 'YSK_HOST_BROWSE_CHROME'
                          ? (settingsDraft.chromePath || '').trim()
                          : k === 'YSK_HOST_BROWSE_LOOPBACK'
                            ? settingsDraft.allowLoopback
                              ? '1'
                              : '0'
                            : k === 'YSK_HOST_BROWSE_NO_SANDBOX'
                              ? settingsDraft.noSandbox
                                ? '1'
                                : '0'
                              : k === 'YSK_HOST_BROWSE_AUDIO'
                                ? settingsDraft.audioBridge
                                  ? '1'
                                  : '0'
                                : '';
                    const panelSet = Boolean(panelRaw);
                    const panelVal = panelSet ? panelRaw : unset;
                    return {
                      k,
                      host: hostVal,
                      panel: panelVal,
                      effective: panelSet ? panelVal : hostVal,
                    };
                  })}
                  rowKey={(row) => row.k}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="hostBrowse" /> : null}
      </PageTabs>

      <ConfirmDialog
        open={dangerConfirm != null}
        onClose={() => setDangerConfirm(null)}
        onConfirm={() => {
          if (dangerConfirm === 'nosandbox') {
            setSettingsDraft((d) => ({ ...d, noSandbox: true }));
          } else if (dangerConfirm === 'dangerdl') {
            setSettingsDraft((d) => ({ ...d, allowDangerousDownloads: true }));
          }
          setDangerConfirm(null);
        }}
        title={t('hostBrowse.settingsDangerConfirmTitle')}
        description={
          dangerConfirm === 'nosandbox'
            ? t('hostBrowse.settingsNoSandboxWarn')
            : t('hostBrowse.settingsDangerDlWarn')
        }
        danger
        confirmLabel={t('common.confirm')}
      />
    </FeaturePageLayout>
  );
}
