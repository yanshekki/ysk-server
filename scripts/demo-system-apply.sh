#!/usr/bin/env bash
# Demo system-level apply paths (dry by default).
# Usage:
#   ./scripts/demo-system-apply.sh
#   YSK_API=http://127.0.0.1:9287 ADMIN_PASS=admin ./scripts/demo-system-apply.sh
# With real mutations (DANGEROUS — needs root):
#   YSK_EXECUTE=1 APPLY_SYSTEM=1 ./scripts/demo-system-apply.sh

set -euo pipefail

API="${YSK_API:-http://127.0.0.1:9287}"
USER="${ADMIN_USER:-admin}"
PASS="${ADMIN_PASS:-admin}"
DOMAIN="${DEMO_DOMAIN:-demo.local}"

echo "== YSK Server system-apply demo =="
echo "API=$API domain=$DOMAIN"

TOKEN=$(curl -fsS -X POST "$API/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" | node -pe 'JSON.parse(fs.readFileSync(0,"utf8")).token')

echo "Logged in."

auth() { curl -fsS -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' "$@"; }

echo "-- protection probe --"
auth -X POST "$API/api/v1/protection/probe" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.protection.mode, j.details.join(" | "))'

echo "-- email apply (write configs) --"
auth -X POST "$API/api/v1/system/email/apply" \
  -d "{\"domain\":\"$DOMAIN\",\"installPackages\":false}" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.written.join("\n"))'

echo "-- php apply --"
auth -X POST "$API/api/v1/system/php/apply" \
  -d "{\"domain\":\"php.$DOMAIN\",\"poolName\":\"demo\",\"enableSite\":false}" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.written.join("\n"))'

echo "-- nginx site --"
auth -X POST "$API/api/v1/system/nginx/site" \
  -d "{\"serverName\":\"app.$DOMAIN\",\"upstream\":\"http://127.0.0.1:3000\",\"reload\":false}" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.written.join("\n"))'

echo "-- firewall plan (no apply unless APPLY_SYSTEM=1) --"
auth -X POST "$API/api/v1/system/firewall/apply" \
  -d "{\"allowSmtp\":true,\"apply\":${APPLY_SYSTEM:-false}}" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.commands.slice(0,5).join("\n"))'

echo "-- systemd unit template --"
auth -X POST "$API/api/v1/system/systemd/install" \
  -d "{\"enable\":false}" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.written.join("\n"), j.notes.join(" | "))'

if [[ "${APPLY_SYSTEM:-}" == "1" ]]; then
  echo "-- APPLY_SYSTEM=1: attempting email package install + certbot dry plan --"
  auth -X POST "$API/api/v1/system/email/apply" \
    -d "{\"domain\":\"$DOMAIN\",\"installPackages\":true}" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(JSON.stringify(j.commandResults,null,2))'
  auth -X POST "$API/api/v1/system/ssl/apply" \
    -d "{\"domain\":\"$DOMAIN\",\"email\":\"admin@$DOMAIN\",\"run\":false}" | node -pe 'const j=JSON.parse(fs.readFileSync(0,"utf8")); console.log(j.commands.join("\n"))'
else
  echo "Skip system mutations (set APPLY_SYSTEM=1 and YSK_EXECUTE=1 on server for real apt/ufw)."
fi

echo "Done."
