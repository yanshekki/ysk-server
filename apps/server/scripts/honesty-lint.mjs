#!/usr/bin/env node
/**
 * Honesty lint — fail on dishonest HTTP response patterns in apps/server.
 *
 * Flags:
 * 1. sendJson with ok ternary that ignores blocked (prefer sendOpsResult)
 * 2. ok: true near blocked: true in same object literal (rough)
 *
 * Exit 1 on findings.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const scanRoot = join(root, 'src');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

const files = walk(scanRoot);
const findings = [];

// Prefer sendOpsResult for classic ops status selection
const badTernary =
  /sendJson\(\s*res\s*,\s*\w+\.ok\s*\?\s*200\s*:\s*422\s*,\s*\w+\s*\)/g;
const badBlocked422 =
  /sendJson\(\s*res\s*,\s*\w+\.ok\s*\?\s*200\s*:\s*\w+\.blocked\s*\?\s*422/g;
// Also catch 200 : 4xx with blocked ignored (common residual pattern)
const badOk4xx =
  /sendJson\(\s*res\s*,\s*\w+\.ok\s*\?\s*200\s*:\s*(400|401|403|500|502)\s*,/g;

for (const file of files) {
  if (file.includes('/http/util.ts')) continue;
  if (file.endsWith('.test.ts') || file.endsWith('.spec.ts')) continue;
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  for (const m of text.matchAll(badTernary)) {
    const line = text.slice(0, m.index).split('\n').length;
    findings.push(`${rel}:${line}: use sendOpsResult instead of sendJson(ok?200:422)`);
  }
  for (const m of text.matchAll(badBlocked422)) {
    const line = text.slice(0, m.index).split('\n').length;
    findings.push(`${rel}:${line}: blocked mapped to 422 — use sendOpsResult (403)`);
  }
  // Soft report (do not fail CI yet): residual ok?200:4xx/5xx — migrate to sendOpsResult
  for (const m of text.matchAll(badOk4xx)) {
    const line = text.slice(0, m.index).split('\n').length;
    if (m[0].includes(': 404')) continue;
    // collect as soft only after hard findings; print at end
    findings.push(
      `SOFT ${rel}:${line}: prefer sendOpsResult for ops-shaped results (ok?200:${m[1]})`,
    );
  }
  // Rough: ok: true and blocked: true within 120 chars (production sources only)
  const dish = /ok:\s*true[\s\S]{0,120}blocked:\s*true|blocked:\s*true[\s\S]{0,120}ok:\s*true/g;
  for (const m of text.matchAll(dish)) {
    const snip = m[0];
    if (snip.includes('誠實') || snip.includes('assertHonest')) continue;
    const line = text.slice(0, m.index).split('\n').length;
    // skip if line is clearly a comment
    const lineText = text.split('\n')[line - 1] ?? '';
    if (lineText.trimStart().startsWith('//') || lineText.trimStart().startsWith('*')) continue;
    findings.push(`${rel}:${line}: possible ok:true + blocked:true in source`);
  }
}

const hard = findings.filter((f) => !f.startsWith('SOFT '));
const soft = findings.filter((f) => f.startsWith('SOFT '));
if (soft.length) {
  console.warn(
    `honesty-lint soft (${soft.length}):\n` + soft.map((f) => `  ${f}`).join('\n'),
  );
}
if (hard.length) {
  console.error('honesty-lint FAILED:\n' + hard.map((f) => `  ${f}`).join('\n'));
  process.exit(1);
}
console.log(
  `honesty-lint OK (${files.length} files, ${hard.length} hard, ${soft.length} soft)`,
);
