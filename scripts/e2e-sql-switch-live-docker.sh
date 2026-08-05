#!/usr/bin/env bash
# S6 live data path: MySQL container → dump → MariaDB container → verify row.
# Exercises real client dump/import with user DB (not host apt purge).
# Product switchSqlEngine unit path: pnpm e2e:sql-switch
#
# Usage: bash scripts/e2e-sql-switch-live-docker.sh
set -euo pipefail

log() { printf '[e2e-sql-live] %s\n' "$*"; }
fail() { printf '[e2e-sql-live] FAIL: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker required"
docker info >/dev/null 2>&1 || fail "docker daemon not available"

WORK=$(mktemp -d /tmp/ysk-s6-XXXXXX)
cleanup() {
  docker rm -f ysk-s6-mysql ysk-s6-maria >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

MYSQL_IMG=${MYSQL_IMG:-mysql:8.0}
MARIA_IMG=${MARIA_IMG:-mariadb:11.4}
ROOT_PW=ysk_s6_root

docker rm -f ysk-s6-mysql ysk-s6-maria >/dev/null 2>&1 || true

log "Start MySQL ($MYSQL_IMG)…"
docker run -d --name ysk-s6-mysql \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PW" \
  -e MYSQL_DATABASE=ysk_e2e \
  "$MYSQL_IMG" >/dev/null

log "Wait MySQL ready (auth)…"
ok=0
for i in $(seq 1 90); do
  if docker exec ysk-s6-mysql mysql -uroot -p"$ROOT_PW" -e "SELECT 1" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
[[ $ok -eq 1 ]] || {
  docker logs ysk-s6-mysql 2>&1 | tail -30 || true
  fail "MySQL not ready with password"
}

log "Seed ysk_e2e.t…"
docker exec ysk-s6-mysql mysql -uroot -p"$ROOT_PW" -e \
  "CREATE DATABASE IF NOT EXISTS ysk_e2e; USE ysk_e2e; DROP TABLE IF EXISTS t; CREATE TABLE t(i INT); INSERT INTO t VALUES (42);"

log "Dump user DB…"
docker exec ysk-s6-mysql mysqldump -uroot -p"$ROOT_PW" --single-transaction --databases ysk_e2e \
  >"$WORK/ysk_e2e.sql" 2>/dev/null
[[ -s "$WORK/ysk_e2e.sql" ]] || fail "empty dump"
grep -q 'ysk_e2e' "$WORK/ysk_e2e.sql" || fail "dump missing database"

log "Start MariaDB ($MARIA_IMG)…"
docker run -d --name ysk-s6-maria \
  -e MYSQL_ROOT_PASSWORD="$ROOT_PW" \
  -e MARIADB_ROOT_PASSWORD="$ROOT_PW" \
  "$MARIA_IMG" >/dev/null

log "Wait MariaDB ready (auth)…"
ok=0
for i in $(seq 1 90); do
  if docker exec ysk-s6-maria mariadb -uroot -p"$ROOT_PW" -e "SELECT 1" >/dev/null 2>&1 \
    || docker exec ysk-s6-maria mysql -uroot -p"$ROOT_PW" -e "SELECT 1" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done
[[ $ok -eq 1 ]] || {
  docker logs ysk-s6-maria 2>&1 | tail -30 || true
  fail "MariaDB not ready"
}

log "Import dump into MariaDB…"
if docker exec -i ysk-s6-maria mariadb -uroot -p"$ROOT_PW" <"$WORK/ysk_e2e.sql" 2>/dev/null; then
  :
elif docker exec -i ysk-s6-maria mysql -uroot -p"$ROOT_PW" <"$WORK/ysk_e2e.sql" 2>/dev/null; then
  :
else
  fail "import failed"
fi

log "Verify data…"
COUNT=$(docker exec ysk-s6-maria mariadb -uroot -p"$ROOT_PW" -N -e "SELECT COUNT(*) FROM ysk_e2e.t;" 2>/dev/null \
  || docker exec ysk-s6-maria mysql -uroot -p"$ROOT_PW" -N -e "SELECT COUNT(*) FROM ysk_e2e.t;")
VAL=$(docker exec ysk-s6-maria mariadb -uroot -p"$ROOT_PW" -N -e "SELECT i FROM ysk_e2e.t;" 2>/dev/null \
  || docker exec ysk-s6-maria mysql -uroot -p"$ROOT_PW" -N -e "SELECT i FROM ysk_e2e.t;")
# strip CR
COUNT=$(echo "$COUNT" | tr -d '\r')
VAL=$(echo "$VAL" | tr -d '\r')
[[ "$COUNT" == "1" ]] || fail "expected count 1 got '$COUNT'"
[[ "$VAL" == "42" ]] || fail "expected value 42 got '$VAL'"

log "PASS live data path MySQL→MariaDB (row=42)."
log "Code unit gate: pnpm e2e:sql-switch · host apt exclusive still needs root+YSK_EXECUTE checklist."
