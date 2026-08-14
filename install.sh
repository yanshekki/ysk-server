#!/usr/bin/env bash
# YSK Server bootstrap — plan/bundle wizard + full stack install
#
# Usage:
#   ./install.sh                          # interactive wizard (TTY)
#   ./install.sh --non-interactive        # plan=recommended
#   ./install.sh --plan full --non-interactive
#   ./install.sh --bundles control-plane,web,defense --non-interactive
#   ./install.sh --plan minimal --from-source
#
# Docs: docs/getting-started/install.md · install-ZH.md
# Uninstall: ./uninstall.sh

set -euo pipefail

PRODUCT="YSK Server"
CLI="ysk-server"
# Global npm package name (bin remains `ysk-server`)
PKG="ysk-server"
MIN_NODE_MAJOR=22
NON_INTERACTIVE=0
RUN_SETUP=1
UPGRADE=0
UPGRADE_STACK=0
INSTALL_FROM_SOURCE=0
INSTALL_SYSTEMD=0
INSTALL_SYSTEMD_EXPLICIT=0
WITH_MYSQL_SERVER=0
ADMIN_USER="admin"
ADMIN_PASSWORD=""
CREDENTIALS_FILE=""
UNIT_ACTIVE=0
WITH_CLAMAV=0
PLAN=""
BUNDLES_CSV=""
SQL_SERVER="mariadb"
DATA_DIR=""
SKIP_WIZARD=0
OPERATION=install
BOOTSTRAP_TLS=1
LISTEN_HOST_OVERRIDE=""
TLS_SAN_IPS=""

# Resolve script directory (works when executed as file; pipe uses fetch)
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
INSTALL_ROOT="${SCRIPT_DIR:-}"

INSTALL_ARGV=("$@")

usage() {
  cat <<EOF
$PRODUCT installer — plan/bundle selection + stack install

Interactive (default on TTY):
  ./install.sh

Non-interactive:
  ./install.sh --non-interactive [--plan recommended|full|minimal]
  ./install.sh --non-interactive --bundles control-plane,web,database,defense

Plans:
  minimal       control-plane only
  recommended   control-plane + web + database + defense  (default non-interactive)
  full          all bundles

Options:
  --plan NAME             Use a named plan
  --bundles LIST          Comma-separated bundle ids (implies custom)
  --non-interactive       No prompts (CI / cloud-init)
  --skip-setup            Do not run 'ysk-server setup'
  --upgrade               Overlay latest ysk-server onto the running install (no apt stack)
  --upgrade-stack         Also refresh apt stack packages (dangerous if MySQL/MariaDB already live)
  --from-source           Build from current git checkout
  --install-systemd       Install+enable+start systemd unit (default ON as root)
  --no-install-systemd    Skip systemd (manual serve)
  --with-mysql-server     Use mysql-server instead of mariadb-server
  --with-clamav           Include ClamAV when email bundle selected
  --data-dir PATH         Panel data directory
  --admin-password PASS   Initial admin password (default: random strong)
  --admin-user NAME       Initial admin username (default: admin)
  --full                  Alias for --plan full
  --minimal               Alias for --plan minimal
  --skip-runtimes         Remove 'runtimes' from selected bundles
  --bootstrap-tls         Generate self-signed panel TLS for IP login (default on)
  --no-bootstrap-tls      Skip TLS bootstrap (lab only — HTTP insecure)
  --listen-host HOST      Override listen host (default 0.0.0.0 with TLS)
  --tls-san IPS           Extra SAN IPs comma-separated for bootstrap cert
  -h, --help              Show help

Logs: /var/log/ysk-server/install-*.log (root) or ~/.ysk/logs/
Manifest: \$dataDir/stack-manifest.json
Uninstall: ./uninstall.sh

Docs: docs/getting-started/install.md
EOF
}

SKIP_RUNTIMES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --skip-setup) RUN_SETUP=0; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    --upgrade-stack) UPGRADE=1; UPGRADE_STACK=1; shift ;;
    --from-source) INSTALL_FROM_SOURCE=1; shift ;;
    --install-systemd) INSTALL_SYSTEMD=1; INSTALL_SYSTEMD_EXPLICIT=1; shift ;;
    --no-install-systemd) INSTALL_SYSTEMD=0; INSTALL_SYSTEMD_EXPLICIT=1; shift ;;
    --with-mysql-server) WITH_MYSQL_SERVER=1; SQL_SERVER=mysql; shift ;;
    --with-clamav) WITH_CLAMAV=1; shift ;;
    --full) PLAN=full; shift ;;
    --minimal) PLAN=minimal; shift ;;
    --skip-runtimes) SKIP_RUNTIMES=1; shift ;;
    --plan) PLAN="${2:-}"; shift 2 ;;
    --bundles) BUNDLES_CSV="${2:-}"; PLAN="${PLAN:-custom}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --admin-password) ADMIN_PASSWORD="${2:-}"; shift 2 ;;
    --admin-user) ADMIN_USER="${2:-admin}"; shift 2 ;;
    --skip-wizard) SKIP_WIZARD=1; NON_INTERACTIVE=1; shift ;;
    --bootstrap-tls) BOOTSTRAP_TLS=1; shift ;;
    --no-bootstrap-tls) BOOTSTRAP_TLS=0; shift ;;
    --listen-host) LISTEN_HOST_OVERRIDE="${2:-}"; shift 2 ;;
    --tls-san) TLS_SAN_IPS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# CI convenience
if [[ "${CI:-}" == "true" || "${CI:-}" == "1" ]]; then
  NON_INTERACTIVE=1
fi

# Product default: root installs enable+start systemd (public “ready to use”)
if [[ "$INSTALL_SYSTEMD_EXPLICIT" -eq 0 ]]; then
  if [[ "$(id -u)" -eq 0 && "${CI:-}" != "true" && "${CI:-}" != "1" ]]; then
    INSTALL_SYSTEMD=1
  fi
fi

# Load libraries
load_libs() {
  local root="${INSTALL_ROOT:-}"
  local lib
  if [[ -n "$root" && -f "$root/install/lib/common.sh" ]]; then
    lib="$root/install/lib"
  elif [[ -n "$root" && -f "$root/lib/common.sh" ]]; then
    lib="$root/lib"
  else
    # will fetch via ensure_stack_assets after sourcing minimal stubs — pull assets first
    return 1
  fi
  # shellcheck source=/dev/null
  source "$lib/common.sh"
  # shellcheck source=/dev/null
  source "$lib/manifest.sh"
  # shellcheck source=/dev/null
  source "$lib/stack-ops.sh"
  # shellcheck source=/dev/null
  source "$lib/verify.sh"
  # shellcheck source=/dev/null
  source "$lib/wizard-install.sh"
}

if ! load_libs; then
  # Bootstrap: fetch assets then load
  PRODUCT="YSK Server"
  log() { printf '[%s] %s\n' "$PRODUCT" "$*"; }
  err() { printf '[%s] ERROR: %s\n' "$PRODUCT" "$*" >&2; }
  # I-01: only HTTPS raw base; prefer pin via YSK_INSTALL_RAW (commit SHA URL)
  raw="${YSK_INSTALL_RAW:-https://raw.githubusercontent.com/yanshekki/ysk-server/main}"
  case "$raw" in
    https://*) ;;
    *)
      err "YSK_INSTALL_RAW must be https:// (refusing $raw)"
      exit 1
      ;;
  esac
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ysk-install-XXXXXX")"
  log "Fetching installer assets from $raw …"
  log "Tip: pin a commit, e.g. YSK_INSTALL_RAW=https://raw.githubusercontent.com/yanshekki/ysk-server/<sha>"
  mkdir -p "$tmp/install/lib" "$tmp/deploy/stack"
  for f in install/lib/common.sh install/lib/manifest.sh install/lib/stack-ops.sh \
           install/lib/verify.sh install/lib/wizard-install.sh \
           deploy/stack/bundles.json deploy/stack/components.json; do
    curl -fsSL "$raw/$f" -o "$tmp/$f" || {
      err "Failed to download $raw/$f"
      exit 1
    }
  done
  # Optional integrity: fetch install/checksums.sha256 and verify (fail closed when present or required)
  # YSK_INSTALL_REQUIRE_CHECKSUMS=1 → must download + verify
  # default: verify when checksums file is available from the same base
  local_require_cs="${YSK_INSTALL_REQUIRE_CHECKSUMS:-0}"
  if curl -fsSL "$raw/install/checksums.sha256" -o "$tmp/install/checksums.sha256" 2>/dev/null; then
    log "Verifying downloaded assets against install/checksums.sha256 …"
    if command -v sha256sum >/dev/null 2>&1; then
      (
        cd "$tmp" || exit 1
        # Only check files we actually downloaded (ignore missing wizard-uninstall etc.)
        while read -r hash path; do
          [[ -z "$hash" || "$hash" == \#* ]] && continue
          [[ -f "$path" ]] || continue
          echo "$hash  $path"
        done < install/checksums.sha256 | sha256sum -c - || {
          err "Checksum verification FAILED — refusing to run untrusted installer assets"
          err "Pin YSK_INSTALL_RAW to a known commit and ensure checksums.sha256 matches"
          exit 1
        }
      ) || exit 1
    elif command -v shasum >/dev/null 2>&1; then
      (
        cd "$tmp" || exit 1
        while read -r hash path; do
          [[ -z "$hash" || "$hash" == \#* ]] && continue
          [[ -f "$path" ]] || continue
          got="$(shasum -a 256 "$path" | awk '{print $1}')"
          if [[ "$got" != "$hash" ]]; then
            err "Checksum mismatch for $path"
            exit 1
          fi
        done < install/checksums.sha256
      ) || exit 1
    else
      err "sha256sum/shasum missing — cannot verify checksums"
      if [[ "$local_require_cs" == "1" || "$local_require_cs" == "true" ]]; then
        exit 1
      fi
      log "WARN: continuing without checksum verify (install sha256 tools recommended)"
    fi
    log "Asset checksums OK"
  else
    if [[ "$local_require_cs" == "1" || "$local_require_cs" == "true" ]]; then
      err "YSK_INSTALL_REQUIRE_CHECKSUMS=1 but install/checksums.sha256 not available from $raw"
      exit 1
    fi
    log "No install/checksums.sha256 at base (set YSK_INSTALL_REQUIRE_CHECKSUMS=1 to require)"
  fi
  INSTALL_ROOT="$tmp"
  SCRIPT_DIR="$tmp"
  load_libs || {
    err "Failed to load installer libraries"
    exit 1
  }
fi

trap 'on_err $LINENO $?' ERR

embed_web_ui() {
  local root="$1"
  local web_dist="$root/apps/web/dist"
  local target="$root/apps/server/public/web"
  if [[ -f "$web_dist/index.html" ]]; then
    log "Embedding Web UI into apps/server/public/web"
    mkdir -p "$target"
    rm -rf "${target:?}/"*
    cp -a "$web_dist"/. "$target"/
    return 0
  fi
  log "Web UI dist missing — run pnpm --filter ysk-server-web build (API-only until then)"
}

# I-07: prefer non-root global npm prefix when possible
npm_global_prefix() {
  if [[ -n "${YSK_NPM_PREFIX:-}" ]]; then
    echo "$YSK_NPM_PREFIX"
    return 0
  fi
  if [[ "$(id -u)" -eq 0 ]]; then
    # Dedicated install user (optional): YSK_NPM_USER=ysk-npm
    if [[ -n "${YSK_NPM_USER:-}" ]] && id "$YSK_NPM_USER" &>/dev/null; then
      local home
      home="$(getent passwd "$YSK_NPM_USER" 2>/dev/null | cut -d: -f6 || true)"
      if [[ -n "$home" ]]; then
        echo "${home}/.npm-global"
        return 0
      fi
    fi
    echo ""
    return 0
  fi
  echo "${HOME}/.npm-global"
}

ysk_npm_global_dest() {
  local prefix root
  prefix="$(npm_global_prefix)"
  if [[ -n "$prefix" ]]; then
    printf '%s\n' "${prefix}/lib/node_modules/${PKG}"
    return 0
  fi
  root="$(npm root -g 2>/dev/null || true)"
  if [[ -n "$root" ]]; then
    printf '%s\n' "${root}/${PKG}"
  fi
}

# Leftover global tree + npm --force → ENOTEMPTY, then bufferutil runs
# `node-gyp-build` against a half-deleted tree (LIVE 1.0.27 log).
# First call keeps the previous tree as rollback; later calls only wipe a failed extract.
clean_ysk_npm_global_dest() {
  local dest bak
  dest="$(ysk_npm_global_dest)"
  [[ -n "$dest" && -e "$dest" ]] || return 0
  if [[ -n "${YSK_NPM_DEST_BAK:-}" && -e "$YSK_NPM_DEST_BAK" ]]; then
    log "Clearing failed extract at $dest"
    rm -rf "$dest" 2>/dev/null || mv "$dest" "${dest}.ysk-broken.$$" 2>/dev/null || true
    return 0
  fi
  bak="${dest}.ysk-old.$$"
  log "Moving leftover $dest aside (npm ENOTEMPTY / broken extract)"
  if mv "$dest" "$bak" 2>/dev/null; then
    YSK_NPM_DEST_BAK="$bak"
    return 0
  fi
  rm -rf "$dest" 2>/dev/null || warn "Could not clear leftover $dest"
}

restore_ysk_npm_global_dest() {
  local dest
  dest="$(ysk_npm_global_dest)"
  [[ -n "${YSK_NPM_DEST_BAK:-}" && -d "$YSK_NPM_DEST_BAK" ]] || return 0
  if [[ ! -d "$dest" ]]; then
    log "Restoring previous $dest from $YSK_NPM_DEST_BAK"
    mv "$YSK_NPM_DEST_BAK" "$dest" 2>/dev/null || true
  fi
}

discard_ysk_npm_dest_bak() {
  if [[ -n "${YSK_NPM_DEST_BAK:-}" ]]; then
    rm -rf "$YSK_NPM_DEST_BAK" 2>/dev/null || true
  fi
  YSK_NPM_DEST_BAK=""
}

ensure_node_gyp_build() {
  if command -v node-gyp-build >/dev/null 2>&1; then
    return 0
  fi
  log "Installing node-gyp-build (ws optional native helper)"
  npm install -g --force node-gyp-build >/dev/null 2>&1 || true
}

install_product_from_pack() {
  local dest tmp spec tgz
  dest="$(ysk_npm_global_dest)"
  spec="${PKG}@${YSK_NPM_VERSION:-latest}"
  [[ -n "$dest" ]] || return 1
  tmp="$(mktemp -d)"
  log "Extracting $spec to $dest (npm pack fallback)"
  if ! (cd "$tmp" && npm pack "$spec" >/dev/null); then
    rm -rf "$tmp"
    return 1
  fi
  tgz="$(ls -1 "$tmp"/*.tgz 2>/dev/null | head -1 || true)"
  if [[ -z "$tgz" || ! -f "$tgz" ]]; then
    rm -rf "$tmp"
    return 1
  fi
  tar -xzf "$tgz" -C "$tmp" || {
    rm -rf "$tmp"
    return 1
  }
  if [[ ! -f "$tmp/package/dist/cli.js" ]]; then
    rm -rf "$tmp"
    return 1
  fi
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -a "$tmp/package/." "$dest/"
  rm -rf "$tmp"
  with_npm_only_allow_stub
  (cd "$dest" && npm install --omit=dev --no-fund --no-audit --ignore-scripts --no-progress) || true
  npm_rebuild_natives
  if [[ -f "$dest/dist/cli.js" ]]; then
    if [[ "$(id -u)" -eq 0 ]]; then
      cat >/usr/local/bin/ysk-server <<WRAP
#!/usr/bin/env bash
exec node "$dest/dist/cli.js" "\$@"
WRAP
      chmod +x /usr/local/bin/ysk-server
    else
      mkdir -p "${HOME}/.local/bin"
      cat >"${HOME}/.local/bin/ysk-server" <<WRAP
#!/usr/bin/env bash
exec node "$dest/dist/cli.js" "\$@"
WRAP
      chmod +x "${HOME}/.local/bin/ysk-server"
      export PATH="${HOME}/.local/bin:${PATH}"
    fi
    hash -r 2>/dev/null || true
    return 0
  fi
  return 1
}

# ip-set@3 preinstall is `npx only-allow pnpm`. On Ubuntu 24 that often
# becomes `only-allow: not found` (LIVE-001). --ignore-scripts avoids the
# hook but leaves empty scoped packages (@simplewebauthn/server) so CLI
# setup/--version crash (LIVE-005). Stub the gate and extract packages.
with_npm_only_allow_stub() {
  local stub
  stub="$(mktemp -d "${TMPDIR:-/tmp}/ysk-npm-gate.XXXXXX")"
  cat >"$stub/only-allow" <<'SH'
#!/bin/sh
exit 0
SH
  chmod +x "$stub/only-allow"
  cat >"$stub/npx" <<'SH'
#!/bin/sh
for a in "$@"; do
  if [ "$a" = "only-allow" ]; then exit 0; fi
done
stubdir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
oldifs=$IFS
IFS=:
for d in $PATH; do
  [ "$d" = "$stubdir" ] && continue
  if [ -x "$d/npx" ]; then
    IFS=$oldifs
    exec "$d/npx" "$@"
  fi
done
IFS=$oldifs
exit 127
SH
  chmod +x "$stub/npx"
  export PATH="$stub:$PATH"
  # Real only-allow allows installs when INIT_CWD contains node_modules
  export INIT_CWD="${INIT_CWD:-/usr/lib/node_modules/ysk-server}"
}

# --ignore-scripts (1.0.25) left an empty scoped dir; repair it.
ensure_webauthn_module() {
  local prefix root dest
  prefix="$(npm_global_prefix)"
  if [[ -n "$prefix" ]]; then
    dest="$prefix/lib/node_modules/ysk-server"
  else
    root="$(npm root -g 2>/dev/null || true)"
    dest="${root}/ysk-server"
  fi
  [[ -d "$dest" ]] || return 0
  if [[ -f "$dest/node_modules/@simplewebauthn/server/package.json" ]]; then
    return 0
  fi
  log "Repairing @simplewebauthn/server (empty or missing)"
  with_npm_only_allow_stub
  (cd "$dest" && npm install --omit=dev --no-fund --no-audit --no-progress @simplewebauthn/server@13.3.2) \
    || warn "Could not install @simplewebauthn/server — passkeys will fail until repaired"
}

npm_rebuild_natives() {
  local prefix root
  prefix="$(npm_global_prefix)"
  if [[ -n "$prefix" ]]; then
    export PATH="${prefix}/bin:${PATH}"
    if [[ -d "$prefix/lib/node_modules/ysk-server" ]]; then
      (cd "$prefix/lib/node_modules/ysk-server" && npm rebuild node-pty) || true
    fi
    npm rebuild --prefix "$prefix" >/dev/null 2>&1 || true
    return 0
  fi
  root="$(npm root -g 2>/dev/null || true)"
  if [[ -n "$root" && -d "$root/ysk-server" ]]; then
    (cd "$root/ysk-server" && npm rebuild node-pty) || true
  fi
  npm rebuild -g ysk-server >/dev/null 2>&1 || true
}

npm_install_global() {
  # usage: npm_install_global <pkg-spec> [pkg-spec...]
  local prefix
  prefix="$(npm_global_prefix)"
  local -a extra=()
  if [[ -n "$prefix" ]]; then
    mkdir -p "$prefix"
    extra=(--prefix "$prefix")
    # Ensure bin on PATH for this install session
    export PATH="${prefix}/bin:${PATH}"
    log "npm global prefix: $prefix (I-07 non-root / dedicated prefix)"
  elif [[ "$(id -u)" -eq 0 ]]; then
    warn "I-07: installing npm packages as root into system global (set YSK_NPM_PREFIX or YSK_NPM_USER to avoid)"
  fi
  extra+=(--force)
  if [[ "${YSK_NPM_IGNORE_SCRIPTS:-0}" == "1" ]]; then
    extra+=(--ignore-scripts)
  fi
  with_npm_only_allow_stub
  local rc=0
  if [[ "$(id -u)" -eq 0 && -n "${YSK_NPM_USER:-}" ]] && id "$YSK_NPM_USER" &>/dev/null && [[ -n "$prefix" ]]; then
    # Run as dedicated user when prefix is under their home
    runuser -u "$YSK_NPM_USER" -- env PATH="$PATH" INIT_CWD="$INIT_CWD" npm install -g "${extra[@]}" "$@" 2>/dev/null \
      || sudo -u "$YSK_NPM_USER" env PATH="$PATH" INIT_CWD="$INIT_CWD" npm install -g "${extra[@]}" "$@" 2>/dev/null \
      || npm install -g "${extra[@]}" "$@"
    rc=$?
  else
    npm install -g "${extra[@]}" "$@"
    rc=$?
  fi
  if [[ "$rc" -eq 0 ]]; then
    npm_rebuild_natives
  fi
  return "$rc"
}

install_node_globals() {
  phase "node-globals"
  if ! require_cmd npm; then
    record_hard_fail "npm not found"
    return 1
  fi
  local need_pnpm=1 need_pm2=1
  if require_cmd pnpm; then
    local pnpm_major
    pnpm_major="$(pnpm -v 2>/dev/null | cut -d. -f1 || echo 0)"
    if [[ "$pnpm_major" =~ ^[0-9]+$ ]] && [[ "$pnpm_major" -ge 11 ]]; then
      need_pnpm=0
    else
      log "pnpm $(pnpm -v) is older than 11 — installing latest (Node ${MIN_NODE_MAJOR}+)"
    fi
  fi
  require_cmd pm2 && need_pm2=0
  if [[ "$need_pnpm" -eq 0 && "$need_pm2" -eq 0 ]]; then
    log "pnpm and pm2 already on PATH — skip global reinstall"
    return 0
  fi
  log "Installing global npm tools (pnpm@latest, pm2)..."
  if [[ "$need_pnpm" -eq 1 ]]; then
    npm_install_global pnpm@latest 2>/dev/null || npm_install_global pnpm || warn "pnpm install failed"
  fi
  if [[ "$need_pm2" -eq 1 ]]; then
    npm_install_global pm2@latest 2>/dev/null || npm_install_global pm2 || warn "pm2 install failed"
  fi
  local prefix
  prefix="$(npm_global_prefix)"
  if [[ -n "$prefix" && -d "$prefix/bin" ]]; then
    log "Ensure PATH includes: export PATH=\"${prefix}/bin:\$PATH\""
  fi
}

# Overlay official npm tarball onto the running ExecStart tree (from-source
# installs keep serving apps/server/dist/cli.js — npm i -g alone never updates it).
overlay_npm_onto_running() {
  local spec="${PKG}@${YSK_NPM_VERSION:-latest}"
  local dest=""
  local unit="/etc/systemd/system/ysk-server.service"
  local cli=""

  if [[ -f "$unit" ]]; then
    cli="$(awk '
      /^ExecStart=/ {
        n = split($0, a, /[[:space:]]+/)
        for (i = 1; i <= n; i++) if (a[i] ~ /cli\.(js|cjs|mjs)$/) { print a[i]; exit }
      }' "$unit")"
    if [[ -n "$cli" && -f "$cli" ]]; then
      dest="$(cd "$(dirname "$cli")/.." && pwd)"
    fi
  fi
  if [[ -z "$dest" && -f /usr/lib/ysk-server/apps/server/dist/cli.js ]]; then
    dest="/usr/lib/ysk-server/apps/server"
  fi
  if [[ -z "$dest" ]]; then
    local groot node_bin ysk_bin
    groot="$(npm root -g 2>/dev/null || true)"
    if [[ -n "$groot" && -f "$groot/ysk-server/dist/cli.js" ]]; then
      dest="$groot/ysk-server"
    fi
    if [[ -z "$dest" ]]; then
      node_bin="$(command -v node 2>/dev/null || true)"
      if [[ -n "$node_bin" && -f "$(dirname "$node_bin")/../lib/node_modules/ysk-server/dist/cli.js" ]]; then
        dest="$(cd "$(dirname "$node_bin")/../lib/node_modules/ysk-server" && pwd)"
      fi
    fi
    if [[ -z "$dest" ]]; then
      ysk_bin="$(command -v ysk-server 2>/dev/null || true)"
      if [[ -n "$ysk_bin" && -f "$(dirname "$ysk_bin")/../lib/node_modules/ysk-server/dist/cli.js" ]]; then
        dest="$(cd "$(dirname "$ysk_bin")/../lib/node_modules/ysk-server" && pwd)"
      fi
    fi
  fi
  if [[ -z "$dest" || ! -d "$dest" ]]; then
    log "No running package dir to overlay — npm global install is the product"
    return 2
  fi

  local tmp latest=""
  tmp="$(mktemp -d)"
  log "Overlay $spec onto $dest"
  if ! (cd "$tmp" && npm pack "$spec" >/dev/null); then
    latest="$(npm view "$PKG" version 2>/dev/null || echo "${YSK_NPM_VERSION:-}")"
    if [[ -n "$latest" && "$latest" != "latest" ]] && \
       curl -fsSL "https://registry.npmjs.org/${PKG}/-/${PKG}-${latest}.tgz" -o "$tmp/pkg.tgz"; then
      log "Fetched tarball via curl (npm pack failed)"
    else
      log "WARNING: could not download $spec"
      rm -rf "$tmp"
      return 1
    fi
  fi
  if [[ ! -f "$tmp/pkg.tgz" ]]; then
    local tgz
    tgz="$(ls -1 "$tmp"/*.tgz 2>/dev/null | head -1 || true)"
    [[ -n "$tgz" ]] && mv -f "$tgz" "$tmp/pkg.tgz"
  fi
  if [[ ! -f "$tmp/pkg.tgz" ]]; then
    log "WARNING: no tarball to extract"
    rm -rf "$tmp"
    return 1
  fi
  tar -xzf "$tmp/pkg.tgz" -C "$tmp"
  if [[ ! -f "$tmp/package/dist/cli.js" ]]; then
    log "WARNING: packed tarball missing dist/cli.js"
    rm -rf "$tmp"
    return 1
  fi
  latest="$(node -p "require('$tmp/package/package.json').version" 2>/dev/null || true)"
  mkdir -p "$dest/dist"
  cp -a "$tmp/package/dist/." "$dest/dist/"
  if [[ -d "$tmp/package/public" ]]; then
    mkdir -p "$dest/public"
    cp -a "$tmp/package/public/." "$dest/public/"
  fi
  if [[ -d "$tmp/package/node_modules" ]]; then
    mkdir -p "$dest/node_modules"
    local dep
    for dep in ysk-server-core ysk-server-shared; do
      if [[ -d "$tmp/package/node_modules/$dep" ]]; then
        rm -rf "$dest/node_modules/$dep"
        cp -a "$tmp/package/node_modules/$dep" "$dest/node_modules/$dep"
      fi
    done
  fi
  rm -rf "$tmp"
  if [[ -n "$latest" ]] && ! grep -qF "$latest" "$dest/dist/version.js" 2>/dev/null; then
    log "WARNING: overlay verify failed — $dest/dist/version.js does not contain $latest"
    return 1
  fi
  log "Overlay complete → $dest ($latest)"
  return 0
}

ensure_unit_execute() {
  local unit="/etc/systemd/system/ysk-server.service"
  [[ -f "$unit" ]] || return 0
  [[ "$(id -u)" -eq 0 ]] || return 0
  if grep -q '^Environment=YSK_EXECUTE=1' "$unit"; then
    return 0
  fi
  if grep -q '^Environment=NODE_ENV=production' "$unit"; then
    sed -i '/^Environment=NODE_ENV=production/a Environment=YSK_EXECUTE=1' "$unit"
  else
    sed -i '/^\[Service\]/a Environment=YSK_EXECUTE=1' "$unit"
  fi
  systemctl daemon-reload 2>/dev/null || true
  log "Enabled YSK_EXECUTE=1 on $unit"
}

install_product() {
  phase "product"
  if [[ "$INSTALL_FROM_SOURCE" -eq 1 ]]; then
    local src_root="${SCRIPT_DIR:-.}"
    # if we fetched assets to tmp, prefer cwd if it looks like the monorepo
    if [[ -f "./apps/server/package.json" ]]; then
      src_root="$(pwd)"
    elif [[ -f "$src_root/apps/server/package.json" ]]; then
      :
    else
      record_hard_fail "--from-source requires running inside the git checkout"
      return 1
    fi
    log "Installing from source: $src_root"
    # Ensure npm global bin is on PATH after npm i -g pnpm (non-login shells)
    export PATH="$(npm prefix -g 2>/dev/null)/bin:${PATH:-/usr/bin}"
    if require_cmd pnpm; then
      (cd "$src_root" && pnpm install && pnpm build)
    else
      npm install -g pnpm
      export PATH="$(npm prefix -g 2>/dev/null)/bin:${PATH:-/usr/bin}"
      hash -r 2>/dev/null || true
      (cd "$src_root" && pnpm install && pnpm build)
    fi
    embed_web_ui "$src_root"
    (cd "$src_root/apps/server" && npm link --force 2>/dev/null || true)
    local cli_js="$src_root/apps/server/dist/cli.js"
    if [[ -f "$cli_js" ]]; then
      local wrapper="/usr/local/bin/ysk-server"
      write_cli() {
        local dest="$1"
        cat >"$dest" <<WRAP
#!/usr/bin/env bash
exec node "$cli_js" "\$@"
WRAP
        chmod +x "$dest"
      }
      if [[ "$(id -u)" -eq 0 ]]; then
        write_cli "$wrapper"
      else
        mkdir -p "$HOME/.local/bin"
        write_cli "$HOME/.local/bin/ysk-server"
        if require_cmd sudo; then
          # Quote CLI path (I-08)
          sudo tee "$wrapper" >/dev/null <<WRAP
#!/usr/bin/env bash
exec node "$cli_js" "\$@"
WRAP
          sudo chmod +x "$wrapper" || true
        fi
      fi
      log "CLI wrapper ready"
    fi
    manifest_add_component "control-plane-product" "" "ysk-server" "" "npm"
    return 0
  fi

  if [[ "$UPGRADE" -eq 1 ]]; then
    log "Upgrading $PKG via npm..."
  else
    log "Installing $PKG via npm..."
  fi
  # I-06: allow pin via YSK_NPM_VERSION (default latest)
  local npm_spec="${YSK_NPM_VERSION:-latest}"
  local npm_pkg="${PKG}@${npm_spec}"
  log "npm package: $npm_pkg"
  clean_ysk_npm_global_dest
  ensure_node_gyp_build
  local product_ok=0
  # I-07: use npm_install_global (prefix / dedicated user when configured)
  if npm_install_global "$npm_pkg"; then
    product_ok=1
  else
    warn "npm install -g $npm_pkg failed — retry without lifecycle scripts"
    clean_ysk_npm_global_dest
    if YSK_NPM_IGNORE_SCRIPTS=1 npm_install_global "$npm_pkg"; then
      product_ok=1
    elif install_product_from_pack; then
      log "Installed $PKG from npm pack fallback"
      product_ok=1
    fi
  fi
  if [[ "$product_ok" -eq 1 ]]; then
    discard_ysk_npm_dest_bak
  else
    restore_ysk_npm_global_dest
    if require_cmd "$CLI" || require_cmd ysk-server \
      || [[ -f /etc/systemd/system/ysk-server.service ]] \
      || [[ -f /usr/lib/ysk-server/apps/server/dist/cli.js ]]; then
      warn "npm install -g $npm_pkg failed — overlay will update the running tree"
    else
      record_hard_fail "Global npm install failed for $PKG (try YSK_NPM_PREFIX=\$HOME/.npm-global or npm install -g --force)"
      return 1
    fi
  fi
  ensure_webauthn_module
  if require_cmd npm; then
    local prefix
    prefix="$(npm_global_prefix)"
    if [[ -n "$prefix" ]]; then
      log "Installed: $(npm list -g --prefix "$prefix" --depth=0 "$PKG" 2>/dev/null | tail -1 || echo "$PKG @ $prefix")"
    else
      log "Installed: $(npm list -g --depth=0 "$PKG" 2>/dev/null | tail -1 || echo "$PKG")"
    fi
  fi
  manifest_add_component "control-plane-product" "" "ysk-server" "" "npm"
}


# §3.9 embed SPA under dataDir/web when monorepo source is available
ensure_web_ui() {
  local dir="${1:-$DATA_DIR}"
  local root="${INSTALL_ROOT:-}"
  if [[ -z "$root" || ! -f "$root/apps/web/package.json" ]]; then
    # try cwd
    if [[ -f "./apps/web/package.json" ]]; then
      root="$(pwd)"
    else
      log "Web UI: no monorepo apps/web — skip embed (use packaged public/web or fix in readiness)"
      return 0
    fi
  fi
  phase "web-ui"
  log "Building ysk-server-web from $root …"
  (
    cd "$root"
    if command -v pnpm >/dev/null 2>&1; then
      pnpm --filter ysk-server-web build || log "WARN: web build failed"
    elif command -v npm >/dev/null 2>&1; then
      npm run build -w ysk-server-web || log "WARN: web build failed"
    else
      log "WARN: no pnpm/npm — skip web build"
      return 0
    fi
  )
  if [[ -f "$root/apps/web/dist/index.html" && -n "$dir" ]]; then
    resolve_sudo || true
    # shellcheck disable=SC2086
    $SUDO mkdir -p "$dir/web" 2>/dev/null || mkdir -p "$dir/web"
    if [[ -w "$dir/web" ]] || [[ "$(id -u)" -eq 0 ]]; then
      rm -rf "$dir/web"/* 2>/dev/null || true
      cp -a "$root/apps/web/dist/." "$dir/web/"
    else
      # shellcheck disable=SC2086
      $SUDO rm -rf "$dir/web"/* 2>/dev/null || true
      $SUDO cp -a "$root/apps/web/dist/." "$dir/web/"
    fi
    log "Web UI installed → $dir/web"
  else
    log "WARN: apps/web/dist missing after build"
  fi
}

# §2.3 harden: dataDir 750 so other users cannot read control-plane JSON
harden_data_dir() {
  local dir="${1:-$DATA_DIR}"
  if [[ -z "$dir" || ! -d "$dir" ]]; then
    return 0
  fi
  resolve_sudo || true
  log "Hardening dataDir mode 750: $dir"
  # shellcheck disable=SC2086
  if $SUDO chmod 750 "$dir" 2>/dev/null; then
    log "dataDir mode set to 750"
  elif chmod 750 "$dir" 2>/dev/null; then
    log "dataDir mode set to 750"
  else
    log "WARN: could not chmod 750 $dir — fix later: chmod 750 $dir"
    return 1
  fi
  return 0
}

gen_admin_password() {
  if [[ -n "$ADMIN_PASSWORD" ]]; then
    return 0
  fi
  if command -v openssl >/dev/null 2>&1; then
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)"
  else
    ADMIN_PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  fi
  # Ensure meets typical strength rules
  ADMIN_PASSWORD="Ysk1!${ADMIN_PASSWORD}"
}

write_credentials_file() {
  CREDENTIALS_FILE="${DATA_DIR}/BOOTSTRAP-CREDENTIALS.txt"
  resolve_sudo || true
  # shellcheck disable=SC2086
  $SUDO mkdir -p "$DATA_DIR" 2>/dev/null || mkdir -p "$DATA_DIR" 2>/dev/null || true
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
YSK Server bootstrap credentials (install-time)
Created: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Data dir: $DATA_DIR

  Username: $ADMIN_USER
  Password: $ADMIN_PASSWORD

Change this password after first login. Enable 2FA.
Support: email@ysk.hk  ·  Panel: /support
EOF
  # shellcheck disable=SC2086
  if [[ "$(id -u)" -eq 0 ]]; then
    install -m 600 "$tmp" "$CREDENTIALS_FILE"
  else
    cp "$tmp" "$CREDENTIALS_FILE"
    chmod 600 "$CREDENTIALS_FILE" 2>/dev/null || true
  fi
  rm -f "$tmp"
}

run_setup() {
  phase "setup"
  if [[ "$RUN_SETUP" -ne 1 ]]; then
    log "Skipping setup (--skip-setup)"
    # Still harden if directory already exists (upgrade / re-run)
    harden_data_dir "$DATA_DIR" || true
    return 0
  fi
  export YSK_DATA_DIR="${DATA_DIR}"
  # Ensure path exists before setup so chmod always has a target
  resolve_sudo || true
  # shellcheck disable=SC2086
  $SUDO mkdir -p "$DATA_DIR" 2>/dev/null || mkdir -p "$DATA_DIR" 2>/dev/null || true

  local existing_cp=0
  if [[ -f "$DATA_DIR/config.json" ]]; then
    existing_cp=1
  fi
  KEEP_EXISTING_ADMIN=0
  if [[ "$existing_cp" -eq 1 && -z "$ADMIN_PASSWORD" ]]; then
    log "Existing control-plane config found — not rotating admin password"
    KEEP_EXISTING_ADMIN=1
  else
    gen_admin_password
    write_credentials_file
  fi

  local setup_cmd=("$CLI" setup --non-interactive --data-dir "$DATA_DIR")
  setup_cmd+=(--admin-user "$ADMIN_USER")
  if [[ "$KEEP_EXISTING_ADMIN" -eq 0 ]]; then
    setup_cmd+=(--admin-password "$ADMIN_PASSWORD")
  fi
  # IP-first login needs bind-all when TLS bootstrap is on
  if [[ "$BOOTSTRAP_TLS" -eq 1 ]]; then
    setup_cmd+=(--host "${LISTEN_HOST_OVERRIDE:-0.0.0.0}")
  elif [[ -n "$LISTEN_HOST_OVERRIDE" ]]; then
    setup_cmd+=(--host "$LISTEN_HOST_OVERRIDE")
  fi
  if [[ "$NON_INTERACTIVE" -eq 1 ]] || [[ -f "$DATA_DIR/config.json" ]]; then
    setup_cmd+=(--force)
  fi
  if require_cmd "$CLI"; then
    log "Running setup (admin user=$ADMIN_USER; password in $CREDENTIALS_FILE)"
    if ! "${setup_cmd[@]}"; then
      # I-02: do not swallow total failure when config is missing
      if [[ ! -f "$DATA_DIR/config.json" ]]; then
        record_hard_fail "setup failed and $DATA_DIR/config.json is missing"
        return 1
      fi
      log "setup returned non-zero (config already present — continuing)"
    fi
  else
    log "CLI not on PATH yet; run: $CLI setup --data-dir $DATA_DIR"
    if [[ ! -f "$DATA_DIR/config.json" ]]; then
      record_hard_fail "CLI missing and setup not completed"
      return 1
    fi
  fi
  if [[ ! -f "$DATA_DIR/config.json" ]]; then
    record_hard_fail "setup did not create config.json under $DATA_DIR"
    return 1
  fi
  harden_data_dir "$DATA_DIR" || true
  ensure_web_ui "$DATA_DIR" || true
}

# Bootstrap self-signed panel TLS for first HTTPS login by IP (I-03/I-04/I-05)
run_bootstrap_tls() {
  if [[ "$BOOTSTRAP_TLS" -ne 1 ]]; then
    log "Skipping TLS bootstrap (--no-bootstrap-tls) — panel may be HTTP (insecure)"
    return 0
  fi
  phase "bootstrap-tls"
  if ! require_cmd openssl; then
    record_hard_fail "openssl required for panel bootstrap TLS"
    return 1
  fi
  if ! require_cmd "$CLI"; then
    record_hard_fail "CLI required for ssl bootstrap"
    return 1
  fi
  local boot_cmd=("$CLI" ssl bootstrap --data-dir "$DATA_DIR")
  if [[ -n "$TLS_SAN_IPS" ]]; then
    boot_cmd+=(--ip "$TLS_SAN_IPS")
  fi
  if [[ -n "$LISTEN_HOST_OVERRIDE" ]]; then
    boot_cmd+=(--host "$LISTEN_HOST_OVERRIDE")
  fi
  log "Running: ${boot_cmd[*]}"
  if ! "${boot_cmd[@]}"; then
    record_hard_fail "ssl bootstrap failed"
    return 1
  fi
  # Harden secrets (I-05)
  local ssl_dir="$DATA_DIR/ssl/panel"
  if [[ -d "$ssl_dir" ]]; then
    resolve_sudo || true
    # shellcheck disable=SC2086
    $SUDO chmod 700 "$ssl_dir" 2>/dev/null || chmod 700 "$ssl_dir" 2>/dev/null || true
    # shellcheck disable=SC2086
    $SUDO chmod 600 "$ssl_dir"/bootstrap-key.pem 2>/dev/null || chmod 600 "$ssl_dir"/bootstrap-key.pem 2>/dev/null || true
    # shellcheck disable=SC2086
    $SUDO chmod 644 "$ssl_dir"/bootstrap-cert.pem 2>/dev/null || chmod 644 "$ssl_dir"/bootstrap-cert.pem 2>/dev/null || true
  fi
  return 0
}

install_systemd_unit() {
  if [[ "$INSTALL_SYSTEMD" -ne 1 ]]; then
    log "systemd skipped (--no-install-systemd or non-root)"
    return 0
  fi
  phase "systemd"
  if ! require_cmd "$CLI" && [[ "$INSTALL_FROM_SOURCE" -ne 1 ]]; then
    log "No CLI for unit-install — skip"
    return 0
  fi
  log "Installing systemd unit + enable --now (dataDir=$DATA_DIR)"
  UNIT_ACTIVE=0
  if [[ "$(id -u)" -eq 0 ]]; then
    # Install-time is intentional host mutation
    if YSK_EXECUTE=1 "$CLI" system unit-install --enable --data-dir "$DATA_DIR"; then
      if systemctl is-active --quiet ysk-server 2>/dev/null; then
        UNIT_ACTIVE=1
        log "ysk-server.service is active"
      else
        systemctl start ysk-server 2>/dev/null || true
        if systemctl is-active --quiet ysk-server 2>/dev/null; then
          UNIT_ACTIVE=1
          log "ysk-server.service started"
        else
          log "WARNING: unit installed but not active — check: systemctl status ysk-server"
        fi
      fi
    else
      log "WARNING: unit-install failed — start manually: $CLI serve --data-dir $DATA_DIR"
    fi
  elif require_cmd "$CLI"; then
    "$CLI" system unit-install --data-dir "$DATA_DIR" || true
    log "Unit written (not root) — enable with: sudo YSK_EXECUTE=1 $CLI system unit-install --enable --data-dir $DATA_DIR"
  fi
}

print_next() {
  local ip_hint="127.0.0.1"
  if command -v hostname >/dev/null 2>&1; then
    local first
    first="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [[ -n "$first" && "$first" != 127.* ]]; then
      ip_hint="$first"
    fi
  fi
  local panel_url="https://${ip_hint}:9287"
  if [[ "$BOOTSTRAP_TLS" -ne 1 ]]; then
    panel_url="http://${ip_hint}:9287  (INSECURE — bootstrap TLS disabled)"
  fi
  local service_line="Manual: $CLI serve --data-dir $DATA_DIR --port 9287"
  if [[ "$UNIT_ACTIVE" -eq 1 ]]; then
    service_line="systemd: ysk-server.service is ACTIVE (enable --now done)"
  elif [[ "$INSTALL_SYSTEMD" -eq 1 ]]; then
    service_line="systemd unit written — start: sudo systemctl start ysk-server"
  fi
  local login_pass
  if [[ "${KEEP_EXISTING_ADMIN:-0}" -eq 1 ]]; then
    login_pass="(unchanged — existing admin kept)"
  elif [[ -n "${ADMIN_PASSWORD:-}" ]]; then
    login_pass="$ADMIN_PASSWORD"
  else
    login_pass="see ${CREDENTIALS_FILE:-$DATA_DIR/BOOTSTRAP-CREDENTIALS.txt}"
  fi

  cat <<EOF

============================================================
 $PRODUCT v1.0.30 — installation finished
============================================================
 Plan:     ${PLAN:-custom}
 Bundles:  $BUNDLES_CSV
 Log:      ${INSTALL_LOG:-n/a}
 Manifest: ${MANIFEST_PATH:-n/a}
 Data dir: $DATA_DIR
 Service:  $service_line

 Panel:
   $panel_url
   Accept the browser warning if using the install-time self-signed cert.

 Login (change after first login + enable 2FA):
   Username: ${ADMIN_USER:-admin}
   Password: ${login_pass}
   File:     ${CREDENTIALS_FILE:-$DATA_DIR/BOOTSTRAP-CREDENTIALS.txt}

 Firewall: open TCP 9287 for remote admin access.
 Host ops:  export YSK_EXECUTE=1   (and usually root)

 Support / Donate / YSK Limited:
   Panel → Support (/support)  ·  email@ysk.hk
   Linktree: https://linktr.ee/yanshekki
   Crypto:   yanshekki.eth (EVM) · yanshekki.near · \$yanshekki (ADA)
   Docs:     docs/INDEX.md · docs/getting-started/install.md

 Uninstall:
   ./uninstall.sh --all --keep-data --yes
   ./uninstall.sh --all --purge-data --yes

============================================================

EOF
}

# Product-only: npm pack overlay + restart. Never reinstall MariaDB/MySQL.
upgrade_product_only() {
  OPERATION=upgrade
  phase "product-upgrade"
  log "Product-only upgrade — apt stack is not touched (MySQL/MariaDB data stays)."
  log "To also refresh apt packages: install.sh --upgrade-stack"
  ensure_stack_assets
  manifest_require_jq
  DATA_DIR="${DATA_DIR:-$(default_data_dir)}"
  YSK_DATA_DIR="$DATA_DIR"
  local mpath="${DATA_DIR}/stack-manifest.json"
  manifest_load "$mpath"
  # Overlay first: running ExecStart tree (npm i -g EEXIST must not abort).
  local ov=0
  overlay_npm_onto_running || ov=$?
  if [[ "$ov" -ne 0 ]]; then
    warn "Overlay did not apply (code $ov) — trying npm install -g --force"
    install_product || true
    ov=0
    overlay_npm_onto_running || ov=$?
  fi
  ensure_unit_execute
  if [[ "$(id -u)" -eq 0 ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl try-restart ysk-server 2>/dev/null || true
  fi
  local ver=""
  ver="$("$CLI" --version 2>/dev/null || true)"
  if [[ "$ov" -eq 1 ]]; then
    record_hard_fail "Could not overlay $PKG onto the running install"
    err "Upgrade had hard failures — see ${INSTALL_LOG:-"(no log)"}"
    exit 1
  fi
  if [[ ${HARD_FAILURES[@]+x} ]] && [[ ${#HARD_FAILURES[@]} -gt 0 ]]; then
    err "Upgrade had hard failures — see ${INSTALL_LOG:-"(no log)"}"
    exit 1
  fi
  log "Upgrade done${ver:+ — $ver} — log: ${INSTALL_LOG:-"(no log)"}"
}

main() {
  setup_logging install "${INSTALL_ARGV[*]:-}"
  if [[ "$UPGRADE" -eq 1 && "$UPGRADE_STACK" -eq 0 ]]; then
    upgrade_product_only
    return 0
  fi
  OPERATION=install
  ensure_stack_assets
  manifest_require_jq

  DATA_DIR="${DATA_DIR:-$(default_data_dir)}"

  if [[ "$SKIP_WIZARD" -eq 1 ]]; then
    wizard_install_apply_defaults_noninteractive
  else
    wizard_install_run
  fi

  if [[ "$SKIP_RUNTIMES" -eq 1 ]]; then
    BUNDLES_CSV="$(printf '%s' "$BUNDLES_CSV" | tr ',' '\n' | grep -v '^runtimes$' | paste -sd, -)"
  fi

  local host_sql=""
  host_sql="$(detect_host_sql_engine || true)"
  if [[ -n "$host_sql" && "$host_sql" != "$SQL_SERVER" ]]; then
    warn "SQL requested=$SQL_SERVER but host already has $host_sql — keeping $host_sql (exclusive /var/lib/mysql)"
    SQL_SERVER="$host_sql"
    if [[ "$host_sql" == "mysql" ]]; then WITH_MYSQL_SERVER=1; else WITH_MYSQL_SERVER=0; fi
  fi
  resolve_components_from_bundles "$BUNDLES_CSV" "$SQL_SERVER" "$WITH_CLAMAV"
  wizard_print_summary

  # manifest init
  local mpath
  mpath="$(default_manifest_path)"
  # override data dir for path
  YSK_DATA_DIR="$DATA_DIR"
  mpath="${DATA_DIR}/stack-manifest.json"
  manifest_load "$mpath"
  local clamav_json=false
  [[ "$WITH_CLAMAV" -eq 1 ]] && clamav_json=true
  manifest_set_meta "$PLAN" "$DATA_DIR" "$BUNDLES_CSV" "$SQL_SERVER" "$clamav_json"

  install_selected_components
  install_node_globals
  install_product
  overlay_npm_onto_running
  run_setup
  run_bootstrap_tls
  install_systemd_unit
  ensure_unit_execute
  if [[ "$(id -u)" -eq 0 ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl try-restart ysk-server 2>/dev/null || true
  fi

  # verify (skip pure optional soft components that may not exist)
  local verify_list=()
  local id
  for id in "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}"; do
    case "$id" in
      rspamd|clamav) continue ;;
      control-plane-product) verify_list+=("$id") ;;
      *) verify_list+=("$id") ;;
    esac
  done
  verify_selected_components "${verify_list[@]+"${verify_list[@]}"}"

  manifest_save "$mpath"
  print_next

  if [[ ${HARD_FAILURES[@]+x} ]] && [[ ${#HARD_FAILURES[@]} -gt 0 ]]; then
    err "Completed with hard failures — see $INSTALL_LOG"
    exit 1
  fi
  log "Done — log: $INSTALL_LOG manifest: $mpath"
}

main
