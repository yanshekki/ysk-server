/**
 * Read-only JSON tree — Files-page token colours, no editor deps.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActionBar } from './ActionBar';
import { Button } from './Button';

export function parseJsonInput(
  value: unknown,
): { ok: true; data: unknown } | { ok: false; text: string } {
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return { ok: true, data: '' };
    try {
      return { ok: true, data: JSON.parse(s) as unknown };
    } catch {
      return { ok: false, text: value };
    }
  }
  return { ok: true, data: value };
}

export function prettyJsonText(value: unknown): string {
  try {
    if (typeof value === 'string') {
      const parsed = parseJsonInput(value);
      if (parsed.ok) return JSON.stringify(parsed.data, null, 2);
      return value;
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isExpandable(v: unknown): v is Record<string, unknown> | unknown[] {
  return Array.isArray(v) || isRecord(v);
}

function childCount(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  if (isRecord(v)) return Object.keys(v).length;
  return 0;
}

export function collectExpandablePaths(
  value: unknown,
  path: string,
  depth: number,
  maxDepth: number,
  into: Set<string>,
): void {
  if (depth >= maxDepth || !isExpandable(value)) return;
  into.add(path);
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      collectExpandablePaths(item, path ? `${path}.${i}` : String(i), depth + 1, maxDepth, into);
    });
    return;
  }
  for (const [k, child] of Object.entries(value)) {
    collectExpandablePaths(child, path ? `${path}.${k}` : k, depth + 1, maxDepth, into);
  }
}

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="tok-keyword">null</span>;
  if (typeof value === 'boolean') return <span className="tok-keyword">{String(value)}</span>;
  if (typeof value === 'number') return <span className="tok-number">{String(value)}</span>;
  if (typeof value === 'string') return <span className="tok-string">{JSON.stringify(value)}</span>;
  return <span className="tok-plain">{String(value)}</span>;
}

function collapsedPreview(value: unknown): string {
  const n = childCount(value);
  if (Array.isArray(value)) return `Array(${n})`;
  if (isRecord(value)) return `{${n}}`;
  return '';
}

function JsonNode({
  name,
  value,
  path,
  expanded,
  onToggle,
}: {
  name?: string;
  value: unknown;
  path: string;
  expanded: Set<string>;
  onToggle: (path: string) => void;
}) {
  const open = expanded.has(path);
  const keyEl =
    name != null ? (
      <>
        <span className="tok-attr">{JSON.stringify(name)}</span>
        <span className="tok-punct">: </span>
      </>
    ) : null;

  if (!isExpandable(value)) {
    return (
      <div className="json-viewer__row">
        {keyEl}
        <Primitive value={value} />
      </div>
    );
  }

  const entries = Array.isArray(value)
    ? value.map((item, i) => [String(i), item] as const)
    : Object.entries(value);
  const openBracket = Array.isArray(value) ? '[' : '{';
  const closeBracket = Array.isArray(value) ? ']' : '}';

  return (
    <div className="json-viewer__block">
      <div className="json-viewer__row">
        <button
          type="button"
          className="json-viewer__toggle"
          aria-expanded={open}
          onClick={() => onToggle(path)}
        >
          {open ? '▼' : '▶'}
        </button>
        {keyEl}
        {open ? (
          <span className="tok-punct">{openBracket}</span>
        ) : (
          <span className="json-viewer__preview">
            <span className="tok-punct">{openBracket}</span>
            <span className="tok-comment"> {collapsedPreview(value)} </span>
            <span className="tok-punct">{closeBracket}</span>
          </span>
        )}
      </div>
      {open ? (
        <div className="json-viewer__children">
          {entries.map(([k, child]) => (
            <JsonNode
              key={k}
              name={Array.isArray(value) ? undefined : k}
              value={child}
              path={path ? `${path}.${k}` : k}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
          <div className="json-viewer__row">
            <span className="tok-punct">{closeBracket}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type JsonViewerProps = {
  value: unknown;
  defaultExpandDepth?: number;
  maxHeight?: number | string;
};

export function JsonViewer({
  value,
  defaultExpandDepth = 2,
  maxHeight = 'min(60vh, 28rem)',
}: JsonViewerProps) {
  const { t } = useTranslation();
  const parsed = useMemo(() => parseJsonInput(value), [value]);
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    if (parsed.ok) collectExpandablePaths(parsed.data, '', 0, defaultExpandDepth, set);
    return set;
  }, [parsed, defaultExpandDepth]);
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setExpanded(initialExpanded);
    setCopied(false);
  }, [initialExpanded]);

  const text = parsed.ok ? prettyJsonText(parsed.data) : parsed.text;

  const expandAll = () => {
    if (!parsed.ok) return;
    const set = new Set<string>();
    collectExpandablePaths(parsed.data, '', 0, 64, set);
    setExpanded(set);
  };
  const collapseAll = () => setExpanded(new Set());
  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const treeStyle =
    maxHeight != null
      ? { maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }
      : undefined;

  return (
    <div className="json-viewer">
      <div className="json-viewer__toolbar">
        <ActionBar size="sm">
          <Button type="button" variant="ghost" size="sm" onClick={() => void copy()}>
            {copied ? t('common.copied', { defaultValue: t('common.copy') }) : t('common.copy')}
          </Button>
          {parsed.ok && isExpandable(parsed.data) ? (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={expandAll}>
                {t('common.expandAll')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={collapseAll}>
                {t('common.collapseAll')}
              </Button>
            </>
          ) : null}
        </ActionBar>
      </div>
      {parsed.ok ? (
        <div className="json-viewer__tree" style={treeStyle} role="tree">
          <JsonNode
            value={parsed.data}
            path=""
            expanded={expanded}
            onToggle={toggle}
          />
        </div>
      ) : (
        <pre className="json-viewer__fallback" style={treeStyle}>
          {parsed.text}
        </pre>
      )}
    </div>
  );
}
