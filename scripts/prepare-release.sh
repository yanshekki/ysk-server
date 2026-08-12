#!/usr/bin/env bash
# Build, test, pack ysk-server for release review / npm publish.
# Usage:
#   bash scripts/prepare-release.sh
#   bash scripts/publish-ysk-server-npm.sh --publish   # real npm publish (requires login)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PUBLISH=0
[[ "${1:-}" == "--publish" ]] && PUBLISH=1

log() { printf '[prepare-release] %s\n' "$*"; }

log "pnpm install (frozen if lock present)…"
pnpm install --frozen-lockfile 2>/dev/null || pnpm install

log "honesty + UI gates…"
pnpm gates

log "typecheck…"
pnpm typecheck

log "build…"
pnpm build

log "embed web UI into server public/web for pack…"
mkdir -p apps/server/public/web
if [[ -f apps/web/dist/index.html ]]; then
  rm -rf apps/server/public/web/*
  cp -a apps/web/dist/. apps/server/public/web/
  log "web UI embedded ($(du -sh apps/server/public/web | awk '{print $1}'))"
else
  log "WARNING: apps/web/dist missing — pack will be API-only"
fi

log "test…"
pnpm test

log "e2e real-ops…"
pnpm e2e:real-ops

log "pack ysk-server…"
pnpm --filter ysk-server pack
PACK=$(ls -t apps/server/ysk-server-*.tgz 2>/dev/null | head -1 || ls -t ysk-server-*.tgz 2>/dev/null | head -1 || true)
if [[ -n "${PACK:-}" ]]; then
  log "pack artifact: $PACK"
  tar -tzf "$PACK" | head -40
else
  log "pack file location may be cwd — check *.tgz"
  ls -la ./*.tgz apps/server/*.tgz 2>/dev/null || true
fi

if [[ "$PUBLISH" -eq 1 ]]; then
  log "PUBLISH MODE — @ysk-server/shared → @ysk-server/core → ysk-server"
  pnpm --filter @ysk-server/shared publish --access public --no-git-checks
  pnpm --filter @ysk-server/core publish --access public --no-git-checks
  pnpm --filter ysk-server publish --access public --no-git-checks
  log "published"
  log "Install: npm install -g ysk-server"
else
  log "Dry-run complete. To publish: bash scripts/publish-ysk-server-npm.sh --publish"
  log "See docs/deploy/npm-publish.md"
fi
