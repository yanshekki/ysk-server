#!/usr/bin/env node
/**
 * L5 hard gate: no hardcoded CJK operator messages in API/core.
 *
 * Scans packages/core/src + apps/server/src for CJK in string literals.
 * Allows: comments, regex matchers (legacy backend / intent matching).
 * Code should use tl() / yskError / notes.* keys (L3–L4).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanRoots = [
  join(root, 'packages/core/src'),
  join(root, 'apps/server/src'),
];

const HAN = /[\u4e00-\u9fff]/;
const STR_LIT =
  /(['"`])((?:(?!\1)[^\\]|\\.)*?[\u4e00-\u9fff](?:(?!\1)[^\\]|\\.)*?)\1/g;

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(name) && !name.includes('.test.')) acc.push(p);
  }
  return acc;
}

function isCommentLine(line) {
  const s = line.trim();
  return (
    s.startsWith('//') ||
    s.startsWith('*') ||
    s.startsWith('/*') ||
    s.startsWith('*/')
  );
}

function isRegexContext(code) {
  if (/\/[^/\n]*[\u4e00-\u9fff][^/\n]*\/[gimsuy]*/.test(code)) return true;
  if (/\bRegExp\s*\(/.test(code) && HAN.test(code)) return true;
  return false;
}

function stripLineComment(line) {
  const idx = line.indexOf('//');
  if (idx === -1) return line;
  const before = line.slice(0, idx);
  const quotes = (before.match(/['"`]/g) || []).length;
  if (quotes % 2 === 0) return before;
  return line;
}

const files = scanRoots.flatMap((d) => walk(d));
const failures = [];

for (const file of files) {
  const rel = relative(root, file).split('\\').join('/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    const code = stripLineComment(line);
    if (!HAN.test(code)) continue;
    if (isRegexContext(code)) continue;
    if (/\bfrom\s+['"]/.test(code) || /\bimport\s+['"]/.test(code)) continue;

    STR_LIT.lastIndex = 0;
    let m;
    while ((m = STR_LIT.exec(code)) !== null) {
      const lit = m[2];
      if (!HAN.test(lit)) continue;
      failures.push({
        file: rel,
        line: i + 1,
        snippet: lit.slice(0, 48).replace(/\s+/g, ' '),
      });
    }
  }
}

console.log('i18n-check-api');
console.log(`  scanned: ${files.length} files (core + server)`);
console.log(`  findings: ${failures.length}`);

if (failures.length) {
  console.error(
    'FAIL: hardcoded CJK in API/core strings (use tl() / yskError / notes.*):\n',
  );
  for (const f of failures.slice(0, 50)) {
    console.error(`  - ${f.file}:${f.line}: "${f.snippet}"`);
  }
  if (failures.length > 50) console.error(`  … +${failures.length - 50} more`);
  process.exit(1);
}
console.log('OK: no hardcoded CJK operator string literals');
