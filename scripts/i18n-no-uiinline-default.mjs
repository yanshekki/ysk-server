#!/usr/bin/env node
/**
 * Fail if web source still uses defaultValue: t('uiInline...') crutches.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const webSrc = join(dirname(fileURLToPath(import.meta.url)), '../apps/web/src');
const HIT = /defaultValue:\s*t\(\s*['"]uiInline\./;
const HIT2 = /defaultValue:\s*tr\(\s*['"]uiInline\./;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(name) && !name.includes('.test.')) acc.push(p);
  }
  return acc;
}

const fails = [];
for (const file of walk(webSrc)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (HIT.test(line) || HIT2.test(line)) {
      fails.push(`${relative(webSrc, file)}:${i + 1}`);
    }
  });
}

// zh-HK mixed EN product words in software/runtime critical
import { readFileSync as rf } from 'node:fs';
const zhSw = JSON.parse(rf(join(dirname(fileURLToPath(import.meta.url)), '../packages/shared/locales/zh-HK/software.json'), 'utf8'));
const badEn = /Latest|Installed|Manage(?!d)/;
function walkStr(o, path, acc) {
  if (typeof o === 'string') {
    if (badEn.test(o) && /[\u4e00-\u9fff]/.test(o)) acc.push(`${path}: ${o.slice(0, 60)}`);
  } else if (o && typeof o === 'object') {
    for (const [k, v] of Object.entries(o)) walkStr(v, path ? `${path}.${k}` : k, acc);
  }
}
const mix = [];
walkStr(zhSw, 'software', mix);

console.log('i18n-no-uiinline-default');
console.log(`  defaultValue uiInline: ${fails.length}`);
console.log(`  zh-HK software mixed EN: ${mix.length}`);
if (fails.length || mix.length) {
  for (const f of fails.slice(0, 30)) console.error('  ', f);
  for (const m of mix.slice(0, 20)) console.error('  ', m);
  process.exit(1);
}
console.log('OK');
