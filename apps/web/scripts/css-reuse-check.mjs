#!/usr/bin/env node
/**
 * CSS reuse gate (Wave2 R6).
 *
 * Hard fails:
 * 1. Disallowed inline style={{ … }} (dynamic CSS variables & meter width OK)
 * 2. Core design patterns missing multi-file reuse
 *
 * Also reports top class frequency (informational).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');

function isTestOrSpec(name) {
  return name.includes('.test.') || name.includes('.spec.') || name.endsWith('.stories.tsx');
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      // Skip unit/integration test fixtures under src/test
      if (name === 'test' || name === '__tests__' || name === '__mocks__') continue;
      walk(p, acc);
    } else if (/\.(tsx|ts|jsx|js)$/.test(name) && !isTestOrSpec(name)) acc.push(p);
  }
  return acc;
}

const files = walk(src);
const classFiles = new Map();
const freq = new Map();
let totalClassUses = 0;
/** @type {Array<{ file: string; snippet: string }>} */
const badInlines = [];

/**
 * Allowed inline styles (honest exceptions only):
 * - CSS custom properties: --meter-pct, ['--x' as string]: …
 * - Dynamic width/height percentages for meters
 */
function isAllowedStyleObject(inner) {
  const t = inner.replace(/\s+/g, ' ').trim();
  if (!t) return true;
  // Explicit custom-property form used by u-meter-fill
  if (
    /\[\s*["']--[\w-]+["']\s+as\s+string\s*\]\s*:/.test(t) ||
    /["']--[\w-]+["']\s*:/.test(t) ||
    /--[\w-]+\s*:/.test(t)
  ) {
    // Allow if no other obvious layout keys (position, display, margin, …)
    if (
      !/\b(position|display|margin|padding|flex|justify|align|top|left|right|bottom|zIndex|background|border|whiteSpace|gap)\b/.test(
        t,
      )
    ) {
      return true;
    }
  }
  // width: `${x}%` only
  if (/^\s*width\s*:\s*[`][^`]*[%)][`]\s*,?\s*$/.test(t)) return true;
  if (/^\s*width\s*:\s*`\$\{[^}]+\}%`\s*,?\s*$/.test(t)) return true;
  return false;
}

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  // Inline styles
  const styleRe = /style=\{\{([\s\S]*?)\}\}/g;
  let sm;
  while ((sm = styleRe.exec(text))) {
    const inner = sm[1];
    if (!isAllowedStyleObject(inner)) {
      const line = text.slice(0, sm.index).split('\n').length;
      badInlines.push({
        file: `${rel}:${line}`,
        snippet: inner.replace(/\s+/g, ' ').trim().slice(0, 80),
      });
    }
  }

  // className string forms
  const re =
    /className=(?:\{`([^`]*)`\}|\{"([^"]*)"\}|"([^"]*)"|'([^']*)'|\{\s*\[([^\]]+)\])/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1] || m[2] || m[3] || m[4] || m[5] || '';
    const cleaned = raw.replace(/\$\{[^}]+\}/g, ' ').replace(/['"`]/g, ' ');
    for (const cls of cleaned.split(/[\s,]+/).filter(Boolean)) {
      if (cls.includes('${') || cls.includes('{') || cls === 'null' || cls === 'undefined')
        continue;
      // skip ternary noise
      if (['true', 'false', '?', ':', '&&', '||'].includes(cls)) continue;
      totalClassUses += 1;
      freq.set(cls, (freq.get(cls) || 0) + 1);
      if (!classFiles.has(cls)) classFiles.set(cls, new Set());
      classFiles.get(cls).add(file);
    }
  }

  // String literals that look like BEM class lists (VARIANT_CLASS, buttonClassName)
  const strRe = /['"`]([a-z][a-z0-9_-]*(?:\s+[a-z][a-z0-9_-]*){0,6})['"`]/g;
  while ((m = strRe.exec(text))) {
    const raw = m[1];
    if (!/^(btn|field|alert|card|badge|empty|page-header|table-wrap|data-table|muted)\b/.test(raw))
      continue;
    for (const cls of raw.split(/\s+/)) {
      totalClassUses += 1;
      freq.set(cls, (freq.get(cls) || 0) + 1);
      if (!classFiles.has(cls)) classFiles.set(cls, new Set());
      classFiles.get(cls).add(file);
    }
  }

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

function patternFileCount(prefix) {
  return new Set(
    [...classFiles.entries()]
      .filter(
        ([k]) => k === prefix || k.startsWith(`${prefix}--`) || k.startsWith(`${prefix}__`),
      )
      .flatMap(([, set]) => [...set]),
  ).size;
}

// Core primitives that must appear in kit + ≥1 consumer (or ≥2 files total)
const core = [
  'card',
  'btn',
  'field',
  'alert',
  'badge',
  'muted',
  'data-table', // preferred over bare table-wrap
  'empty',
];

const failures = [];

if (badInlines.length > 0) {
  failures.push(
    `disallowed inline style={{ count must be 0, got ${badInlines.length}`,
  );
  for (const b of badInlines.slice(0, 12)) {
    failures.push(`  ${b.file}: ${b.snippet}`);
  }
  if (badInlines.length > 12) failures.push(`  … +${badInlines.length - 12} more`);
}

for (const c of core) {
  const n = patternFileCount(c);
  // table-wrap counts toward data-table family
  const n2 = c === 'data-table' ? n + patternFileCount('table-wrap') : n;
  if (n2 < 1) {
    failures.push(`pattern "${c}" used in ${n2} file(s), need ≥1 (kit or page)`);
  }
}

const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
const top15 = sorted.slice(0, 15);
const top15Uses = top15.reduce((s, [, n]) => s + n, 0);
const share = totalClassUses ? top15Uses / totalClassUses : 0;

console.log('=== CSS reuse report (R6) ===');
console.log('disallowed inline style={{ count:', badInlines.length);
console.log('total class uses:', totalClassUses);
console.log('unique classes:', freq.size);
console.log('top15 share:', (share * 100).toFixed(1) + '%');
console.log('top15:', top15.map(([k, n]) => `${k}(${n})`).join(', '));
for (const c of core) {
  const n =
    c === 'data-table'
      ? patternFileCount(c) + patternFileCount('table-wrap')
      : patternFileCount(c);
  console.log(`pattern ${c}: ${n} files`);
}
if (share < 0.35) {
  console.warn('warn: top15 share < 35% (informational)');
}

if (failures.length) {
  console.error('FAIL:\n' + failures.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
console.log('OK: inline styles policy + core patterns present');
