#!/usr/bin/env bash
# VNC gate: unit tests + docs/API surface (no root required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[e2e-vnc] %s\n' "$*"; }
fail() { printf '[e2e-vnc] FAIL: %s\n' "$*" >&2; exit 1; }

log "Docs…"
test -f docs/features/vnc.md || fail "missing vnc.md"
test -f docs/features/vnc-ZH.md || fail "missing vnc-ZH.md"
grep -q 'TigerVNC' docs/features/vnc.md || fail "EN missing TigerVNC"
grep -q 'noVNC' docs/features/vnc.md || fail "EN missing noVNC"
grep -q 'yskvnc_' docs/features/vnc.md || fail "EN missing linux user prefix"
grep -q 'Linux 用戶' docs/features/vnc-ZH.md || fail "ZH missing Linux 用戶"
grep -q '經 server' docs/features/vnc-ZH.md || fail "ZH missing 經 server"
grep -q '客戶端' docs/features/vnc-ZH.md || fail "ZH missing 客戶端"

log "Source surface…"
test -f packages/core/src/hosting/vnc/service.ts || fail "service"
test -f packages/core/src/hosting/vnc/linux-user.ts || fail "linux-user"
test -f packages/core/src/hosting/vnc/novnc.ts || fail "novnc"
test -f packages/core/src/hosting/vnc/client-profiles.ts || fail "client-profiles"
test -f packages/core/src/hosting/vnc/session-ticket.ts || fail "session-ticket"
test -f packages/core/src/hosting/vnc/share-links.ts || fail "share-links"
test -f apps/server/src/routes/vnc.ts || fail "routes"
test -f apps/server/src/vnc/ws-handler.ts || fail "vnc ws-handler"
test -f apps/web/src/pages/features/VncPage.tsx || fail "VncPage"
test -f apps/web/src/features/vnc/VncViewer.tsx || fail "VncViewer"
test -f apps/web/src/pages/features/VncSharePage.tsx || fail "VncSharePage"
grep -q 'network.vnc' packages/shared/src/capabilities.ts || fail "cap network.vnc"
grep -q 'path="vnc"' apps/web/src/app/App.tsx || fail "route vnc"
grep -q 'vnc-share' apps/web/src/app/App.tsx || fail "route vnc-share"
grep -q "key: 'vnc'" apps/web/src/shared/nav/features.ts || fail "nav vnc"
grep -q "id: 'tigervnc'" packages/core/src/hosting/software-catalog.ts || fail "catalog tigervnc"
grep -q '/api/v1/vnc/sessions' apps/server/src/routes/vnc.ts || fail "sessions API"
grep -q '/api/v1/vnc/share' apps/server/src/routes/vnc.ts || fail "share API"
grep -q 'prepareBrowserSession' packages/core/src/hosting/vnc/service.ts || fail "prepareBrowserSession"
grep -q 'createVncShareLink' packages/core/src/hosting/vnc/share-links.ts || fail "createVncShareLink"
grep -q 'clipboardPasteFrom' apps/web/src/features/vnc/VncViewer.tsx || fail "clipboard UI"
grep -q 'openInBrowser' apps/web/src/pages/features/VncPage.tsx || fail "openInBrowser CTA"

log "Unit tests…"
pnpm --filter @ysk/core exec vitest run src/hosting/vnc

log "PASS e2e-vnc gate."
