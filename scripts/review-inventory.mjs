#!/usr/bin/env node
/**
 * Wave-2 review inventory (read-only report).
 * Usage: node scripts/review-inventory.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');

function walk(dir, pred, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, acc);
    else if (pred(p)) acc.push(p);
  }
  return acc;
}

function lines(p) {
  try {
    return readFileSync(p, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

function countExportTypes(p) {
  const t = readFileSync(p, 'utf8');
  return (t.match(/^export (type|interface) /gm) || []).length;
}

const report = [];
const push = (s) => report.push(s);

push('# Wave-2 review inventory');
push(`Generated: ${new Date().toISOString()}`);
push('');

// God files
push('## Large files (LOC)');
const large = [
  'apps/server/src/http-server.ts',
  'apps/server/src/controllers/system-controller.ts',
  'apps/web/src/pages/features/ProtectionPage.tsx',
  'apps/web/src/pages/features/LogsPage.tsx',
  'apps/web/src/pages/features/CdnPage.tsx',
  'apps/web/src/pages/FilesPage.tsx',
  'apps/web/src/pages/EmailDomainPage.tsx',
  'apps/web/src/styles/components.css',
  'packages/shared/src/dto.ts',
  'packages/shared/src/ops.ts',
].map((rel) => ({ rel, n: lines(join(root, rel)) }));
for (const { rel, n } of large.sort((a, b) => b.n - a.n)) {
  push(`- ${n}\t${rel}`);
}
push('');

// Web feature API types
push('## apps/web feature api.ts type exports');
const apis = walk(join(root, 'apps/web/src/features'), (p) => p.endsWith('/api.ts'));
for (const p of apis
  .map((p) => ({ p: relative(root, p), n: countExportTypes(p) }))
  .sort((a, b) => b.n - a.n)) {
  push(`- ${p.n}\t${p.p}`);
}
push('');

// Shared exports
push('## @yanshekki/shared type|interface exports');
const shared = walk(join(root, 'packages/shared/src'), (p) => p.endsWith('.ts') && !p.includes('.test.'));
let sharedN = 0;
for (const p of shared) {
  const n = countExportTypes(p);
  sharedN += n;
  if (n) push(`- ${n}\t${relative(root, p)}`);
}
push(`- total\t${sharedN}`);
push('');

// Dead / deprecated UI — Wave2 R5 removed ExecutionResultPanel, KeyValueList,
// ResourceTable, CapabilityBanner, SettingField. Scan residual orphans.
push('## Unused UI export scan (filename matches outside definition)');
const uiDir = join(root, 'apps/web/src/shared/components/ui');
for (const p of walk(uiDir, (f) => f.endsWith('.tsx'))) {
  const base = p.split('/').pop().replace(/\.tsx$/, '');
  if (base === 'index') continue;
  const hits = walk(join(root, 'apps/web/src'), (f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .filter((f) => f !== p)
    .filter((f) => {
      const t = readFileSync(f, 'utf8');
      return new RegExp(`\\b${base}\\b`).test(t);
    });
  if (hits.length === 0) {
    push(`- ORPHAN?\t${relative(root, p)}`);
  }
}
push('');

// Dual security routes
push('## Firewall / fail2ban link sites');
const linkHits = [];
for (const p of walk(join(root, 'apps/web/src'), (p) => p.endsWith('.tsx') || p.endsWith('.ts'))) {
  const t = readFileSync(p, 'utf8');
  if (/to=["']\/(firewall|fail2ban)/.test(t) || /['"]\/(firewall|fail2ban)/.test(t)) {
    linkHits.push(relative(root, p));
  }
}
for (const h of [...new Set(linkHits)].sort()) push(`- ${h}`);
push('');

// Scaffold dirs that should stay filled (Wave2 R7: empty shells removed)
push('## Scaffold dirs (expect filled or absent)');
for (const d of ['apps/server/src/routes', 'apps/web/src/styles/components']) {
  const abs = join(root, d);
  const files = walk(abs, () => true);
  push(`- ${d}: ${existsSync(abs) ? files.length + ' files' : 'MISSING'}`);
}
push('');

// CDN honesty notes
push('## CDN / honesty keywords in core');
const coreHosting = join(root, 'packages/core/src/hosting');
for (const p of walk(coreHosting, (p) => p.endsWith('.ts') && !p.includes('.test.'))) {
  const t = readFileSync(p, 'utf8');
  if (/尚未實作|not implemented|fleet dispatch|placeholder written|CHANGE_ME/.test(t)) {
    const linesArr = t.split('\n');
    linesArr.forEach((line, i) => {
      if (/尚未實作|not implemented|fleet dispatch|placeholder written|CHANGE_ME/.test(line)) {
        push(`- ${relative(root, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

console.log(report.join('\n'));
