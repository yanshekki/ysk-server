#!/usr/bin/env bash
# YSK Server — recover FTPS PASV + Node project 203/EXEC on a production host.
# Run as root on the panel host (e.g. hermes). Does NOT require the panel process.
#
# Usage:
#   sudo bash scripts/hermes-ftps-node-recover.sh
#   sudo bash scripts/hermes-ftps-node-recover.sh --node-major 26 --linux-user ysks_b8bff7fbe417
#
# Steps (in order):
#   B) Ensure Node under /usr/local/ysk/node/<major> (world-readable for project users)
#   C) Remind / open UFW for control + PASV ports (optional --apply-ufw)

set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-26}"
LINUX_USER="${LINUX_USER:-}"
APPLY_UFW=0
PASV_MIN="${PASV_MIN:-30000}"
PASV_MAX="${PASV_MAX:-30100}"
LISTEN_PORT="${LISTEN_PORT:-21}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node-major) NODE_MAJOR="$2"; shift 2 ;;
    --linux-user) LINUX_USER="$2"; shift 2 ;;
    --pasv-min) PASV_MIN="$2"; shift 2 ;;
    --pasv-max) PASV_MAX="$2"; shift 2 ;;
    --listen-port) LISTEN_PORT="$2"; shift 2 ;;
    --apply-ufw) APPLY_UFW=1; shift ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root (sudo)" >&2
  exit 1
fi

echo "=== YSK recover: Node (B) + FTPS ports (C) ==="
echo "NODE_MAJOR=$NODE_MAJOR LISTEN=$LISTEN_PORT PASV=${PASV_MIN}:${PASV_MAX}"

# ── B: Node for project users (never /root/.hermes) ─────────────────────────
echo
echo "── [B] Node binary for project users ──"
DEST="/usr/local/ysk/node/${NODE_MAJOR}"
mkdir -p /usr/local/ysk/node /tmp/ysk-node-install

need_tarball=1
if command -v node >/dev/null 2>&1; then
  CUR="$(node -v 2>/dev/null | sed 's/^v//' || true)"
  case "$CUR" in
    ${NODE_MAJOR}.*)
      mkdir -p "$DEST/bin"
      NODE_BIN="$(command -v node)"
      ln -sfn "$NODE_BIN" "$DEST/bin/node"
      if command -v npm >/dev/null 2>&1; then
        ln -sfn "$(command -v npm)" "$DEST/bin/npm" || true
      fi
      # If node is under /root, tarball is still required
      if [[ "$NODE_BIN" == /root/* ]] || [[ "$NODE_BIN" == *'/.hermes/'* ]]; then
        echo "Panel Node is private ($NODE_BIN) — installing official tarball for project users"
        need_tarball=1
      else
        echo "Linked existing Node $CUR → $DEST/bin/node"
        need_tarball=0
      fi
      ;;
  esac
fi

if [[ "$need_tarball" -eq 1 ]]; then
  echo "Installing official Node ${NODE_MAJOR}.x → $DEST"
  case "$(uname -m)" in aarch64|arm64) ARCH=linux-arm64 ;; *) ARCH=linux-x64 ;; esac
  cd /tmp/ysk-node-install
  rm -f SHASUMS256.txt node.tgz
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/SHASUMS256.txt" -o SHASUMS256.txt
  TARBALL=$(grep -E "node-v${NODE_MAJOR}\\.[0-9]+\\.[0-9]+-${ARCH}\\.tar\\.gz$" SHASUMS256.txt | awk '{print $2}' | head -1)
  if [[ -z "$TARBALL" ]]; then
    TARBALL=$(grep -E "node-v${NODE_MAJOR}\\.[0-9]+\\.[0-9]+-${ARCH}\\.tar\\.xz$" SHASUMS256.txt | awk '{print $2}' | head -1)
  fi
  if [[ -z "$TARBALL" ]]; then
    echo "ERROR: no tarball for Node ${NODE_MAJOR} / $ARCH" >&2
    exit 1
  fi
  curl -fsSL "https://nodejs.org/dist/latest-v${NODE_MAJOR}.x/$TARBALL" -o node.tgz
  rm -rf "$DEST"
  mkdir -p "$DEST"
  if echo "$TARBALL" | grep -q '\\.xz$'; then
    tar -C "$DEST" --strip-components=1 -xJf node.tgz
  else
    tar -C "$DEST" --strip-components=1 -xzf node.tgz
  fi
  # Ensure o+rx so ysks_* can traverse and exec
  chmod -R a+rX "$DEST"
  ln -sfn "$DEST/bin/node" /usr/local/bin/node || true
  ln -sfn "$DEST/bin/npm" /usr/local/bin/npm || true
fi

test -x "$DEST/bin/node"
echo "OK: $DEST/bin/node → $($DEST/bin/node -v)"

# Fix crash-looping project unit(s)
echo
echo "── [B] systemd project units ──"
shopt -s nullglob
UNITS=(/etc/systemd/system/ysk-project-*.service)
if [[ ${#UNITS[@]} -eq 0 ]]; then
  echo "No ysk-project-*.service under /etc/systemd/system"
else
  for u in "${UNITS[@]}"; do
    name="$(basename "$u")"
    if [[ -n "$LINUX_USER" && "$name" != "ysk-project-${LINUX_USER}.service" ]]; then
      continue
    fi
    echo "Unit: $name"
    if grep -q '/root/' "$u" 2>/dev/null || grep -q '\.hermes/' "$u" 2>/dev/null; then
      echo "  WARNING: ExecStart still points under /root or .hermes — redeploy from panel after this script"
      grep -E '^ExecStart=' "$u" || true
    fi
    systemctl stop "$name" 2>/dev/null || true
    systemctl reset-failed "$name" 2>/dev/null || true
    echo "  stopped + reset-failed"
  done
fi
echo "Next: open panel → project → 部署 (writes ExecStart=$DEST/bin/node ...)"

# ── C: FTPS ports ───────────────────────────────────────────────────────────
echo
echo "── [C] FTPS / PASV ports ──"
UFW_LINES=(
  "ufw allow ${LISTEN_PORT}/tcp"
  "ufw allow 990/tcp"
  "ufw allow ${PASV_MIN}:${PASV_MAX}/tcp"
)
echo "Recommended (host firewall + cloud security group):"
for line in "${UFW_LINES[@]}"; do
  echo "  sudo $line"
done

if [[ "$APPLY_UFW" -eq 1 ]]; then
  if command -v ufw >/dev/null 2>&1; then
    for line in "${UFW_LINES[@]}"; do
      # shellcheck disable=SC2086
      $line || true
    done
    ufw reload || true
    echo "UFW rules applied (idempotent)."
    ufw status numbered | head -40 || true
  else
    echo "ufw not installed — open the same ports on your cloud security group"
  fi
else
  echo "Dry-run only. Re-run with --apply-ufw to apply UFW (still open cloud SG yourself)."
fi

echo
echo "=== Done ==="
echo "B: Node ready at $DEST/bin/node — redeploy project from panel"
echo "C: open TCP ${LISTEN_PORT}, 990, ${PASV_MIN}-${PASV_MAX} on host + cloud SG"
echo "Then: FileZilla re-login; journalctl -u ysk-project-*.service -n 30"
