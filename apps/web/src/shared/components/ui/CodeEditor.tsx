/**
 * Overlay syntax editor — Files-page chrome, no Monaco/CodeMirror.
 * Transparent textarea over highlightToHtml (VS Code Dark+ tokens).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { highlightToHtml, syntaxLangFromName, type SyntaxLang } from '../../lib/simple-syntax';
import {
  applyEditorTab,
  countLines,
  cursorFromOffset,
  editorLanguageLabel,
  gutterLabels,
} from '../../lib/code-editor-model';

export { applyEditorTab, countLines, cursorFromOffset, editorLanguageLabel, gutterLabels };

export interface CodeEditorProps {
  id?: string;
  value: string;
  onChange?: (next: string) => void;
  filename?: string;
  language?: SyntaxLang;
  ariaLabel?: string;
  readOnly?: boolean;
  onSave?: () => void;
  variant?: 'full' | 'embed';
  tabLabel?: string;
  tabActions?: ReactNode;
  banner?: ReactNode;
}

export function CodeEditor({
  id,
  value,
  onChange,
  filename = 'untitled.yml',
  language,
  ariaLabel,
  readOnly = false,
  onSave,
  variant = 'embed',
  tabLabel,
  tabActions,
  banner,
}: CodeEditorProps) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLPreElement | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });

  const lang = language ?? syntaxLangFromName(filename);
  const lineCount = useMemo(() => countLines(value), [value]);
  const labels = useMemo(() => gutterLabels(lineCount), [lineCount]);
  const html = useMemo(() => highlightToHtml(value, lang), [value, lang]);
  const langLabel = editorLanguageLabel(filename);
  const name = tabLabel ?? (filename.split('/').pop() || filename);

  const layout = useCallback(() => {
    const area = areaRef.current;
    const body = bodyRef.current;
    const hi = highlightRef.current;
    const gutter = gutterRef.current;
    if (!area || !body) return;
    area.style.height = '0px';
    const h = Math.max(area.scrollHeight, body.clientHeight || 0);
    area.style.height = `${h}px`;
    if (hi) {
      hi.style.height = `${h}px`;
      hi.style.minHeight = `${h}px`;
    }
    if (gutter) gutter.style.minHeight = `${h}px`;
  }, []);

  useEffect(() => {
    const idr = requestAnimationFrame(() => {
      layout();
      requestAnimationFrame(layout);
    });
    return () => cancelAnimationFrame(idr);
  }, [value, html, layout]);

  useEffect(() => {
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [layout]);

  function markCursor(el: HTMLTextAreaElement) {
    setCursor(cursorFromOffset(value, el.selectionStart));
  }

  function commit(next: string, selStart: number, selEnd: number) {
    onChange?.(next);
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.selectionStart = selStart;
      el.selectionEnd = selEnd;
      setCursor(cursorFromOffset(next, selStart));
      layout();
    });
  }

  return (
    <div
      className={`fm-vscode${variant === 'embed' ? ' fm-vscode--embed' : ''}`}
      data-testid="code-editor"
      data-lang={lang}
    >
      <div className="fm-vscode__tabbar">
        <div className="fm-vscode__tab">
          <span className="fm-vscode__tab-icon" aria-hidden>
            {name.toLowerCase().endsWith('.html') || name.toLowerCase().endsWith('.htm')
              ? '〈/〉'
              : '📄'}
          </span>
          <span className="fm-vscode__tab-name">{name}</span>
        </div>
        {tabActions ? <div className="fm-vscode__actions">{tabActions}</div> : null}
      </div>
      {banner}
      <div ref={bodyRef} className="fm-vscode__body">
        <div ref={gutterRef} className="fm-vscode__gutter" aria-hidden>
          {labels}
        </div>
        <div className="fm-vscode__code">
          <pre
            ref={highlightRef}
            className="fm-vscode__highlight"
            aria-hidden
            dangerouslySetInnerHTML={{ __html: html || ' ' }}
          />
          <textarea
            ref={areaRef}
            id={id}
            className="fm-vscode__area"
            value={value}
            rows={Math.min(Math.max(lineCount, 12), 500)}
            readOnly={readOnly || !onChange}
            onChange={(e) => {
              onChange?.(e.target.value);
              markCursor(e.target);
              requestAnimationFrame(layout);
            }}
            onClick={(e) => markCursor(e.currentTarget)}
            onKeyUp={(e) => markCursor(e.currentTarget)}
            onSelect={(e) => markCursor(e.currentTarget)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                onSave?.();
                return;
              }
              if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey || readOnly) return;
              e.preventDefault();
              const el = e.currentTarget;
              const next = applyEditorTab(value, el.selectionStart, el.selectionEnd, e.shiftKey);
              commit(next.text, next.start, next.end);
            }}
            spellCheck={false}
            wrap="off"
            aria-label={ariaLabel ?? t('files.editorAria', { name })}
          />
        </div>
      </div>
      <div className="fm-vscode__statusbar" role="status">
        <span className="fm-vscode__status-item">
          {t('files.editorLnCol', { line: cursor.line, col: cursor.col })}
        </span>
        <span className="fm-vscode__status-item">
          {t('files.editorLines', { count: lineCount })}
        </span>
        <span className="fm-vscode__status-spacer" />
        <span className="fm-vscode__status-item">{t('files.editorSpaces', { n: 2 })}</span>
        <span className="fm-vscode__status-item">UTF-8</span>
        <span className="fm-vscode__status-item fm-vscode__status-item--lang">{langLabel}</span>
      </div>
    </div>
  );
}
