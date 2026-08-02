#!/usr/bin/env bash
# YSK Server one-click bootstrap for Ubuntu 22.04 / 24.04
# Installs control plane + full system software stack (hosting / mail / DB / defense / runtimes).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash
#   ./install.sh --non-interactive
#   ./install.sh --upgrade
#   ./install.sh --minimal
#   ./install.sh --from-source --install-systemd
#
# Docs: docs/getting-started/install.md · install-ZH.md

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
# Default: install full system software (everything the panel/CLI may use)
FULL_STACK=1
SKIP_RUNTIMES=0
WITH_MYSQL_SERVER=0
WITH_CLAMAV=0
SUDO=""

log() { printf '[%s] %s\n' "$PRODUCT" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$PRODUCT" "$*" >&2; }
err() { printf '[%s] ERROR: %s\n' "$PRODUCT" "$*" >&2; }

usage() {
  cat <<EOF
$PRODUCT installer — control plane + full system software

Default installs ALL packages the panel/CLI may use (nginx, DBs, mail stack,
firewall, PHP/Go/Rust toolchains, etc.). Packages are installed; most services
are NOT force-enabled (configure via panel/CLI + YSK_EXECUTE=1).

Options:
  --non-interactive     No prompts (scripted deploy)
  --skip-setup          Install only; do not run '$CLI setup'
  --upgrade             Upgrade mode (reinstall / update npm package)
  --from-source         Install from current git checkout (development)
  --install-systemd     After setup, write/install ysk-server.service
  --full                Full system software (default)
  --minimal             Only base deps + Node + product (no hosting stack)
  --skip-runtimes       Skip PHP/Go/Rust/pm2 (still installs Node)
  --with-mysql-server   Install mysql-server instead of mariadb-server
  --with-clamav         Also install clamav (large)
  -h, --help            Show help

Docs: docs/getting-started/install.md
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --skip-setup) RUN_SETUP=0; shift ;;
    --upgrade) UPGRADE=1; shift ;;
    --from-source) INSTALL_FROM_SOURCE=1; shift ;;
    --install-systemd) INSTALL_SYSTEMD=1; shift ;;
    --full) FULL_STACK=1; shift ;;
    --minimal) FULL_STACK=0; shift ;;
    --skip-runtimes) SKIP_RUNTIMES=1; shift ;;
    --with-mysql-server) WITH_MYSQL_SERVER=1; shift ;;
    --with-clamav) WITH_CLAMAV=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) err "Unknown option: $1"; usage; exit 1 ;;
  esac
done

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

resolve_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    SUDO=""
    return 0
  fi
  if require_cmd sudo; then
    SUDO="sudo"
    return 0
  fi
  err "Root or sudo required to install system packages"
  return 1
}

apt_update() {
  $SUDO apt-get update -y
}

# Install packages; on failure try one-by-one for soft packages
apt_install_core() {
  # Use env so this works when SUDO is empty (running as root).
  # shellcheck disable=SC2086
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

apt_install_soft() {
  local pkg
  for pkg in "$@"; do
    # shellcheck disable=SC2086
    if $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$pkg" 2>/dev/null; then
      log "  + $pkg"
    else
      warn "optional package unavailable: $pkg (continuing)"
    fi
  done
}

preseed_postfix() {
  # Noninteractive postfix (no forced mailer configuration)
  echo "postfix postfix/main_mailer_type select No configuration" | $SUDO debconf-set-selections || true
  echo "postfix postfix/mailname string localhost" | $SUDO debconf-set-selections || true
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
  if [[ "$OS_ID" != "ubuntu" && "$OS_ID" != "debian" ]]; then
    log "Warning: official support targets Ubuntu 22.04/24.04; continuing best-effort"
  fi
}

install_base_deps() {
  if ! require_cmd apt-get; then
    err "apt-get not found; cannot install system packages"
    return 1
  fi
  resolve_sudo
  log "Installing base system dependencies..."
  apt_update
  apt_install_core \
    curl git ca-certificates build-essential gnupg \
    software-properties-common apt-transport-https \
    openssl jq unzip zip rsync tar cron logrotate \
    htop net-tools iproute2 dnsutils whois lsof procps sudo \
    acl attr
}

# Full hosting / mail / DB / defense stack from SOFTWARE_CATALOG + extras
install_hosting_stack() {
  if [[ "$FULL_STACK" -ne 1 ]]; then
    log "Minimal mode: skipping full hosting stack"
    return 0
  fi
  resolve_sudo
  log "Installing FULL system software stack (hosting / mail / DB / defense / FTP / DNS)..."
  log "Note: packages are installed; services are not all force-enabled."

  preseed_postfix

  # Core web + SSL
  apt_install_core \
    nginx apache2 \
    certbot python3-certbot-nginx \
    openssl

  apt_install_soft python3-certbot-apache

  # DB clients always; one SQL server default MariaDB
  apt_install_core \
    postgresql postgresql-client \
    redis-server redis-tools \
    sqlite3

  if [[ "$WITH_MYSQL_SERVER" -eq 1 ]]; then
    log "Installing mysql-server (not mariadb-server)"
    apt_install_soft mariadb-client mysql-client
    apt_install_core mysql-server
  else
    log "Installing mariadb-server (default; use --with-mysql-server for Oracle MySQL)"
    apt_install_soft mysql-client
    apt_install_core mariadb-server mariadb-client
  fi

  # Mail stack
  apt_install_core \
    postfix \
    dovecot-core dovecot-imapd dovecot-pop3d dovecot-lmtpd \
    opendkim opendkim-tools

  apt_install_soft rspamd

  if [[ "$WITH_CLAMAV" -eq 1 ]]; then
    log "Installing clamav (large)..."
    apt_install_soft clamav clamav-daemon
  fi

  # DNS
  apt_install_core pdns-server pdns-backend-bind
  apt_install_soft bind9-dnsutils

  # FTP
  apt_install_core vsftpd db-util libpam-modules

  # Defense
  apt_install_core ufw fail2ban

  # Backup / quota
  apt_install_soft restic quota

  log "Hosting stack package phase complete"
}

install_runtimes() {
  if [[ "$SKIP_RUNTIMES" -eq 1 ]]; then
    log "Skipping extra runtimes (--skip-runtimes)"
    return 0
  fi
  if [[ "$FULL_STACK" -ne 1 ]]; then
    return 0
  fi
  resolve_sudo
  log "Installing language runtimes (PHP / Python / Go)..."

  # PHP 8.2 + 8.3 common modules + FPM (Ubuntu 22.04 may only have 8.1/8.2)
  apt_install_soft \
    php php-cli php-fpm php-common \
    php-mysql php-pgsql php-sqlite3 php-redis \
    php-curl php-xml php-mbstring php-zip php-gd php-bcmath php-intl php-soap

  apt_install_soft \
    php8.1-cli php8.1-fpm php8.1-mysql php8.1-pgsql php8.1-curl php8.1-xml php8.1-mbstring php8.1-zip \
    php8.2-cli php8.2-fpm php8.2-mysql php8.2-pgsql php8.2-curl php8.2-xml php8.2-mbstring php8.2-zip \
    php8.3-cli php8.3-fpm php8.3-mysql php8.3-pgsql php8.3-curl php8.3-xml php8.3-mbstring php8.3-zip

  apt_install_core python3 python3-pip python3-venv
  apt_install_soft golang-go

  # Rust via rustup (optional network)
  if ! require_cmd cargo && ! require_cmd rustc; then
    log "Installing Rust toolchain via rustup (non-interactive)..."
    if curl -fsSL https://sh.rustup.rs | sh -s -- -y; then
      # shellcheck disable=SC1090
      [[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env" || true
      log "Rust installed (cargo=$(command -v cargo || echo pending-login-shell))"
    else
      warn "rustup failed; install later: https://rustup.rs"
    fi
  else
    log "Rust/cargo already present"
  fi
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
  resolve_sudo
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  # shellcheck disable=SC2086
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  log "Node.js $(node -v) / npm $(npm -v)"
}

install_node_globals() {
  if ! require_cmd npm; then
    warn "npm not found; skip pnpm/pm2"
    return 0
  fi
  log "Installing global npm tools (pnpm, pm2)..."
  if [[ "$(id -u)" -eq 0 ]]; then
    npm install -g pnpm@latest 2>/dev/null || npm install -g pnpm || warn "pnpm global install failed"
    npm install -g pm2@latest 2>/dev/null || npm install -g pm2 || warn "pm2 global install failed"
  else
    npm install -g pnpm@latest 2>/dev/null || npm install -g pnpm || warn "pnpm global install failed"
    npm install -g pm2@latest 2>/dev/null || npm install -g pm2 || warn "pm2 global install failed"
  fi
}

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

install_product() {
  if [[ "$INSTALL_FROM_SOURCE" -eq 1 ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    log "Installing from source: $SCRIPT_DIR"
    if require_cmd pnpm; then
      (cd "$SCRIPT_DIR" && pnpm install && pnpm build)
    else
      (cd "$SCRIPT_DIR" && npm install -g pnpm && pnpm install && pnpm build)
    fi
    embed_web_ui "$SCRIPT_DIR"
    (cd "$SCRIPT_DIR/apps/server" && npm link 2>/dev/null || true)
    export PATH="$SCRIPT_DIR/apps/server/dist:$PATH"
    local wrapper="/usr/local/bin/ysk-server"
    local local_wrapper="$HOME/.local/bin/ysk-server"
    local cli_js="$SCRIPT_DIR/apps/server/dist/cli.js"
    if [[ -f "$cli_js" ]]; then
      mkdir -p "$HOME/.local/bin" 2>/dev/null || true
      write_cli_wrapper() {
        local dest="$1"
        cat > "$dest" <<WRAP
#!/usr/bin/env bash
exec node "$cli_js" "\$@"
WRAP
        chmod +x "$dest"
      }
      if [[ "$(id -u)" -eq 0 ]]; then
        write_cli_wrapper "$wrapper" || true
      else
        write_cli_wrapper "$local_wrapper" 2>/dev/null || true
        if require_cmd sudo; then
          sudo bash -c "cat > $wrapper <<'WRAP'
#!/usr/bin/env bash
exec node $cli_js \"\$@\"
WRAP
chmod +x $wrapper" 2>/dev/null || true
        fi
      fi
      log "CLI wrapper ready (ysk-server). Ensure /usr/local/bin or ~/.local/bin is on PATH"
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
  elif [[ "$INSTALL_FROM_SOURCE" -eq 1 && -f "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/apps/server/dist/cli.js" ]]; then
    local root
    root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    log "Running setup via node dist/cli.js"
    node "$root/apps/server/dist/cli.js" setup --non-interactive --force || true
  else
    log "CLI binary not on PATH yet; run manually: $CLI setup"
  fi
}

install_systemd_unit() {
  if [[ "$INSTALL_SYSTEMD" -ne 1 ]]; then
    return 0
  fi
  local root
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local cli_js="$root/apps/server/dist/cli.js"
  if [[ ! -f "$cli_js" ]]; then
    log "No dist/cli.js — skip systemd"
    return 0
  fi
  local data="${YSK_DATA_DIR:-$HOME/.ysk}"
  log "Writing systemd unit for dataDir=$data"
  if [[ "$(id -u)" -eq 0 && "${YSK_EXECUTE:-}" == "1" ]]; then
    YSK_EXECUTE=1 node "$cli_js" system unit-install --enable --data-dir "$data" || log "unit-install enable failed"
  else
    node "$cli_js" system unit-install --data-dir "$data" || true
    log "Unit written under $data/systemd — enable with: YSK_EXECUTE=1 sudo $CLI system unit-install --enable --data-dir $data"
  fi
}

print_next() {
  cat <<EOF

============================================================
 $PRODUCT installation finished
============================================================
 Mode: $([[ "$FULL_STACK" -eq 1 ]] && echo "FULL system software" || echo "MINIMAL (control plane only)")

 Docs:
   docs/getting-started/install.md
   docs/getting-started/install-ZH.md

 Next steps:
   1. $CLI setup --non-interactive --data-dir /var/lib/ysk-server
   2. $CLI readiness --data-dir /var/lib/ysk-server --json
   3. $CLI serve --data-dir /var/lib/ysk-server --port 9287
      or: YSK_EXECUTE=1 sudo -E $CLI system unit-install --enable --data-dir /var/lib/ysk-server
   4. Open Web UI → login → enable 2FA → create project → deploy
   5. Host mutations need: export YSK_EXECUTE=1  (and often root)

 Installed packages are available on PATH; panel/CLI still apply configs
 honestly (written ≠ applied until EXECUTE).

 Commands:
   $CLI --help
   $CLI readiness --json
   $CLI serve --data-dir .ysk --port 9287
   $CLI update --check

 Optional env:
   YSK_EXECUTE=1          # allow system mutations (apt apply, ufw, …)
   YSK_ADMIN_PASSWORD=…   # initial admin password on first setup

EOF
}

main() {
  log "Starting installer (non-interactive=$NON_INTERACTIVE upgrade=$UPGRADE full=$FULL_STACK)"
  detect_os
  install_base_deps
  install_hosting_stack
  install_runtimes
  install_node
  install_node_globals
  install_product
  run_setup
  install_systemd_unit
  print_next
  log "Done"
}

main "$@"
