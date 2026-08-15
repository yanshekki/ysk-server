/**
 * Browser interactive shell — real PTY as root or project Linux user.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  PageGuide,
  ActionBar,
  Alert,
  Badge,
  Button,
  FeaturePageLayout,
  Field,
  Modal,
  PageTabs,
  buttonClassName,
} from '../../shared/components/ui';
import { usePageTab } from '../../shared/hooks/usePageTab';
import { ApiError } from '../../shared/services/api';
import {
  terminalApi,
  terminalWsUrl,
  type TerminalTarget,
  type TerminalTargetsResponse,
} from '../../features/terminal/api';

const TABS = ['session', 'about'] as const;

type ConnState = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export function TerminalPage() {
  const { t } = useTranslation();
  const [tab, setTab] = usePageTab(TABS, 'session');
  const [targets, setTargets] = useState<TerminalTargetsResponse | null>(null);
  const [targetId, setTargetId] = useState('root');
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [conn, setConn] = useState<ConnState>('idle');
  const [statusLine, setStatusLine] = useState<string | null>(null);
  const [dims, setDims] = useState({ cols: 120, rows: 32 });
  const [sessionUser, setSessionUser] = useState<string | null>(null);
  const [totpOpen, setTotpOpen] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [rootConfirmOpen, setRootConfirmOpen] = useState(false);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const connectedRef = useRef(false);

  const refreshTargets = useCallback(async () => {
    setLoadErr(null);
    try {
      const r = await terminalApi.targets();
      setTargets(r);
      if (!r.items.some((i) => i.id === targetId) && r.items[0]) {
        setTargetId(r.items[0].id);
      }
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('common.loadFailed'));
    }
  }, [t, targetId]);

  useEffect(() => {
    void refreshTargets();
  }, [refreshTargets]);

  // Keep xterm mounted for the page lifetime (session panel stays in DOM, hidden on About).
  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      lineHeight: 1.2,
      scrollback: 8000,
      convertEol: false,
      allowTransparency: false,
      macOptionIsMeta: true,
      theme: {
        background: '#0c0f14',
        foreground: '#e6edf3',
        cursor: '#7ee787',
        cursorAccent: '#0c0f14',
        selectionBackground: 'rgba(56, 139, 253, 0.35)',
        black: '#0c0f14',
        red: '#ff7b72',
        green: '#7ee787',
        yellow: '#d29922',
        blue: '#79c0ff',
        magenta: '#d2a8ff',
        cyan: '#a5d6ff',
        white: '#e6edf3',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#a5d6ff',
        brightWhite: '#ffffff',
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    // Defer fit so layout has settled
    requestAnimationFrame(() => {
      try {
        fit.fit();
        setDims({ cols: term.cols, rows: term.rows });
      } catch {
        /* */
      }
    });
    termRef.current = term;
    fitRef.current = fit;

    const pushResize = () => {
      try {
        fit.fit();
        setDims({ cols: term.cols, rows: term.rows });
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch {
        /* */
      }
    };
    window.addEventListener('resize', pushResize);
    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => pushResize())
        : null;
    if (hostRef.current && ro) ro.observe(hostRef.current);

    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Raw stdin bytes (text frames) — full keyboard including control chars
        ws.send(data);
      }
    });

    // Ctrl/Cmd+V paste is handled by xterm; also accept drop of text
    const el = hostRef.current;
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const text = e.dataTransfer?.getData('text/plain');
      if (text && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(text);
      }
    };
    el?.addEventListener('dragover', onDragOver);
    el?.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('resize', pushResize);
      ro?.disconnect();
      el?.removeEventListener('dragover', onDragOver);
      el?.removeEventListener('drop', onDrop);
      try {
        wsRef.current?.close();
      } catch {
        /* */
      }
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Re-fit when returning to Session tab
  useEffect(() => {
    if (tab !== 'session') return;
    const fit = fitRef.current;
    const term = termRef.current;
    if (!fit || !term) return;
    requestAnimationFrame(() => {
      try {
        fit.fit();
        setDims({ cols: term.cols, rows: term.rows });
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
        }
        if (connectedRef.current) term.focus();
      } catch {
        /* */
      }
    });
  }, [tab]);

  const disconnect = useCallback((msg?: string) => {
    connectedRef.current = false;
    try {
      wsRef.current?.close();
    } catch {
      /* */
    }
    wsRef.current = null;
    setSessionUser(null);
    setConn((c) => (c === 'connecting' ? 'error' : 'closed'));
    if (msg) setStatusLine(msg);
  }, []);

  const connect = useCallback(
    async (opts?: { totp?: string; rootAck?: boolean }) => {
      if (!targets?.canOpen) {
        setStatusLine(t('terminal.needRootExecute'));
        setConn('error');
        return;
      }
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term) return;

      // Close any stale socket first
      try {
        wsRef.current?.close();
      } catch {
        /* */
      }
      wsRef.current = null;

      try {
        fit?.fit();
      } catch {
        /* */
      }
      const cols = term.cols;
      const rows = term.rows;
      setDims({ cols, rows });

      const target: 'root' | { projectId: string } =
        targetId === 'root'
          ? 'root'
          : { projectId: targetId.replace(/^project:/, '') };

      if (target === 'root' && !opts?.totp?.trim() && !opts?.rootAck) {
        setRootConfirmOpen(true);
        setConn('idle');
        return;
      }

      // Root + enrolled TOTP: ask for code before ticket (unless already provided)
      if (
        target === 'root' &&
        targets.rootNeedsStepUp &&
        !opts?.totp?.trim()
      ) {
        setTotpCode('');
        setTotpOpen(true);
        setStatusLine(t('terminal.stepUpRequired'));
        setConn('idle');
        return;
      }

      setConn('connecting');
      setSessionUser(null);
      setStatusLine(t('terminal.connecting'));
      term.reset();
      term.focus();
      term.writeln(`\x1b[90m${t('terminal.connecting')}\x1b[0m`);

      try {
        const sess = await terminalApi.openSession({
          target,
          cols,
          rows,
          totp: opts?.totp?.trim() || undefined,
        });
        setTotpOpen(false);
        setTotpCode('');
        const url = terminalWsUrl(sess.wsPath);
        const ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          connectedRef.current = true;
          setConn('connected');
          setSessionUser(sess.linuxUser);
          setStatusLine(t('terminal.connectedAs', { user: sess.linuxUser }));
          // Clear banner — real shell prompt arrives via PTY
          term.reset();
          term.focus();
          try {
            fit?.fit();
            ws.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
          } catch {
            /* */
          }
        };

        ws.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            try {
              const msg = JSON.parse(ev.data) as {
                t?: string;
                message?: string;
                code?: number;
                user?: string;
              };
              if (msg.t === 'err') {
                term.writeln(`\r\n\x1b[31m${msg.message ?? 'error'}\x1b[0m`);
                setStatusLine(msg.message ?? t('terminal.error'));
                setConn('error');
                connectedRef.current = false;
                return;
              }
              if (msg.t === 'exit') {
                term.writeln(
                  `\r\n\x1b[90m[${t('terminal.exitCode', { code: msg.code ?? 0 })}]\x1b[0m`,
                );
                setStatusLine(t('terminal.exitCode', { code: msg.code ?? 0 }));
                setConn('closed');
                setSessionUser(null);
                connectedRef.current = false;
                return;
              }
              if (msg.t === 'ready' && msg.user) {
                setSessionUser(msg.user);
                setStatusLine(t('terminal.connectedAs', { user: msg.user }));
                setConn('connected');
                try {
                  fit?.fit();
                  ws.send(
                    JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }),
                  );
                } catch {
                  /* */
                }
              }
            } catch {
              term.write(ev.data);
            }
            return;
          }
          const buf = ev.data as ArrayBuffer;
          const text = new TextDecoder().decode(buf);
          term.write(text);
        };

        ws.onerror = () => {
          setStatusLine(t('terminal.wsError'));
          setConn('error');
          connectedRef.current = false;
        };

        ws.onclose = () => {
          if (connectedRef.current) {
            setStatusLine(t('terminal.disconnected'));
            setConn('closed');
          }
          connectedRef.current = false;
          setSessionUser(null);
          if (wsRef.current === ws) wsRef.current = null;
        };
      } catch (e) {
        if (e instanceof ApiError && e.needsTotp) {
          setTotpOpen(true);
          setStatusLine(t('terminal.stepUpRequired'));
          setConn('idle');
          term.writeln(`\r\n\x1b[33m${t('terminal.stepUpRequired')}\x1b[0m`);
          return;
        }
        const msg = e instanceof Error ? e.message : t('terminal.error');
        term.writeln(`\r\n\x1b[31m${msg}\x1b[0m`);
        setStatusLine(msg);
        setConn('error');
        setSessionUser(null);
      }
    },
    [t, targetId, targets?.canOpen, targets?.rootNeedsStepUp],
  );

  const selected: TerminalTarget | undefined = useMemo(
    () => targets?.items.find((i) => i.id === targetId),
    [targets, targetId],
  );

  const statusTone =
    conn === 'connected'
      ? 'ok'
      : conn === 'error'
        ? 'danger'
        : conn === 'connecting'
          ? 'warn'
          : 'neutral';

  const titleUser = sessionUser ?? selected?.linuxUser ?? '—';

  return (
    <FeaturePageLayout
      title={t('nav.terminal')}
      showCapability={false}
      status={{
        pill: {
          label:
            conn === 'connected'
              ? t('terminal.stateConnected')
              : conn === 'connecting'
                ? t('terminal.stateConnecting')
                : t('terminal.stateIdle'),
          tone: statusTone,
        },
        items: [
          {
            label: 'EXECUTE',
            value: targets?.executeEnabled ? t('common.on') : t('common.off'),
            tone: targets?.executeEnabled ? 'ok' : 'warn',
          },
          {
            label: 'Root',
            value: targets?.isRoot ? t('common.yes') : t('common.no'),
            tone: targets?.isRoot ? 'ok' : 'warn',
          },
          {
            label: t('terminal.user'),
            value: titleUser,
          },
          ...(conn === 'connected'
            ? [
                {
                  label: t('terminal.size'),
                  value: `${dims.cols}×${dims.rows}`,
                },
              ]
            : []),
        ],
      }}
      actions={
        <ActionBar size="sm">
          <Button variant="secondary" size="sm" onClick={() => void refreshTargets()}>
            {t('common.refresh')}
          </Button>
        </ActionBar>
      }
    >
      {loadErr ? <Alert variant="error">{loadErr}</Alert> : null}

      <PageTabs
        tabs={[
          { id: 'session', label: t('terminal.tabSession') },
          { id: 'about', label: t('common.about') },
        ]}
        active={tab}
        onChange={setTab}
        variant="scroll"
      >
        {/* Keep session DOM mounted so xterm survives About tab switches */}
        <div
          className="tab-panel term-page"
          hidden={tab !== 'session'}
          aria-hidden={tab !== 'session'}
        >
          {!targets?.canOpen ? (
            <Alert variant="warn">
              {t('terminal.needRootExecute')}{' '}
              <Link
                to="/system/readiness"
                className={buttonClassName({ variant: 'ghost', size: 'sm' })}
              >
                {t('nav.readiness')}
              </Link>
            </Alert>
          ) : null}

          <div className="term-toolbar">
            <div className="term-toolbar__field">
              <label htmlFor="term-target">{t('terminal.target')}</label>
              <select
                id="term-target"
                className="input"
                value={targetId}
                disabled={conn === 'connected' || conn === 'connecting'}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {(targets?.items ?? []).map((item) => (
                  <option key={item.id} value={item.id} disabled={!item.available}>
                    {item.label}
                    {!item.available ? ` (${t('terminal.unavailable')})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="term-toolbar__actions">
              {conn === 'connected' || conn === 'connecting' ? (
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => disconnect(t('terminal.disconnected'))}
                >
                  {t('terminal.disconnect')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="md"
                  disabled={!targets?.canOpen || !selected?.available}
                  onClick={() => void connect()}
                >
                  {t('terminal.connect')}
                </Button>
              )}
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  const term = termRef.current;
                  if (!term) return;
                  const buf = [];
                  for (let i = 0; i < term.buffer.active.length; i += 1) {
                    buf.push(term.buffer.active.getLine(i)?.translateToString(true) ?? '');
                  }
                  void navigator.clipboard?.writeText(buf.join('\n').trimEnd());
                }}
              >
                {t('terminal.copyAll', { defaultValue: 'Copy all' })}
              </Button>
              {statusLine ? (
                <span className="term-meta">
                  <Badge tone={statusTone}>{statusLine}</Badge>
                </span>
              ) : null}
            </div>
          </div>

          {targetId === 'root' && targets?.rootNeedsStepUp ? (
            <Alert variant="info">{t('terminal.stepUpHint')}</Alert>
          ) : null}

          <Modal
            open={rootConfirmOpen}
            onClose={() => setRootConfirmOpen(false)}
            title={t('terminal.rootConfirmTitle', { defaultValue: 'Open a root shell?' })}
            description={t('terminal.rootConfirmDesc', {
              defaultValue:
                'This session is an unrestricted root PTY on the host. Commands are audited.',
            })}
            size="sm"
            footer={
              <>
                <Button variant="secondary" size="md" onClick={() => setRootConfirmOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => {
                    setRootConfirmOpen(false);
                    void connect({ rootAck: true });
                  }}
                >
                  {t('terminal.connect')}
                </Button>
              </>
            }
          >
            <p className="muted u-text-sm">
              {t('terminal.rootConfirmBody', {
                defaultValue: 'Only continue if you intend to run privileged host commands.',
              })}
            </p>
          </Modal>

          <Modal
            open={totpOpen}
            onClose={() => {
              if (!totpBusy) {
                setTotpOpen(false);
                setTotpCode('');
              }
            }}
            title={t('terminal.stepUpTitle')}
            description={t('terminal.stepUpDesc')}
            size="sm"
            footer={
              <>
                <Button
                  variant="secondary"
                  size="md"
                  disabled={totpBusy}
                  onClick={() => {
                    setTotpOpen(false);
                    setTotpCode('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  loading={totpBusy}
                  disabled={!totpCode.trim()}
                  onClick={() => {
                    setTotpBusy(true);
                    void connect({ totp: totpCode })
                      .catch(() => {
                        /* errors handled in connect */
                      })
                      .finally(() => setTotpBusy(false));
                  }}
                >
                  {t('terminal.connect')}
                </Button>
              </>
            }
          >
            <Field label={t('terminal.totpLabel')} htmlFor="term-totp" flush required>
              <input
                id="term-totp"
                className="input"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && totpCode.trim() && !totpBusy) {
                    setTotpBusy(true);
                    void connect({ totp: totpCode })
                      .catch(() => {
                        /* */
                      })
                      .finally(() => setTotpBusy(false));
                  }
                }}
                placeholder="000000"
              />
            </Field>
          </Modal>

          <div
            className={`term-frame${conn === 'connected' ? ' is-connected' : ''}${
              conn === 'connecting' ? ' is-connecting' : ''
            }`}
          >
            <div className="term-frame__chrome" aria-hidden>
              <span className="term-frame__dots">
                <i />
                <i />
                <i />
              </span>
              <span className="term-frame__title">
                {titleUser}@ysk
                {conn === 'connected' ? ` — ${dims.cols}×${dims.rows}` : ''}
              </span>
            </div>
            <div ref={hostRef} className="term-frame__xterm" />
            {conn === 'idle' ? (
              <div className="term-frame__placeholder">{t('terminal.placeholder')}</div>
            ) : null}
          </div>
        </div>

        {tab === 'about' ? (
          <div className="tab-panel stack">
            {conn === 'connected' ? (
              <Alert variant="warn">
                {t('terminal.sessionStillOpen')}{' '}
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => disconnect(t('terminal.disconnected'))}
                >
                  {t('terminal.disconnect')}
                </Button>
              </Alert>
            ) : null}
            <section className="dns-about">
              <header className="dns-about__head">
                <h3 className="dns-about__title">{t('terminal.aboutTitle')}</h3>
                <p className="dns-about__sub">{t('terminal.aboutSub')}</p>
              </header>
              <ol className="dns-about__list">
                <li className="dns-about__item">
                  <span className="dns-about__n" aria-hidden>
                    1
                  </span>
                  <div className="dns-about__body">
                    <div className="dns-about__item-title">{t('terminal.aboutWhat')}</div>
                    <p className="dns-about__text">{t('terminal.aboutWhatBody')}</p>
                  </div>
                </li>
                <li className="dns-about__item">
                  <span className="dns-about__n" aria-hidden>
                    2
                  </span>
                  <div className="dns-about__body">
                    <div className="dns-about__item-title">{t('terminal.aboutReq')}</div>
                    <p className="dns-about__text">{t('terminal.aboutReqBody')}</p>
                  </div>
                </li>
                <li className="dns-about__item">
                  <span className="dns-about__n" aria-hidden>
                    3
                  </span>
                  <div className="dns-about__body">
                    <div className="dns-about__item-title">{t('terminal.aboutUsers')}</div>
                    <p className="dns-about__text">{t('terminal.aboutUsersBody')}</p>
                  </div>
                </li>
              </ol>
            </section>
            <PageGuide guideId="terminal" />
          </div>
        ) : null}
      </PageTabs>
    </FeaturePageLayout>
  );
}
