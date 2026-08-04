#!/usr/bin/env node
/**
 * Full SSOT gate: no raw `command -v` outside software-probe module.
 * Shell fragments must use shellBinExists / shellRequireBin / shellEnsureAptPackage
 * from packages/core/src/hosting/software-probe/shell.ts
 *
 * Usage: node scripts/check-software-probe-ssot.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'packages/core/src');

const ALLOW_DIRS = [
  'hosting/software-probe/', // only place raw command -v is allowed
];

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(p, acc);
    } else if (
      (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.mjs')) &&
      !name.includes('.test.') &&
      !name.includes('.depth.test.')
    ) {
      acc.push(p);
    }
  }
  return acc;
}

const offenders = [];
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, '/');
  if (ALLOW_DIRS.some((a) => rel.startsWith(a))) continue;
  // comment-only in catalog
  if (rel === 'hosting/software-catalog.ts') continue;

  const src = readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (!line.includes('command -v')) return;
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;
    // Allow only when clearly using imported shell helpers (line already built via shell*)
    if (line.includes('shellBinExists') || line.includes('shellRequireBin') || line.includes('shellEnsureAptPackage') || line.includes('shellResolveBin') || line.includes('shellProbePathExport')) {
      // still may embed command -v inside helper call result — OK if only in template from helper
      if (line.includes('shellBinExists(') || line.includes('shellRequireBin(') || line.includes('shellEnsureAptPackage(') || line.includes('shellResolveBin(') || line.includes('shellProbePathExport(')) {
        return;
      }
    }
    // Disallow raw command -v
    offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
}

// Also scan apps/server (not tests)
const APPS = join(ROOT, 'apps/server/src');
try {
  for (const file of walk(APPS)) {
    const rel = 'apps/server/src/' + relative(APPS, file).replace(/\\/g, '/');
    const src = readFileSync(file, 'utf8');
    src.split('\n').forEach((line, i) => {
      if (!line.includes('command -v')) return;
      if (line.trim().startsWith('//')) return;
      if (line.includes('shellBinExists') || line.includes('binPresent') || line.includes('resolveBin')) return;
      offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
} catch {
  /* optional */
}

if (offenders.length) {
  console.error(`software-probe SSOT FAILED (${offenders.length} hits):\n` + offenders.join('\n'));
  process.exit(1);
}
console.log('software-probe SSOT: OK (no raw command -v outside software-probe/)');
