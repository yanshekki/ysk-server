#!/usr/bin/env bash
# SQL engine switch — code smoke (not full dual-engine host E2E with user DBs).
# Full data switch: docs/product/sql-switch-e2e-checklist.md
#
# Usage: bash scripts/e2e-sql-switch-check.sh
# Exit 0 = unit + DTO + module surface + checklist present.
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

log "Core module surface (preview / health / frozen)…"
node --input-type=module -e "
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// Prefer built dist if present
let core;
try {
  core = await import('./packages/core/dist/index.js');
} catch {
  try {
    core = await import('./packages/core/src/index.ts');
  } catch (e) {
    console.error('cannot import core', e);
    process.exit(1);
  }
}
const need = [
  'previewSqlEngineSwitch',
  'switchSqlEngine',
  'diagnoseSqlEngine',
  'executeSqlEngineRepair',
  'planRepairFromFindings',
  'readMysqlFrozen',
  'clearMysqlFrozen',
  'recoverMysqlAfterEngineSwitch',
  'unfreezeMysqlEngine',
];
const missing = need.filter((n) => typeof core[n] !== 'function');
if (missing.length) {
  console.error('missing exports:', missing.join(', '));
  process.exit(1);
}
const plan = core.planRepairFromFindings([
  { id: 'frozen_marker', severity: 'error', messageKey: 'x' },
  { id: 'unit_failed', severity: 'error', messageKey: 'y' },
]);
const ids = plan.map((a) => a.id);
if (!ids.includes('clear_frozen') || !ids.includes('start_unit') || ids[0] !== 'stop_unit') {
  console.error('plan shape unexpected', ids);
  process.exit(1);
}
console.log('module surface OK; plan sample:', ids.join(' → '));
"

test -f docs/product/sql-switch-e2e-checklist.md || fail "missing checklist"
grep -q '通過標準' docs/product/sql-switch-e2e-checklist.md || fail "checklist missing pass criteria"
grep -q 'FROZEN\|凍結' docs/product/sql-switch-e2e-checklist.md || fail "checklist missing FROZEN path"
grep -q '反向' docs/product/sql-switch-e2e-checklist.md || fail "checklist missing reverse switch"

# Optional host probe (informational — does not fail when dual engines absent)
if command -v systemctl >/dev/null 2>&1; then
  log "Host unit snapshot (informational)…"
  # systemctl is-active returns non-zero for inactive/failed — do not fall through to "unknown"
  mysql_a=$(systemctl is-active mysql 2>/dev/null || true)
  maria_a=$(systemctl is-active mariadb 2>/dev/null || true)
  mysql_a=${mysql_a:-unknown}
  maria_a=${maria_a:-unknown}
  log "  mysql=${mysql_a}  mariadb=${maria_a}"
  if [[ "$mysql_a" == active && "$maria_a" == active ]]; then
    log "WARN: both units active — exclusive invariant may be broken on this host"
  fi
fi

log "PASS (unit + DTO + surface + checklist). Full S6 with user DBs: docs/product/sql-switch-e2e-checklist.md"
