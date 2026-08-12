#!/usr/bin/env node
/**
 * Aggregate package coverage-summary.json files into one report.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const packages = [
  ['@ysk-server/shared', 'packages/shared/coverage/coverage-summary.json'],
  ['@ysk-server/core', 'packages/core/coverage/coverage-summary.json'],
  ['ysk-server', 'apps/server/coverage/coverage-summary.json'],
  ['@ysk-server/web', 'apps/web/coverage/coverage-summary.json'],
];

const rows = [];
for (const [name, rel] of packages) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    rows.push({ name, missing: true });
    continue;
  }
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const t = j.total ?? {};
  rows.push({
    name,
    lines: t.lines?.pct ?? null,
    statements: t.statements?.pct ?? null,
    functions: t.functions?.pct ?? null,
    branches: t.branches?.pct ?? null,
  });
}

console.log('coverage-aggregate');
console.log('| Package | Lines | Stmts | Funcs | Branches |');
console.log('|---------|------:|------:|------:|---------:|');
for (const r of rows) {
  if (r.missing) {
    console.log(`| ${r.name} | — | — | — | — |`);
    continue;
  }
  console.log(
    `| ${r.name} | ${r.lines?.toFixed?.(1) ?? r.lines} | ${r.statements?.toFixed?.(1) ?? r.statements} | ${r.functions?.toFixed?.(1) ?? r.functions} | ${r.branches?.toFixed?.(1) ?? r.branches} |`,
  );
}

const outDir = join(root, 'coverage');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'aggregate.json'), JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2));
console.log(`wrote coverage/aggregate.json`);
