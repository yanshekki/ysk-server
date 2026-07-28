import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface CodeBlockProps {
  children: string;
  maxHeight?: boolean;
  spaced?: boolean;
}

export function CodeBlock({ children, spaced }: CodeBlockProps) {
  return (
    <pre className={spaced ? 'code code--spaced' : 'code'}>{children}</pre>
  );
}

export type LogLineLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain';

export interface LogViewerProps {
  text: string;
  emptyLabel?: string;
  /** Highlight error/warn/info keywords (default true) */
  highlight?: boolean;
  /** Show clickable IPs → protection ban (default true) */
  linkIps?: boolean;
  maxHeight?: number | string;
}

const IP_RE = /\b((?:\d{1,3}\.){3}\d{1,3})\b/g;

function classifyLine(line: string): LogLineLevel {
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

function isPublicIp(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n > 255)) return false;
  if (ip.startsWith('127.') || ip.startsWith('0.') || ip === '255.255.255.255') return false;
  if (parts[0] === 10) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return false;
  return true;
}

function renderLineContent(line: string, linkIps: boolean): ReactNode {
  if (!linkIps) return line;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const re = new RegExp(IP_RE.source, 'g');
  while ((m = re.exec(line)) !== null) {
    const ip = m[1];
    const start = m.index;
    if (start > last) nodes.push(line.slice(last, start));
    if (isPublicIp(ip)) {
      nodes.push(
        <Link
          key={`${start}-${ip}`}
          to={`/protection?tab=bans&ip=${encodeURIComponent(ip)}`}
          className="log-viewer__ip"
          title={`到防護中心 ban ${ip}`}
          onClick={(e) => e.stopPropagation()}
        >
          {ip}
        </Link>,
      );
    } else {
      nodes.push(ip);
    }
    last = start + ip.length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes.length ? nodes : line;
}

export function LogViewer({
  text,
  emptyLabel = '—',
  highlight = true,
  linkIps = true,
  maxHeight,
}: LogViewerProps) {
  if (!text) {
    return <p className="muted">{emptyLabel}</p>;
  }
  const lines = text.split('\n');
  const style =
    maxHeight != null
      ? { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }
      : undefined;

  if (!highlight && !linkIps) {
    return (
      <pre className="code code--spaced log-viewer" style={style}>
        {text}
      </pre>
    );
  }

  return (
    <div className="log-viewer code code--spaced" style={style} role="log">
      {lines.map((line, i) => {
        const level = highlight ? classifyLine(line) : 'plain';
        return (
          <div
            key={i}
            className={`log-viewer__line log-viewer__line--${level}`}
          >
            <span className="log-viewer__n" aria-hidden>
              {i + 1}
            </span>
            <span className="log-viewer__t">{renderLineContent(line, linkIps)}</span>
          </div>
        );
      })}
    </div>
  );
}
