#!/usr/bin/env bash
# Updates gate: summary/scan APIs + software hub redirect + unit tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[e2e-updates] %s\n' "$*"; }
fail() { printf '[e2e-updates] FAIL: %s\n' "$*" >&2; exit 1; }

log "Docs…"
test -f docs/deploy/install-update.md || fail "install-update.md"
test -f docs/deploy/install-update-ZH.md || fail "install-update-ZH.md"
grep -q 'updates.scan\|/updates/summary\|Software hub' docs/deploy/install-update.md || fail "EN missing scan/summary"
grep -q 'updates.scan\|更新' docs/deploy/install-update-ZH.md || fail "ZH missing scan"

log "Surface…"
test -f packages/core/src/update/summary.ts || fail "summary module"
test -f apps/web/src/pages/UpdatesPage.tsx || fail "UpdatesPage"
test -f apps/web/src/shared/hooks/useUpdatesNavBadge.ts || fail "nav badge hook"
grep -q "path=\"updates\"" apps/web/src/app/App.tsx || fail "route updates"
grep -q "key: 'updates'" apps/web/src/shared/nav/features.ts || fail "nav updates"
grep -q 'to === .*/software' apps/web/src/shared/nav/features.ts && fail "software hub still in nav" || true
grep -q 'Navigate to="/updates"' apps/web/src/app/App.tsx apps/web/src/pages/features/SoftwareHubPage.tsx || fail "software→updates redirect"
grep -q '/api/v1/updates/summary' apps/server/src/routes/updates-inventory.ts || fail "summary route"
grep -q 'scan-settings' apps/server/src/routes/updates-inventory.ts || fail "scan-settings route"
grep -q "updates.scan" apps/server/src/app-context.ts || fail "updates.scan job"
grep -q 'tabOverview\|scanNow' packages/shared/locales/en/updates.json || fail "overview i18n"
grep -q 'useUpdatesNavBadge' apps/web/src/app/layout/AppShell.tsx || fail "shell badge"

log "Unit tests…"
pnpm --filter @ysk-server/core exec vitest run src/update/summary.test.ts
pnpm --filter @ysk-server/web exec vitest run src/shared/hooks/useUpdatesNavBadge.test.ts src/shared/nav/features.test.ts 2>/dev/null \
  || pnpm --filter web exec vitest run src/shared/hooks/useUpdatesNavBadge.test.ts src/shared/nav/features.test.ts 2>/dev/null \
  || (cd apps/web && pnpm exec vitest run src/shared/hooks/useUpdatesNavBadge.test.ts src/shared/nav/features.test.ts)

log "PASS e2e-updates gate."
