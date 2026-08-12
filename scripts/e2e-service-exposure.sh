#!/usr/bin/env bash
# Smoke: service-exposure unit suite (model, sync, geo, ports adapters).
# Full host UFW e2e requires root + YSK_EXECUTE; this gate runs in CI/dev without root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "== service-exposure: build shared + core =="
pnpm --filter @yanshekki/shared build
pnpm --filter @yanshekki/core build

echo "== service-exposure: unit tests =="
pnpm --filter @yanshekki/core test -- src/hosting/service-exposure/
pnpm --filter @yanshekki/shared test -- src/service-exposure.test.ts

echo "== service-exposure: smoke OK =="
echo "Note: live UFW/ipset apply is covered by unit mocks; run on a root host with YSK_EXECUTE for full ops."
