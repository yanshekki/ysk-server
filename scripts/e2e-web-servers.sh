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
test -f packages/core/src/hosting/nginx-settings.ts || fail "nginx-settings"
grep -q 'path="apache"' apps/web/src/app/App.tsx || fail "route apache"
grep -q "key: 'apache'" apps/web/src/shared/nav/features.ts || fail "nav apache"
grep -q 'hosting/nginx/sites' apps/server/src/routes/hosting-infra-services.ts || fail "nginx sites api"
grep -q 'manageInNginx' packages/shared/locales/zh-HK/projects.json || fail "i18n manageInNginx"

log "Unit…"
pnpm --filter @ysk/core exec vitest run src/hosting/nginx-settings.test.ts src/hosting/nginx-sites-list.test.ts src/hosting/apache

log "PASS e2e-web-servers"
