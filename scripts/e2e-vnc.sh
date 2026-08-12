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
grep -q 'Open in browser' docs/features/vnc.md || fail "EN missing Open in browser"
grep -q 'Linux 用戶' docs/features/vnc-ZH.md || fail "ZH missing Linux 用戶"
grep -q '在瀏覽器開啟' docs/features/vnc-ZH.md || fail "ZH missing 在瀏覽器開啟"
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
grep -q 'toggleRecording\|MediaRecorder' apps/web/src/features/vnc/VncViewer.tsx || fail "record UI"
grep -q 'takeScreenshot\|toDataURL' apps/web/src/features/vnc/VncViewer.tsx || fail "screenshot UI"
grep -q 'createShare\|shareLink' apps/web/src/pages/features/VncPage.tsx apps/web/src/features/vnc/VncViewer.tsx || fail "share UI"
grep -q 'vnc-session-tabs' apps/web/src/pages/features/VncPage.tsx || fail "multi-session tabs"
grep -q 'Open in browser' docs/features/vnc.md || fail "docs EN open in browser"
grep -q '在瀏覽器開啟' docs/features/vnc-ZH.md || fail "docs ZH open in browser"
grep -q '/vnc-share' docs/features/vnc.md || fail "docs share path"
grep -q 'Connect host' docs/features/vnc.md || fail "docs EN Connect host"
grep -q 'server_proxy' docs/features/vnc.md || fail "docs EN server_proxy"
grep -q '連線主機' docs/features/vnc-ZH.md || fail "docs ZH 連線主機"
grep -q '經伺服器代理' docs/features/vnc-ZH.md || fail "docs ZH server proxy path"
grep -q 'resolveClientRfbHost' packages/core/src/hosting/vnc/types.ts || fail "resolveClientRfbHost"
grep -q 'connectHost' packages/core/src/hosting/vnc/client-profiles.ts || fail "profiles connectHost"
grep -q 'connectHost' apps/server/src/routes/vnc.ts || fail "routes connectHost"
grep -q 'connectHost' apps/web/src/pages/features/VncPage.tsx || fail "UI connectHost"
grep -q 'updateClientProfile' apps/web/src/features/vnc/api.ts || fail "API updateClientProfile"
grep -q 'setClientEditId\|clientEditId' apps/web/src/pages/features/VncPage.tsx || fail "UI edit client"
grep -q 'probeRfbTcp\|rfb-probe' packages/core/src/hosting/vnc/service.ts packages/core/src/hosting/vnc/*.ts || fail "RFB probe surface"
test -f packages/core/src/hosting/vnc/browser-session.flow.test.ts || fail "flow test file"

log "Unit tests…"
pnpm --filter @yanshekki/core exec vitest run src/hosting/vnc

log "Locale CTA smoke (not still English on major keys)…"
node -e "
const fs=require('fs');
const en=JSON.parse(fs.readFileSync('packages/shared/locales/en/vnc.json','utf8'));
for (const loc of fs.readdirSync('packages/shared/locales')) {
  const p='packages/shared/locales/'+loc+'/vnc.json';
  if (!fs.existsSync(p) || loc==='en') continue;
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  if (j.openInBrowser === en.openInBrowser) {
    console.error('FAIL still EN openInBrowser', loc);
    process.exit(1);
  }
}
console.log('locale CTAs localized');
"

log "PASS e2e-vnc gate."
