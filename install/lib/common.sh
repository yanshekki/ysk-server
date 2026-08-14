#!/usr/bin/env bash
# Shared helpers for install.sh / uninstall.sh
# shellcheck shell=bash

PRODUCT="${PRODUCT:-YSK Server}"
CLI="${CLI:-ysk-server}"
PKG="${PKG:-ysk-server}"
MIN_NODE_MAJOR="${MIN_NODE_MAJOR:-20}"
SUDO="${SUDO:-}"
INSTALL_LOG="${INSTALL_LOG:-}"
LOG_DIR="${LOG_DIR:-}"
PHASE="${PHASE:-init}"
OPERATION="${OPERATION:-install}"

# -g: this file is sourced from load_libs() — without -g the arrays die
# when that function returns (set -u → HARD_FAILURES: unbound variable).
declare -ga HARD_FAILURES=()
declare -ga SOFT_SKIPS=()
declare -ga VERIFY_OK=()
declare -ga VERIFY_FAIL=()

log() { printf '[%s] %s\n' "$PRODUCT" "$*"; }
warn() { printf '[%s] WARN: %s\n' "$PRODUCT" "$*" >&2; }
err() { printf '[%s] ERROR: %s\n' "$PRODUCT" "$*" >&2; }

phase() {
  PHASE="$1"
  log "======== phase: $PHASE ========"
}

record_hard_fail() {
  HARD_FAILURES+=("$1")
  err "$1"
}

on_err() {
  local line="${1:-?}"
  local ec="${2:-1}"
  err "Abort at line ${line} (exit ${ec}) during phase '${PHASE}' (${OPERATION})"
  err "Full log: ${INSTALL_LOG:-"(not opened)"}"
  if [[ ${#HARD_FAILURES[@]} -gt 0 ]]; then
    err "Hard failures:"
    local f
    for f in "${HARD_FAILURES[@]}"; do
      err "  - $f"
    done
  fi
  if [[ -n "${INSTALL_LOG:-}" && -f "$INSTALL_LOG" ]]; then
    err "Tail of log (last 40 lines):"
    tail -n 40 "$INSTALL_LOG" 2>/dev/null || true
  fi
}

setup_logging() {
  local kind="${1:-install}"
  local extra="${2:-}"
  local ts
  ts="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo unknown)"
  if [[ "$(id -u)" -eq 0 ]]; then
    LOG_DIR="/var/log/ysk-server"
  else
    LOG_DIR="${HOME}/.ysk/logs"
  fi
  mkdir -p "$LOG_DIR" 2>/dev/null || {
    LOG_DIR="${TMPDIR:-/tmp}/ysk-server-logs"
    mkdir -p "$LOG_DIR"
  }
  INSTALL_LOG="${LOG_DIR}/${kind}-${ts}.log"
  exec > >(tee -a "$INSTALL_LOG") 2>&1
  log "Log file: $INSTALL_LOG"
  log "Started at $(date -Is 2>/dev/null || date) uid=$(id -u) user=$(id -un 2>/dev/null || echo '?')"
  [[ -n "$extra" ]] && log "Args: $extra"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || return 1
}

find_bin() {
  local b="$1"
  if command -v "$b" >/dev/null 2>&1; then
    command -v "$b"
    return 0
  fi
  local p
  for p in "/usr/local/sbin/$b" "/usr/local/bin/$b" "/usr/sbin/$b" "/usr/bin/$b" "/sbin/$b" "/bin/$b" \
           "/usr/local/cargo/bin/$b" "${HOME}/.cargo/bin/$b" "/root/.cargo/bin/$b"; do
    if [[ -x "$p" ]]; then
      printf '%s\n' "$p"
      return 0
    fi
  done
  # Debian/Ubuntu PostgreSQL: /usr/lib/postgresql/16/bin/postgres is not on PATH
  # (same set as packages/core/.../resolve-bin.ts PG_VERSIONED_BINS).
  case "$b" in
    postgres|pg_ctl|initdb|pg_isready|pg_dump|pg_restore|createdb|dropdb|createuser|dropuser)
      p="$(ls -1 /usr/lib/postgresql/*/bin/"$b" 2>/dev/null | sort -V | tail -n 1 || true)"
      if [[ "$p" == /* && -x "$p" ]]; then
        printf '%s\n' "$p"
        return 0
      fi
      ;;
  esac
  return 1
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
  err "Root or sudo required"
  return 1
}

# Resolve paths for stack JSON + lib (repo checkout or fetched assets)
resolve_stack_root() {
  local candidate
  if [[ -n "${YSK_STACK_ROOT:-}" && -d "$YSK_STACK_ROOT" ]]; then
    STACK_ROOT="$YSK_STACK_ROOT"
    return 0
  fi
  if [[ -n "${INSTALL_ROOT:-}" && -f "$INSTALL_ROOT/deploy/stack/bundles.json" ]]; then
    STACK_ROOT="$INSTALL_ROOT"
    return 0
  fi
  if [[ -n "${SCRIPT_DIR:-}" && -f "$SCRIPT_DIR/deploy/stack/bundles.json" ]]; then
    STACK_ROOT="$SCRIPT_DIR"
    return 0
  fi
  # walk up from SCRIPT_DIR
  candidate="${SCRIPT_DIR:-.}"
  if [[ -f "$candidate/deploy/stack/bundles.json" ]]; then
    STACK_ROOT="$candidate"
    return 0
  fi
  if [[ -f "$candidate/../deploy/stack/bundles.json" ]]; then
    STACK_ROOT="$(cd "$candidate/.." && pwd)"
    return 0
  fi
  return 1
}

ensure_stack_assets() {
  if resolve_stack_root; then
    BUNDLES_JSON="$STACK_ROOT/deploy/stack/bundles.json"
    COMPONENTS_JSON="$STACK_ROOT/deploy/stack/components.json"
    return 0
  fi
  local raw="${YSK_INSTALL_RAW:-https://raw.githubusercontent.com/yanshekki/ysk-server/main}"
  local tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ysk-stack-XXXXXX")"
  log "Fetching stack definitions from $raw …"
  mkdir -p "$tmp/deploy/stack" "$tmp/install/lib"
  local f
  for f in deploy/stack/bundles.json deploy/stack/components.json \
           install/lib/common.sh install/lib/manifest.sh install/lib/verify.sh \
           install/lib/stack-ops.sh install/lib/wizard-install.sh install/lib/wizard-uninstall.sh; do
    if ! curl -fsSL "$raw/$f" -o "$tmp/$f"; then
      record_hard_fail "failed to fetch $raw/$f"
      return 1
    fi
  done
  STACK_ROOT="$tmp"
  INSTALL_ROOT="$tmp"
  BUNDLES_JSON="$STACK_ROOT/deploy/stack/bundles.json"
  COMPONENTS_JSON="$STACK_ROOT/deploy/stack/components.json"
  export YSK_STACK_ROOT="$STACK_ROOT"
  log "Stack assets cached at $tmp"
}

apt_update() {
  log "apt-get update..."
  # shellcheck disable=SC2086
  if ! $SUDO apt-get update -y; then
    record_hard_fail "apt-get update failed"
    return 1
  fi
}

apt_install_core() {
  if [[ $# -eq 0 ]]; then return 0; fi
  log "apt install (required): $*"
  # Allow downgrades: sury/PPA meta packages can resolve to an older default series
  # than already-held phpX.Y-* packages; without this, upgrade aborts mid-stack.
  # shellcheck disable=SC2086
  if ! $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "$@"; then
    local pkg failed=0
    for pkg in "$@"; do
      log "  retry single: $pkg"
      # shellcheck disable=SC2086
      if $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "$pkg"; then
        log "  + $pkg OK"
      else
        record_hard_fail "required package failed: $pkg"
        failed=1
      fi
    done
    return "$failed"
  fi
  local pkg
  for pkg in "$@"; do log "  + $pkg"; done
}

apt_install_optional() {
  local pkg
  for pkg in "$@"; do
    log "apt install (optional): $pkg"
    # --no-remove: Ubuntu mysql-client Conflicts with MariaDB and would
    # purge mariadb-server. Optional must never evict a required engine.
    # shellcheck disable=SC2086
    if $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades --no-remove "$pkg"; then
      log "  + $pkg (optional OK)"
    else
      warn "optional package skipped (unavailable or would remove installed packages): $pkg"
      SOFT_SKIPS+=("$pkg")
    fi
  done
}

apt_remove_pkgs() {
  local mode="$1" # remove | purge
  shift
  if [[ $# -eq 0 ]]; then return 0; fi
  log "apt $mode: $*"
  # shellcheck disable=SC2086
  if [[ "$mode" == "purge" ]]; then
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get purge -y "$@" || warn "apt purge had errors (continuing)"
  else
    $SUDO env DEBIAN_FRONTEND=noninteractive apt-get remove -y "$@" || warn "apt remove had errors (continuing)"
  fi
}

default_data_dir() {
  if [[ "$(id -u)" -eq 0 ]]; then
    printf '%s\n' "${YSK_DATA_DIR:-/var/lib/ysk-server}"
  else
    printf '%s\n' "${YSK_DATA_DIR:-$HOME/.ysk}"
  fi
}

default_manifest_path() {
  local dd
  dd="$(default_data_dir)"
  printf '%s\n' "${YSK_STACK_MANIFEST:-$dd/stack-manifest.json}"
}

is_tty() {
  [[ -t 0 && -t 1 ]] || return 1
}

prompt_yn() {
  # prompt_yn "Question?" default_y|default_n
  local q="$1"
  local def="${2:-default_y}"
  local hint ans
  if [[ "$NON_INTERACTIVE" -eq 1 ]] || ! is_tty; then
    [[ "$def" == "default_y" ]] && return 0
    return 1
  fi
  if [[ "$def" == "default_y" ]]; then hint="[Y/n]"; else hint="[y/N]"; fi
  printf '%s %s ' "$q" "$hint" >&2
  read -r ans || true
  ans="$(printf '%s' "${ans:-}" | tr '[:upper:]' '[:lower:]')"
  if [[ -z "$ans" ]]; then
    [[ "$def" == "default_y" ]] && return 0
    return 1
  fi
  [[ "$ans" == "y" || "$ans" == "yes" ]]
}

prompt_line() {
  local q="$1"
  local def="${2:-}"
  local ans
  if [[ "$NON_INTERACTIVE" -eq 1 ]] || ! is_tty; then
    printf '%s\n' "$def"
    return 0
  fi
  if [[ -n "$def" ]]; then
    printf '%s [%s]: ' "$q" "$def" >&2
  else
    printf '%s: ' "$q" >&2
  fi
  read -r ans || true
  if [[ -z "${ans:-}" ]]; then
    printf '%s\n' "$def"
  else
    printf '%s\n' "$ans"
  fi
}

csv_contains() {
  local needle="$1"
  local csv="$2"
  local IFS=','
  local x
  for x in $csv; do
    x="$(echo "$x" | tr -d '[:space:]')"
    [[ "$x" == "$needle" ]] && return 0
  done
  return 1
}

array_contains() {
  local needle="$1"
  shift
  local x
  for x in "$@"; do
    [[ "$x" == "$needle" ]] && return 0
  done
  return 1
}
