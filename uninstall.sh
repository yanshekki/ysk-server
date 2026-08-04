#!/usr/bin/env bash
# YSK Server stack uninstall — partial or full, keep-data or purge-data
#
# Usage:
#   ./uninstall.sh                              # interactive wizard
#   ./uninstall.sh --bundles email,ftp --keep-data --yes
#   ./uninstall.sh --components nginx,certbot --keep-data --yes
#   ./uninstall.sh --all --purge-data --yes     # DANGEROUS
#
# Docs: docs/getting-started/uninstall.md · uninstall-ZH.md

set -euo pipefail

PRODUCT="YSK Server"
CLI="ysk-server"
NON_INTERACTIVE=0
UN_SCOPE=""
UN_BUNDLES_CSV=""
UN_COMPONENTS_CSV=""
DATA_POLICY="keep"
REMOVE_PRODUCT=0
UN_ALL=0
YES=0
DATA_DIR=""
OPERATION=uninstall

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
INSTALL_ROOT="${SCRIPT_DIR:-}"
INSTALL_ARGV=("$@")

usage() {
  cat <<EOF
$PRODUCT uninstaller — remove stack bundles/components

Interactive (default on TTY):
  ./uninstall.sh

Non-interactive:
  ./uninstall.sh --bundles web,email --keep-data --yes
  ./uninstall.sh --components nginx,postfix --keep-data --yes
  ./uninstall.sh --all --keep-data --yes
  ./uninstall.sh --all --purge-data --yes          # deletes registered data paths

Options:
  --all                   Remove all components recorded in stack-manifest
  --bundles LIST          Remove components belonging to these bundles
  --components LIST       Remove explicit component ids
  --keep-data             apt remove; keep DB/mail/data dirs (default)
  --purge-data            apt purge + delete registered dataPaths
  --remove-product        Also remove ysk-server npm CLI / unit / optional dataDir
  --data-dir PATH         Manifest location base (default: /var/lib/ysk-server or ~/.ysk)
  --yes                   Skip final confirmation (required for non-interactive)
  --non-interactive       No prompts (implies need --yes)
  -h, --help              Show help

Safety:
  - Only packages/paths recorded in manifest (or known component definitions)
  - purge refuses paths outside /var/*, /etc/letsencrypt, /usr/local/cargo|rustup
  - Default is keep-data

Logs: /var/log/ysk-server/uninstall-*.log
Manifest: \$dataDir/stack-manifest.json
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all) UN_ALL=1; UN_SCOPE=all; shift ;;
    --bundles) UN_BUNDLES_CSV="${2:-}"; UN_SCOPE=bundles; shift 2 ;;
    --components) UN_COMPONENTS_CSV="${2:-}"; UN_SCOPE=components; shift 2 ;;
    --keep-data) DATA_POLICY=keep; shift ;;
    --purge-data) DATA_POLICY=purge; shift ;;
    --remove-product) REMOVE_PRODUCT=1; shift ;;
    --data-dir) DATA_DIR="${2:-}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "${CI:-}" == "true" || "${CI:-}" == "1" ]]; then
  NON_INTERACTIVE=1
fi

load_libs() {
  local root="${INSTALL_ROOT:-}"
  local lib
  if [[ -n "$root" && -f "$root/install/lib/common.sh" ]]; then
    lib="$root/install/lib"
  else
    return 1
  fi
  # shellcheck source=/dev/null
  source "$lib/common.sh"
  # shellcheck source=/dev/null
  source "$lib/manifest.sh"
  # shellcheck source=/dev/null
  source "$lib/stack-ops.sh"
  # shellcheck source=/dev/null
  source "$lib/wizard-uninstall.sh"
}

if ! load_libs; then
  PRODUCT="YSK Server"
  log() { printf '[%s] %s\n' "$PRODUCT" "$*"; }
  err() { printf '[%s] ERROR: %s\n' "$PRODUCT" "$*" >&2; }
  raw="${YSK_INSTALL_RAW:-https://raw.githubusercontent.com/yanshekki/ysk-server/main}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/ysk-uninstall-XXXXXX")"
  log "Fetching uninstaller assets from $raw …"
  mkdir -p "$tmp/install/lib" "$tmp/deploy/stack"
  for f in install/lib/common.sh install/lib/manifest.sh install/lib/stack-ops.sh \
           install/lib/wizard-uninstall.sh \
           deploy/stack/bundles.json deploy/stack/components.json; do
    curl -fsSL "$raw/$f" -o "$tmp/$f" || {
      err "Failed to download $raw/$f"
      exit 1
    }
  done
  INSTALL_ROOT="$tmp"
  SCRIPT_DIR="$tmp"
  load_libs || {
    err "Failed to load uninstaller libraries"
    exit 1
  }
fi

trap 'on_err $LINENO $?' ERR

main() {
  setup_logging uninstall "${INSTALL_ARGV[*]:-}"
  OPERATION=uninstall
  ensure_stack_assets
  manifest_require_jq
  resolve_sudo

  DATA_DIR="${DATA_DIR:-$(default_data_dir)}"
  export YSK_DATA_DIR="$DATA_DIR"
  local mpath="${DATA_DIR}/stack-manifest.json"
  if [[ ! -f "$mpath" && -f /var/lib/ysk-server/stack-manifest.json ]]; then
    mpath=/var/lib/ysk-server/stack-manifest.json
  fi
  if [[ ! -f "$mpath" && -f "${HOME}/.ysk/stack-manifest.json" ]]; then
    mpath="${HOME}/.ysk/stack-manifest.json"
  fi

  manifest_load "$mpath"
  log "Using manifest: $mpath (exists=$([[ -f $mpath ]] && echo yes || echo no))"

  wizard_uninstall_run

  if [[ ${#UN_COMPONENT_LIST[@]} -eq 0 ]]; then
    warn "Nothing to remove"
    exit 0
  fi

  if [[ "$NON_INTERACTIVE" -eq 1 && "$YES" -ne 1 ]]; then
    record_hard_fail "non-interactive uninstall requires --yes"
    exit 1
  fi

  if [[ "$YES" -ne 1 && "$NON_INTERACTIVE" -eq 0 ]]; then
    # already confirmed in wizard when interactive
    :
  fi

  phase "uninstall-components"
  local id
  for id in "${UN_COMPONENT_LIST[@]+"${UN_COMPONENT_LIST[@]}"}"; do
    remove_component "$id" "$DATA_POLICY"
  done

  # refresh bundles list in manifest (drop bundles that no longer have components)
  if [[ -n "${UN_BUNDLES_CSV:-}" ]]; then
    local remaining
    remaining="$(printf '%s' "$MANIFEST_JSON" | jq -r --arg csv "$UN_BUNDLES_CSV" '
      ($csv | split(",")) as $rm
      | .bundles = ((.bundles // []) | map(select(. as $b | ($rm | index($b) | not))))
      | .updatedAt = (now | todateiso8601)
    ' 2>/dev/null || true)"
    if [[ -n "$remaining" ]]; then
      MANIFEST_JSON="$remaining"
    fi
  fi

  if [[ -f "$mpath" ]] || [[ ${#UN_COMPONENT_LIST[@]} -gt 0 ]]; then
    manifest_save "$mpath" || true
  fi

  cat <<EOF

============================================================
 $PRODUCT uninstall finished
============================================================
 Data policy: $DATA_POLICY
 Log:         ${INSTALL_LOG:-n/a}
 Manifest:    $mpath
 Removed:     ${UN_COMPONENT_LIST[*]}

 Re-install:
   ./install.sh
   ./install.sh --plan recommended --non-interactive

EOF
  log "Done — log: $INSTALL_LOG"
}

main
