#!/usr/bin/env bash
# Validate a validator-shaped compose file against a real docker compose.
# Does not pull chain images. Skips without a daemon unless YSK_E2E_REQUIRE_DOCKER=1.
# Compose YAML is passed on stdin so a VM/rootless daemon need not see host /tmp.
set -euo pipefail

log() { printf '[e2e-val-docker] %s\n' "$*"; }
fail() { printf '[e2e-val-docker] FAIL: %s\n' "$*" >&2; exit 1; }

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  if [ "${YSK_E2E_REQUIRE_DOCKER:-}" = 1 ]; then
    fail "docker compose required"
  fi
  log "SKIPPED: docker compose not available"
  exit 0
fi

GOOD=$(cat <<'YAML'
services:
  el:
    image: alpine:3.20
    command: ["sleep", "2"]
    labels:
      com.ysk-server.managed: "true"
      com.ysk-server.feature: validators
      com.ysk-server.instance: eth-hoodi-e2e
  cl:
    image: alpine:3.20
    command: ["sleep", "2"]
    depends_on: [el]
YAML
)

BAD=$(cat <<'YAML'
services:
  el:
    image: alpine:3.20
    command: ["false"]
YAML
)

cleanup() {
  printf '%s\n' "$GOOD" | docker compose -f - -p yskval-eth-hoodi-e2e down >/dev/null 2>&1 || true
  printf '%s\n' "$BAD" | docker compose -f - -p ysk-e2e-rollback down >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf '%s\n' "$GOOD" | docker compose -f - -p yskval-eth-hoodi-e2e config >/dev/null
log "compose config OK"

if printf '%s\n' "$BAD" | docker compose -f - -p ysk-e2e-rollback up -d >/dev/null 2>&1; then
  sleep 1
  printf '%s\n' "$GOOD" | docker compose -f - -p ysk-e2e-rollback up -d >/dev/null
  printf '%s\n' "$GOOD" | docker compose -f - -p ysk-e2e-rollback down >/dev/null
fi
log "OK"
