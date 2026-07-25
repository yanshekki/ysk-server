#!/usr/bin/env bash
# YSK Server one-click bootstrap for Ubuntu 22.04 / 24.04
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash
#   ./install.sh --non-interactive
#   ./install.sh --upgrade

set -euo pipefail

PRODUCT="YSK Server"
CLI="ysk-server"
PKG="ysk-server"
MIN_NODE_MAJOR=20
NON_INTERACTIVE=0
RUN_SETUP=1
UPGRADE=0
INSTALL_FROM_SOURCE=0

log() { printf '[%s] %s\n' "$PRODUCT" "$*"; }
err() { printf '[%s] ERROR: %s\n' "$PRODUCT" "$*" >&2; }

usage() {
  cat <<EOF
$PRODUCT installer

Options:
  --non-interactive   No prompts (scripted deploy)
  --skip-setup        Install only; do not run '$CLI setup'
  --upgrade           Upgrade mode (reinstall / update package)
  --from-source       Install from current git checkout (development)
  -h, --help          Show help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --skip-setup) RUN_SETUP=0; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    --from-source) INSTALL_FROM_SOURCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-unknown}"
    OS_VER="${VERSION_ID:-unknown}"
  else
    OS_ID="unknown"
    OS_VER="unknown"
  fi
  log "Detected OS: ${OS_ID} ${OS_VER}"
  if [[ "$OS_ID" != "ubuntu" ]]; then
    log "Warning: official support targets Ubuntu 22.04/24.04; continuing best-effort"
  fi
}

install_system_deps() {
  if ! require_cmd apt-get; then
    log "apt-get not found; skip system package install"
    return 0
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    if require_cmd sudo; then
      SUDO="sudo"
    else
      err "Root or sudo required to install system dependencies"
      return 1
    fi
  else
    SUDO=""
  fi
  log "Installing system dependencies (curl, git, build-essential, ca-certificates)..."
  $SUDO apt-get update -y
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl git ca-certificates build-essential gnupg
}

install_node() {
  if require_cmd node; then
    NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$NODE_MAJOR" -ge "$MIN_NODE_MAJOR" ]]; then
      log "Node.js $(node -v) already installed"
      return 0
    fi
    log "Node.js too old ($(node -v)); installing LTS via NodeSource"
  else
    log "Installing Node.js LTS via NodeSource"
  fi
  if ! require_cmd curl; then
    err "curl required to install Node.js"
    return 1
  fi
  if [[ "$(id -u)" -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  log "Node.js $(node -v) / npm $(npm -v)"
}

install_product() {
  if [[ "$INSTALL_FROM_SOURCE" -eq 1 ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    log "Installing from source: $SCRIPT_DIR"
    if require_cmd pnpm; then
      (cd "$SCRIPT_DIR" && pnpm install && pnpm build)
    else
      (cd "$SCRIPT_DIR" && npm install -g pnpm && pnpm install && pnpm build)
    fi
    (cd "$SCRIPT_DIR/apps/server" && npm link 2>/dev/null || true)
    # Prefer local bin
    export PATH="$SCRIPT_DIR/apps/server/dist:$PATH"
    if [[ -f "$SCRIPT_DIR/apps/server/dist/cli.js" ]]; then
      $SUDO ln -sfn "$SCRIPT_DIR/apps/server/dist/cli.js" /usr/local/bin/ysk-server 2>/dev/null || \
        ln -sfn "$SCRIPT_DIR/apps/server/dist/cli.js" "$HOME/.local/bin/ysk-server" 2>/dev/null || true
    fi
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
      log "Global npm install failed; try: npm install -g $PKG"
      return 1
    }
  fi
}

run_setup() {
  if [[ "$RUN_SETUP" -ne 1 ]]; then
    log "Skipping setup (--skip-setup)"
    return 0
  fi
  if ! require_cmd "$CLI" && ! require_cmd node; then
    err "$CLI not found after install"
    return 1
  fi
  local setup_cmd=("$CLI" setup --non-interactive)
  if [[ "$NON_INTERACTIVE" -eq 1 ]]; then
    setup_cmd+=(--force)
  fi
  if require_cmd "$CLI"; then
    log "Running: ${setup_cmd[*]}"
    "${setup_cmd[@]}" || log "setup returned non-zero (config may already exist)"
  else
    log "CLI binary not on PATH yet; run manually: $CLI setup"
  fi
}

print_next() {
  cat <<EOF

============================================================
 $PRODUCT installation finished
============================================================
 Next steps:
   1. $CLI setup --non-interactive --data-dir /var/lib/ysk-server
   2. $CLI serve --data-dir /var/lib/ysk-server --port 8787
      or: sudo cp deploy/ysk-server.service /etc/systemd/system/ && systemctl enable --now ysk-server
   3. Open Web UI → login → Projects → Deploy Node (real listen)
   4. Real-ops guide: docs/deploy/real-ops.md
   5. Verify: bash scripts/e2e-real-ops.sh

 Commands:
   $CLI --help
   $CLI serve --data-dir .ysk --port 8787
   $CLI update --check
   $CLI update --apply   # needs network + YSK_EXECUTE=1
   $CLI ask "show system info"
   $CLI tools --json

 Optional env:
   YSK_EXECUTE=1          # allow system mutations (apt, ufw, certbot, …)
   YSK_PROBE_ON_START=1   # run protection probe on serve start
   YSK_ADMIN_PASSWORD=…  # initial admin password on first boot

EOF
}

main() {
  log "Starting installer (non-interactive=$NON_INTERACTIVE upgrade=$UPGRADE)"
  detect_os
  install_system_deps
  install_node
  install_product
  run_setup
  print_next
}

main "$@"
