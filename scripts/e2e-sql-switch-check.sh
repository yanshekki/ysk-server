#!/usr/bin/env bash
# SQL engine switch — code smoke (not full dual-engine host E2E with user DBs).
# Full data switch: docs/product/sql-switch-e2e-checklist.md
#
# Usage: bash scripts/e2e-sql-switch-check.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[e2e-sql-switch] %s\n' "$*"; }
fail() { printf '[e2e-sql-switch] FAIL: %s\n' "$*" >&2; exit 1; }

log "Build shared + core…"
pnpm --filter @ysk/shared build
pnpm --filter @ysk/core build

log "Unit tests: sql-engine-switch + mysql-frozen + health…"
pnpm --filter @ysk/core exec vitest run \
  src/hosting/sql-engine-switch/sql-engine-switch.test.ts \
  src/hosting/sql-engine-switch/mysql-frozen.test.ts \
  src/hosting/sql-engine-health \
  --reporter=dot

log "DTO fields for exclusive switch + health…"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const sw = readFileSync('packages/shared/src/software.ts', 'utf8');
if (!sw.includes('needs_exclusive_switch') || !sw.includes('switchTarget')) process.exit(1);
const db = readFileSync('packages/shared/src/databases.ts', 'utf8');
if (!db.includes('healthFindings') || !db.includes('datadirEmpty')) process.exit(1);
console.log('DTO OK');
"

test -f docs/product/sql-switch-e2e-checklist.md || fail "missing checklist"

log "PASS (unit + DTO + checklist). Full S6 with user DBs: run the checklist on a dual-capable host."
