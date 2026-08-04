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
PKG="ysk-server"
MIN_NODE_MAJOR=20
NON_INTERACTIVE=0
RUN_SETUP=1
UPGRADE=0
INSTALL_FROM_SOURCE=0
INSTALL_SYSTEMD=0
WITH_MYSQL_SERVER=0
WITH_CLAMAV=0
PLAN=""
BUNDLES_CSV=""
SQL_SERVER="mariadb"
DATA_DIR=""
SKIP_WIZARD=0
OPERATION=install

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
  --upgrade               Reinstall/upgrade npm package
  --from-source           Build from current git checkout
  --install-systemd       Write systemd unit after setup
  --with-mysql-server     Use mysql-server instead of mariadb-server
  --with-clamav           Include ClamAV when email bundle selected
  --data-dir PATH         Panel data directory
  --full                  Alias for --plan full
  --minimal               Alias for --plan minimal
  --skip-runtimes         Remove 'runtimes' from selected bundles
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
    --from-source) INSTALL_FROM_SOURCE=1; shift ;;
    --install-systemd) INSTALL_SYSTEMD=1; shift ;;
    --with-mysql-server) WITH_MYSQL_SERVER=1; SQL_SERVER=mysql; shift ;;
    --with-clamav) WITH_CLAMAV=1; shift ;;
    --full) PLAN=full; shift ;;
    --minimal) PLAN=minimal; shift ;;
    --skip-runtimes) SKIP_RUNTIMES=1; shift ;;
    --plan) PLAN="${2:-}"; shift 2 ;;
    --bundles) BUNDLES_CSV="${2:-}"; PLAN="${PLAN:-custom}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --skip-wizard) SKIP_WIZARD=1; NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

# CI convenience
if [[ "${CI:-}" == "true" || "${CI:-}" == "1" ]]; then
  NON_INTERACTIVE=1
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
  raw="${YSK_INSTALL_RAW:-https://raw.githubusercontent.com/yanshekki/ysk-server/main}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ysk-install-XXXXXX")"
  log "Fetching installer assets from $raw …"
  mkdir -p "$tmp/install/lib" "$tmp/deploy/stack"
  for f in install/lib/common.sh install/lib/manifest.sh install/lib/stack-ops.sh \
           install/lib/verify.sh install/lib/wizard-install.sh \
           deploy/stack/bundles.json deploy/stack/components.json; do
    curl -fsSL "$raw/$f" -o "$tmp/$f" || {
      err "Failed to download $raw/$f"
      exit 1
    }
  done
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
  log "Web UI dist missing — run pnpm --filter @ysk/web build (API-only until then)"
}

install_node_globals() {
  phase "node-globals"
  if ! require_cmd npm; then
    record_hard_fail "npm not found"
    return 1
  fi
  log "Installing global npm tools (pnpm, pm2)..."
  npm install -g pnpm@latest 2>/dev/null || npm install -g pnpm || warn "pnpm install failed"
  npm install -g pm2@latest 2>/dev/null || npm install -g pm2 || warn "pm2 install failed"
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
    if require_cmd pnpm; then
      (cd "$src_root" && pnpm install && pnpm build)
    else
      (cd "$src_root" && npm install -g pnpm && pnpm install && pnpm build)
    fi
    embed_web_ui "$src_root"
    (cd "$src_root/apps/server" && npm link 2>/dev/null || true)
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
          sudo tee "$wrapper" >/dev/null <<WRAP
#!/usr/bin/env bash
exec node $cli_js "\$@"
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
  if [[ "$(id -u)" -eq 0 ]]; then
    npm install -g "$PKG@latest" || npm install -g "$PKG"
  else
    npm install -g "$PKG@latest" || npm install -g "$PKG" || {
      record_hard_fail "Global npm install failed for $PKG"
      return 1
    }
  fi
  manifest_add_component "control-plane-product" "" "ysk-server" "" "npm"
}

run_setup() {
  phase "setup"
  if [[ "$RUN_SETUP" -ne 1 ]]; then
    log "Skipping setup (--skip-setup)"
    return 0
  fi
  export YSK_DATA_DIR="${DATA_DIR}"
  local setup_cmd=("$CLI" setup --non-interactive --data-dir "$DATA_DIR")
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    setup_cmd+=(--force)
  fi
  if require_cmd "$CLI"; then
    log "Running: ${setup_cmd[*]}"
    "${setup_cmd[@]}" || log "setup returned non-zero (config may already exist)"
  else
    log "CLI not on PATH yet; run: $CLI setup --data-dir $DATA_DIR"
  fi
}

install_systemd_unit() {
  if [[ "$INSTALL_SYSTEMD" -ne 1 ]]; then
    return 0
  fi
  phase "systemd"
  if ! require_cmd "$CLI" && [[ "$INSTALL_FROM_SOURCE" -ne 1 ]]; then
    log "No CLI for unit-install — skip"
    return 0
  fi
  log "Writing systemd unit for dataDir=$DATA_DIR"
  if [[ "$(id -u)" -eq 0 && "${YSK_EXECUTE:-}" == "1" ]]; then
    YSK_EXECUTE=1 "$CLI" system unit-install --enable --data-dir "$DATA_DIR" || log "unit-install enable failed"
  elif require_cmd "$CLI"; then
    "$CLI" system unit-install --data-dir "$DATA_DIR" || true
    log "Unit written — enable with: YSK_EXECUTE=1 sudo $CLI system unit-install --enable --data-dir $DATA_DIR"
  fi
}

print_next() {
  cat <<EOF

============================================================
 $PRODUCT installation finished
============================================================
 Plan:     ${PLAN:-custom}
 Bundles:  $BUNDLES_CSV
 Log:      ${INSTALL_LOG:-n/a}
 Manifest: ${MANIFEST_PATH:-n/a}
 Data dir: $DATA_DIR

 Next:
   1. $CLI setup --non-interactive --data-dir $DATA_DIR
   2. $CLI readiness --data-dir $DATA_DIR --json
   3. $CLI serve --data-dir $DATA_DIR --port 9287
   4. Open Web UI → login → enable 2FA

 Host mutations need: export YSK_EXECUTE=1  (and often root)

 Uninstall (partial or full):
   ./uninstall.sh
   ./uninstall.sh --bundles email --keep-data --yes
   ./uninstall.sh --all --purge-data --yes

 Docs: docs/getting-started/install.md · uninstall.md

EOF
}

main() {
  setup_logging install "${INSTALL_ARGV[*]:-}"
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
  run_setup
  install_systemd_unit

  # verify (skip pure optional soft components that may not exist)
  local verify_list=()
  local id
  for id in "${SELECTED_COMPONENTS[@]+"${SELECTED_COMPONENTS[@]}"}"; do
    case "$id" in
      rspamd|clamav|apache2) continue ;;
      control-plane-product) verify_list+=("$id") ;;
      *) verify_list+=("$id") ;;
    esac
  done
  verify_selected_components "${verify_list[@]+"${verify_list[@]}"}"

  manifest_save "$mpath"
  print_next

  if [[ ${#HARD_FAILURES[@]} -gt 0 ]]; then
    err "Completed with hard failures — see $INSTALL_LOG"
    exit 1
  fi
  log "Done — log: $INSTALL_LOG manifest: $mpath"
}

main
