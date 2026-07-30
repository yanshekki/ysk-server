#!/usr/bin/env node
/**
 * Guard: feature pages use system primitives only.
 * - PageTabs / Tabs for page tabs
 * - DataTable for tables (no raw <table in pages/features)
 * - Form / Field for forms
 * - ActionBar for button lists (no btn-row)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scanDirs = [join(root, 'src', 'pages'), join(root, 'src', 'features')];

/** Non-feature shells / the primitive itself */
const SKIP = new Set([
  'LoginPage.tsx',
  'CronScheduleBuilder.tsx',
  'DataTable.tsx',
]);

function walk(dir, acc = []) {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const files = scanDirs.flatMap((d) => walk(d));
const failures = [];

for (const file of files) {
  const base = file.split('/').pop();
  if (SKIP.has(base)) continue;
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  if (/<table[\s>]/.test(text)) {
    failures.push(`${rel}: raw <table> — use DataTable`);
  }
  if (/\bbtn-row\b/.test(text)) {
    failures.push(`${rel}: btn-row — use ActionBar`);
  }
  if (/\bops-user-list\b|\bops-user\b|\bops-field\b/.test(text)) {
    failures.push(`${rel}: ops-user/ops-field — use DataTable + Form/Field`);
  }

  // Create buttons must not live in FeaturePageLayout.actions
  const layoutOpen = text.match(/<FeaturePageLayout\b([\s\S]*?)(?:\n\s*>\n|>\s*\n)/);
  if (layoutOpen) {
    const head = layoutOpen[0];
    if (
      /\+\s*(建立|新增|登記)/.test(head) ||
      /email\.create|projects\.create/.test(head)
    ) {
      failures.push(
        `${rel}: create button in FeaturePageLayout.actions — put on DataTable/ListPanel toolbar only`,
      );
    }
  }
}

const indexPath = join(root, 'src/shared/components/ui/index.ts');
const indexText = readFileSync(indexPath, 'utf8');
for (const name of ['PageTabs', 'DataTable', 'ActionBar', 'Form', 'FeaturePageLayout']) {
  if (!new RegExp(`\\b${name}\\b`).test(indexText)) {
    failures.push(`ui/index.ts: missing export ${name}`);
  }
}

if (failures.length) {
  console.error(
    'page-primitives-check FAILED:\n' + failures.map((f) => '  - ' + f).join('\n'),
  );
  process.exit(1);
}

console.log(
  `page-primitives-check OK (${files.filter((f) => !SKIP.has(f.split('/').pop())).length} files, strict)`,
);
