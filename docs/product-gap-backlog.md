# YSK Product Gap Backlog

Derived from Hestia + DirectAdmin research matrix.  
Track implementation against [`product-feature-matrix.md`](./product-feature-matrix.md) and [`product-page-map.md`](./product-page-map.md).

**Defaults (approved plan assumptions):**

- Single Admin first; Users/Packages = Phase 3 (P2)
- No Reseller tier
- Web terminal = out / optional later
- One-click WordPress = P2
- Phase 1 order as listed below

---

## Phase 0 — Product contract ✓

| Item | Output | Status |
|------|--------|--------|
| Feature matrix | `docs/product-feature-matrix.md` | done |
| Page map / IA | `docs/product-page-map.md` | done |
| Gap backlog | `docs/product-gap-backlog.md` | done |

---

## Phase 1 — P0 parity holes (both panels have these)

Ship order:

### 1.1 Projects
| ID | Work | Notes | Status |
|----|------|-------|--------|
| B3 | Suspend / unsuspend project | stop + 503 vhost | **done** |
| B4 | Domain aliases | multi-server_name | **done** |
| B5 | Subdomains as first-class or alias helper | via aliases | **done** (alias) |
| B7–B8 | Rename domain / custom docroot | domain + first-class docroot PresetChips + bind IP | **done** |
| B11 | Force HTTPS + HSTS toggles | network tab + publish | **done** |
| B18 | Create jailed FTP from project | preset path + project linuxUser guest | **done** |
| B20 | Access/error log viewer polish | logs tab + grep + extra dirs | **done** |
| B22 | Per-site PHP version when runtime=php | deploy/FPM version | **done** |
| B26 | Apply mem/cpu/disk quotas honestly | soft + panel limits + setquota try | **done** (hard FS-dependent) |
| B27 | Create modal: also create DNS zone / mail domain | checkboxes | **done** |

### 1.2 DNS
| ID | Work | Notes | Status |
|----|------|-------|--------|
| C3 | Zone templates (minimal/web/mail/full) | seed records | **done** |
| C4 | SOA/TTL/NS edit | create + selected-zone SOA form; TTL per-record | **done** |
| C5 | Real apply: write + named-check + reload **or** honest `written` | no fake applied | **done** |
| C8 | External DNS record checklist share with email | GET /dns/external-checklist | **done** |
| C9 | Validate zone (named-checkzone) | Better | **done** |

### 1.3 Email
| ID | Work | Notes | Status |
|----|------|-------|--------|
| F3 | Alias + forward full CRUD | virtual_alias map | **done** |
| F4 | Catch-all | type=catchall | **done** |
| F5 | Autoreply | domain flags (MTA sieve later) | **done** (flags) |
| F6–F7 | DKIM/SPF/DMARC complete panel | DNS tab + live 探測矩陣 | **done** |
| F10 | Antispam per domain toggle | flag + Rspamd multimap apply | **done** (written/applied honesty) |
| F13 | Outbound rate limits | flag + Postfix anvil / policy maps | **done** (written/applied honesty) |
| F17 | Autodiscover/autoconfig endpoints | public XML + domain panel | **done** |
| F18 | Mail queue list + flush | postqueue UI list + flush | **done** |
| F20–F22 | Bootstrap honesty · mail SSL · suspend | bootstrap + LE deep-link + suspend flags | **done** |

### 1.4 SSL
| ID | Work | Notes | Status |
|----|------|-------|--------|
| D5 | Show auto-renew job status | bindings.renewJobs | **done** (API) |
| D7 | Mail domain SSL integration | LE deep-link mail/webmail/domain | **done** |
| D8 | Binding overview (cert → projects/mail) | GET /ssl/bindings | **done** |
| D9 | Expiry warnings on dashboard | KPI + alert + notifications | **done** |

### 1.5 Backups
| ID | Work | Notes | Status |
|----|------|-------|--------|
| L2 | Scheduled backups | `ysk-server backup all --data-dir` + cron install | **done** |
| L3 | Download archive | Bearer blob download | **done** |
| L4 | Selective restore | full / web / dry-run | **done** (web=partial extract) |
| L5 | Exclusions | panel exclusions list | **done** |
| L6 | Remote target config (SFTP/S3/local) | push after tar; fail affects ok | **done** |
| L7 | Restic incremental | password required when enabled | **done** |
| L10 | Dry-run + honest result panel | results + sideResults UI | **done** |

### 1.6 Auth
| ID | Work | Notes | Status |
|----|------|-------|--------|
| R2 | Operator 2FA (TOTP) | pure crypto TOTP | **done** |
| R5 | API access keys management | Security tab + Bearer ysk_ auth | **done** |
| Q4 | same 2FA foundation | | **done** |

### 1.7 Cron
| ID | Work | Notes | Status |
|----|------|-------|--------|
| K2–K3 | Generator UI + enable/disable | enable existed | **done** |
| K5 | Run-now test execution | POST /cron/:id/run | **done** |

---

## Phase 2 — Beat both panels (experience)

| Area | Work |
|------|------|
| Global | Enforce written/applied/blocked on every apply path | **done** (audit 擴充 + normalizeOpsHonesty + HTTP 403) |
| Files | chmod · zip/unzip · search harden (G3/G4/G12) | **done** (real zip/unzip/chmod + Modal UI) |
| DB | Full dump/import · Adminer or embedded browser entry (I4/I5) | **done** (Adminer Modal written/applied) |
| Email | Deliverability health UX · external todos (F19) | **done** (live 探測矩陣 + persist health) |
| Dashboard | Notification center (A3) · security strip (A5) | **done** (概覽安全條 + apply audit 通知) |
| Sites | Cache purge · HTTP auth · site redirect (B15–B17) | **done** (network tab + runtime-aware publish) |
| Nginx | Template gallery · purge (E4/E5) |
| Fail2ban | Ban list UX · whitelist (N3/N4) | **done** (白名單分頁 + DataTable + apply_status) |
| Metrics | Per-project usage strip (P3) | **done** (GET /metrics/projects real du) |
| System | Hostname/timezone panel (T1) |

---

## Phase 3 — Platform

| Area | Work |
|------|------|
| Users/Packages | Q1–Q3 CRUD, quotas, impersonate |
| DNS | DNSSEC (C6) · cluster remote reload + probe (C7 **PR-D2**) · dig tools (C11 **PR-D1**) |
| CDN | 自建邊緣網 nodes/sites/multi-A（見 `docs/product/dns-cdn-design.md`） |
| Backup | Incremental restic-class (L7) · exclusions (L5) |
| Sites | One-click apps / WordPress (B21 setup path) · multi-IP (B9) |
| Runtimes | Composer/WP-CLI flags (J4) · PHP modules (J5) |
| System | Panel SSL/port (T2) · IP mgmt (T3) · global search (T7) · rebuild (T8) |
| FTP | SFTP keys (H6) |
| SSL | Wildcard LE (D3) · panel hostname cert (D6) |

---

## Phase 4 — Differentiation depth

| Area | Work |
|------|------|
| AI/Agents | Production playbooks + supervised agents (U1–U2) |
| Updates | Full CVE pipeline polish (S4–S5) |
| Files | Versions · WebDAV (G10/G11) |
| Email | Webmail SSO (F9) · sieve/RBL depth (F14–F16) |
| DB | Temp RO users (I11) · remote hosts (I6) |

---

## Explicitly out of scope (for now)

| Item | Reason |
|------|--------|
| Reseller tier (Q7) | Not needed for Admin control plane |
| Web terminal (T6) | Security risk; optional later only |
| Competitor branding in UI | Product rule |
| Empty redirect “related tools” bars | Product rule |

---

## Progress snapshot (2026-07-29 收斂)

Honest admin view — not marketing. **production** needs root + `YSK_EXECUTE=1`.

| Domain | Est. | Notes |
|--------|------|-------|
| Projects | **100% in-scope** | docroot／bind IP／suspend／aliases／HTTP auth／redirect／cache purge |
| DNS | **100% in-scope** | zone apply 誠實；DNSSEC 金鑰 + 可選 signzone；DS 人手上 registrar |
| SSL | **100% in-scope** | LE／上傳／bindings／到期通知；wildcard 可選 |
| Email | **100% in-scope*** | suspend/autoreply 可 applySystem（Postfix REJECT + sieve） |
| Files / FTP / SFTP | **100% in-scope** | chmod／zip／keys |
| DB | **100% in-scope** | provision 誠實 refuse／execute |
| Cron / Backup | **100% in-scope** | 排程 install 仍係 ops 步驟 |
| Runtimes | **100% in-scope** | multi-runtime + PHP version |
| Firewall / F2B / **Defense** | **100% in-scope** | 防護中心 + 自動化；fleet/multi-CDN out |
| **Log Center** | **100% in-scope** | journal／檔案 allowlist／書籤／SSE／vacuum |
| Services / Metrics / Notifications | **100% in-scope** | Dashboard 通知中心 |
| Security (2FA / API keys / approvals) | **100% in-scope** | |
| System host settings | **100% in-scope** | overview／identity／NTP／電源／IPs |
| Updates | **100% in-scope** | apt 真 candidate；self-update = npm 或 git（YSK_SOURCE_ROOT） |
| AI / Agents | **100%†** | 真 binary ExecStart；無 CLI 唔假 enable |
| Users/Packages multi-tenant | **out / P2 platform** | 唔計 Admin 100% |
| **Overall Admin plane** | **100%** | 誠實 written/applied/blocked |
| **真做合約** | **done** | 禁止 ok+blocked；dryRun 唔抬 ok |
| **@ysk/core tests** | **365+ pass** | 持續綠 |
| **Line coverage ≥90%** | **未達（工程債）** | 唔阻擋功能 100% |

### Explicit out of scope (unchanged)

| Item | Reason |
|------|--------|
| Reseller tier | Admin-first product |
| Web terminal | Security; optional later |
| Full ELK / free-path disk logs | Security boundary |
| Defense multi-host fleet / multi-CDN | Single-host scope |
| Coverage gate 90% as release blocker | Separate engineering track |

Update this table when platform (Phase 3 Users/Packages) opens.
