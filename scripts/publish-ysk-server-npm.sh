#!/usr/bin/env bash
# Publish YSK Server packages to npmjs.com (unscoped, no org required):
#   1) ysk-server-shared
#   2) ysk-server-core
#   3) ysk-server  (product CLI + panel; bundles shared+core)
#
# Usage:
#   bash scripts/publish-ysk-server-npm.sh           # dry-run pack
#   bash scripts/publish-ysk-server-npm.sh --publish  # real publish

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PUBLISH=0
[[ "${1:-}" == "--publish" ]] && PUBLISH=1

log() { printf '[publish-ysk-server] %s\n' "$*"; }

if ! npm whoami &>/dev/null; then
  log "ERROR: npm whoami failed — set Automation token in ~/.npmrc"
  exit 1
fi
log "npm user: $(npm whoami)"

SERVER_VER="$(node -p "require('./apps/server/package.json').version")"
SHARED_VER="$(node -p "require('./packages/shared/package.json').version")"
CORE_VER="$(node -p "require('./packages/core/package.json').version")"
log "versions: shared=$SHARED_VER core=$CORE_VER server=$SERVER_VER"

if [[ "$SHARED_VER" != "$SERVER_VER" || "$CORE_VER" != "$SERVER_VER" ]]; then
  log "ERROR: shared ($SHARED_VER), core ($CORE_VER), and ysk-server ($SERVER_VER) must be the same version"
  exit 1
fi

# Ensure package READMEs exist (npm page content)
for f in packages/shared/README.md packages/core/README.md apps/server/README.md; do
  if [[ ! -f "$f" ]]; then
    log "ERROR: missing $f"
    exit 1
  fi
done

log "build shared → core → server → web…"
pnpm --filter ysk-server-shared build
pnpm --filter ysk-server-core build
pnpm --filter ysk-server build
if ! pnpm --filter ysk-server-web build; then
  log "ERROR: web build failed — refusing to publish a stale embedded panel"
  exit 1
fi

log "embed web UI…"
mkdir -p apps/server/public/web
if [[ -f apps/web/dist/index.html ]]; then
  rm -rf apps/server/public/web/*
  cp -a apps/web/dist/. apps/server/public/web/
  log "embedded $(du -sh apps/server/public/web | awk '{print $1}')"
else
  log "WARNING: no apps/web/dist — API-only pack"
fi

npm_version_exists() {
  local name="$1" ver="$2"
  npm view "${name}@${ver}" version &>/dev/null
}

if [[ "$PUBLISH" -eq 1 ]]; then
  if npm_version_exists ysk-server-shared "$SHARED_VER"; then
    log "skip ysk-server-shared@$SHARED_VER (already on npm)"
  else
    log "PUBLISH ysk-server-shared@$SHARED_VER…"
    pnpm --filter ysk-server-shared publish --access public --no-git-checks
  fi

  if npm_version_exists ysk-server-core "$CORE_VER"; then
    log "skip ysk-server-core@$CORE_VER (already on npm)"
  else
    log "PUBLISH ysk-server-core@$CORE_VER…"
    pnpm --filter ysk-server-core publish --access public --no-git-checks
  fi
else
  log "dry-run: would publish ysk-server-shared + ysk-server-core"
  (cd packages/shared && npm publish --access public --dry-run 2>&1 | tail -8)
  (cd packages/core && npm publish --access public --dry-run 2>&1 | tail -8)
fi

# Stage product package with bundled libs + README
PACK_DIR="$(mktemp -d)"
STAGE="$(mktemp -d)"
log "stage product → $STAGE"
(cd packages/shared && pnpm pack --pack-destination "$PACK_DIR")
(cd packages/core && pnpm pack --pack-destination "$PACK_DIR")

cp -a apps/server/dist "$STAGE/"
cp -a apps/server/public "$STAGE/"
cp -a apps/server/README.md "$STAGE/README.md"
test -f "$STAGE/README.md"

mkdir -p "$STAGE/node_modules"
# extract packed libs as node_modules/ysk-server-shared|core
SHARED_TGZ="$(ls "$PACK_DIR"/ysk-server-shared-*.tgz | head -1)"
CORE_TGZ="$(ls "$PACK_DIR"/ysk-server-core-*.tgz | head -1)"
tar -xzf "$SHARED_TGZ" -C "$STAGE/node_modules"
mv "$STAGE/node_modules/package" "$STAGE/node_modules/ysk-server-shared"
tar -xzf "$CORE_TGZ" -C "$STAGE/node_modules"
mv "$STAGE/node_modules/package" "$STAGE/node_modules/ysk-server-core"

export STAGE SHARED_VER CORE_VER
node <<'NODE'
const fs = require('fs');
const stage = process.env.STAGE;
const serverPkg = JSON.parse(fs.readFileSync('apps/server/package.json', 'utf8'));
const corePkg = JSON.parse(fs.readFileSync('packages/core/package.json', 'utf8'));
const deps = {};
for (const src of [corePkg.dependencies || {}, serverPkg.dependencies || {}]) {
  for (const [k, v] of Object.entries(src)) {
    if (k === 'ysk-server-shared' || k === 'ysk-server-core') continue;
    if (k.startsWith('workspace:')) continue;
    deps[k] = v;
  }
}
deps['ysk-server-shared'] = process.env.SHARED_VER;
deps['ysk-server-core'] = process.env.CORE_VER;
const out = {
  name: 'ysk-server',
  version: serverPkg.version,
  description: serverPkg.description,
  type: 'module',
  bin: serverPkg.bin,
  main: serverPkg.main,
  types: serverPkg.types,
  files: ['dist', 'public', 'README.md'],
  engines: serverPkg.engines,
  repository: serverPkg.repository,
  license: serverPkg.license || 'MIT',
  keywords: serverPkg.keywords,
  homepage: 'https://github.com/yanshekki/ysk-server#readme',
  bugs: { url: 'https://github.com/yanshekki/ysk-server/issues' },
  publishConfig: { access: 'public' },
  dependencies: deps,
  bundleDependencies: ['ysk-server-shared', 'ysk-server-core'],
};
fs.writeFileSync(stage + '/package.json', JSON.stringify(out, null, 2) + '\n');
console.log('staged', out.name + '@' + out.version);
// sanity: README present
if (!fs.existsSync(stage + '/README.md')) throw new Error('README missing in stage');
NODE

if [[ "$PUBLISH" -eq 1 ]]; then
  if npm_version_exists ysk-server "$SERVER_VER"; then
    log "skip ysk-server@$SERVER_VER (already on npm)"
  else
    log "PUBLISH ysk-server@$SERVER_VER…"
    (cd "$STAGE" && npm publish --access public)
  fi
  log "done"
  log "  https://www.npmjs.com/package/ysk-server"
  log "  https://www.npmjs.com/package/ysk-server-shared"
  log "  https://www.npmjs.com/package/ysk-server-core"
  log "install: npm install -g ysk-server@$SERVER_VER"
  if command -v gh >/dev/null 2>&1; then
    if gh release view "v$SERVER_VER" >/dev/null 2>&1; then
      log "GitHub release v$SERVER_VER already exists"
    else
      log "create GitHub release v$SERVER_VER"
      gh release create "v$SERVER_VER" --title "ysk-server $SERVER_VER" \
        --notes "npm: https://www.npmjs.com/package/ysk-server/v/$SERVER_VER" \
        || log "WARN: gh release create failed (non-fatal)"
    fi
  else
    log "WARN: gh not installed — skip GitHub release v$SERVER_VER"
  fi
else
  log "dry-run pack ysk-server…"
  (cd "$STAGE" && npm pack --dry-run 2>&1 | grep -E 'README|package size|total files|Bundled|name:|version:' | head -20)
  log "To publish: bash scripts/publish-ysk-server-npm.sh --publish"
fi
