#!/usr/bin/env node
/**
 * Page guide catalogs: same ids in zh-HK / zh-CN / en;
 * each entry has title + summary; canDo or legacy features present.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'apps/web/src/shared/guides/data');
const LOCALES = ['zh-HK', 'zh-CN', 'en'];

function load(code) {
  const p = join(dataDir, `${code}.json`);
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

const maps = Object.fromEntries(LOCALES.map((c) => [c, load(c)]));
const baseIds = new Set(Object.keys(maps['zh-HK']));
const failures = [];

console.log('i18n-guides-parity');

for (const code of LOCALES) {
  if (code === 'zh-HK') continue;
  const ids = new Set(Object.keys(maps[code]));
  for (const id of baseIds) {
    if (!ids.has(id)) failures.push(`${code} missing guide id: ${id}`);
  }
  for (const id of ids) {
    if (!baseIds.has(id)) failures.push(`${code} extra guide id (not in zh-HK): ${id}`);
  }
}

for (const code of LOCALES) {
  for (const [id, doc] of Object.entries(maps[code])) {
    if (!doc || typeof doc !== 'object') {
      failures.push(`${code}.${id}: not an object`);
      continue;
    }
    if (!String(doc.title || '').trim()) failures.push(`${code}.${id}: empty title`);
    if (!String(doc.summary || '').trim()) failures.push(`${code}.${id}: empty summary`);
    const hasCanDo = Array.isArray(doc.canDo) && doc.canDo.length > 0;
    if (!hasCanDo) {
      failures.push(`${code}.${id}: need native canDo[] (1–5 items)`);
    }
    if (Array.isArray(doc.canDo) && doc.canDo.length > 5) {
      failures.push(`${code}.${id}: canDo length ${doc.canDo.length} > 5`);
    }
    if (Array.isArray(doc.notes) && doc.notes.length > 4) {
      failures.push(`${code}.${id}: notes length ${doc.notes.length} > 4`);
    }
    // Prefer slim shape: fail if only legacy content remains without canDo (already covered)
    if (doc.features && !hasCanDo) {
      failures.push(`${code}.${id}: legacy features without canDo`);
    }
  }
}

console.log(`  guide ids (zh-HK): ${baseIds.size}`);
console.log(`  findings: ${failures.length}`);

if (failures.length) {
  console.error('FAIL: page guide parity');
  for (const f of failures.slice(0, 60)) console.error(`  - ${f}`);
  if (failures.length > 60) console.error(`  … +${failures.length - 60} more`);
  process.exit(1);
}
console.log('OK: guide catalogs aligned');
