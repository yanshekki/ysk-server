#!/usr/bin/env node
/**
 * Lint zh-HK locale JSON for non–Hong Kong written Chinese terms.
 * Fail CI when forbidden TW/Mainland wording appears in operator strings.
 *
 * Allowlist: exact full-string values that are intentional exceptions.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const zhHkDir = join(root, 'packages/shared/locales/zh-HK');

/** term → preferred (for message only) */
const FORBIDDEN = [
  { term: '軟體', prefer: '軟件' },
  { term: '網路', prefer: '網絡' },
  { term: '設置', prefer: '設定' },
  { term: '服務器', prefer: '伺服器' },
  { term: '默認', prefer: '預設' },
  { term: '信息', prefer: '資訊／訊息' },
  { term: '登錄', prefer: '登入／登記' },
  { term: '點擊', prefer: '點選' },
  { term: '刷新', prefer: '重新整理' },
  { term: '磁盤', prefer: '磁碟' },
  { term: '創建', prefer: '建立' },
  { term: '內存', prefer: '記憶體' },
  { term: '用戶端', prefer: '客戶端' },
  { term: '請您', prefer: '請' },
  { term: '反饋', prefer: '回饋' },
  { term: '使用者名稱', prefer: '用戶名' },
  { term: '文件夾', prefer: '資料夾' },
];

/** Full value allowlist (rare proper nouns / quotes) */
const ALLOW_VALUES = new Set([
  // keep empty unless a true exception appears
]);

/** Path allowlist: namespace.key prefix (posix) e.g. notes.auto.n9999 */
const ALLOW_KEYS = new Set([]);

function walkJson(obj, path, acc) {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'string') {
    acc.push({ path, value: obj });
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => walkJson(v, `${path}[${i}]`, acc));
    return;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      walkJson(v, path ? `${path}.${k}` : k, acc);
    }
  }
}

function loadLeaves() {
  const leaves = [];
  for (const name of readdirSync(zhHkDir)) {
    if (!name.endsWith('.json') || name === 'translation.json') continue;
    const ns = name.replace(/\.json$/, '');
    const data = JSON.parse(readFileSync(join(zhHkDir, name), 'utf8'));
    const acc = [];
    walkJson(data, ns, acc);
    leaves.push(...acc);
  }
  return leaves;
}

const leaves = loadLeaves();
const failures = [];

for (const { path, value } of leaves) {
  if (ALLOW_VALUES.has(value)) continue;
  if (ALLOW_KEYS.has(path)) continue;
  for (const { term, prefer } of FORBIDDEN) {
    if (value.includes(term)) {
      failures.push({ path, term, prefer, sample: value.slice(0, 120) });
    }
  }
}

if (failures.length) {
  console.error('i18n-hk-glossary-lint FAIL');
  console.error(`  findings: ${failures.length}`);
  for (const f of failures.slice(0, 80)) {
    console.error(`  ${f.path}: 「${f.term}」→ 宜用「${f.prefer}」`);
    console.error(`    ${JSON.stringify(f.sample)}`);
  }
  if (failures.length > 80) console.error(`  … +${failures.length - 80} more`);
  process.exit(1);
}

console.log('i18n-hk-glossary-lint');
console.log(`  scanned leaves: ${leaves.length}`);
console.log('OK: zh-HK glossary clean');
