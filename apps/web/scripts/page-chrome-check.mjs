#!/usr/bin/env node
/**
 * Guard: every feature page uses FeaturePageLayout status chrome.
 * Fails if pages reintroduce OpsHero, raw *-hero markup, or skip layout.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = join(root, 'src', 'pages');

/** Thin wrappers + non-page modules + guest/public surfaces */
const SKIP = new Set([
  'LoginPage.tsx',
  'PublicSharePage.tsx', // guest landing — not panel FeaturePageLayout chrome
  'VncSharePage.tsx', // public share viewer — not panel chrome
  'NodeRuntimePage.tsx', // re-export only → GenericRuntimePage
  'FtpsServicePage.tsx', // re-export only → FtpPage
  'SoftwareHubPage.tsx', // Navigate redirect only
  'FirewallServicesPanel.tsx', // embedded tab panel under Firewall
  'FtpServicePanel.tsx', // embedded panel under FtpPage
  'CronScheduleBuilder.tsx',
  'MariadbPage.tsx',
  'MariadbServicePage.tsx',
  'MysqlPage.tsx',
  'MysqlServicePage.tsx',
  'PostgresServicePage.tsx',
  'RedisServicePage.tsx',
]);

/** Test / helper modules co-located under pages/ — not product UI. */
function isNonPageTsx(name) {
  return (
    name.includes('.test.') ||
    name.includes('.spec.') ||
    name.endsWith('.unit.tsx') ||
    name.endsWith('.stories.tsx')
  );
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.tsx') && !isNonPageTsx(name)) acc.push(p);
  }
  return acc;
}

const files = walk(pagesDir);
const failures = [];

const bannedImport = /from\s+['"][^'"]*OpsHero['"]|import\s*\{[^}]*\bOpsHero\b/;
const bannedMarkup =
  /className=\{?[`'"][^`'"]*\b(ops-hero|sys-hero|upd-hero|sdu-hero|def-hero|lc-hero|fw-hero|rdy-hero|mail-hero)\b/;
const bannedJsx = /<\s*OpsHero\b/;

for (const file of files) {
  const base = file.split('/').pop();
  if (SKIP.has(base)) continue;
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  if (bannedImport.test(text) || bannedJsx.test(text)) {
    failures.push(`${rel}: OpsHero is banned — use FeaturePageLayout status=`);
  }
  if (bannedMarkup.test(text)) {
    failures.push(`${rel}: raw *-hero className banned — use FeaturePageLayout status=`);
  }

  // Must use FeaturePageLayout (wrappers already skipped)
  if (!text.includes('FeaturePageLayout')) {
    failures.push(`${rel}: missing FeaturePageLayout`);
    continue;
  }

  // Must pass status= (page-level KPIs live in header)
  if (!/\bstatus=\s*\{/.test(text)) {
    failures.push(`${rel}: FeaturePageLayout missing status= prop`);
  }
}

// Shared UI must not re-export OpsHero
const indexPath = join(root, 'src/shared/components/ui/index.ts');
const indexText = readFileSync(indexPath, 'utf8');
if (/\bOpsHero\b/.test(indexText)) {
  failures.push('src/shared/components/ui/index.ts: still exports OpsHero');
}

if (failures.length) {
  console.error('page-chrome-check FAILED:\n' + failures.map((f) => '  - ' + f).join('\n'));
  process.exit(1);
}

console.log(
  `page-chrome-check OK (${files.filter((f) => !SKIP.has(f.split('/').pop())).length} pages, OpsHero banned)`,
);
