#!/usr/bin/env bash
# Smoke: service-exposure unit suite (model, sync, geo, ports adapters).
# Full host UFW e2e requires root + YSK_EXECUTE; this gate runs in CI/dev without root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== service-exposure: build shared + core =="
pnpm --filter @ysk-server/shared build
pnpm --filter @ysk-server/core build

echo "== service-exposure: unit tests =="
pnpm --filter @ysk-server/core test -- src/hosting/service-exposure/
pnpm --filter @ysk-server/shared test -- src/service-exposure.test.ts

echo "== service-exposure: smoke OK =="
echo "Note: live UFW/ipset apply is covered by unit mocks; run on a root host with YSK_EXECUTE for full ops."
