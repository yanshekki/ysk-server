#!/usr/bin/env node
/**
 * Fail if the web panel pulls JS/CSS/fonts from a public CDN at runtime.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webSrc = join(root, 'apps/web');

const FORBIDDEN = [
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /unpkg\.com/i,
  /cdn\.jsdelivr\.net/i,
  /cdnjs\.cloudflare\.com/i,
  /ajax\.googleapis\.com/i,
];

const SKIP_DIR = new Set(['node_modules', 'dist', 'coverage']);
const EXT = new Set(['.html', '.css', '.ts', '.tsx', '.js', '.mjs']);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if ([...EXT].some((e) => name.endsWith(e))) acc.push(p);
  }
  return acc;
}

const hits = [];
for (const file of walk(webSrc)) {
  const text = readFileSync(file, 'utf8');
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      hits.push(`${relative(root, file)}  ${re.source}`);
    }
  }
}

console.log('no-external-assets');
if (hits.length) {
  console.error('FAIL: runtime CDN / webfont URLs\n' + hits.map((h) => `  ${h}`).join('\n'));
  process.exit(1);
}
console.log('OK: no Google Fonts / public CDN URLs in apps/web');
