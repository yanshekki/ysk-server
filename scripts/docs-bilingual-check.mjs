#!/usr/bin/env node
/**
 * Verify formal docs EN/ZH pairs are structurally parallel.
 * Checks: heading counts by level, fenced code block counts, table row counts.
 * Skips docs/_archive.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = join(root, 'docs');

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '_archive') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.md') && !name.endsWith('-ZH.md')) acc.push(p);
  }
  return acc;
}

function zhPathFor(enPath) {
  const base = enPath.split('/').pop();
  const dir = dirname(enPath);
  if (base === 'INDEX.md') return join(dir, 'INDEX-ZH.md');
  if (base === 'AI-Secure-Linux-Server-Manager-Spec.md') {
    return join(dir, 'AI-Secure-Linux-Server-Manager-Spec-ZH.md');
  }
  return join(dir, base.replace(/\.md$/, '-ZH.md'));
}

function stats(text) {
  const lines = text.split('\n');
  const heads = { h1: 0, h2: 0, h3: 0, h4: 0 };
  let fences = 0;
  let tableRows = 0;
  let inFence = false;
  for (const line of lines) {
    // Fence toggles first so shell comments (`# …`) inside code are not headings
    if (/^```/.test(line)) {
      fences++;
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (/^# /.test(line)) heads.h1++;
    else if (/^## /.test(line)) heads.h2++;
    else if (/^### /.test(line)) heads.h3++;
    else if (/^#### /.test(line)) heads.h4++;
    if (/^\|/.test(line) && !/^\|\s*:?-+:?\s*\|/.test(line)) tableRows++;
  }
  return {
    heads,
    codeBlocks: Math.floor(fences / 2),
    tableRows,
    lines: lines.length,
  };
}

function cjkRatio(text) {
  const sample = text.slice(0, 3000);
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const lat = (sample.match(/[A-Za-z]/g) || []).length;
  if (cjk + lat === 0) return 0;
  return cjk / (cjk + lat);
}

/**
 * Historical / draft / deep-dive notes outside the product handbook programme
 * (features + cli + user-manual + INDEX + docs-standard/inventory).
 * Still versioned; just not gated by structural bilingual CI.
 */
function shouldSkip(rel) {
  const n = rel.replace(/\\/g, '/');
  if (n.includes('/features/_TEMPLATE')) return true;
  if (n.includes('/_archive/')) return true;
  if (n.includes('/security/phase-')) return true;
  if (n.includes('/security/install-audit')) return true;
  if (n.includes('/architecture/') && (n.includes('-drain') || n.includes('phase-a') || n.includes('secondary-dev') || n.includes('software-probe'))) {
    return true;
  }
  if (n.startsWith('docs/product/')) return true;
  if (n === 'docs/product-gap-backlog.md' || n === 'docs/product-remaining-plan.md') return true;
  if (n === 'docs/runtime-addons.md') return true;
  // Large install/uninstall guides need a dedicated bilingual pass (not D0–D5 handbook)
  if (n.includes('/getting-started/install') || n.includes('/getting-started/uninstall')) return true;
  return false;
}

const enFiles = [
  join(root, 'README.md'),
  ...walk(docsRoot),
].filter((p) => !shouldSkip(relative(root, p)));

const failures = [];
let pairs = 0;
let skipped = 0;

for (const enPath of enFiles) {
  const rel = relative(root, enPath);
  if (shouldSkip(rel)) {
    skipped++;
    continue;
  }
  const zh = zhPathFor(enPath);
  if (!existsSync(zh)) {
    failures.push({ rel, issue: 'missing ZH sibling' });
    continue;
  }
  pairs++;
  const enText = readFileSync(enPath, 'utf8');
  const zhText = readFileSync(zh, 'utf8');
  const enS = stats(enText);
  const zhS = stats(zhText);
  const issues = [];

  for (const k of ['h1', 'h2', 'h3', 'h4']) {
    if (enS.heads[k] !== zhS.heads[k]) {
      issues.push(`heading ${k}: en=${enS.heads[k]} zh=${zhS.heads[k]}`);
    }
  }
  if (enS.codeBlocks !== zhS.codeBlocks) {
    issues.push(`code blocks: en=${enS.codeBlocks} zh=${zhS.codeBlocks}`);
  }
  // allow small table drift of 1 (language switcher only) — still flag ≥3
  if (Math.abs(enS.tableRows - zhS.tableRows) >= 3) {
    issues.push(`table rows: en=${enS.tableRows} zh=${zhS.tableRows}`);
  }
  // line count ratio
  const ratio = zhS.lines / Math.max(enS.lines, 1);
  if (ratio < 0.7 || ratio > 1.45) {
    issues.push(`line ratio zh/en=${ratio.toFixed(2)} (en=${enS.lines} zh=${zhS.lines})`);
  }
  // EN should not be CJK-heavy (narrative)
  const enCjk = cjkRatio(enText);
  if (enCjk > 0.35 && enS.lines > 40) {
    issues.push(`EN file looks Chinese-heavy (cjkRatio=${enCjk.toFixed(2)})`);
  }
  // ZH should have CJK (CLI refs are command-heavy — lower floor)
  const zhCjk = cjkRatio(zhText);
  const zhFloor = rel.includes('/cli/') || rel.includes('commands') ? 0.04 : 0.08;
  if (zhCjk < zhFloor && zhS.lines > 30) {
    issues.push(`ZH file looks English-only (cjkRatio=${zhCjk.toFixed(2)})`);
  }

  if (issues.length) {
    failures.push({ rel, zh: relative(root, zh), issues });
  }
}

console.log('docs-bilingual-check');
console.log(`  pairs: ${pairs}`);
console.log(`  skipped: ${skipped} (phase/drain/draft)`);
console.log(`  failures: ${failures.length}`);
if (failures.length) {
  for (const f of failures.slice(0, 40)) {
    console.error(`  FAIL ${f.rel}`);
    if (f.issue) console.error(`    ${f.issue}`);
    for (const i of f.issues || []) console.error(`    - ${i}`);
  }
  if (failures.length > 40) console.error(`  … +${failures.length - 40} more`);
  process.exit(1);
}
console.log('OK: all formal pairs structurally parallel');
