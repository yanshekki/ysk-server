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
grep -q 'Access mode\|access mode' docs/features/vpn.md || fail "EN missing access mode"
grep -q 'Full-tunnel protect\|full-tunnel protect' docs/features/vpn.md || fail "EN missing client protect"
grep -q 'MASQUERADE\|NAT' docs/features/vpn.md || fail "EN missing NAT"
grep -q '伺服器' docs/features/vpn-ZH.md || fail "ZH missing 伺服器"
grep -q '客戶端' docs/features/vpn-ZH.md || fail "ZH missing 客戶端"
grep -q '連線模式\|全隧道' docs/features/vpn-ZH.md || fail "ZH missing access/protect"

log "Source surface…"
test -f packages/core/src/hosting/vpn/service.ts || fail "service"
test -f packages/core/src/hosting/vpn/openvpn-ops.ts || fail "openvpn-ops"
test -f packages/core/src/hosting/vpn/outline-ops.ts || fail "outline-ops"
test -f packages/core/src/hosting/vpn/access-mode.ts || fail "access-mode"
test -f packages/core/src/hosting/vpn/client-conf-protect.ts || fail "client-conf-protect"
test -f packages/core/src/hosting/vpn/endpoint.ts || fail "endpoint"
test -f apps/server/src/routes/vpn.ts || fail "routes"
test -f apps/web/src/pages/features/VpnPage.tsx || fail "VpnPage"
grep -q 'network.vpn' packages/shared/src/capabilities.ts || fail "cap network.vpn"
grep -q "path=\"vpn\"" apps/web/src/app/App.tsx || fail "route vpn"
grep -q "key: 'vpn'" apps/web/src/shared/nav/features.ts || fail "nav vpn"
grep -q 'needsInternetNat\|parseAccessMode' packages/core/src/hosting/vpn/access-mode.ts || fail "access mode helpers"
grep -q 'isFullTunnelAllowedIps\|buildVpnClientProtectScript' packages/core/src/hosting/vpn/client-conf-protect.ts || fail "protect helpers"
grep -q 'redirect-gateway\|AllowedIPs' packages/core/src/hosting/vpn/access-mode.ts || fail "full tunnel push"
grep -q 'accessMode\|access_mode' apps/web/src/pages/features/VpnPage.tsx apps/server/src/routes/vpn.ts || fail "UI/API accessMode"

log "Unit tests…"
pnpm --filter ysk-server-core exec vitest run src/hosting/vpn

log "PASS e2e-vpn gate."
