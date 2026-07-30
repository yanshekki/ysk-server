#!/usr/bin/env node
/**
 * Guard: every page that renders PageGuide must expose a visible「說明」tab.
 *
 * Accepts either:
 * - WithPageGuide (adds about tab automatically), or
 * - Manual PageTabs entry { id: 'about', label: '說明' } (or id: "about")
 *
 * Exit 1 on findings.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = join(root, 'src', 'pages');

/** Thin wrappers / non-pages — parent or WithPageGuide owns chrome */
const SKIP = new Set([
  'LoginPage.tsx',
  'CronScheduleBuilder.tsx',
  'MariadbPage.tsx',
  'MariadbServicePage.tsx',
  'MysqlPage.tsx',
  'MysqlServicePage.tsx',
  'PostgresServicePage.tsx',
  'RedisServicePage.tsx',
  'PageGuide.tsx',
  'WithPageGuide.tsx',
]);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.tsx')) acc.push(p);
  }
  return acc;
}

const files = walk(pagesDir);
const failures = [];

const usesGuide =
  /<PageGuide\b|guideId\s*=|WithPageGuide\b|from\s+['"][^'"]*PageGuide['"]/;
// Note: no trailing \b after quotes — next char is often `,` (non-word → no boundary).
const hasAboutTab =
  /\bid\s*:\s*['"]about['"]|WithPageGuide\b|['"]about['"]\s*as\s*const|TABS\s*=\s*\[[^\]]*['"]about['"]/;

for (const file of files) {
  const base = file.split('/').pop();
  if (SKIP.has(base)) continue;
  const text = readFileSync(file, 'utf8');
  if (!usesGuide.test(text)) continue;
  // Only require about when page actually renders guide content
  const rendersGuide =
    /<PageGuide\b/.test(text) ||
    /<WithPageGuide\b/.test(text) ||
    /tab\s*===\s*['"]about['"]/.test(text);
  if (!rendersGuide) continue;
  if (!hasAboutTab.test(text)) {
    const rel = relative(root, file);
    failures.push(
      `${rel}: PageGuide without about tab — add { id: 'about', label: '說明' } or use WithPageGuide`,
    );
  }
}

if (failures.length) {
  console.error('about-tab-check FAILED:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}

console.log(`about-tab-check OK (${files.length} page files scanned)`);
