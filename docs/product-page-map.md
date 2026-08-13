# YSK Product Page Map (IA)

> Language: English | [中文](./product-page-map-ZH.md)

Every sidebar item maps to a page. Every page lists **required tabs** and **allowed actions** (real ops or preset deep-links only).  
Cross-feature empty redirects are forbidden.

See also: [`product-feature-matrix.md`](./product-feature-matrix.md).

---

## Sidebar sections → routes

| Section | Route | Page | Matrix |
|---------|-------|------|--------|
| Overview | `/` | Dashboard | A |
| Sites | `/projects` | Project list | B |
| Sites | `/projects/:id` | Project detail | B |
| Mail | `/email` | Email domains | F |
| Mail | `/email/domains/:id` | Email domain detail | F |
| Files | `/files` | File manager | G |
| Files | `/files/public` | Public files nginx | G |
| Files | `/ftp` | FTP accounts | H |
| Files | `/ftp` | FTPS (accounts + service) | H |
| Databases | `/databases/mysql` | MySQL data | I |
| Databases | `/databases/mysql/service` | MySQL service | I |
| Databases | `/databases/mariadb` | MariaDB data | I |
| Databases | `/databases/mariadb/service` | MariaDB service | I |
| Databases | `/databases/postgres` | Postgres data | I |
| Databases | `/databases/postgres/service` | Postgres service | I |
| Databases | `/databases/redis` | Redis data | I |
| Databases | `/databases/redis/service` | Redis service | I |
| Files | `/bt-tracker` | BT Tracker | G |
| DNS / SSL | `/dns` | DNS zones | C |
| DNS / SSL | `/cdn` | CDN / edges | C′ |
| DNS / SSL | `/ssl` | Certificates | D |
| DNS / SSL | `/nginx` | Nginx / vhosts | E |
| DNS / SSL | `/apache` | Apache sites | E |
| Runtimes | `/runtimes/node` | Node | J |
| Runtimes | `/runtimes/php` | PHP | J |
| Runtimes | `/runtimes/python` | Python | J |
| Runtimes | `/runtimes/go` | Go | J |
| Runtimes | `/runtimes/rust` | Rust | J |
| Runtimes | `/runtimes/java` | Java | J |
| Runtimes | `/runtimes/kotlin` | Kotlin | J |
| Runtimes | `/runtimes/bun` | Bun | J |
| Security | `/protection` | Host defense (UFW / fail2ban) | M |
| Security | `/security` | Allowlist / approvals | R |
| Security | `/vpn` | VPN | |
| Security | `/vnc` | VNC | |
| System | `/users` | Users & packages | T |
| System | `/services` | Service matrix | O |
| System | `/metrics` | Metrics | P |
| System | `/network` | Service exposure | |
| System | `/browse` | Host Browse (panel-only) | |
| System | `/terminal` | Browser terminal (panel-only) |
| System | `/logs` | Log Center | T |
| System | `/cron` | Cron | K |
| System | `/backups` | Backups | L |
| System | `/system/migrate` | Host migrate | |
| System | `/updates` | Updates hub | S |
| System | `/system/unit` | Control-plane unit | T |
| System | `/system/readiness` | Readiness | T |
| System | `/system` | System index | T |
| System | `/support` | Support (panel-only) | |

**Redirects (not sidebar)**

| Route | Goes to |
|-------|---------|
| `/firewall` · `/fail2ban` | `/protection/firewall` · `/protection/fail2ban` |
| `/software` | `/updates` |
| `/ai` · `/agents` | `/` (CLI-only: `ask` · `agents`) |

---

## Page contracts

### `/` Dashboard

| Area | Required content |
|------|------------------|
| Strip | Live health · disk/mem · executeEnabled/root |
| List | Recent projects · pending approvals · certs expiring soon |
| Actions | Refresh · open readiness (preset) · create project (opens modal) |

**Forbidden:** tile-only marketing grid without live status.

---

### `/projects` List

| Actions | Type |
|---------|------|
| Create project | real ops |
| Search / filter | local |
| Open project | list navigation (allowed) |
| Delete (confirm) | real ops |

---

### `/projects/:id` Detail

| Tab | Required facts | Required actions |
|-----|----------------|------------------|
| **Overview** | id, home, runtime, git, last deploy/backup, health | Publish Nginx · Publish Nginx+SSL · Backup · Health · Open files `?root=project:id` |
| **Deploy** | runtime profile, git, port | Deploy · Stop · (PHP deploy if applicable) |
| **Network** | domain, aliases, nginx path, SSL state | Publish nginx · Publish+SSL · Force HTTPS/HSTS · LE for domain preset `/ssl?domain=&action=le` |
| **Resources** | mem/cpu/disk quota | Apply quotas |
| **Logs** | access/error/app | Refresh · download tail |
| **Advanced** | danger zone | Backup · Suspend · Delete |

**Forbidden on Overview:** chips that only go to `/nginx`, `/dns`, `/ssl`, `/databases/*` without project context.

**Allowed deep-links only with preset:**

- `/files?root=project:<id>`
- `/ssl?domain=<domain>&action=le`
- `/ftp?project=<id>` (when implemented)

---

### `/email` List

| Actions | Type |
|---------|------|
| Create domain | real ops |
| Refresh | real ops |
| Open domain | navigation |

---

### `/email/domains/:id` Detail

| Tab | Required actions |
|-----|------------------|
| **DNS** | Show MX/SPF/DKIM/DMARC · copy · refresh |
| **Mailboxes** | Create · change password · quota · delete · suspend |
| **Health** | Live check (MX/PTR/25) · external todos |
| **Relay** | Save relay · apply system |
| **Advanced** | Bootstrap stack · antispam · SSL LE preset · queue flush |

---

### `/files`

| Side | Main | Side panels |
|------|------|-------------|
| Roots: public + each project | List/grid · upload · mkdir · rename · move/copy · delete→trash | Trash · Shares · Favorites |

| Actions | Type |
|---------|------|
| chmod | real ops (P0) |
| zip/unzip | real ops (P0) |
| Share link create/revoke | real ops |
| Open public nginx settings | `/files/public` (same feature family — allowed) |

**Query presets:** `?root=public` \| `?root=project:<id>`

---

### `/ftp` (accounts + service; `/ftp/service` redirects)

| Page | Actions |
|------|---------|
| Accounts | CRUD · path jail · password |
| Service | install · start/stop · FTPS settings · apply |

**Allowed cross-link:** accounts ↔ service (same feature family).

---

### `/dns`

| Zone list | Record panel (selected zone) |
|-----------|------------------------------|
| Create zone · write managed file · delete | Add record · write zone · **SSL LE preset for zone** · validate zone |

---

### `/ssl`

| List | Actions |
|------|---------|
| Domain · status · expiry · bound sites | LE request · upload · delete · renew |

**Query presets:** `?domain=` · `?action=le` (auto-open LE modal)

---

### `/nginx`

| Actions |
|---------|
| List vhosts · sync/reload · show `nginx -t` result · open project network (preset `?project=`) |

---

### `/databases/{engine}` + `/service`

| Data page | Service page |
|-----------|--------------|
| DB/user CRUD · dump/import · (Adminer P1) | lifecycle · SettingField categories · apply by mode · metrics |

**Allowed cross-link:** data ↔ service only.

---

### `/runtimes/*`

| Page | Actions |
|------|---------|
| PHP | install versions · set default · FPM pools |
| Node | probe · install major versions |

---

### `/cron`

| Actions |
|---------|
| CRUD · enable/disable · schedule helper · **run now (test)** · show managed vs system |

---

### `/backups`

| Actions |
|---------|
| Run all / run one · schedule · download · restore (full/selective) · delete · remote target (P0) |

---

### `/protection` · firewall · fail2ban

| Firewall | Fail2ban |
|----------|----------|
| Rules CRUD · presets · apply · ban list | jails · ban/unban · whitelist · apply |

---

### `/services`

| Actions |
|---------|
| Matrix refresh · lifecycle per unit · enable boot · open console (engine service path) · log entry |

---

### `/metrics`

| Actions |
|---------|
| Refresh · threshold alerts · (history charts P1) |

---

### `/updates`

| Actions |
|---------|
| Scan · show CVE/risk · approve · execute update (fail-closed) |

---

### `/security`

| Actions |
|---------|
| List tools · run sys.info · approve/deny pending · (API keys P0) |

---

### System section UX contract (ops console)

All **sidebar System** pages share:

1. **Hero** — English eyebrow · status pill · honest one-liner · meta · primary CTA  
2. **KPI strip / stats** — 4 key numbers  
3. **Rail** — EXECUTE / root / path / sync as applicable  
4. **Body** — card rows (not bare tables as primary UX) · chips + search when list > ~8  
5. **OpsResultPanel** when mutations exist · typed confirm for destructive ops  

| Page | Actions |
|------|---------|
| `/system` 主機 | identity · NTP · network/disks · **電源** REBOOT/POWEROFF · 捷徑 |
| `/system` 匯出 | export JSON · managed nginx · rebuild dry-run/sync |
| `/system/unit` | write template vs install+enable · blockers steps |
| `/system/readiness` | auto-probe · blockers · filter · fixHref · download JSON |
| `/updates` | **host update hub**: panel + catalog services + runtimes + remaining apt · scan · OSV · apply |
| `/users` | create user/package · suspend · impersonate · delete |
| `/services` | matrix lifecycle · category filter · protection probe tab |
| `/metrics` | load/mem/disk meters · alerts · refresh |
| `/logs` | Log Center explore/ops/settings · allowlist · SSE · vacuum |
| `/cron` | jobs cards · create · install to system crontab honesty |
| `/backups` | archive cards · run-all · restore/delete · remote/restic |

**Power policy:** 整機電源只在 `/system` 主機 tab；服務 lifecycle 在 `/services`；監控在 `/metrics`。無「開機」按鈕（需實體／hypervisor）。

---

### CLI-only: `ask` · `agents` (no sidebar)

| Surface | Actions |
|---------|---------|
| `ysk-server ask` / `tools` | Allowlisted playbooks — not a panel page (`/ai` redirects home) |
| `ysk-server agents` | Fleet / install / status — `/agents` redirects home |

---

## Action policy (global)

| Allowed | Forbidden |
|---------|-----------|
| Button runs API/host op on **this** resource | Button only navigates to unrelated list |
| Deep-link with **preset query** that target page consumes | Bare `/ssl`, `/backups`, `/dns` chips in content |
| Same-feature data↔service links | Competitor names / marketing fluff in UI |
| Sidebar for cross-feature discovery | Content “related tools” redirect bars |

---

## Status vocabulary (all pages)

| Status | Meaning |
|--------|---------|
| `written` | Config saved in YSK store / managed files |
| `applied` | Host confirmed (reload/sync/probe OK) |
| `blocked` | executeEnabled/root/missing binary prevented apply |
| `failed` | Apply attempted and failed |

UI must never show success green for `written` alone when the op claims “online”.
