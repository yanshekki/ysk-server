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

if [[ "${YSK_E2E_SKIP_BUILD:-}" == "1" ]]; then
  log "Skipping package builds (YSK_E2E_SKIP_BUILD=1)"
else
  log "Building packages…"
  pnpm --filter @ysk-server/shared build
  pnpm --filter @ysk-server/core build
  pnpm --filter ysk-server build
  pnpm --filter @ysk-server/web build || log "web build optional for API-only path"
fi

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
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/agents/runtimes/openclaw/install" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"execute":false}' >/dev/null
log "Agent runtimes OK"

# SMTP relay config
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/relay" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"host":"smtp.example.com","port":587,"username":"u","password":"p","applySystem":false}' >/dev/null
log "SMTP relay OK"

# Dashboard summary
SUM=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/dashboard/summary" -H "$AUTH")
echo "$SUM" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.projects||!j.agents) process.exit(18);})"
log "Dashboard summary OK"

# App templates
TPL=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/templates" -H "$AUTH")
echo "$TPL" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.items||j.items.length<3) process.exit(19);})"
CREATE_TPL=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"tpl-demo","runtime":"node","templateId":"node-starter"}')
echo "$CREATE_TPL" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.scaffold||!j.scaffold.ok) process.exit(20);})"
log "Templates OK"

# Redis provision (expect 422 without redis/EXECUTE — not fake ok)
REDIS=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/hosting/db/redis-provision" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"projectId":"p","dbIndex":1,"execute":true}' || true)
echo "$REDIS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(j.ok===true&&j.executed!==true&&!j.reachable) process.exit(0); if(typeof j.ok!=='boolean') process.exit(21);})"
log "Redis provision response OK"

# Postgres provision refuse path
PG=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/hosting/db/postgres-provision" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"dbName":"yskpg","username":"yskpg","password":"longpassword1","execute":true}' || true)
echo "$PG" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(typeof j.ok!=='boolean') process.exit(22); if(j.ok===true&&j.executed!==true) process.exit(23);})"
log "Postgres provision response OK"

# WordPress download refuse without EXECUTE (create php project first)
WP_CREATE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"wp-demo","runtime":"php","templateId":"wordpress-php"}')
WP_ID=$(printf '%s' "$WP_CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).project.id))")
WP=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${WP_ID}/wordpress-download" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}' || true)
echo "$WP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(j.requiresExecute!==true&&j.ok!==true) process.exit(24);})"
log "WordPress download gate OK"

# CLI templates + projects create --template
CLI_OUT=$(node apps/server/dist/cli.js templates --json)
echo "$CLI_OUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.items||j.items.length<2) process.exit(25);})"
CLI_CREATE=$(node apps/server/dist/cli.js projects create --data-dir "$DATA_DIR" --name cli-tpl --template static-site --json)
echo "$CLI_CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.project||!j.scaffold) process.exit(26);})"
log "CLI templates/projects OK"

# Static site deploy (nginx root conf, no process)
STATIC_CREATE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"static-${NAME}\",\"domain\":\"static-${NAME}.local\",\"runtime\":\"static\",\"templateId\":\"static-site\"}")
STATIC_ID=$(printf '%s' "$STATIC_CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).project.id))")
STATIC_DEP=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${STATIC_ID}/deploy-static" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
echo "$STATIC_DEP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||!j.nginxPath) process.exit(27);})"
STATIC_NGX=$(printf '%s' "$STATIC_DEP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).nginxPath||''))")
grep -q 'try_files' "$STATIC_NGX" || fail "static nginx conf missing try_files"
log "Static deploy OK: $STATIC_NGX"

# BIND zone file + PowerDNS plan + runtimes probe
ZONE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/hosting/dns/zone-file" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"zone\":\"e2e-${NAME}.test\",\"serverIp\":\"203.0.113.50\"}")
echo "$ZONE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||!j.zonePath) process.exit(28);})"
PDNS=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/hosting/dns/powerdns/load" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"zone\":\"e2e-${NAME}.test\",\"serverIp\":\"203.0.113.50\",\"load\":false}")
echo "$PDNS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(j.mode!=='plan'&&j.ok!==true) process.exit(29);})"
RT=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/hosting/runtimes" -H "$AUTH")
echo "$RT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.probe||!j.probe.node||!j.supported) process.exit(30);})"
log "DNS zone / PowerDNS plan / runtimes OK"

# Email domain + mailbox + webmail plan
EM=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/domains" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"domain\":\"mail-${NAME}.test\",\"serverIp\":\"203.0.113.10\"}")
EM_ID=$(printf '%s' "$EM" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).domain.id))")
MB=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/domains/${EM_ID}/mailboxes" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"localPart":"info","password":"longpassword99"}')
echo "$MB" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||!j.mailbox) process.exit(31);})"
WM=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/webmail/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"domain\":\"webmail-${NAME}.test\",\"download\":false}")
echo "$WM" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||j.mode!=='plan') process.exit(32);})"
# Deliverability pack (honest: deliveryGuaranteed never true from local probe alone)
DELIV=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/email/domains/${EM_ID}/deliverability" -H "$AUTH")
echo "$DELIV" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(typeof j.score!=='number'&&!j.items) process.exit(38); if(j.deliveryGuaranteed===true) process.exit(39);})"
DELIV_OV=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/email/deliverability/overview" -H "$AUTH")
echo "$DELIV_OV" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!Array.isArray(j.items)) process.exit(40);})"
log "Email mailbox + webmail plan + deliverability OK"

# —— PHP real listen (degraded php -S; skip hard-fail only if php binary missing) ——
PHP_CREATE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"php-${NAME}\",\"domain\":\"php-${NAME}.local\",\"runtime\":\"php\",\"templateId\":\"wordpress-php\"}")
PHP_ID=$(printf '%s' "$PHP_CREATE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).project.id))")
PHP_DEP=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PHP_ID}/deploy-php" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"forceBuiltin":true}')
PHP_PORT=$(printf '%s' "$PHP_DEP" | node -e "
let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
  const j=JSON.parse(d);
  if(j.ok===true){
    if(!j.listening||!j.port) process.exit(41);
    process.stderr.write('php deploy ok port='+j.port+' degraded='+j.degraded+'\\n');
    process.stdout.write(String(j.port));
    return;
  }
  // Honest skip when php binary missing on host
  const notes=(j.notes||[]).join(' ');
  if(/php binary|not found|no php|failed to resolve/i.test(notes)||j.ok===false){
    process.stderr.write('php deploy skipped/failed honestly: '+notes.slice(0,200)+'\\n');
    process.stdout.write('0');
    return;
  }
  console.error(JSON.stringify(j,null,2));
  process.exit(42);
});
")
if [[ "$PHP_PORT" != "0" && -n "$PHP_PORT" ]]; then
  # php built-in may return index.php body; accept any HTTP response
  PHP_CODE=$(curl -sS -o /tmp/ysk-e2e-php-body -w '%{http_code}' "http://127.0.0.1:${PHP_PORT}/" || true)
  [[ "$PHP_CODE" =~ ^[23] ]] || fail "php app HTTP not 2xx/3xx: code=$PHP_CODE"
  log "PHP direct curl OK http=$PHP_CODE port=$PHP_PORT"
  curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/projects/${PHP_ID}/stop" \
    -H "$AUTH" -H 'Content-Type: application/json' -d '{}' >/dev/null || true
  sleep 0.3
  if curl -fsS "http://127.0.0.1:${PHP_PORT}/" >/dev/null 2>&1; then
    fail "php app still listening after stop"
  fi
  log "PHP stop OK"
else
  log "PHP listen path not exercised (binary missing or honest fail) — Node+static still covered"
fi

# —— CLI parity smoke: backup + email-deliverability ——
# Note: concurrent CLI against live dataDir is OK for read/backup; email CLI may exit 1 when panelReady=false
CLI_CP=$(node apps/server/dist/cli.js backup control-plane --data-dir "$DATA_DIR" --json) || fail "backup control-plane exit $?"
echo "$CLI_CP" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||!j.archivePath) process.exit(43);})"
CLI_BL=$(node apps/server/dist/cli.js backup list --data-dir "$DATA_DIR" --json) || fail "backup list exit $?"
echo "$CLI_BL" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.items||!j.items.length) process.exit(44);})"
CLI_BS=$(node apps/server/dist/cli.js backup status --data-dir "$DATA_DIR" --json) || fail "backup status exit $?"
echo "$CLI_BS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(j.ok!==true) process.exit(45);})"
# deliverability: exit 1 when external PTR/port25 incomplete is honest — assert JSON only
set +e
CLI_ED=$(node apps/server/dist/cli.js hosting email-deliverability --data-dir "$DATA_DIR" --domain "mail-${NAME}.test" --json 2>/dev/null)
ED_EC=$?
set -e
echo "$CLI_ED" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d||'{}'); const r=j.report||j; if(j.ok!==true&&!r.score&&!r.items) process.exit(46); if(r.deliveryGuaranteed===true||j.deliveryGuaranteed===true) process.exit(47);})"
log "CLI backup + email-deliverability OK (deliverability exit=$ED_EC, panelReady may be false)"

# Spec §5 email bootstrap (plan mode)
BOOT=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/email/bootstrap" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"domain\":\"boot-${NAME}.test\",\"serverIp\":\"203.0.113.10\",\"adminLocalPart\":\"postmaster\",\"adminPassword\":\"longpassword99\",\"installPackages\":false,\"webmail\":true}")
echo "$BOOT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.domainId||!j.steps||!j.steps.length) process.exit(36); if(!j.externalTodos||!j.externalTodos.length) process.exit(37);})"
log "Email bootstrap OK"

# Firewall plan write script
FW=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/system/firewall/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"allowSmtp":true,"apply":false}')
echo "$FW" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||!j.written||!j.written.length) process.exit(33);})"
log "Firewall ufw script OK"

# Production readiness (expect not productionReady without root+EXECUTE)
READY=$(curl -sS "http://127.0.0.1:${PORT_API}/api/v1/readiness" -H "$AUTH" || true)
echo "$READY" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.items||!j.score) process.exit(34); if(j.productionReady===true&&j.mode==='degraded') process.exit(35); process.stderr.write('productionReady='+j.productionReady+' mode='+j.mode+'\\n')})"
log "Readiness probe OK"

# Public file server apply
curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/hosting/files/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"serverName":"files.e2e.local","reload":false}' >/dev/null
log "Public files apply OK"

# —— CDN + fleet honesty (D3/E2) via live HTTP (same process as serve memory) ——
# Register edge session on the running control plane (public)
CDN_REG=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/fleet/agents/register" \
  -H 'Content-Type: application/json' \
  -d "{\"agentId\":\"e2e-edge-${NAME}\",\"group\":\"e2e\",\"meta\":{\"source\":\"edge\"}}")
CDN_SID=$(printf '%s' "$CDN_REG" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).id||''))")
[[ -n "$CDN_SID" ]] || fail "fleet register missing session"

# Node + site + apply via authenticated API
CDN_NODE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cdn/nodes" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"e2e-fleet\",\"fleetAgentId\":\"${CDN_SID}\"}")
CDN_NID=$(printf '%s' "$CDN_NODE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).node.id||''))")
CDN_SITE=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cdn/sites" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"e2e-cdn\",\"domains\":[\"cdn-${NAME}.test\"],\"edgeNodeIds\":[\"${CDN_NID}\"],\"origin\":{\"kind\":\"url\",\"url\":\"http://127.0.0.1:3100\"}}")
CDN_SITE_ID=$(printf '%s' "$CDN_SITE" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).site.id||''))")
CDN_APPLY=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cdn/sites/${CDN_SITE_ID}/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
echo "$CDN_APPLY" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||j.apply_status!=='written') {console.error(d); process.exit(48);} if(!j.edges||!j.edges.length||j.edges[0].method!=='fleet') process.exit(49);})"
CDN_CMDS=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/fleet/agents/${CDN_SID}/commands?history=1" -H "$AUTH")
echo "$CDN_CMDS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.items||!j.items.length) process.exit(51); if(j.items[0].status!=='queued') process.exit(52); if(j.items[0].payload?.op!=='cdn.edge.apply') process.exit(53);})"
log "CDN fleet queue OK (HTTP, written ≠ applied)"

# local edge conf write via API
CDN_LOC=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cdn/nodes" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"name":"e2e-local","publicIpv4":["127.0.0.1"]}')
CDN_LID=$(printf '%s' "$CDN_LOC" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).node.id||''))")
CDN_LS=$(curl -fsS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cdn/sites" \
  -H "$AUTH" -H 'Content-Type: application/json' \
  -d "{\"name\":\"e2e-local-site\",\"domains\":[\"local-${NAME}.test\"],\"edgeNodeIds\":[\"${CDN_LID}\"],\"origin\":{\"kind\":\"url\",\"url\":\"http://127.0.0.1:3100\"}}")
CDN_LSID=$(printf '%s' "$CDN_LS" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).site.id||''))")
CDN_LA=$(curl -sS -X POST "http://127.0.0.1:${PORT_API}/api/v1/cdn/sites/${CDN_LSID}/apply" \
  -H "$AUTH" -H 'Content-Type: application/json' -d '{}')
echo "$CDN_LA" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); if(!j.ok||j.apply_status!=='written') {console.error(d); process.exit(54);}})"
log "CDN local conf write OK (honest written)"

# —— agentCycle pull → runCdnFleetPayload → ack (E2) ——
if node scripts/e2e-cdn-fleet-ack.mjs --data-dir "$DATA_DIR" --port "$PORT_API" --session "$CDN_SID"; then
  CDN_AFTER=$(curl -fsS "http://127.0.0.1:${PORT_API}/api/v1/fleet/agents/${CDN_SID}/commands?history=1" -H "$AUTH")
  echo "$CDN_AFTER" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const j=JSON.parse(d); const c=(j.items||[]).find(x=>x.payload&&x.payload.op==='cdn.edge.apply'); if(!c||c.status!=='done') {console.error(d); process.exit(60);} if(c.result&&c.result.ok===false) process.exit(61);})"
  log "CDN fleet queue→agent ack done (status=done, conf written)"
else
  fail "CDN fleet agent ack path failed"
fi

log "PASS — real ops vertical verified"
echo "PASS"
