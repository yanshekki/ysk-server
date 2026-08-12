#!/usr/bin/env bash
# Host Browse gate: unit suite + docs surface checks (no live Chrome required).
# Usage: bash scripts/e2e-host-browse.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[e2e-host-browse] %s\n' "$*"; }
fail() { printf '[e2e-host-browse] FAIL: %s\n' "$*" >&2; exit 1; }

log "Docs present…"
test -f docs/features/host-browse.md || fail "missing host-browse.md"
test -f docs/features/host-browse-ZH.md || fail "missing host-browse-ZH.md"

log "Docs sections…"
for needle in \
  'Audio bridge' \
  '/sessions/:id/tabs' \
  'tab_open' \
  'lastSnapshot' \
  'YSK_HOST_BROWSE_AUDIO' \
  'captureStream'
do
  grep -q "$needle" docs/features/host-browse.md || fail "EN doc missing: $needle"
done
for needle in \
  '音訊橋接' \
  '/sessions/:id/tabs' \
  'lastSnapshot' \
  'captureStream' \
  'YSK_HOST_BROWSE_AUDIO'
do
  grep -q "$needle" docs/features/host-browse-ZH.md || fail "ZH doc missing: $needle"
done

log "Core modules present…"
for f in \
  packages/core/src/host-browse/audio-bridge.ts \
  packages/core/src/host-browse/downloads.ts \
  packages/core/src/host-browse/chrome-as-user.ts \
  packages/core/src/host-browse/browser-engine.ts \
  packages/core/src/host-browse/service.ts \
  apps/web/src/features/host-browse/pcm-player.ts \
  apps/server/src/host-browse/ws-handler.ts
do
  test -f "$f" || fail "missing $f"
done

log "API route surface in source…"
grep -q "rest === '/tabs'" apps/server/src/routes/host-browse.ts \
  || fail "tabs route missing"
grep -q 'startAudioBridge' apps/server/src/host-browse/ws-handler.ts \
  || fail "WS audio bridge missing"
grep -q 'openTab' packages/core/src/host-browse/service.ts \
  || fail "service openTab missing"

log "Running host-browse unit tests…"
pnpm --filter @yanshekki/core exec vitest run src/host-browse

log "PASS host-browse e2e gate (unit + docs + surface)."
log "Optional live Chrome: open /browse with engine=browser and panel audioBridge."
