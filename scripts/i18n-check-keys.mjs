#!/usr/bin/env node
/**
 * Ensure zh-HK / zh-CN / en translation catalogs share the same key set.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = join(root, 'packages/shared/locales');
const LOCALES = ['zh-HK', 'zh-CN', 'en'];

function flatten(obj, prefix = '', out = new Set()) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    out.add(prefix);
    return out;
  }
  if (typeof obj !== 'object' || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.add(p);
    else flatten(v, p, out);
  }
  return out;
}

function loadTranslation(code) {
  const p = join(localesDir, code, 'translation.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

const maps = {};
for (const code of LOCALES) {
  maps[code] = flatten(loadTranslation(code));
}

const base = maps['zh-HK'];
const failures = [];

for (const code of LOCALES) {
  if (code === 'zh-HK') continue;
  for (const k of base) {
    if (!maps[code].has(k)) failures.push(`missing in ${code}: ${k}`);
  }
  for (const k of maps[code]) {
    if (!base.has(k)) failures.push(`extra in ${code} (not in zh-HK): ${k}`);
  }
}

console.log('i18n-check-keys');
for (const code of LOCALES) {
  console.log(`  ${code}: ${maps[code].size} keys`);
}

if (failures.length) {
  console.error('FAIL:\n' + failures.slice(0, 40).map((f) => '  - ' + f).join('\n'));
  if (failures.length > 40) console.error(`  … +${failures.length - 40} more`);
  process.exit(1);
}
console.log('OK: locale key sets match');
