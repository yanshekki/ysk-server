/**
 * In-panel noVNC RFB viewer with control toolbar.
 * Connects via panel WS proxy (/api/v1/vnc/ws?ticket=…) — not 127.0.0.1.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import RFB from '@novnc/novnc';
import { ActionBar, Badge, Button, Field } from '../../shared/components/ui';

export type VncViewerTarget = {
  kind: 'account' | 'client';
  id: string;
  label: string;
  subtitle?: string;
};

type ConnState = 'idle' | 'minting' | 'connecting' | 'connected' | 'error' | 'closed';

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
  const [statusText, setStatusText] = useState('');

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

      rfb.addEventListener('connect', () => {
        setState('connected');
        setStatusText(t('vnc.viewer.connected'));
        setNeedPassword(false);
      });
      rfb.addEventListener('disconnect', (ev: Event) => {
        const detail = (ev as CustomEvent<{ clean?: boolean }>).detail;
        setState(detail?.clean ? 'closed' : 'error');
        setStatusText(
          detail?.clean
            ? t('vnc.viewer.disconnected')
            : t('vnc.viewer.error'),
        );
        rfbRef.current = null;
      });
      rfb.addEventListener('credentialsrequired', () => {
        setNeedPassword(true);
        setState('connecting');
        setStatusText(t('vnc.viewer.passwordPrompt'));
      });
      rfb.addEventListener('securityfailure', (ev: Event) => {
        const detail = (ev as CustomEvent<{ status?: number; reason?: string }>).detail;
        setError(detail?.reason || t('vnc.viewer.securityFailure'));
        setState('error');
      });

      rfbRef.current = rfb;
      if (sess.password || password) {
        // credentials may already be set; if required later, user re-sends
      }
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : t('vnc.viewer.error'));
      setStatusText(t('vnc.viewer.error'));
    }
  }, [createSession, password, scale, t, target]);

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
          <Button size="sm" variant="ghost" onClick={disconnect}>
            {t('vnc.viewer.disconnect')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
        </ActionBar>
      </div>

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
