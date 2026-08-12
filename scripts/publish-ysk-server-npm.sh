#!/usr/bin/env bash
# Publish unscoped **ysk-server** to npmjs.com.
#
# Workspace packages (@ysk-server/shared, @ysk-server/core) are **bundled** into
# the tarball so installers only need the unscoped product package.
#
# Usage:
#   bash scripts/publish-ysk-server-npm.sh           # pack dry-run
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

VERSION="$(node -p "require('./apps/server/package.json').version")"
log "ysk-server version: $VERSION"

log "build shared → core → server → web…"
pnpm --filter @ysk-server/shared build
pnpm --filter @ysk-server/core build
pnpm --filter ysk-server build
pnpm --filter @ysk-server/web build || log "WARN: web build failed"

log "embed web UI…"
mkdir -p apps/server/public/web
if [[ -f apps/web/dist/index.html ]]; then
  rm -rf apps/server/public/web/*
  cp -a apps/web/dist/. apps/server/public/web/
  log "embedded $(du -sh apps/server/public/web | awk '{print $1}')"
else
  log "WARNING: no apps/web/dist — API-only pack"
fi

PACK_DIR="$(mktemp -d)"
log "pack workspace tarballs → $PACK_DIR"
# pack from package dirs (pnpm --filter … pack --pack-destination is flaky)
(cd packages/shared && pnpm pack --pack-destination "$PACK_DIR")
(cd packages/core && pnpm pack --pack-destination "$PACK_DIR")

STAGE="$(mktemp -d)"
log "stage → $STAGE"
cp -a apps/server/dist "$STAGE/"
cp -a apps/server/public "$STAGE/"
[[ -f apps/server/README.md ]] && cp apps/server/README.md "$STAGE/" || true

# tarball names from scoped packages: ysk-server-shared-*.tgz / ysk-server-core-*.tgz
SHARED_TGZ="$(ls "$PACK_DIR"/ysk-server-shared-*.tgz 2>/dev/null | head -1)"
CORE_TGZ="$(ls "$PACK_DIR"/ysk-server-core-*.tgz 2>/dev/null | head -1)"
if [[ -z "${SHARED_TGZ:-}" || -z "${CORE_TGZ:-}" ]]; then
  log "ERROR: expected pack artifacts under $PACK_DIR:"
  ls -la "$PACK_DIR" || true
  exit 1
fi

mkdir -p "$STAGE/node_modules/@ysk-server"
tar -xzf "$SHARED_TGZ" -C "$STAGE/node_modules/@ysk-server"
mv "$STAGE/node_modules/@ysk-server/package" "$STAGE/node_modules/@ysk-server/shared"
tar -xzf "$CORE_TGZ" -C "$STAGE/node_modules/@ysk-server"
mv "$STAGE/node_modules/@ysk-server/package" "$STAGE/node_modules/@ysk-server/core"

export STAGE
node <<'NODE'
const fs = require('fs');
const stage = process.env.STAGE;
const serverPkg = JSON.parse(fs.readFileSync('apps/server/package.json', 'utf8'));
const corePkg = JSON.parse(fs.readFileSync('packages/core/package.json', 'utf8'));
const sharedVer = JSON.parse(
  fs.readFileSync(stage + '/node_modules/@ysk-server/shared/package.json', 'utf8'),
).version;
const coreVer = JSON.parse(
  fs.readFileSync(stage + '/node_modules/@ysk-server/core/package.json', 'utf8'),
).version;
const deps = {};
for (const src of [corePkg.dependencies || {}, serverPkg.dependencies || {}]) {
  for (const [k, v] of Object.entries(src)) {
    if (k.startsWith('@ysk-server/') || k.startsWith('@yanshekki/') || k.startsWith('@ysk/')) continue;
    deps[k] = v;
  }
}
deps['@ysk-server/shared'] = sharedVer;
deps['@ysk-server/core'] = coreVer;
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
  publishConfig: { access: 'public' },
  dependencies: deps,
  bundleDependencies: ['@ysk-server/shared', '@ysk-server/core'],
};
fs.writeFileSync(stage + '/package.json', JSON.stringify(out, null, 2) + '\n');
console.log('staged', out.name + '@' + out.version, 'bundled', out.bundleDependencies.join(','));
NODE

if [[ "$PUBLISH" -eq 1 ]]; then
  log "PUBLISH ysk-server@$VERSION…"
  (cd "$STAGE" && npm publish --access public)
  log "done — https://www.npmjs.com/package/ysk-server"
  log "install: npm install -g ysk-server@$VERSION"
else
  log "dry-run pack…"
  (cd "$STAGE" && npm pack --dry-run 2>&1 | tail -25)
  log "To publish: bash scripts/publish-ysk-server-npm.sh --publish"
fi
