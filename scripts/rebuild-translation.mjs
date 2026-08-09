#!/usr/bin/env node
/**
 * Rebuild packages/shared/locales/{locale}/translation.json
 * from sibling namespace JSON files + reserved leaf keys (product, tagline, company).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'packages/shared/locales');
const LEAF_KEYS = ['product', 'tagline', 'company'];
const SKIP = new Set(['translation.json', 'locales.json']);

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** All locale directories that contain namespace JSON (Tier-1 + Tier-2). */
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

for (const code of LOCALES) {
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
  writeFileSync(prevPath, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`rebuild-translation ${code}: ${files.length} namespaces`);
}
console.log('OK');
