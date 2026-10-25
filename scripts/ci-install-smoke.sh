#!/usr/bin/env bash
# Light installer checks for CI and local machines (no apt, no root).
# Does not install the product.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

bash -n install.sh
bash -n uninstall.sh
for f in install/lib/*.sh; do
  bash -n "$f"
done

bash install.sh --help >/dev/null
bash uninstall.sh --help >/dev/null

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c install/checksums.sha256
elif command -v shasum >/dev/null 2>&1; then
  mismatch=0
  while read -r hash path; do
    [[ -z "${hash:-}" || "${hash}" == \#* ]] && continue
    got="$(shasum -a 256 "$path" | awk '{print $1}')"
    if [[ "$got" != "$hash" ]]; then
      echo "checksum mismatch: $path" >&2
      mismatch=1
    fi
  done < install/checksums.sha256
  if [[ "$mismatch" -ne 0 ]]; then
    exit 1
  fi
else
  echo "sha256sum/shasum missing — cannot verify install/checksums.sha256" >&2
  exit 1
fi

python3 -m json.tool deploy/stack/bundles.json >/dev/null
python3 -m json.tool deploy/stack/components.json >/dev/null

echo "install smoke OK"
