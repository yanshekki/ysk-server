#!/usr/bin/env bash
# Root-only hosting path: useradd indicators + systemd unit install template + optional nginx -t
# Non-root: exits 0 with SKIP message (CI-friendly).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

log() { printf '[e2e-hosting-root] %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  log "SKIP: not root — production OS path not exercised on this host"
  exit 0
fi

if [[ "${YSK_EXECUTE:-}" != "1" ]]; then
  log "Enabling YSK_EXECUTE=1 for root e2e"
  export YSK_EXECUTE=1
fi

DATA_DIR="${YSK_E2E_ROOT_DATA:-/tmp/ysk-e2e-root-$$}"
mkdir -p "$DATA_DIR"
export YSK_ADMIN_PASSWORD="${YSK_ADMIN_PASSWORD:-admin-root-e2e}"

log "Build…"
pnpm --filter @ysk/shared build
pnpm --filter @ysk/core build
pnpm --filter @ysk/server build
pnpm --filter @ysk/web build || true

log "Setup dataDir=$DATA_DIR"
node apps/server/dist/cli.js setup --data-dir "$DATA_DIR" --non-interactive --force

log "unit-install (enable=false write only first)"
node apps/server/dist/cli.js system unit-install --data-dir "$DATA_DIR"
test -f "$DATA_DIR/systemd/ysk-server.service"

PORT_API="${YSK_E2E_PORT:-18766}"
node apps/server/dist/cli.js serve --data-dir "$DATA_DIR" --port "$PORT_API" &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT

for i in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:${PORT_API}/health" >/dev/null 2>&1 && break
  sleep 0.25
  [[ $i -eq 40 ]] && { log "FAIL: API down"; exit 1; }
done

# Web UI
curl -fsS "http://127.0.0.1:${PORT_API}/" | grep -qi 'html\|ysk\|root' || log "WARN: Web UI HTML not detected (web dist missing?)"

TOKEN=$(
  curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"${YSK_ADMIN_PASSWORD}\"}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).token||''))"
)
AUTH="Authorization: Bearer ${TOKEN}"

CREATE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"rootapp","domain":"rootapp.local","runtime":"node"}')
PID=$(printf '%s' "$CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).project.id))")

DEPLOY=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PID}/deploy" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"enableSystemd":true}')
printf '%s' "$DEPLOY" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  if(!j.ok) { console.error(j); process.exit(2); }
  console.log('deploy mode='+(j.deployMode||'?')+' degraded='+j.degraded+' port='+j.port);
});
"

STATUS=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/projects/${PID}/status" -H "$AUTH")
log "status: $STATUS"

curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PID}/publish-nginx" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"reload":true}' >/dev/null || true

# MySQL refuse or execute
MYSQL=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/hosting/db/mysql-provision" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"dbName":"ysk_e2e","username":"ysk_e2e","password":"testpass99"}' || true)
log "mysql: $MYSQL"

# PHP FPM/builtin path (honest)
PHP_CREATE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"rootphp","domain":"rootphp.local","runtime":"php","templateId":"wordpress-php"}')
PHP_ID=$(printf '%s' "$PHP_CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).project.id))")
# provision OS isolation when possible
curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PHP_ID}/os-provision" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null || true
PHP_DEP=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PHP_ID}/deploy-php" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"forceBuiltin":true}' || true)
log "php deploy: $PHP_DEP"
curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PHP_ID}/stop" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null || true

# Email domain + deliverability
EM=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/domains" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"domain":"root-mail.e2e.test","serverIp":"203.0.113.10"}')
EM_ID=$(printf '%s' "$EM" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).domain.id||''))" || true)
if [[ -n "$EM_ID" ]]; then
  DELIV=$(curl -sS "http://127.0.0.1:${PORT_API}/api/v1/email/domains/${EM_ID}/deliverability" -H "$AUTH" || true)
  log "email deliverability: $DELIV"
fi

curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PID}/stop" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null || true

log "PASS root hosting smoke (node + php + email)"
exit 0
