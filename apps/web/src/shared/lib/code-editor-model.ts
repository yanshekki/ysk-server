/**
 * Pure helpers for the overlay syntax editor (no React).
 */

export const EDITOR_INDENT = '  ';

export function countLines(text: string): number {
  if (!text) return 1;
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

export function gutterLabels(lineCount: number, max = 20_000): string {
  const n = Math.min(Math.max(1, lineCount), max);
  let s = '';
  for (let i = 1; i <= n; i++) s += `${i}\n`;
  if (lineCount > max) s += '…\n';
  return s;
}

/** VS Code–style language label from filename. */
export function editorLanguageLabel(name: string): string {
  const base = name.split('/').pop() || name;
  const lower = base.toLowerCase();
  if (lower === 'dockerfile') return 'Dockerfile';
  if (lower === 'makefile') return 'Makefile';
  if (lower === 'compose.yml' || lower === 'compose.yaml' || lower === 'docker-compose.yml') {
    return 'YAML';
  }
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : '';
  const map: Record<string, string> = {
    html: 'HTML',
    htm: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    js: 'JavaScript',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    jsx: 'JavaScript React',
    ts: 'TypeScript',
    tsx: 'TypeScript React',
    json: 'JSON',
    md: 'Markdown',
    markdown: 'Markdown',
    php: 'PHP',
    phtml: 'PHP',
    py: 'Python',
    rb: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    java: 'Java',
    kt: 'Kotlin',
    c: 'C',
    h: 'C',
    cpp: 'C++',
    hpp: 'C++',
    cs: 'C#',
    sh: 'Shell Script',
    bash: 'Shell Script',
    zsh: 'Shell Script',
    sql: 'SQL',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    xml: 'XML',
    svg: 'XML',
    env: 'Properties',
    conf: 'Properties',
    ini: 'Properties',
    log: 'Log',
    txt: 'Plain Text',
    vue: 'Vue',
    svelte: 'Svelte',
  };
  return map[ext] || 'Plain Text';
}

export function cursorFromOffset(text: string, offset: number): { line: number; col: number } {
  const pos = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  let col = 1;
  for (let i = 0; i < pos; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function lineStartAt(text: string, pos: number): number {
  return text.lastIndexOf('\n', Math.max(0, pos) - 1) + 1;
}

function lineEndAt(text: string, pos: number): number {
  const n = text.indexOf('\n', pos);
  return n < 0 ? text.length : n;
}

function leadingCut(line: string): number {
  if (line.startsWith('\t')) return 1;
  if (line.startsWith(EDITOR_INDENT)) return EDITOR_INDENT.length;
  if (line.startsWith(' ')) return 1;
  return 0;
}

/** Tab / Shift+Tab for YAML and other indented files. */
export function applyEditorTab(
  text: string,
  start: number,
  end: number,
  shift: boolean,
): { text: string; start: number; end: number } {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const multiline = s !== e && text.slice(s, e).includes('\n');

  if (!shift && !multiline) {
    const next = text.slice(0, s) + EDITOR_INDENT + text.slice(e);
    const pos = s + EDITOR_INDENT.length;
    return { text: next, start: pos, end: pos };
  }

  const first = lineStartAt(text, s);
  const lastChar = e > first && text[e - 1] === '\n' && s !== e ? e - 1 : e;
  const last = lineEndAt(text, lastChar);
  const before = text.slice(0, first);
  const block = text.slice(first, last);
  const after = text.slice(last);
  const lines = block.split('\n');

  let startDelta = 0;
  let endDelta = 0;
  let walked = first;
  const mapped = lines.map((line) => {
    const lineAbs = walked;
    walked += line.length + 1;
    if (shift) {
      const cut = leadingCut(line);
      if (!cut) return line;
      if (s >= lineAbs && s <= lineAbs + line.length) {
        startDelta -= Math.min(cut, Math.max(0, s - lineAbs));
      }
      if (e > lineAbs) endDelta -= cut;
      return line.slice(cut);
    }
    if (s >= lineAbs && s <= lineAbs + line.length) startDelta += EDITOR_INDENT.length;
    if (e > lineAbs) endDelta += EDITOR_INDENT.length;
    return EDITOR_INDENT + line;
  });

  return {
    text: before + mapped.join('\n') + after,
    start: Math.max(first, s + startDelta),
    end: Math.max(first, e + endDelta),
  };
}
