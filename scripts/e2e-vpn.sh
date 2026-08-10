#!/usr/bin/env bash
# VPN gate: unit tests + docs/API surface (no root required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[e2e-vpn] %s\n' "$*"; }
fail() { printf '[e2e-vpn] FAIL: %s\n' "$*" >&2; exit 1; }

log "Docs…"
test -f docs/features/vpn.md || fail "missing vpn.md"
test -f docs/features/vpn-ZH.md || fail "missing vpn-ZH.md"
grep -q 'WireGuard' docs/features/vpn.md || fail "EN missing WireGuard"
grep -q 'OpenVPN' docs/features/vpn.md || fail "EN missing OpenVPN"
grep -q 'Shadowsocks\|Outline' docs/features/vpn.md || fail "EN missing SS/Outline"
grep -q '伺服器' docs/features/vpn-ZH.md || fail "ZH missing 伺服器"
grep -q '客戶端' docs/features/vpn-ZH.md || fail "ZH missing 客戶端"

log "Source surface…"
test -f packages/core/src/hosting/vpn/service.ts || fail "service"
test -f packages/core/src/hosting/vpn/openvpn-ops.ts || fail "openvpn-ops"
test -f packages/core/src/hosting/vpn/outline-ops.ts || fail "outline-ops"
test -f apps/server/src/routes/vpn.ts || fail "routes"
test -f apps/web/src/pages/features/VpnPage.tsx || fail "VpnPage"
grep -q 'network.vpn' packages/shared/src/capabilities.ts || fail "cap network.vpn"
grep -q "path=\"vpn\"" apps/web/src/app/App.tsx || fail "route vpn"
grep -q "key: 'vpn'" apps/web/src/shared/nav/features.ts || fail "nav vpn"

log "Unit tests…"
pnpm --filter @ysk/core exec vitest run src/hosting/vpn

log "PASS e2e-vpn gate."
