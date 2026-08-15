#!/usr/bin/env bash
# Live Docker engine smoke: status → run alpine → logs → stop → rm.
# Skips when the daemon is missing unless YSK_E2E_REQUIRE_DOCKER=1.
set -euo pipefail

log() { printf '[e2e-docker] %s\n' "$*"; }
fail() { printf '[e2e-docker] FAIL: %s\n' "$*" >&2; exit 1; }

if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  if [ "${YSK_E2E_REQUIRE_DOCKER:-}" = 1 ]; then
    fail "docker daemon required"
  fi
  log "SKIPPED: docker daemon not available"
  exit 0
fi

NAME="ysk-e2e-dock-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT

log "Run alpine:3.20…"
docker run -d --name "$NAME" --label com.ysk-server.managed=true alpine:3.20 sleep 30 >/dev/null
docker logs --tail 5 "$NAME" >/dev/null
docker stop "$NAME" >/dev/null
docker rm "$NAME" >/dev/null
trap - EXIT
log "OK"
