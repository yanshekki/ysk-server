#!/usr/bin/env node
/**
 * Export coverage scanner — every runtime export must appear in a test
 * or be listed in coverage-exceptions.json.
 *
 * Usage: node scripts/test-export-coverage.mjs
 * Exit 1 on unexplained exports (when STRICT=1 or --strict).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict') || process.env.STRICT === '1';

const PACKAGES = [
  'packages/shared/src',
  'packages/core/src',
  'apps/server/src',
  'apps/web/src',
];

const exceptionsPath = join(root, 'docs/testing/coverage-exceptions.json');
/** @type {{ path: string, reason: string }[]} */
let exceptions = [];
if (existsSync(exceptionsPath)) {
  exceptions = JSON.parse(readFileSync(exceptionsPath, 'utf8')).exceptions ?? [];
}
const exceptionSet = new Set(exceptions.map((e) => e.path.replace(/\\/g, '/')));

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'test' || name === 'styles') continue;
      walk(p, acc);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !/\.spec\.(ts|tsx)$/.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

function collectExports(file) {
  const text = readFileSync(file, 'utf8');
  const names = new Set();
  // export function foo / export async function foo / export class Foo / export const foo =
  const re =
    /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(text))) names.add(m[1]);
  // export { a, b as c }
  const re2 = /export\s*\{([^}]+)\}/g;
  while ((m = re2.exec(text))) {
    for (const part of m[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      const name = (bits[1] || bits[0] || '').trim();
      if (name && name !== 'type' && !name.startsWith('type ')) names.add(name.replace(/^type\s+/, ''));
    }
  }
  return [...names].filter((n) => n && !['type', 'interface', 'default'].includes(n));
}

function loadAllTestText() {
  const chunks = [];
  for (const base of PACKAGES) {
    const abs = join(root, base);
    for (const f of walk(abs)) {
      if (/\.test\.(ts|tsx)$/.test(f) || /\.spec\.(ts|tsx)$/.test(f)) {
        chunks.push(readFileSync(f, 'utf8'));
      }
    }
    // also walk for test files only
  }
  // re-walk including test files
  function walkTests(dir, acc = []) {
    if (!existsSync(dir)) return acc;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walkTests(p, acc);
      } else if (/\.(test|spec)\.(ts|tsx)$/.test(name)) {
        acc.push(readFileSync(p, 'utf8'));
      }
    }
    return acc;
  }
  for (const base of PACKAGES) {
    chunks.push(...walkTests(join(root, base)));
  }
  return chunks.join('\n');
}

const testBlob = loadAllTestText();
const missing = [];
const covered = [];

for (const base of PACKAGES) {
  const abs = join(root, base);
  for (const file of walk(abs)) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (exceptionSet.has(rel)) continue;
    if (rel.endsWith('/index.ts') || rel.endsWith('/index.tsx')) continue;
    if (rel.endsWith('/types.ts') || rel.endsWith('/types.tsx')) continue;
    if (rel.includes('/test/')) continue;

    const exports = collectExports(file);
    if (exports.length === 0) continue; // types-only

    const sibling =
      file.replace(/\.tsx?$/, '.test.ts') ||
      file.replace(/\.tsx?$/, '.test.tsx');
    const hasSibling =
      existsSync(file.replace(/\.tsx$/, '.test.tsx').replace(/\.ts$/, '.test.ts')) ||
      existsSync(file.replace(/\.ts$/, '.test.ts')) ||
      existsSync(file.replace(/\.tsx$/, '.test.tsx'));

    for (const name of exports) {
      const mentioned =
        hasSibling ||
        new RegExp(`\\b${name}\\b`).test(testBlob) ||
        testBlob.includes(`'${name}'`) ||
        testBlob.includes(`"${name}"`);
      if (mentioned) covered.push(`${rel}#${name}`);
      else missing.push(`${rel}#${name}`);
    }
  }
}

console.log('test-export-coverage');
console.log(`  covered exports (heuristic): ${covered.length}`);
console.log(`  missing: ${missing.length}`);
console.log(`  exceptions: ${exceptions.length}`);
if (missing.length) {
  console.log('  sample missing (up to 40):');
  for (const m of missing.slice(0, 40)) console.log(`    - ${m}`);
  if (missing.length > 40) console.log(`    … +${missing.length - 40} more`);
}

if (strict && missing.length) {
  process.exit(1);
}
console.log(strict ? 'OK (strict)' : 'OK (report-only; use --strict to fail)');
process.exit(0);
