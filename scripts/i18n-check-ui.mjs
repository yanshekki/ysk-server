#!/usr/bin/env node
/**
 * L5 hard gate: no hardcoded CJK in web UI string literals.
 *
 * Scans apps/web/src for user-visible Chinese in quotes/templates.
 * Allows: comments, regex matchers, page-guide catalog (L2.1 deferred).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = join(root, 'apps/web/src');

/** Relative path prefixes (posix) to skip entirely */
const SKIP_PREFIXES = [
  'shared/guides/catalog.ts', // L2.1 multi-locale guide bodies
];

/** File basenames always skipped */
const SKIP_FILES = new Set([]);

const HAN = /[\u4e00-\u9fff]/;
/** Quoted / template string that contains Han */
const STR_LIT =
  /(['"`])((?:(?!\1)[^\\]|\\.)*?[\u4e00-\u9fff](?:(?!\1)[^\\]|\\.)*?)\1/g;

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(name) && !name.includes('.test.')) acc.push(p);
  }
  return acc;
}

function isCommentLine(line) {
  const s = line.trim();
  return (
    s.startsWith('//') ||
    s.startsWith('*') ||
    s.startsWith('/*') ||
    s.startsWith('*/') ||
    s.startsWith('{/*')
  );
}

/** Regex literal or RegExp that intentionally matches CJK backend text */
function isRegexContext(code) {
  if (/\/[^/\n]*[\u4e00-\u9fff][^/\n]*\/[gimsuy]*/.test(code)) return true;
  if (/\bRegExp\s*\(/.test(code) && HAN.test(code)) return true;
  return false;
}

function stripLineComment(line) {
  // naive // strip outside strings is hard; only strip trailing // if no quote after
  const idx = line.indexOf('//');
  if (idx === -1) return line;
  const before = line.slice(0, idx);
  const quotes = (before.match(/['"`]/g) || []).length;
  if (quotes % 2 === 0) return before;
  return line;
}

const files = walk(webSrc);
const failures = [];

for (const file of files) {
  const rel = relative(webSrc, file).split('\\').join('/');
  if (SKIP_FILES.has(rel.split('/').pop())) continue;
  if (SKIP_PREFIXES.some((p) => rel === p || rel.startsWith(p))) continue;

  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    const code = stripLineComment(line);
    if (!HAN.test(code)) continue;
    if (isRegexContext(code)) continue;
    // skip import/from paths
    if (/\bfrom\s+['"]/.test(code) || /\bimport\s+['"]/.test(code)) continue;

    STR_LIT.lastIndex = 0;
    let m;
    while ((m = STR_LIT.exec(code)) !== null) {
      const lit = m[2];
      // skip empty / pure punctuation
      if (!HAN.test(lit)) continue;
      failures.push({
        file: `apps/web/src/${rel}`,
        line: i + 1,
        snippet: lit.slice(0, 48).replace(/\s+/g, ' '),
      });
    }
  }
}

console.log('i18n-check-ui');
console.log(`  scanned: ${files.length} files under apps/web/src`);
console.log(`  findings: ${failures.length}`);

if (failures.length) {
  console.error('FAIL: hardcoded CJK string literals in web UI (use t() / locale packs):\n');
  for (const f of failures.slice(0, 50)) {
    console.error(`  - ${f.file}:${f.line}: "${f.snippet}"`);
  }
  if (failures.length > 50) console.error(`  … +${failures.length - 50} more`);
  process.exit(1);
}
console.log('OK: no hardcoded CJK UI string literals');
