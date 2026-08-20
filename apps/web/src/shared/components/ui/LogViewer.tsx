/**
 * Unified log tail — line numbers, severity, filter, wrap, follow-scroll, copy/download.
 * Display only; parents own fetch / SSE.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from './Button';

export type LogLineLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain';

export type LogViewerLine =
  | string
  | {
      text: string;
      level?: LogLineLevel;
    };

export interface LogViewerProps {
  text?: string;
  lines?: LogViewerLine[];
  emptyLabel?: string;
  highlight?: boolean;
  linkIps?: boolean;
  maxHeight?: number | string;
  /** Compact toolbar (default true). Config previews pass false. */
  toolbar?: boolean;
  /** Show the Follow control in the toolbar (default true when toolbar). */
  showFollow?: boolean;
  /** Stick to bottom while true. Parent may also use this for polling. */
  follow?: boolean;
  onFollowChange?: (next: boolean) => void;
  downloadName?: string;
  defaultWrap?: boolean;
}

export type LogLevelFilter = 'all' | 'error' | 'warn';

const IP_RE = /\b((?:\d{1,3}\.){3}\d{1,3})\b/g;

export function classifyLine(line: string): LogLineLevel {
  const l = line.toLowerCase();
  if (
    /\b(error|err|crit|critical|emerg|alert|fatal|fail(?:ed|ure)?|panic|exception)\b/.test(l) ||
    /\bpriority=(?:0|1|2|3)\b/.test(l)
  ) {
    return 'error';
  }
  if (/\b(warn(?:ing)?|notice)\b/.test(l) || /\bpriority=(?:4|5)\b/.test(l)) {
    return 'warn';
  }
  if (/\b(debug|trace)\b/.test(l)) return 'debug';
  if (/\b(info)\b/.test(l)) return 'info';
  return 'plain';
}

export function isPublicIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n > 255)) return false;
  if (ip.startsWith('127.') || ip.startsWith('0.') || ip === '255.255.255.255') return false;
  if (parts[0] === 10) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  return true;
}

function lineLooksLikeTrustedCidr(line: string): boolean {
  return (
    /\bset_real_ip_from\b/i.test(line) ||
    /\ballow\s+/i.test(line) ||
    /\bdeny\s+/i.test(line) ||
    /\/\d{1,3}\b/.test(line)
  );
}

function LogIpLink({ ip }: { ip: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/protection?tab=bans&ip=${encodeURIComponent(ip)}`}
      className="log-viewer__ip"
      title={t('logViewer.banIpTitle', { ip })}
      onClick={(e) => e.stopPropagation()}
    >
      {ip}
    </Link>
  );
}

function highlightNeedle(text: string, needle: string, keyBase: string): ReactNode {
  if (!needle) return text;
  const q = needle.toLowerCase();
  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < text.length) {
    const hit = lower.indexOf(q, i);
    if (hit < 0) {
      nodes.push(text.slice(i));
      break;
    }
    if (hit > i) nodes.push(text.slice(i, hit));
    nodes.push(
      <mark key={`${keyBase}-${n++}`} className="log-viewer__hit">
        {text.slice(hit, hit + needle.length)}
      </mark>,
    );
    i = hit + needle.length;
  }
  return nodes.length === 1 ? nodes[0] : nodes;
}

function renderLineContent(line: string, linkIps: boolean, needle: string, keyBase: string): ReactNode {
  if (!linkIps || lineLooksLikeTrustedCidr(line)) {
    return highlightNeedle(line, needle, keyBase);
  }
  const nodes: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(IP_RE.source, 'g');
  let part = 0;
  while ((m = re.exec(line)) !== null) {
    const ip = m[1];
    const start = m.index;
    if (start > last) {
      nodes.push(
        <span key={`${keyBase}-t${part++}`}>{highlightNeedle(line.slice(last, start), needle, `${keyBase}-h${part}`)}</span>,
      );
    }
    if (isPublicIp(ip)) {
      nodes.push(<LogIpLink key={`${keyBase}-ip${start}`} ip={ip} />);
    } else {
      nodes.push(ip);
    }
    last = start + ip.length;
  }
  if (last < line.length) {
    nodes.push(
      <span key={`${keyBase}-t${part++}`}>{highlightNeedle(line.slice(last), needle, `${keyBase}-h${part}`)}</span>,
    );
  }
  return nodes.length ? nodes : highlightNeedle(line, needle, keyBase);
}

function normalizeLines(text: string | undefined, lines: LogViewerLine[] | undefined): Array<{
  text: string;
  levelHint?: LogLineLevel;
}> {
  if (lines && lines.length) {
    return lines.map((row) =>
      typeof row === 'string' ? { text: row } : { text: row.text, levelHint: row.level },
    );
  }
  if (text) return text.split('\n').map((row) => ({ text: row }));
  return [];
}

function nearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
}

export function LogViewer({
  text,
  lines,
  emptyLabel,
  highlight = true,
  linkIps = true,
  maxHeight = 'min(52vh, 28rem)',
  toolbar = true,
  showFollow = true,
  follow = false,
  onFollowChange,
  downloadName = 'log.txt',
  defaultWrap = false,
}: LogViewerProps) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pausedRef = useRef(false);
  const [filter, setFilter] = useState('');
  const [level, setLevel] = useState<LogLevelFilter>('all');
  const [wrap, setWrap] = useState(defaultWrap);
  const [copied, setCopied] = useState(false);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  const raw = useMemo(() => normalizeLines(text, lines), [text, lines]);
  const classified = useMemo(
    () =>
      raw.map((row, i) => ({
        i,
        text: row.text,
        level: highlight ? (row.levelHint ?? classifyLine(row.text)) : (row.levelHint ?? 'plain'),
      })),
    [raw, highlight],
  );

  const needle = filter.trim();
  const needleLower = needle.toLowerCase();
  const visible = useMemo(() => {
    return classified.filter((row) => {
      if (level === 'error' && row.level !== 'error') return false;
      if (level === 'warn' && row.level !== 'warn') return false;
      if (needleLower && !row.text.toLowerCase().includes(needleLower)) return false;
      return true;
    });
  }, [classified, level, needleLower]);

  const errorCount = classified.filter((r) => r.level === 'error').length;
  const warnCount = classified.filter((r) => r.level === 'warn').length;
  const errorVisibleIdx = useMemo(
    () => visible.map((row, vi) => ({ vi, level: row.level })).filter((x) => x.level === 'error').map((x) => x.vi),
    [visible],
  );

  const bodyStyle =
    maxHeight != null
      ? { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }
      : undefined;

  useEffect(() => {
    pausedRef.current = false;
  }, [follow]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !follow || pausedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [follow, visible.length, raw.length]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el || !follow) return;
    if (nearBottom(el)) {
      pausedRef.current = false;
      return;
    }
    pausedRef.current = true;
    if (showFollow && onFollowChange && follow) onFollowChange(false);
  };

  const copy = useCallback(async () => {
    const body = visible.map((r) => r.text).join('\n');
    if (!body) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }, [visible]);

  const download = useCallback(() => {
    const body = visible.map((r) => r.text).join('\n');
    if (!body) return;
    try {
      const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = downloadName.replace(/[^\w.\-]+/g, '_') || 'log.txt';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* blob URL unsupported */
    }
  }, [visible, downloadName]);

  const jumpError = (dir: 1 | -1) => {
    if (!errorVisibleIdx.length) return;
    const el = bodyRef.current;
    let next: number;
    if (activeIdx == null) {
      next = dir === 1 ? errorVisibleIdx[0]! : errorVisibleIdx[errorVisibleIdx.length - 1]!;
    } else if (dir === 1) {
      next = errorVisibleIdx.find((i) => i > activeIdx) ?? errorVisibleIdx[0]!;
    } else {
      next = [...errorVisibleIdx].reverse().find((i) => i < activeIdx) ?? errorVisibleIdx[errorVisibleIdx.length - 1]!;
    }
    setActiveIdx(next);
    const node = el?.querySelector(`[data-log-vi="${next}"]`);
    node?.scrollIntoView({ block: 'center' });
  };

  const empty = !raw.length || (raw.length === 1 && !raw[0]!.text);
  const resolvedEmpty = emptyLabel ?? t('logViewer.empty');

  return (
    <div className={`log-viewer${toolbar ? '' : ' log-viewer--bare'}${wrap ? ' log-viewer--wrap' : ''}`}>
      {toolbar ? (
        <div className="log-viewer__toolbar">
          <input
            className="log-viewer__filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('logViewer.filterPh')}
            aria-label={t('logViewer.filter')}
          />
          <div className="log-viewer__chips" role="group" aria-label={t('logViewer.levels')}>
            <button
              type="button"
              className={`log-viewer__chip${level === 'all' ? ' is-on' : ''}`}
              aria-pressed={level === 'all'}
              onClick={() => setLevel('all')}
            >
              {t('logViewer.all')} {classified.length}
            </button>
            <button
              type="button"
              className={`log-viewer__chip${level === 'error' ? ' is-on' : ''}`}
              aria-pressed={level === 'error'}
              onClick={() => setLevel(level === 'error' ? 'all' : 'error')}
            >
              {t('logViewer.errors', { n: errorCount })}
            </button>
            <button
              type="button"
              className={`log-viewer__chip${level === 'warn' ? ' is-on' : ''}`}
              aria-pressed={level === 'warn'}
              onClick={() => setLevel(level === 'warn' ? 'all' : 'warn')}
            >
              {t('logViewer.warnings', { n: warnCount })}
            </button>
          </div>
          <div className="log-viewer__actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={wrap}
              className={wrap ? 'is-on' : undefined}
              onClick={() => setWrap((v) => !v)}
            >
              {t('logViewer.wrap')}
            </Button>
            {showFollow && onFollowChange ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={follow}
                className={follow ? 'is-on' : undefined}
                onClick={() => onFollowChange(!follow)}
              >
                {t('logViewer.follow')}
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} disabled={empty}>
              {copied ? t('common.copied') : t('common.copy')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={download} disabled={empty}>
              {t('logViewer.download')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => jumpError(1)}
              disabled={!errorVisibleIdx.length}
              title={t('logViewer.nextError')}
            >
              {t('logViewer.nextError')}
            </Button>
          </div>
          <span className="log-viewer__meta" aria-live="polite">
            {t('logViewer.lines', { n: classified.length })}
            {visible.length !== classified.length ? ` · ${t('logViewer.shown', { n: visible.length })}` : ''}
          </span>
        </div>
      ) : null}

      {empty ? (
        <div className="log-viewer__body log-viewer__body--empty" style={bodyStyle} role="status">
          <p className="log-viewer__empty-msg">{resolvedEmpty}</p>
        </div>
      ) : (
        <div
          ref={bodyRef}
          className="log-viewer__body"
          style={bodyStyle}
          role="log"
          onScroll={onScroll}
        >
          {visible.map((row, vi) => (
            <div
              key={row.i}
              data-log-vi={vi}
              className={`log-viewer__line log-viewer__line--${row.level}${activeIdx === vi ? ' is-active' : ''}`}
            >
              <span className="log-viewer__n" aria-hidden>
                {row.i + 1}
              </span>
              <span className="log-viewer__t">
                {renderLineContent(row.text, linkIps, needle, `l${row.i}`)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
