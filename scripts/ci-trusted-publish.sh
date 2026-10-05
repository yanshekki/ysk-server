#!/usr/bin/env bash
# npm Trusted Publishing (OIDC). No NPM_TOKEN / NODE_AUTH_TOKEN.
# Called from .github/workflows/release.yml after build + tag check.
# Order: ysk-server-shared → ysk-server-core → ysk-server.
# Skips a package whose version is already on the registry.
# The product tarball matches scripts/publish-ysk-server-npm.sh (bundles shared+core).
# The manual script itself is not modified.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[trusted-publish] %s\n' "$*"; }

if [[ -n "${NPM_TOKEN:-}" || -n "${NODE_AUTH_TOKEN:-}" ]]; then
  log "ERROR: NPM_TOKEN / NODE_AUTH_TOKEN must not be set for trusted publishing"
  exit 1
fi

SERVER_VER="$(node -p "require('./apps/server/package.json').version")"
SHARED_VER="$(node -p "require('./packages/shared/package.json').version")"
CORE_VER="$(node -p "require('./packages/core/package.json').version")"
if [[ "$SHARED_VER" != "$SERVER_VER" || "$CORE_VER" != "$SERVER_VER" ]]; then
  log "ERROR: shared ($SHARED_VER), core ($CORE_VER), and ysk-server ($SERVER_VER) must match"
  exit 1
fi

TAG="${GITHUB_REF_NAME:-}"
if [[ "$TAG" != "v$SERVER_VER" ]]; then
  log "ERROR: tag '${TAG:-<empty>}' is not v$SERVER_VER"
  exit 1
fi

npm_version_exists() {
  local name="$1" ver="$2"
  npm view "${name}@${ver}" version >/dev/null 2>&1
}

if [[ ! -f apps/web/dist/index.html ]]; then
  log "ERROR: apps/web/dist missing — refuse to publish without the panel"
  exit 1
fi
mkdir -p apps/server/public/web
rm -rf apps/server/public/web/*
cp -a apps/web/dist/. apps/server/public/web/
log "embedded web UI"

if npm_version_exists ysk-server-shared "$SHARED_VER"; then
  log "skip ysk-server-shared@$SHARED_VER (already on npm)"
else
  log "publish ysk-server-shared@$SHARED_VER"
  (cd packages/shared && npm publish --provenance --access public)
fi

# npm does not rewrite workspace:. Swap in the concrete version for this publish only.
CORE_JSON="packages/core/package.json"
CORE_BAK="$(mktemp)"
cp "$CORE_JSON" "$CORE_BAK"
restore_core() {
  if [[ -f "${CORE_BAK:-}" ]]; then
    cp "$CORE_BAK" "$CORE_JSON"
    rm -f "$CORE_BAK"
  fi
}
trap restore_core EXIT

node -e '
const fs = require("fs");
const p = "packages/core/package.json";
const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
const dep = pkg.dependencies && pkg.dependencies["ysk-server-shared"];
if (typeof dep === "string" && dep.startsWith("workspace:")) {
  pkg.dependencies["ysk-server-shared"] = pkg.version;
  fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n");
}
'

if npm_version_exists ysk-server-core "$CORE_VER"; then
  log "skip ysk-server-core@$CORE_VER (already on npm)"
else
  log "publish ysk-server-core@$CORE_VER"
  (cd packages/core && npm publish --provenance --access public)
fi

# Pack core with workspace: restored so pnpm pack rewrites it the usual way.
restore_core
trap - EXIT

if npm_version_exists ysk-server "$SERVER_VER"; then
  log "skip ysk-server@$SERVER_VER (already on npm)"
  log "done"
  exit 0
fi

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
if (!fs.existsSync(stage + '/README.md')) throw new Error('README missing in stage');
NODE

log "publish ysk-server@$SERVER_VER"
(cd "$STAGE" && npm publish --provenance --access public)
log "done"
