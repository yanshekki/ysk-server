#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
log() { printf '[e2e-web] %s\n' "$*"; }
fail() { printf '[e2e-web] FAIL: %s\n' "$*" >&2; exit 1; }

log "Docs…"
test -f docs/features/nginx-sites.md || fail "nginx-sites.md"
test -f docs/features/apache.md || fail "apache.md"
test -f docs/features/apache-ZH.md || fail "apache-ZH.md"

log "Surface…"
test -f apps/web/src/pages/features/ApachePage.tsx || fail "ApachePage"
test -f packages/core/src/hosting/apache/service.ts || fail "apache service"
test -f packages/core/src/hosting/apache/artifacts.ts || fail "apache artifacts"
test -f packages/core/src/hosting/nginx-settings.ts || fail "nginx-settings"
grep -q 'path="apache"' apps/web/src/app/App.tsx || fail "route apache"
grep -q "key: 'apache'" apps/web/src/shared/nav/features.ts || fail "nav apache"
grep -q 'hosting/nginx/sites' apps/server/src/routes/hosting-infra-services.ts || fail "nginx sites api"
grep -q 'manageInNginx' packages/shared/locales/zh-HK/projects.json || fail "i18n manageInNginx"
grep -q 'cleanup-conflicts\|cleanupConflicts' apps/server/src/routes/apache.ts apps/web/src/features/apache/api.ts || fail "apache cleanup API"
grep -q 'removeArtifact\|removeApacheArtifact' packages/core/src/hosting/apache/artifacts.ts apps/web/src/pages/features/ApachePage.tsx || fail "apache remove residual"
grep -q 'Name conflict\|域名衝突\|conflict' docs/features/apache.md docs/features/apache-ZH.md || fail "docs conflict"
grep -q 'onlyBasenames\|skippedOrphans' packages/core/src/hosting/apache/sync.ts || fail "owned-only sync"

log "Unit…"
pnpm --filter ysk-server-core exec vitest run src/hosting/nginx-settings.test.ts src/hosting/nginx-sites-list.test.ts src/hosting/apache

log "PASS e2e-web-servers"
