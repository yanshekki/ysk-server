#!/usr/bin/env node
/**
 * Fail if translation.json is out of date vs namespace JSON files.
 * Run after editing locales; CI should require a clean rebuild.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'packages/shared/locales');
const LEAF_KEYS = ['product', 'tagline', 'company'];
const SKIP = new Set(['translation.json', 'locales.json']);

function listLocales() {
  return readdirSync(localesDir)
    .filter((name) => {
      const p = join(localesDir, name);
      try {
        return (
          existsSync(p) &&
          readdirSync(p).some((f) => f.endsWith('.json') && f !== 'translation.json')
        );
      } catch {
        return false;
      }
    })
    .sort();
}

const LOCALES = listLocales();

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

function stableStringify(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

function buildExpected(code) {
  const dir = join(localesDir, code);
  const prevPath = join(dir, 'translation.json');
  const prev = existsSync(prevPath) ? loadJson(prevPath) : {};
  const out = {};
  for (const k of LEAF_KEYS) {
    if (typeof prev[k] === 'string') out[k] = prev[k];
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !SKIP.has(f))
    .sort();
  for (const f of files) {
    const ns = f.replace(/\.json$/, '');
    out[ns] = loadJson(join(dir, f));
  }
  return out;
}

function hash(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

let failed = false;
console.log('i18n-rebuild-drift');

for (const code of LOCALES) {
  const path = join(localesDir, code, 'translation.json');
  if (!existsSync(path)) {
    console.error(`  FAIL ${code}: missing translation.json`);
    failed = true;
    continue;
  }
  const actual = stableStringify(loadJson(path));
  const expected = stableStringify(buildExpected(code));
  if (actual !== expected) {
    console.error(
      `  FAIL ${code}: translation.json drift (actual ${hash(actual)} ≠ expected ${hash(expected)})`,
    );
    console.error(`         run: pnpm i18n:rebuild`);
    failed = true;
  } else {
    console.log(`  OK ${code}`);
  }
}

if (failed) process.exit(1);
console.log('OK: translation.json matches namespace sources');
