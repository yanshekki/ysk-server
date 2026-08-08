/**
 * Lightweight syntax highlighter (VS Code Dark+ palette) — no heavy editor deps.
 * Used as a read-only highlight layer under a transparent textarea.
 */

export type SyntaxLang =
  | 'php'
  | 'js'
  | 'ts'
  | 'css'
  | 'html'
  | 'json'
  | 'py'
  | 'sh'
  | 'sql'
  | 'yaml'
  | 'md'
  | 'go'
  | 'rs'
  | 'java'
  | 'xml'
  | 'plain';

const MAX_HIGHLIGHT_CHARS = 400_000;

export function syntaxLangFromName(name: string): SyntaxLang {
  const base = (name.split('/').pop() || name).toLowerCase();
  if (base === 'dockerfile') return 'sh';
  if (base === 'makefile') return 'sh';
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  const map: Record<string, SyntaxLang> = {
    php: 'php',
    phtml: 'php',
    js: 'js',
    mjs: 'js',
    cjs: 'js',
    jsx: 'js',
    ts: 'ts',
    tsx: 'ts',
    css: 'css',
    scss: 'css',
    less: 'css',
    html: 'html',
    htm: 'html',
    json: 'json',
    jsonc: 'json',
    py: 'py',
    sh: 'sh',
    bash: 'sh',
    zsh: 'sh',
    conf: 'sh',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    md: 'md',
    markdown: 'md',
    go: 'go',
    rs: 'rs',
    java: 'java',
    xml: 'xml',
    svg: 'xml',
  };
  return map[ext] ?? 'plain';
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function span(cls: string, text: string): string {
  if (!text) return '';
  return `<span class="tok-${cls}">${esc(text)}</span>`;
}

/** Common C-family / scripting keywords */
const KW_CTRL =
  /^(if|else|elif|elseif|for|foreach|while|do|switch|case|default|break|continue|return|try|catch|finally|throw|match|when|yield|await|async)$/;
const KW_DECL =
  /^(function|class|interface|trait|enum|extends|implements|namespace|use|import|export|from|const|let|var|type|typedef|struct|package|module|fn|def|lambda|new|delete|public|private|protected|static|abstract|final|readonly|override|virtual|internal|package)$/;
const KW_TYPE =
  /^(int|float|double|string|bool|boolean|void|null|undefined|true|false|array|object|mixed|callable|self|parent|this|super|number|any|unknown|never|bigint|symbol|byte|char|long|short|unsigned|signed)$/i;
const KW_PHP_EXTRA =
  /^(echo|print|die|exit|isset|unset|empty|list|array|require|require_once|include|include_once|global|as|instanceof|clone|declare|enddeclare|endfor|endforeach|endif|endswitch|endwhile|and|or|xor)$/;
const KW_PY =
  /^(and|or|not|in|is|None|True|False|pass|with|as|raise|assert|global|nonlocal|from|import|lambda|del|class|def|async|await|yield)$/;
const KW_SH =
  /^(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|select|time|coproc|\[\[|\]\]|export|local|readonly|declare|typeset|return|exit|set|unset|shift|source|alias|true|false)$/;
const KW_SQL =
  /^(select|from|where|and|or|not|insert|into|values|update|set|delete|create|table|index|view|drop|alter|join|left|right|inner|outer|on|group|by|order|having|limit|offset|as|distinct|union|all|null|is|in|like|between|exists|case|when|then|else|end|primary|key|foreign|references|default|unique|check|constraint)$/i;

type Tok = { cls: string; text: string };

function flushPlain(out: Tok[], buf: string) {
  if (buf) out.push({ cls: 'plain', text: buf });
}

/**
 * Tokenize source into colored spans. Best-effort; never throws.
 */
export function tokenize(code: string, lang: SyntaxLang): Tok[] {
  if (lang === 'plain' || !code) {
    return code ? [{ cls: 'plain', text: code }] : [];
  }
  if (lang === 'json') return tokenizeJson(code);
  if (lang === 'html' || lang === 'xml') return tokenizeMarkup(code);
  if (lang === 'css') return tokenizeCss(code);
  if (lang === 'md') return tokenizeMd(code);
  return tokenizeCodey(code, lang);
}

function tokenizeJson(code: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i]!;
    if (c === '"' ) {
      let j = i + 1;
      let escB = false;
      while (j < code.length) {
        const ch = code[j]!;
        if (escB) {
          escB = false;
          j++;
          continue;
        }
        if (ch === '\\') {
          escB = true;
          j++;
          continue;
        }
        if (ch === '"') {
          j++;
          break;
        }
        j++;
      }
      const str = code.slice(i, j);
      // key if next non-ws is :
      let k = j;
      while (k < code.length && /\s/.test(code[k]!)) k++;
      out.push({ cls: code[k] === ':' ? 'attr' : 'string', text: str });
      i = j;
      continue;
    }
    if (/[0-9-]/.test(c)) {
      let j = i + 1;
      while (j < code.length && /[0-9.eE+-]/.test(code[j]!)) j++;
      out.push({ cls: 'number', text: code.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < code.length && /[a-zA-Z0-9_]/.test(code[j]!)) j++;
      const w = code.slice(i, j);
      out.push({
        cls: /^(true|false|null)$/.test(w) ? 'keyword' : 'plain',
        text: w,
      });
      i = j;
      continue;
    }
    if (/[{}\[\]:,]/.test(c)) {
      out.push({ cls: 'punct', text: c });
      i++;
      continue;
    }
    out.push({ cls: 'plain', text: c });
    i++;
  }
  return out;
}

function tokenizeMarkup(code: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < code.length) {
    if (code.startsWith('<!--', i)) {
      const end = code.indexOf('-->', i + 4);
      const j = end < 0 ? code.length : end + 3;
      out.push({ cls: 'comment', text: code.slice(i, j) });
      i = j;
      continue;
    }
    if (code[i] === '<') {
      // <?php ... ?> as keyword block when present
      if (code.startsWith('<?', i)) {
        const end = code.indexOf('?>', i + 2);
        const j = end < 0 ? code.length : end + 2;
        // recurse php inside
        const inner = code.slice(i, j);
        if (inner.startsWith('<?php') || inner.startsWith('<?=')) {
          out.push(...tokenizeCodey(inner, 'php'));
        } else {
          out.push({ cls: 'keyword', text: inner });
        }
        i = j;
        continue;
      }
      const end = code.indexOf('>', i);
      const j = end < 0 ? code.length : end + 1;
      const tag = code.slice(i, j);
      out.push(...tokenizeTag(tag));
      i = j;
      continue;
    }
    // text
    let j = i + 1;
    while (j < code.length && code[j] !== '<') j++;
    out.push({ cls: 'plain', text: code.slice(i, j) });
    i = j;
  }
  return out;
}

function tokenizeTag(tag: string): Tok[] {
  const out: Tok[] = [];
  // < / name attrs >
  const m = /^<\/?([a-zA-Z0-9:_-]+)/.exec(tag);
  if (!m) return [{ cls: 'punct', text: tag }];
  const nameEnd = m[0].length;
  out.push({ cls: 'punct', text: tag.slice(0, tag.startsWith('</') ? 2 : 1) });
  if (tag.startsWith('</')) {
    out.push({ cls: 'tag', text: m[1]! });
  } else {
    out.push({ cls: 'tag', text: m[1]! });
  }
  let i = nameEnd;
  while (i < tag.length) {
    if (/\s/.test(tag[i]!)) {
      let j = i + 1;
      while (j < tag.length && /\s/.test(tag[j]!)) j++;
      out.push({ cls: 'plain', text: tag.slice(i, j) });
      i = j;
      continue;
    }
    if (tag[i] === '/' || tag[i] === '>') {
      out.push({ cls: 'punct', text: tag[i]! });
      i++;
      continue;
    }
    // attr
    let j = i;
    while (j < tag.length && /[a-zA-Z0-9:_-]/.test(tag[j]!)) j++;
    out.push({ cls: 'attr', text: tag.slice(i, j) });
    i = j;
    while (i < tag.length && /\s/.test(tag[i]!)) {
      out.push({ cls: 'plain', text: tag[i]! });
      i++;
    }
    if (tag[i] === '=') {
      out.push({ cls: 'punct', text: '=' });
      i++;
      while (i < tag.length && /\s/.test(tag[i]!)) {
        out.push({ cls: 'plain', text: tag[i]! });
        i++;
      }
      if (tag[i] === '"' || tag[i] === "'") {
        const q = tag[i]!;
        j = i + 1;
        while (j < tag.length && tag[j] !== q) j++;
        if (j < tag.length) j++;
        out.push({ cls: 'string', text: tag.slice(i, j) });
        i = j;
      }
    }
  }
  return out;
}

function tokenizeCss(code: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < code.length) {
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2);
      const j = end < 0 ? code.length : end + 2;
      out.push({ cls: 'comment', text: code.slice(i, j) });
      i = j;
      continue;
    }
    if (code[i] === '"' || code[i] === "'") {
      const q = code[i]!;
      let j = i + 1;
      while (j < code.length && code[j] !== q) {
        if (code[j] === '\\') j += 2;
        else j++;
      }
      if (j < code.length) j++;
      out.push({ cls: 'string', text: code.slice(i, j) });
      i = j;
      continue;
    }
    if (/[0-9]/.test(code[i]!)) {
      let j = i + 1;
      while (j < code.length && /[0-9.%eE+-]/.test(code[j]!)) j++;
      out.push({ cls: 'number', text: code.slice(i, j) });
      i = j;
      continue;
    }
    if (code[i] === '#' && /[0-9a-fA-F]/.test(code[i + 1] ?? '')) {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-F]/.test(code[j]!)) j++;
      out.push({ cls: 'number', text: code.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_-]/.test(code[i]!)) {
      let j = i + 1;
      while (j < code.length && /[a-zA-Z0-9_-]/.test(code[j]!)) j++;
      const w = code.slice(i, j);
      let k = j;
      while (k < code.length && /\s/.test(code[k]!)) k++;
      if (code[k] === '(') out.push({ cls: 'function', text: w });
      else if (code[k] === ':') out.push({ cls: 'attr', text: w });
      else out.push({ cls: 'tag', text: w });
      i = j;
      continue;
    }
    if (/[{}:;,.>#@*&]/.test(code[i]!)) {
      out.push({ cls: 'punct', text: code[i]! });
      i++;
      continue;
    }
    out.push({ cls: 'plain', text: code[i]! });
    i++;
  }
  return out;
}

function tokenizeMd(code: string): Tok[] {
  const out: Tok[] = [];
  const lines = code.split(/(\n)/);
  for (const line of lines) {
    if (line === '\n') {
      out.push({ cls: 'plain', text: '\n' });
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      out.push({ cls: 'keyword', text: line });
      continue;
    }
    if (/^>\s?/.test(line)) {
      out.push({ cls: 'comment', text: line });
      continue;
    }
    if (/^(`{3}|~~~)/.test(line)) {
      out.push({ cls: 'string', text: line });
      continue;
    }
    // inline: bold, code, links — simple pass
    out.push(...tokenizeInlineMd(line));
  }
  return out;
}

function tokenizeInlineMd(line: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '`') {
      let j = i + 1;
      while (j < line.length && line[j] !== '`') j++;
      if (j < line.length) j++;
      out.push({ cls: 'string', text: line.slice(i, j) });
      i = j;
      continue;
    }
    if (line.startsWith('**', i) || line.startsWith('__', i)) {
      const mark = line.slice(i, i + 2);
      const end = line.indexOf(mark, i + 2);
      if (end >= 0) {
        out.push({ cls: 'keyword', text: line.slice(i, end + 2) });
        i = end + 2;
        continue;
      }
    }
    if (line[i] === '[') {
      const close = line.indexOf('](', i);
      if (close >= 0) {
        const end = line.indexOf(')', close + 2);
        if (end >= 0) {
          out.push({ cls: 'function', text: line.slice(i, end + 1) });
          i = end + 1;
          continue;
        }
      }
    }
    out.push({ cls: 'plain', text: line[i]! });
    i++;
  }
  return out;
}

function isWordChar(c: string): boolean {
  return /[a-zA-Z0-9_$]/.test(c);
}

function tokenizeCodey(code: string, lang: SyntaxLang): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let lineStart = true;
  let prevWasClassKw = false;
  let prevWasFnKw = false;

  while (i < code.length) {
    const c = code[i]!;

    // line comments
    if (
      (c === '/' && code[i + 1] === '/') ||
      (c === '#' && lang !== 'php' && lang !== 'css') ||
      (lang === 'py' && c === '#') ||
      (lang === 'sh' && c === '#') ||
      (lang === 'yaml' && c === '#') ||
      (lang === 'sql' && c === '-' && code[i + 1] === '-')
    ) {
      let j = i;
      while (j < code.length && code[j] !== '\n') j++;
      out.push({ cls: 'comment', text: code.slice(i, j) });
      i = j;
      lineStart = false;
      continue;
    }

    // block comments
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const j = end < 0 ? code.length : end + 2;
      out.push({ cls: 'comment', text: code.slice(i, j) });
      i = j;
      continue;
    }

    // PHP open/close
    if (lang === 'php' && code.startsWith('<?', i)) {
      let j = i + 2;
      if (code.startsWith('php', j)) j += 3;
      else if (code[j] === '=') j += 1;
      out.push({ cls: 'keyword', text: code.slice(i, j) });
      i = j;
      continue;
    }
    if (lang === 'php' && code.startsWith('?>', i)) {
      out.push({ cls: 'keyword', text: '?>' });
      i += 2;
      continue;
    }

    // strings
    if (c === '"' || c === "'" || (c === '`' && (lang === 'js' || lang === 'ts'))) {
      const q = c;
      let j = i + 1;
      let escB = false;
      if (q === '`') {
        while (j < code.length) {
          if (!escB && code[j] === '`') {
            j++;
            break;
          }
          escB = !escB && code[j] === '\\';
          if (escB && code[j] !== '\\') escB = false;
          // crude: skip ${
          if (!escB && code[j] === '$' && code[j + 1] === '{') {
            // keep inside string for simplicity
          }
          j++;
        }
      } else {
        while (j < code.length) {
          if (escB) {
            escB = false;
            j++;
            continue;
          }
          if (code[j] === '\\') {
            escB = true;
            j++;
            continue;
          }
          if (code[j] === q) {
            j++;
            break;
          }
          // PHP "\n" style end at newline only if unclosed? keep going
          j++;
        }
      }
      out.push({ cls: 'string', text: code.slice(i, j) });
      i = j;
      lineStart = false;
      prevWasClassKw = false;
      prevWasFnKw = false;
      continue;
    }

    // numbers
    if (
      /[0-9]/.test(c) ||
      (c === '.' && /[0-9]/.test(code[i + 1] ?? '')) ||
      (c === '0' && (code[i + 1] === 'x' || code[i + 1] === 'X'))
    ) {
      let j = i + 1;
      while (j < code.length && /[0-9a-fA-FxX._]/.test(code[j]!)) j++;
      out.push({ cls: 'number', text: code.slice(i, j) });
      i = j;
      lineStart = false;
      prevWasClassKw = false;
      prevWasFnKw = false;
      continue;
    }

    // PHP variables
    if (lang === 'php' && c === '$') {
      let j = i + 1;
      while (j < code.length && /[a-zA-Z0-9_]/.test(code[j]!)) j++;
      out.push({ cls: 'variable', text: code.slice(i, j) });
      i = j;
      lineStart = false;
      prevWasClassKw = false;
      prevWasFnKw = false;
      continue;
    }

    // identifiers / keywords
    if (/[a-zA-Z_@]/.test(c)) {
      let j = i + 1;
      while (j < code.length && isWordChar(code[j]!)) j++;
      const w = code.slice(i, j);
      let k = j;
      while (k < code.length && /[ \t]/.test(code[k]!)) k++;
      const next = code[k] ?? '';

      let cls = 'plain';
      if (prevWasClassKw) {
        cls = 'class';
      } else if (prevWasFnKw) {
        cls = 'function';
      } else if (next === '(') {
        cls = 'function';
      } else if (
        KW_CTRL.test(w) ||
        KW_DECL.test(w) ||
        (lang === 'php' && KW_PHP_EXTRA.test(w)) ||
        (lang === 'py' && KW_PY.test(w)) ||
        (lang === 'sh' && KW_SH.test(w)) ||
        (lang === 'sql' && KW_SQL.test(w))
      ) {
        cls = KW_CTRL.test(w) ? 'control' : 'keyword';
      } else if (KW_TYPE.test(w)) {
        cls = 'type';
      } else if (/^[A-Z][a-zA-Z0-9_]+$/.test(w) && w.length > 1) {
        cls = 'class';
      }

      out.push({ cls, text: w });
      prevWasClassKw = /^(class|interface|trait|enum|struct|type|extends|implements)$/.test(w);
      prevWasFnKw = /^(function|fn|def|func)$/.test(w);
      i = j;
      lineStart = false;
      continue;
    }

    if (c === '\n') {
      out.push({ cls: 'plain', text: '\n' });
      i++;
      lineStart = true;
      prevWasClassKw = false;
      prevWasFnKw = false;
      continue;
    }

    // operators / punct
    if (/[(){}\[\];,.:?!~%^&*=+|<>/-]/.test(c)) {
      // multi-char ops
      const two = code.slice(i, i + 2);
      if (
        [
          '==',
          '!=',
          '<=',
          '>=',
          '=>',
          '->',
          '::',
          '&&',
          '||',
          '++',
          '--',
          '+=',
          '-=',
          '*=',
          '/=',
          '??',
          '?.',
          '===',
          '!==',
        ].some((op) => code.startsWith(op, i))
      ) {
        const op = ['===', '!=='].find((o) => code.startsWith(o, i)) ?? two;
        out.push({ cls: 'operator', text: op });
        i += op.length;
      } else {
        out.push({ cls: 'punct', text: c });
        i++;
      }
      lineStart = false;
      prevWasClassKw = false;
      prevWasFnKw = false;
      continue;
    }

    out.push({ cls: 'plain', text: c });
    i++;
    if (!/\s/.test(c)) {
      lineStart = false;
      prevWasClassKw = false;
      prevWasFnKw = false;
    }
    void lineStart;
  }
  return out;
}

/** Render HTML for highlight layer. */
export function highlightToHtml(code: string, lang: SyntaxLang): string {
  if (!code) return '';
  if (code.length > MAX_HIGHLIGHT_CHARS) {
    return span('plain', code.slice(0, MAX_HIGHLIGHT_CHARS)) + span('comment', '\n/* … truncated highlight … */');
  }
  try {
    const toks = tokenize(code, lang);
    let html = '';
    for (const t of toks) {
      if (t.cls === 'plain') html += esc(t.text);
      else html += span(t.cls, t.text);
    }
    return html;
  } catch {
    return esc(code);
  }
}

export { flushPlain, MAX_HIGHLIGHT_CHARS };
