# YSK Product Page Map (IA)

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
| Files | `/ftp/service` | FTPS service console | H |
| Databases | `/databases/mysql` | MySQL data | I |
| Databases | `/databases/mysql/service` | MySQL service | I |
| Databases | `/databases/mariadb` | MariaDB data | I |
| Databases | `/databases/mariadb/service` | MariaDB service | I |
| Databases | `/databases/postgres` | Postgres data | I |
| Databases | `/databases/postgres/service` | Postgres service | I |
| Databases | `/databases/redis` | Redis data | I |
| Databases | `/databases/redis/service` | Redis service | I |
| DNS / SSL | `/dns` | DNS zones | C |
| DNS / SSL | `/ssl` | Certificates | D |
| DNS / SSL | `/nginx` | Nginx / vhosts | E |
| Runtimes | `/runtimes/node` | Node | J |
| Runtimes | `/runtimes/php` | PHP | J |
| Security | `/security` | Allowlist / approvals | R |
| Security | `/firewall` | Firewall | M |
| Security | `/fail2ban` | Fail2ban | N |
| System | `/services` | Service matrix | O |
| System | `/metrics` | Metrics | P |
| System | `/cron` | Cron | K |
| System | `/backups` | Backups | L |
| System | `/updates` | Updates | S |
| System | `/system/unit` | Control-plane unit | T |
| System | `/system/readiness` | Readiness | T |
| System | `/system` | System index | T |
| AI | `/ai` | AI tasks | U |
| AI | `/agents` | Agents | U |

**Planned (not routed yet)**

| Route | Page | When |
|-------|------|------|
| `/users` | Users | P2 |
| `/packages` | Packages | P2 |
| `/account` | Operator account + 2FA | P0 |

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

### `/ftp` + `/ftp/service`

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

### `/runtimes/php` · `/runtimes/node`

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

### `/firewall` · `/fail2ban`

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

### `/system` · `/system/unit` · `/system/readiness`

| Page | Actions |
|------|---------|
| Index | links to system tools only (nav hub OK) |
| Unit | install/enable/start control-plane service |
| Readiness | run checks · show blockers |

---

### `/ai` · `/agents`

| Page | Actions |
|------|---------|
| AI | run playbook (allowlisted tools only) |
| Agents | install/status · never bypass approval |

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
