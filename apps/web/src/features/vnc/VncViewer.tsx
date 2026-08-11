/**
 * In-panel noVNC RFB viewer with control toolbar.
 * Connects via panel WS proxy (/api/v1/vnc/ws?ticket=…) — not 127.0.0.1.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RFB from '@novnc/novnc';
import { ActionBar, Badge, Button, Field } from '../../shared/components/ui';
import { notifyOk, notifyWarn } from '../../shared/lib/notify';

export type VncViewerTarget = {
  kind: 'account' | 'client';
  id: string;
  label: string;
  subtitle?: string;
};

type ConnState = 'idle' | 'minting' | 'connecting' | 'connected' | 'error' | 'closed';

/** noVNC qualityLevel 0–9 / compressionLevel 0–9 presets */
type QualityPreset = 'low' | 'balanced' | 'high' | 'max';

const QUALITY_PRESETS: Record<
  QualityPreset,
  { quality: number; compression: number }
> = {
  low: { quality: 2, compression: 9 },
  balanced: { quality: 6, compression: 2 },
  high: { quality: 8, compression: 1 },
  max: { quality: 9, compression: 0 },
};

type Props = {
  target: VncViewerTarget;
  /** Create session → ticket + optional stored password */
  createSession: (target: VncViewerTarget) => Promise<{
    wsPath: string;
    password?: string;
    notes?: string[];
  }>;
  onClose: () => void;
};

function wsUrlFromPath(wsPath: string): string {
  const u = new URL(wsPath, window.location.origin);
  u.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/** Map server WS close reason / API errors to user-facing copy. */
function friendlyFailMessage(
  t: (key: string, opts?: Record<string, string>) => string,
  raw: string,
): string {
  const s = (raw || '').trim();
  if (!s) return t('vnc.viewer.error');
  if (/blocked|YSK_EXECUTE|requiresExecute|viewerNeedExecute/i.test(s)) {
    return t('vnc.viewer.errNeedExecute');
  }
  if (/ticket|unauthorized|4401|expired/i.test(s)) {
    return t('vnc.viewer.errTicket');
  }
  if (/busy|4429|too many/i.test(s)) {
    return t('vnc.viewer.errBusy');
  }
  const refused = s.match(/^rfb_refused:(.+):(\d+)/);
  if (refused) {
    return t('vnc.viewer.errRefused', { host: refused[1]!, port: refused[2]! });
  }
  const timeout = s.match(/^rfb_timeout:(.+):(\d+)/);
  if (timeout) {
    return t('vnc.viewer.errTimeout', { host: timeout[1]!, port: timeout[2]! });
  }
  const dns = s.match(/^rfb_dns:(.+)/);
  if (dns) {
    return t('vnc.viewer.errDns', { host: dns[1]! });
  }
  const net = s.match(/^rfb_net:(.+):(\d+)/);
  if (net) {
    return t('vnc.viewer.errNet', { host: net[1]!, port: net[2]! });
  }
  if (/ECONNREFUSED|refused/i.test(s)) return t('vnc.viewer.errRefusedGeneric');
  if (/ETIMEDOUT|timeout/i.test(s)) return t('vnc.viewer.errTimeoutGeneric');
  if (/ENOTFOUND|getaddrinfo/i.test(s)) return t('vnc.viewer.errDnsGeneric');
  if (/auth|password|security/i.test(s)) return t('vnc.viewer.securityFailure');
  // Keep short technical detail as secondary line when no map
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

export function VncViewer({ target, createSession, onClose }: Props) {
  const { t } = useTranslation();
  const screenRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<InstanceType<typeof RFB> | null>(null);
  const [state, setState] = useState<ConnState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [scale, setScale] = useState(true);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>('balanced');
  const [statusText, setStatusText] = useState('');
  /** Last text received from remote (ServerCutText) */
  const [remoteClip, setRemoteClip] = useState('');
  const [clipOpen, setClipOpen] = useState(false);
  const [localClipDraft, setLocalClipDraft] = useState('');

  const disconnect = useCallback(() => {
    try {
      rfbRef.current?.disconnect();
    } catch {
      /* */
    }
    rfbRef.current = null;
    setState('closed');
  }, []);

  const connect = useCallback(async () => {
    if (!screenRef.current) return;
    setError(null);
    setNeedPassword(false);
    setState('minting');
    setStatusText(t('vnc.viewer.minting'));
    try {
      rfbRef.current?.disconnect();
    } catch {
      /* */
    }
    rfbRef.current = null;
    screenRef.current.innerHTML = '';

    try {
      const sess = await createSession(target);
      setState('connecting');
      setStatusText(t('vnc.viewer.connecting'));
      const url = wsUrlFromPath(sess.wsPath);
      const rfb = new RFB(screenRef.current, url, {
        credentials: sess.password || password ? { password: sess.password || password } : undefined,
      });
      rfb.scaleViewport = scale;
      rfb.resizeSession = false;
      rfb.clipViewport = !scale;
      rfb.background = 'rgb(12, 15, 20)';
      const qp = QUALITY_PRESETS[qualityPreset];
      rfb.qualityLevel = qp.quality;
      rfb.compressionLevel = qp.compression;

      rfb.addEventListener('connect', () => {
        setState('connected');
        setStatusText(t('vnc.viewer.connected'));
        setNeedPassword(false);
      });
      rfb.addEventListener('disconnect', (ev: Event) => {
        const detail = (
          ev as CustomEvent<{ clean?: boolean; reason?: string }>
        ).detail;
        const clean = Boolean(detail?.clean);
        setState(clean ? 'closed' : 'error');
        if (clean) {
          setStatusText(t('vnc.viewer.disconnected'));
        } else {
          const reason = detail?.reason || '';
          const msg = friendlyFailMessage(t, reason) || t('vnc.viewer.error');
          setStatusText(t('vnc.viewer.error'));
          setError(msg);
        }
        rfbRef.current = null;
      });
      rfb.addEventListener('credentialsrequired', () => {
        setNeedPassword(true);
        setState('connecting');
        setStatusText(t('vnc.viewer.passwordPrompt'));
        setError(t('vnc.viewer.passwordPromptHint'));
      });
      rfb.addEventListener('securityfailure', (ev: Event) => {
        const detail = (ev as CustomEvent<{ status?: number; reason?: string }>).detail;
        setError(
          friendlyFailMessage(
            t,
            detail?.reason || t('vnc.viewer.securityFailure'),
          ),
        );
        setState('error');
        setStatusText(t('vnc.viewer.securityFailure'));
      });
      // Remote → browser clipboard
      rfb.addEventListener('clipboard', (ev: Event) => {
        const text = (ev as CustomEvent<{ text?: string }>).detail?.text ?? '';
        if (!text) return;
        setRemoteClip(text);
        void (async () => {
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(text);
              notifyOk(t('vnc.viewer.clipboardFromRemote'));
            } else {
              setClipOpen(true);
              notifyOk(t('vnc.viewer.clipboardFromRemoteManual'));
            }
          } catch {
            setClipOpen(true);
            notifyWarn(t('vnc.viewer.clipboardFromRemoteManual'));
          }
        })();
      });

      rfbRef.current = rfb;
      if (sess.password || password) {
        // credentials may already be set; if required later, user re-sends
      }
    } catch (e) {
      setState('error');
      const raw = e instanceof Error ? e.message : String(e);
      setError(friendlyFailMessage(t, raw));
      setStatusText(t('vnc.viewer.error'));
    }
  }, [createSession, password, qualityPreset, scale, t, target]);

  useEffect(() => {
    void connect();
    return () => {
      try {
        rfbRef.current?.disconnect();
      } catch {
        /* */
      }
      rfbRef.current = null;
    };
    // mount once per target
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.kind, target.id]);

  useEffect(() => {
    if (rfbRef.current) {
      rfbRef.current.scaleViewport = scale;
      rfbRef.current.clipViewport = !scale;
    }
  }, [scale]);

  useEffect(() => {
    if (!rfbRef.current) return;
    const qp = QUALITY_PRESETS[qualityPreset];
    rfbRef.current.qualityLevel = qp.quality;
    rfbRef.current.compressionLevel = qp.compression;
  }, [qualityPreset]);

  const sendPassword = () => {
    if (!rfbRef.current || !password) return;
    try {
      rfbRef.current.sendCredentials({ password });
      setNeedPassword(false);
      setStatusText(t('vnc.viewer.connecting'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('vnc.viewer.error'));
    }
  };

  const toggleFullscreen = async () => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await el.requestFullscreen();
      }
    } catch {
      /* */
    }
  };

  /** Browser clipboard → remote (paste into VNC session). */
  const pasteLocalToRemote = async () => {
    if (!rfbRef.current || state !== 'connected') return;
    try {
      let text = localClipDraft;
      if (!text && navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
      if (!text?.trim()) {
        notifyWarn(t('vnc.viewer.clipboardEmpty'));
        setClipOpen(true);
        return;
      }
      rfbRef.current.clipboardPasteFrom(text);
      setLocalClipDraft(text);
      notifyOk(t('vnc.viewer.clipboardToRemote'));
    } catch {
      notifyWarn(t('vnc.viewer.clipboardReadDenied'));
      setClipOpen(true);
    }
  };

  const copyRemoteToLocal = async () => {
    if (!remoteClip) {
      notifyWarn(t('vnc.viewer.clipboardNoRemote'));
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(remoteClip);
        notifyOk(t('vnc.viewer.clipboardCopiedLocal'));
      } else {
        setClipOpen(true);
      }
    } catch {
      setClipOpen(true);
      notifyWarn(t('vnc.viewer.clipboardFromRemoteManual'));
    }
  };

  const tone =
    state === 'connected'
      ? 'ok'
      : state === 'error'
        ? 'danger'
        : state === 'connecting' || state === 'minting'
          ? 'warn'
          : 'neutral';

  return (
    <div
      className={`vnc-viewer ${state === 'connected' ? 'is-connected' : ''} ${
        state === 'connecting' || state === 'minting' ? 'is-connecting' : ''
      }`}
      ref={wrapRef}
    >
      <div className="vnc-viewer__toolbar">
        <div className="vnc-viewer__title">
          <strong>{target.label}</strong>
          {target.subtitle ? (
            <span className="muted u-text-xs"> · {target.subtitle}</span>
          ) : null}
          <Badge tone={tone}>{statusText || t(`vnc.viewer.${state}`, { defaultValue: state })}</Badge>
        </div>
        <ActionBar>
          <Button size="sm" variant="secondary" onClick={() => void connect()}>
            {t('vnc.viewer.reconnect')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setScale((s) => !s)}
            disabled={state !== 'connected'}
          >
            {scale ? t('vnc.viewer.fit') : t('vnc.viewer.oneToOne')}
          </Button>
          <label className="vnc-viewer__quality">
            <span className="u-sr-only">{t('vnc.viewer.quality')}</span>
            <select
              className="u-input vnc-viewer__quality-select"
              value={qualityPreset}
              disabled={state !== 'connected'}
              onChange={(e) =>
                setQualityPreset(e.target.value as QualityPreset)
              }
              aria-label={t('vnc.viewer.quality')}
              title={t('vnc.viewer.qualityHint')}
            >
              <option value="low">{t('vnc.viewer.qualityLow')}</option>
              <option value="balanced">{t('vnc.viewer.qualityBalanced')}</option>
              <option value="high">{t('vnc.viewer.qualityHigh')}</option>
              <option value="max">{t('vnc.viewer.qualityMax')}</option>
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void toggleFullscreen()}
            disabled={state !== 'connected'}
          >
            {t('vnc.viewer.fullscreen')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => rfbRef.current?.sendCtrlAltDel()}
            disabled={state !== 'connected'}
          >
            {t('vnc.viewer.cad')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void pasteLocalToRemote()}
            disabled={state !== 'connected'}
            title={t('vnc.viewer.clipboardToRemoteHint')}
          >
            {t('vnc.viewer.clipboardPaste')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setClipOpen((o) => !o)}
            disabled={state !== 'connected' && !remoteClip}
          >
            {t('vnc.viewer.clipboardPanel')}
          </Button>
          <Button size="sm" variant="ghost" onClick={disconnect}>
            {t('vnc.viewer.disconnect')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </ActionBar>
      </div>

      {clipOpen ? (
        <div className="vnc-viewer__banner vnc-viewer__clip">
          <p className="muted u-text-xs u-mb-0">{t('vnc.viewer.clipboardHint')}</p>
          <div className="vnc-viewer__clip-row">
            <Field label={t('vnc.viewer.clipboardLocal')} htmlFor="vnc-clip-local" flush>
              <textarea
                id="vnc-clip-local"
                className="u-input vnc-viewer__clip-ta"
                rows={2}
                value={localClipDraft}
                onChange={(e) => setLocalClipDraft(e.target.value)}
                placeholder={t('vnc.viewer.clipboardLocalPh')}
              />
            </Field>
            <Button
              size="sm"
              variant="primary"
              disabled={state !== 'connected'}
              onClick={() => void pasteLocalToRemote()}
            >
              {t('vnc.viewer.clipboardSend')}
            </Button>
          </div>
          <div className="vnc-viewer__clip-row">
            <Field label={t('vnc.viewer.clipboardRemote')} htmlFor="vnc-clip-remote" flush>
              <textarea
                id="vnc-clip-remote"
                className="u-input vnc-viewer__clip-ta"
                rows={2}
                readOnly
                value={remoteClip}
                placeholder={t('vnc.viewer.clipboardRemotePh')}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              disabled={!remoteClip}
              onClick={() => void copyRemoteToLocal()}
            >
              {t('vnc.viewer.clipboardCopy')}
            </Button>
          </div>
        </div>
      ) : null}

      {needPassword || error ? (
        <div className="vnc-viewer__banner">
          {error ? <p className="u-text-sm u-mb-0" role="alert">{error}</p> : null}
          {needPassword ? (
            <div className="vnc-viewer__pass">
              <Field label={t('vnc.viewer.password')} htmlFor="vnc-viewer-pass" flush>
                <input
                  id="vnc-viewer-pass"
                  type="password"
                  className="u-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') sendPassword();
                  }}
                  autoComplete="current-password"
                />
              </Field>
              <Button size="sm" variant="primary" onClick={sendPassword}>
                {t('vnc.viewer.sendPassword')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="vnc-viewer__screen"
        ref={screenRef}
        role="application"
        aria-label={t('vnc.viewer.canvasLabel', { name: target.label })}
      />
    </div>
  );
}
