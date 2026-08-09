/**
 * Host-mediated proxy browser — real host egress, no operator browser fingerprint.
 * Tabs: browse | about (code style).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FeaturePageLayout,
  PageGuide,
  PageTabs,
  SegRadio,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { ApiError } from '../../shared/services/api';
import {
  hostBrowseApi,
  type HostBrowseMode,
  type HostBrowseNavigateResult,
  type HostBrowseSession,
} from '../../features/host-browse/api';
import { notifyInfo, notifyOk } from '../../shared/lib/notify';

const TABS = ['browse', 'about'] as const;

export function HostBrowsePage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'browse');

  const [mode, setMode] = useState<HostBrowseMode>('internet');
  const [session, setSession] = useState<HostBrowseSession | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [last, setLast] = useState<HostBrowseNavigateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const ensureSession = useCallback(
    async (m: HostBrowseMode): Promise<HostBrowseSession> => {
      if (session && session.mode === m) return session;
      const created = await hostBrowseApi.createSession({ mode: m });
      setSession(created);
      setLast(null);
      return created;
    },
    [session],
  );

  const applyNav = useCallback(
    (s: HostBrowseSession, result: HostBrowseNavigateResult) => {
      setLast(result);
      setSession((prev) =>
        prev
          ? {
              ...prev,
              currentUrl: result.finalUrl || prev.currentUrl,
              historyIndex: result.blocked ? prev.historyIndex : prev.historyIndex,
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
      if (result.contentPath && !result.blocked) {
        // iframe loads proxied content with contentToken (no Bearer in URL long-term beyond ct)
        if (iframeRef.current) {
          iframeRef.current.src = result.contentPath;
        }
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
        const s = await ensureSession(mode);
        if (abortRef.current) return;
        const result = await hostBrowseApi.navigate(s.sessionId, body);
        if (abortRef.current) return;
        // refresh cookie count
        try {
          const meta = await hostBrowseApi.getSession(s.sessionId);
          setSession(meta);
        } catch {
          /* ignore */
        }
        applyNav(s, result);
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : t('common.loadFailed');
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [applyNav, ensureSession, mode, t],
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
      if (iframeRef.current) iframeRef.current.src = 'about:blank';
      notifyInfo(t('hostBrowse.modeSwitchHint'));
    },
    [mode, t],
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
      /* ignore */
    }
    setSession(null);
    setLast(null);
    if (iframeRef.current) iframeRef.current.src = 'about:blank';
  }, [session]);

  const onCopyUrl = useCallback(async () => {
    const u = last?.finalUrl || session?.currentUrl || urlDraft;
    if (!u) return;
    try {
      await navigator.clipboard.writeText(u);
      notifyOk(t('hostBrowse.copied'));
    } catch {
      /* ignore */
    }
  }, [last, session, t, urlDraft]);

  // Stop: best-effort cancel flag (in-flight fetch may still complete server-side)
  const onStop = useCallback(() => {
    abortRef.current = true;
    setBusy(false);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  const statusPill = useMemo(() => {
    if (busy) return { label: t('hostBrowse.loading'), tone: 'warn' as const };
    if (error || last?.blocked) return { label: t('hostBrowse.ssrfBlocked'), tone: 'danger' as const };
    if (session) return { label: t('hostBrowse.sessionReady'), tone: 'ok' as const };
    return { label: t('hostBrowse.noSession'), tone: 'neutral' as const };
  }, [busy, error, last, session, t]);

  const lockLabel = useMemo(() => {
    const u = last?.finalUrl || session?.currentUrl || '';
    if (u.startsWith('https:')) return t('hostBrowse.locked');
    if (u.startsWith('http:')) return t('hostBrowse.insecure');
    return '—';
  }, [last, session, t]);

  const hasContent = Boolean(last?.contentPath && !last.blocked);

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
            label: t('hostBrowse.modeInternet'),
            value:
              mode === 'internet'
                ? t('hostBrowse.modeInternet')
                : t('hostBrowse.modeIntranet'),
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
        <>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onCloseSession()}
            disabled={!session || busy}
          >
            {t('hostBrowse.closeSession')}
          </Button>
        </>
      }
    >
      <PageTabs
        tabs={[
          { id: 'browse', label: t('hostBrowse.tabBrowse') },
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
                      {
                        value: 'internet',
                        label: t('hostBrowse.modeInternet'),
                      },
                      {
                        value: 'intranet',
                        label: t('hostBrowse.modeIntranet'),
                      },
                    ]}
                    disabled={busy}
                  />
                </div>
                <div className="hb-toolbar__nav">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'back' })}
                    disabled={busy || !session}
                    aria-label={t('hostBrowse.back')}
                  >
                    ←
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void runNavigate({ action: 'forward' })}
                    disabled={busy || !session}
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
                    disabled={!busy}
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

              <div className={`hb-frame-wrap${hasContent ? '' : ' is-empty'}`}>
                {!hasContent ? (
                  <div className="hb-empty">
                    <EmptyState
                      title={t('hostBrowse.emptyTitle')}
                      description={t('hostBrowse.emptyBody')}
                    />
                  </div>
                ) : null}
                <iframe
                  ref={iframeRef}
                  className="hb-frame"
                  title={t('nav.hostBrowse')}
                  sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
                  referrerPolicy="no-referrer"
                  // no allow-same-origin — panel isolation
                />
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
                        type: last.contentType || '—',
                      })
                    : t('hostBrowse.viaHost')}
                </span>
                {session?.userAgent ? (
                  <Badge tone="neutral">{session.userAgent.slice(0, 28)}…</Badge>
                ) : null}
                {last?.rewritten ? <Badge tone="ok">rewrite</Badge> : null}
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'about' ? <PageGuide guideId="hostBrowse" /> : null}
      </PageTabs>
    </FeaturePageLayout>
  );
}
