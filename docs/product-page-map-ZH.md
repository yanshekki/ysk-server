# YSK Product 頁面 Map (IA)

> 語言：中文 | [English](./product-page-map.md)

每個側欄項目對應一個頁面. Every page lists **required tabs** and **allowed actions** (真實操作 or preset deep-links only).  
禁止跨功能空白跳轉.

另見: [`product-feature-matrix.md`](./product-feature-matrix.md).

---

## 側欄分區 → 路由

| 分區 | 路由 | 頁面 | 矩陣 |
|---------|-------|------|--------|
| 概覽 | `/` | 儀表板 | A |
| 站點 | `/projects` | 專案列表 | B |
| 站點 | `/projects/:id` | 專案詳情 | B |
| 郵件 | `/email` | 郵件域名 | F |
| 郵件 | `/email/domains/:id` | 郵件域名詳情 | F |
| 檔案 | `/files` | 檔案管理員 | G |
| 檔案 | `/files/public` | 公用檔案 nginx | G |
| 檔案 | `/ftp` | FTP 帳戶 | H |
| 檔案 | `/ftp/service` | FTPS 服務主控台 | H |
| 資料庫 | `/databases/mysql` | MySQL data | I |
| 資料庫 | `/databases/mysql/service` | MySQL service | I |
| 資料庫 | `/databases/mariadb` | MariaDB data | I |
| 資料庫 | `/databases/mariadb/service` | MariaDB service | I |
| 資料庫 | `/databases/postgres` | Postgres data | I |
| 資料庫 | `/databases/postgres/service` | Postgres service | I |
| 資料庫 | `/databases/redis` | Redis data | I |
| 資料庫 | `/databases/redis/service` | Redis service | I |
| DNS / SSL | `/dns` | DNS zone | C |
| DNS / SSL | `/ssl` | 憑證 | D |
| DNS / SSL | `/nginx` | Nginx / vhosts | E |
| 執行環境 | `/runtimes/node` | Node | J |
| 執行環境 | `/runtimes/php` | PHP | J |
| 安全 | `/security` | 允許清單／審批 | R |
| 安全 | `/firewall` | 防火牆 | M |
| 安全 | `/fail2ban` | Fail2ban | N |
| 系統 | `/users` | Users & packages | T |
| 系統 | `/services` | 服務矩陣 | O |
| 系統 | `/metrics` | 指標 | P |
| 系統 | `/logs` | 日誌中心 | T |
| 系統 | `/cron` | Cron | K |
| 系統 | `/backups` | 備份 | L |
| 系統 | `/updates` | 更新 | S |
| 系統 | `/system/unit` | 控制平面 unit | T |
| 系統 | `/system/readiness` | 就緒 | T |
| 系統 | `/system` | 系統索引 | T |
| AI | `/ai` | AI 任務 | U |
| AI | `/agents` | Agent | U |

**計劃中（尚未路由）**

| 路由 | 頁面 | 何時 |
|-------|------|------|
| `/users` | Users | P2 |
| `/packages` | Packages | P2 |
| `/account` | 操作員 account + 2FA | P0 |

---

## 頁面契約

### `/` 儀表板

| 區域 | 必要內容 |
|------|------------------|
| Strip | Live health · disk/mem · executeEnabled/root |
| List | Recent projects · pending approvals · certs expiring soon |
| 操作 | 重新整理 · open readiness (preset) · create project (opens modal) |

**禁止:** tile-only marketing grid without live status.

---

### `/projects` List

| 操作 | 類型 |
|---------|------|
| 建立專案 | 真實操作 |
| Search / filter | local |
| Open project | list navigation (allowed) |
| Delete (confirm) | 真實操作 |

---

### `/projects/:id` Detail

| Tab | Required facts | Required actions |
|-----|----------------|------------------|
| **概覽** | id, home, runtime, git, last deploy/backup, health | Publish Nginx · Publish Nginx+SSL · Backup · Health · Open files `?root=project:id` |
| **Deploy** | runtime profile, git, port | Deploy · Stop · (PHP deploy if applicable) |
| **Network** | domain, aliases, nginx path, SSL state | Publish nginx · Publish+SSL · Force HTTPS/HSTS · LE for domain preset `/ssl?domain=&action=le` |
| **Resources** | mem/cpu/disk quota | Apply quotas |
| **Logs** | access/error/app | 重新整理 · download tail |
| **Advanced** | danger zone | Backup · Suspend · Delete |

**禁止 on 概覽:** chips that only go to `/nginx`, `/dns`, `/ssl`, `/databases/*` without project context.

**Allowed deep-links only with preset:**

- `/files?root=project:<id>`
- `/ssl?domain=<domain>&action=le`
- `/ftp?project=<id>` (when implemented)

---

### `/email` List

| 操作 | 類型 |
|---------|------|
| Create domain | 真實操作 |
| 重新整理 | 真實操作 |
| Open domain | navigation |

---

### `/email/domains/:id` Detail

| Tab | Required actions |
|-----|------------------|
| **DNS** | Show MX/SPF/DKIM/DMARC · copy · refresh |
| **郵件boxes** | Create · change password · quota · delete · suspend |
| **Health** | Live check (MX/PTR/25) · external todos |
| **Relay** | Save relay · apply system |
| **Advanced** | Bootstrap stack · antispam · SSL LE preset · queue flush |

---

### `/files`

| Side | Main | Side panels |
|------|------|-------------|
| Roots: public + each project | List/grid · upload · mkdir · rename · move/copy · delete→trash | Trash · Shares · Favorites |

| 操作 | 類型 |
|---------|------|
| chmod | 真實操作 (P0) |
| zip/unzip | 真實操作 (P0) |
| Share link create/revoke | 真實操作 |
| Open public nginx settings | `/files/public` (same feature family — allowed) |

**Query presets:** `?root=public` \| `?root=project:<id>`

---

### `/ftp` + `/ftp/service`

| 頁面 | 操作 |
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

| List | 操作 |
|------|---------|
| Domain · status · expiry · bound sites | LE request · upload · delete · renew |

**Query presets:** `?domain=` · `?action=le` (auto-open LE modal)

---

### `/nginx`

| 操作 |
|---------|
| List vhosts · sync/reload · show `nginx -t` result · open project network (preset `?project=`) |

---

### `/databases/{engine}` + `/service`

| Data page | Service page |
|-----------|--------------|
| DB/user CRUD · dump/import · (Adminer P1) | lifecycle · SettingField categories · apply by mode · metrics |

**Allowed cross-link:** data ↔ service only.

---

### `/runtimes/php` · `/runtimes/node`

| 頁面 | 操作 |
|------|---------|
| PHP | install versions · set default · FPM pools |
| Node | probe · install major versions |

---

### `/cron`

| 操作 |
|---------|
| CRUD · enable/disable · schedule helper · **run now (test)** · show managed vs system |

---

### `/backups`

| 操作 |
|---------|
| Run all / run one · schedule · download · restore (full/selective) · delete · remote target (P0) |

---

### `/firewall` · `/fail2ban`

| 防火牆 | Fail2ban |
|----------|----------|
| Rules CRUD · presets · apply · ban list | jails · ban/unban · whitelist · apply |

---

### `/services`

| 操作 |
|---------|
| 矩陣 refresh · lifecycle per unit · enable boot · open console (engine service path) · log entry |

---

### `/metrics`

| 操作 |
|---------|
| 重新整理 · threshold alerts · (history charts P1) |

---

### `/updates`

| 操作 |
|---------|
| Scan · show CVE/risk · approve · execute update (fail-closed) |

---

### `/security`

| 操作 |
|---------|
| List tools · run sys.info · approve/deny pending · (API keys P0) |

---

### 系統 section UX contract (ops console)

All **sidebar 系統** pages share:

1. **Hero** — English eyebrow · status pill · honest one-liner · meta · primary CTA  
2. **KPI strip / stats** — 4 key numbers  
3. **Rail** — EXECUTE / root / path / sync as applicable  
4. **Body** — card rows (not bare tables as primary UX) · chips + search when list > ~8  
5. **OpsResultPanel** when mutations exist · typed confirm for destructive ops  

| 頁面 | 操作 |
|------|---------|
| `/system` 主機 | identity · NTP · network/disks · **電源** REBOOT/POWEROFF · 捷徑 |
| `/system` 匯出 | export JSON · managed nginx · rebuild dry-run/sync |
| `/system/unit` | write template vs install+enable · blockers steps |
| `/system/readiness` | auto-probe · blockers · filter · fixHref · download JSON |
| `/updates` | scan · OSV · self-update · risk chips · apply package |
| `/users` | create user/package · suspend · impersonate · delete |
| `/services` | matrix lifecycle · category filter · protection probe tab |
| `/metrics` | load/mem/disk meters · alerts · refresh |
| `/logs` | 日誌中心 explore/ops/settings · allowlist · SSE · vacuum |
| `/cron` | jobs cards · create · install to system crontab honesty |
| `/backups` | archive cards · run-all · restore/delete · remote/restic |

**Power policy:** 整機電源只在 `/system` 主機 tab；服務 lifecycle 在 `/services`；監控在 `/metrics`。無「開機」按鈕（需實體／hypervisor）。

---

### `/ai` · `/agents`

| 頁面 | 操作 |
|------|---------|
| AI | run playbook (allowlisted tools only) |
| Agent | install/status · never bypass approval |

---

## Action policy (global)

| Allowed | 禁止 |
|---------|-----------|
| Button runs API/host op on **this** resource | Button only navigates to unrelated list |
| Deep-link with **preset query** that target page consumes | Bare `/ssl`, `/backups`, `/dns` chips in content |
| Same-feature data↔service links | Competitor names / marketing fluff in UI |
| Sidebar for cross-feature discovery | Content “related tools” redirect bars |

---

## 狀態 vocabulary (all pages)

| 狀態 | 含義 |
|--------|---------|
| `written` | Config saved in YSK store / managed files |
| `applied` | Host confirmed (reload/sync/probe OK) |
| `blocked` | executeEnabled/root/missing binary prevented apply |
| `failed` | Apply attempted and failed |

UI must never show success green for `written` alone when the op claims “online”.
