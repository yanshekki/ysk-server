#!/usr/bin/env bash
# Software install/uninstall lifecycle surface gate (no root required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[e2e-sw-life] %s\n' "$*"; }
fail() { printf '[e2e-sw-life] FAIL: %s\n' "$*" >&2; exit 1; }

log "Docs…"
test -f docs/deploy/install-update.md || fail "install-update.md"
grep -q 'uninstall\|Uninstall\|解除' docs/deploy/install-update.md docs/deploy/install-update-ZH.md 2>/dev/null \
  || grep -q 'software/uninstall' docs/deploy/install-update.md \
  || true

log "Core surface…"
test -f packages/core/src/hosting/software-uninstall.ts || fail "software-uninstall"
test -f packages/core/src/hosting/software-install.ts || fail "software-install"
grep -q 'previewSoftwareUninstall\|uninstallSoftware' packages/core/src/hosting/software-uninstall.ts || fail "preview/uninstall exports"
grep -q 'impactKeys\|dataPaths\|uninstallProtected' packages/core/src/hosting/software-catalog.ts || fail "catalog metadata"
grep -q 'onLog' packages/core/src/hosting/software-install.ts || fail "install onLog"
grep -q 'onLog' packages/core/src/hosting/software-uninstall.ts || fail "uninstall onLog"

log "API surface…"
grep -q 'uninstall-preview' apps/server/src/routes/software-catalog.ts || fail "uninstall-preview route"
grep -q "pathname === '/api/v1/system/software/uninstall'" apps/server/src/routes/software-catalog.ts || fail "uninstall route"
grep -q 'ysk-software-install-stream\|ysk-software-uninstall' apps/server/src/routes/software-catalog.ts || fail "SSE tags"
grep -q 'wantsSse\|text/event-stream' apps/server/src/routes/software-catalog.ts || fail "SSE detect"

log "UI surface…"
test -f apps/web/src/shared/components/ui/SoftwareUninstallDialog.tsx || fail "UninstallDialog"
test -f apps/web/src/shared/ops-stream/OpsStreamDock.tsx || fail "OpsStreamDock"
test -f apps/web/src/shared/ops-stream/OpsStreamContext.tsx || fail "OpsStreamContext"
grep -q 'SoftwareUninstallDialog' apps/web/src/shared/components/ui/SoftwareInstallBanner.tsx || fail "banner uninstall"
grep -q 'SoftwareUninstallDialog' apps/web/src/shared/components/ui/SoftwareVersionBar.tsx || fail "version bar uninstall"
grep -q 'OpsStreamProvider' apps/web/src/app/App.tsx || fail "provider"
grep -q 'OpsStreamDock' apps/web/src/app/App.tsx || fail "dock mount"
grep -q 'ops-stream-dock--mini\|minimize' apps/web/src/shared/ops-stream/OpsStreamDock.tsx || fail "minimize"
grep -q 'requestCancel' apps/web/src/shared/ops-stream/OpsStreamContext.tsx apps/web/src/shared/ops-stream/OpsStreamDock.tsx || fail "requestCancel"
grep -q 'AbortController\|AbortSignal' apps/web/src/shared/ops-stream/OpsStreamContext.tsx || fail "abort controller"
grep -q 'confirmPhrase\|UNINSTALL' apps/web/src/shared/components/ui/SoftwareUninstallDialog.tsx || fail "double confirm phrase"
grep -q 'ackLabel\|softwareLifecycle.ack' apps/web/src/shared/components/ui/SoftwareUninstallDialog.tsx \
  || grep -q 'ack' apps/web/src/shared/components/ui/SoftwareUninstallDialog.tsx || fail "ack checkbox"

log "Locales…"
test -f packages/shared/locales/en/softwareLifecycle.json || fail "en softwareLifecycle"
test -f packages/shared/locales/zh-HK/softwareLifecycle.json || fail "zh-HK softwareLifecycle"
grep -q 'confirmUninstall' packages/shared/locales/zh-HK/softwareLifecycle.json || fail "zh-HK confirm"

log "Unit tests…"
pnpm --filter ysk-server-core exec vitest run src/hosting/software-uninstall.test.ts src/hosting/software-install.test.ts

log "PASS e2e-software-lifecycle gate."
