#!/usr/bin/env bash
# End-to-end real ops: create project → deploy Node (listen) → curl health → publish nginx → stop
# Usage: from repo root:  bash scripts/e2e-real-ops.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DATA_DIR="${YSK_E2E_DATA:-$(mktemp -d /tmp/ysk-e2e-XXXXXX)}"
PORT_API="${YSK_E2E_PORT:-18765}"
ADMIN_USER="${YSK_ADMIN_USER:-admin}"
ADMIN_PASS="${YSK_ADMIN_PASSWORD:-admin-e2e}"
export YSK_ADMIN_PASSWORD="$ADMIN_PASS"

log() { printf '[e2e-real-ops] %s\n' "$*"; }
fail() { printf '[e2e-real-ops] FAIL: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

log "Building packages…"
pnpm --filter @ysk/shared build
pnpm --filter @ysk/core build
pnpm --filter @ysk/server build
pnpm --filter @ysk/web build || log "web build optional for API-only path"

mkdir -p "$DATA_DIR"
log "dataDir=$DATA_DIR apiPort=$PORT_API"

log "Starting control plane…"
# Prefer compiled CLI; fall back to tsx if needed
if [[ -f apps/server/dist/cli.js ]]; then
  node apps/server/dist/cli.js serve --port "$PORT_API" --data-dir "$DATA_DIR" &
  SERVER_PID=$!
else
  fail "apps/server/dist/cli.js missing — run build first"
fi

# Wait for /health
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT_API}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
  if [[ $i -eq 40 ]]; then fail "API did not become healthy"; fi
done
log "API healthy"

# Web UI static (when dist exists)
if curl -fsS "http://127.0.0.1:${PORT_API}/" 2>/dev/null | head -c 200 | grep -qiE 'html|ysk|root|div'; then
  log "Web UI HTML served on /"
else
  log "Web UI not detected (build apps/web for full product entry)"
fi

STATUS=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/status")
echo "$STATUS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.mode) process.exit(9); process.stderr.write('mode='+j.mode+'\\n')})"

TOKEN=$(
  curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.token) process.exit(2); process.stdout.write(j.token)})"
) || fail "login failed"
AUTH="Authorization: Bearer ${TOKEN}"

NAME="e2e-$(date +%s)"
CREATE=$(
  curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"name\":\"${NAME}\",\"domain\":\"${NAME}.local\",\"runtime\":\"node\"}"
)
PROJECT_ID=$(printf '%s' "$CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); process.stdout.write(j.project.id)})")
log "Created project $PROJECT_ID"

DEPLOY=$(
  curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/deploy" \
    -H "$AUTH" -H 'Content-Type: application/json' \
    -d '{}'
)
APP_PORT=$(printf '%s' "$DEPLOY" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  if(!j.ok) { console.error(JSON.stringify(j,null,2)); process.exit(3); }
  if(!j.listening) process.exit(4);
  if(!j.port) process.exit(5);
  if(!j.health || !j.health.ok) process.exit(6);
  process.stderr.write('deploy ok port='+j.port+' pid='+j.pid+' url='+j.url+'\\n');
  process.stdout.write(String(j.port));
});
")
log "Deployed on port $APP_PORT"

# Direct curl to app (real listen)
BODY=$(curl -fsS "http://127.0.0.1:${APP_PORT}/")
echo "$BODY" | grep -q 'ok' || fail "app body missing ok: $BODY"
log "Direct curl OK: $BODY"

# API health
HEALTH=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/health" -H "$AUTH")
echo "$HEALTH" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||!j.listening) process.exit(7);})"
log "API health OK"

# Publish nginx
NGX=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/publish-nginx" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
NGX_PATH=$(printf '%s' "$NGX" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.parse(d).nginxPath||'')})")
[[ -n "$NGX_PATH" && -f "$NGX_PATH" ]] || fail "nginx path missing"
grep -q "proxy_pass http://127.0.0.1:${APP_PORT}" "$NGX_PATH" || fail "nginx conf missing upstream port"
log "Nginx conf OK: $NGX_PATH"

# Env + backup
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/env" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"env":{"YSK_E2E":"1","NODE_ENV":"production"}}' >/dev/null
BAK=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/backup" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
echo "$BAK" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||!j.archivePath) process.exit(10);})"
log "Backup OK"

# Logs list
LOGS=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/logs" -H "$AUTH")
echo "$LOGS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!Array.isArray(j.files)) process.exit(12);})"
log "Logs list OK"

# Inventory refresh
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/updates/inventory/refresh" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{"osv":false}' >/dev/null
log "Inventory refresh OK"

# Scheduler jobs
SCH=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/scheduler" -H "$AUTH")
echo "$SCH" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!Array.isArray(j.jobs)) process.exit(13);})"
log "Scheduler OK"

# Cron managed file
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cron" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"projectId\":\"${PROJECT_ID}\",\"schedule\":\"0 3 * * *\",\"command\":\"true\"}" >/dev/null
CRON_INSTALL=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cron/install" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' || true)
echo "$CRON_INSTALL" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d); if(j.ok===true) process.exit(0); if(!j.path) process.exit(11);}catch{process.exit(11)}})" || fail "cron install response invalid"
log "Cron managed path OK (install may require EXECUTE)"

# Stop
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/stop" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null
sleep 0.5
if curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
  fail "app still listening after stop"
fi
log "Stop OK — port closed"

# Email/SSL apply write-back smoke
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/system/ssl/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"domain\":\"${NAME}.local\",\"email\":\"admin@${NAME}.local\",\"run\":false}" >/dev/null
CERTS=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/system/ssl/certificates" -H "$AUTH")
echo "$CERTS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.items||!j.items.length) process.exit(8);})"
log "SSL certificate write-back OK"

# SSL PEM upload
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/ssl/upload" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"domain\":\"${NAME}.local\",\"fullchainPem\":\"-----BEGIN CERTIFICATE-----\\nMIIB\\n-----END CERTIFICATE-----\\n\",\"privkeyPem\":\"-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----\\n\"}" >/dev/null
log "SSL upload OK"

# Quota
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/quota" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"quotaMb":512}' >/dev/null
log "Quota OK"

# FTPS config
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/system/ftps/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"domain\":\"${NAME}.local\",\"install\":false}" >/dev/null
log "FTPS config OK"

# Cloudflare DNS dry-run (no token)
CF=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/hosting/dns/cloudflare/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"zone\":\"${NAME}.example\",\"serverIp\":\"203.0.113.10\",\"dryRun\":true}")
echo "$CF" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.planned||!j.planned.length) process.exit(14); if(j.requiresToken!==true&&j.dryRun!==true) process.exit(15);})"
log "Cloudflare DNS plan/dry-run OK"

# Resources limits
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PROJECT_ID}/resources" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"memoryMax":"256M","cpuQuotaPercent":50}' >/dev/null
log "Resources OK"

# fail2ban plan
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/system/fail2ban/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"apply":false}' >/dev/null
log "fail2ban jail.local OK"

# DNSBL check (loopback synthetic)
DNSBL=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/dnsbl/check" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"ip":"127.0.0.1"}')
echo "$DNSBL" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.results||!j.results.length) process.exit(16);})"
log "DNSBL multi-list OK"

# Warm-up plan
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/warmup" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"domain":"example.com","serverIp":"203.0.113.10"}' >/dev/null
log "Warm-up plan OK"

# Agent runtime probes
AG=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/agents/runtimes" -H "$AUTH")
echo "$AG" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.items||j.items.length<3) process.exit(17);})"
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/agents/runtimes/openclaw/unit" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null
log "Agent runtimes OK"

log "PASS — real ops vertical verified"
echo "PASS"
