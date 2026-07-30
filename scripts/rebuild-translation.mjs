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
const LOCALES = ['zh-HK', 'zh-CN', 'en'];
const LEAF_KEYS = ['product', 'tagline', 'company'];
const SKIP = new Set(['translation.json']);

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

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
