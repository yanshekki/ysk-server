#!/usr/bin/env node
/**
 * Disabled raw <button> in pages/features must explain why (title or aria-*).
 * <Button> auto-fills title when disabled — not scanned here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanDirs = [join(root, 'src', 'pages'), join(root, 'src', 'features')];

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.tsx') && !name.includes('.test.') && !name.includes('.spec.')) {
      acc.push(p);
    }
  }
  return acc;
}

const OPEN = /<button\b[\s\S]*?>/g;
const files = scanDirs.flatMap((d) => walk(d));
const failures = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  let m;
  OPEN.lastIndex = 0;
  while ((m = OPEN.exec(text))) {
    const tag = m[0];
    if (!/\bdisabled\s*=/.test(tag)) continue;
    if (/\btitle\s*=/.test(tag)) continue;
    if (/\baria-label\s*=/.test(tag)) continue;
    if (/\baria-describedby\s*=/.test(tag)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    failures.push(`${rel}:${line}: disabled <button> needs title or aria-label`);
  }
}

if (failures.length) {
  console.error('disabled-title-check');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('disabled-title-check\nOK: disabled raw buttons have title/aria-label');
