#!/usr/bin/env node
/**
 * Verify central CSS reuse: no inline styles; core patterns used in ≥2 files.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) acc.push(p);
  }
  return acc;
}

const files = walk(src);
let inline = 0;
const classFiles = new Map(); // class -> Set of files
let totalClassUses = 0;
const freq = new Map();

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const inlineMatches = text.match(/style=\{\{/g);
  if (inlineMatches) inline += inlineMatches.length;

  const re = /className=(?:\{`([^`]*)`\}|\{"([^"]*)"\}|"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1] || m[2] || m[3] || m[4] || '';
    // also handle template with ${} roughly by stripping
    const cleaned = raw.replace(/\$\{[^}]+\}/g, ' ');
    for (const cls of cleaned.split(/\s+/).filter(Boolean)) {
      // skip dynamic fragments
      if (cls.includes('${') || cls.includes('{')) continue;
      totalClassUses += 1;
      freq.set(cls, (freq.get(cls) || 0) + 1);
      if (!classFiles.has(cls)) classFiles.set(cls, new Set());
      classFiles.get(cls).add(file);
    }
  }

  // className={`...${isActive ? ' active' : ''}`} already partially handled
  // Also match className={({ isActive }) => `shell__link${isActive ? ' active' : ''}`}
  const fnRe = /className=\{\([^)]*\)\s*=>\s*`([^`]*)`\}/g;
  while ((m = fnRe.exec(text))) {
    const cleaned = m[1].replace(/\$\{[^}]+\}/g, ' ');
    for (const cls of cleaned.split(/\s+/).filter(Boolean)) {
      totalClassUses += 1;
      freq.set(cls, (freq.get(cls) || 0) + 1);
      if (!classFiles.has(cls)) classFiles.set(cls, new Set());
      classFiles.get(cls).add(file);
    }
  }
}

const core = ['card', 'btn', 'field', 'page-header', 'table-wrap', 'empty', 'alert', 'muted', 'badge'];
const failures = [];

if (inline > 0) failures.push(`inline style={{ count must be 0, got ${inline}`);

for (const c of core) {
  const filesUsing = [...(classFiles.keys())]
    .filter((k) => k === c || k.startsWith(c + '--') || k.startsWith(c + '__'))
    .flatMap((k) => [...classFiles.get(k)]);
  const uniqueFiles = new Set(filesUsing);
  // count files that use base or variant
  const n = new Set(
    [...classFiles.entries()]
      .filter(([k]) => k === c || k.startsWith(`${c}--`) || k.startsWith(`${c}__`))
      .flatMap(([, set]) => [...set]),
  ).size;
  if (n < 2) failures.push(`pattern "${c}" used in ${n} file(s), need ≥2`);
}

const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
const top15 = sorted.slice(0, 15);
const top15Uses = top15.reduce((s, [, n]) => s + n, 0);
const share = totalClassUses ? top15Uses / totalClassUses : 0;

console.log('=== CSS reuse report ===');
console.log('inline style={{ count:', inline);
console.log('total class uses:', totalClassUses);
console.log('unique classes:', freq.size);
console.log('top15 share:', (share * 100).toFixed(1) + '%');
console.log('top15:', top15.map(([k, n]) => `${k}(${n})`).join(', '));
for (const c of core) {
  const n = new Set(
    [...classFiles.entries()]
      .filter(([k]) => k === c || k.startsWith(`${c}--`) || k.startsWith(`${c}__`))
      .flatMap(([, set]) => [...set]),
  ).size;
  console.log(`pattern ${c}: ${n} files`);
}

if (share < 0.5) {
  console.warn('warn: top15 share < 50% (target ≥60% aspirational)');
}

if (failures.length) {
  console.error('FAIL:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('OK: no inline styles; core patterns multi-file reuse');
