# 生產 MVP

> 語言：中文 | [English](./production-mvp.md)

> 本頁為對應英文運維文件的香港書面語版；命令與路徑保持原文以便複製。

30-minute path on Ubuntu 22.04/24.04 to a **usable** control plane + Node site.

## Modes

| Mode | Conditions | What works |
|------|------------|------------|
| **degraded** | non-root or no `YSK_EXECUTE` | dataDir projects, pidfile Node deploy, curl health, managed nginx conf, Web UI |
| **production_capable** | root + `YSK_EXECUTE=1` | useradd, systemd units, nginx -t/reload, apt/email/ssl apply, mysql provision |

API `GET /api/v1/status` reports `mode`: `degraded` | `production_capable`.

## 步驟

### 1. Build & setup

```bash
pnpm install && pnpm build
sudo mkdir -p /var/lib/ysk-server
sudo YSK_ADMIN_PASSWORD='change-me' node apps/server/dist/cli.js setup \
  --data-dir /var/lib/ysk-server --non-interactive --force
```

### 2. Install systemd unit (root)

```bash
sudo YSK_EXECUTE=1 node apps/server/dist/cli.js system unit-install \
  --enable --data-dir /var/lib/ysk-server
# or: ysk-server serve --data-dir /var/lib/ysk-server --port 9287
```

### 3. Open Web UI

```text
http://SERVER_IP:9287/
```

Login with setup admin. **Projects → Create → Deploy Node**.

### 4. Production deploy path

With control plane running as root + `YSK_EXECUTE=1`:

1. Create project (attempts `useradd` for `ysk_*` user)
2. Deploy Node → systemd unit (root) or PM2 (`pm2` + EXECUTE) or pidfile + health curl
3. Publish Nginx → copy conf.d + `nginx -t` + reload
4. Status: `GET /api/v1/projects/:id/status`

### 5. Email / SSL (optional)

- System page: Email apply / SSL plan  
- Status write-back to store; external DNS/PTR/Port25 still operator-owned (Spec §5.4)

### 6. MySQL

```http
POST /api/v1/hosting/db/mysql-provision
{ "dbName": "app", "username": "appuser", "password": "longpassword" }
```

- Without EXECUTE/mysql: **`ok: false`** + SQL to copy (never fake success)
- With EXECUTE + `mysql` client: runs provision

## Verification

```bash
pnpm e2e:real-ops          # non-root vertical (must PASS)
sudo bash scripts/e2e-hosting-root.sh   # skips if not root
```

## Spec mapping

| Spec | MVP coverage |
|------|----------------|
| §2.3 install/serve | setup + unit-install + serve Web |
| §4.1–4.2 Project/Node | disk + deploy (systemd / PM2 / pidfile) + optional OS user |
| §4.3–4.4 PHP/MySQL | apply templates + mysql provision refuse/execute |
| §4.6–4.7 SSL/Nginx | plan + reload path |
| §5 Email | templates + live-check + service is-active |
| Phase 3 items | backlog in README |
