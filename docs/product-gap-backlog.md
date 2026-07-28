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
| B7–B8 | Rename domain / custom docroot | domain via network tab; docroot later | partial |
| B11 | Force HTTPS + HSTS toggles | network tab + publish | **done** |
| B18 | Create jailed FTP from project | preset path + project linuxUser guest | **done** |
| B20 | Access/error log viewer polish | logs tab exists | partial |
| B22 | Per-site PHP version when runtime=php | deploy/FPM version | **done** |
| B26 | Apply mem/cpu/disk quotas honestly | soft + panel limits + setquota try | **done** (hard FS-dependent) |
| B27 | Create modal: also create DNS zone / mail domain | checkboxes | **done** |

### 1.2 DNS
| ID | Work | Notes | Status |
|----|------|-------|--------|
| C3 | Zone templates (minimal/web/mail/full) | seed records | **done** |
| C4 | SOA/TTL/NS edit | SOA fixed in zone file; TTL per-record | partial |
| C5 | Real apply: write + named-check + reload **or** honest `written` | no fake applied | **done** |
| C8 | External DNS record checklist share with email | GET /dns/external-checklist | **done** |
| C9 | Validate zone (named-checkzone) | Better | **done** |

### 1.3 Email
| ID | Work | Notes | Status |
|----|------|-------|--------|
| F3 | Alias + forward full CRUD | virtual_alias map | **done** |
| F4 | Catch-all | type=catchall | **done** |
| F5 | Autoreply | domain flags (MTA sieve later) | **done** (flags) |
| F6–F7 | DKIM/SPF/DMARC complete panel | existing DNS tab | partial |
| F10 | Antispam per domain toggle | flag field | partial |
| F13 | Outbound rate limits | flag field | partial |
| F17 | Autodiscover/autoconfig endpoints | public XML + domain panel | **done** |
| F18 | Mail queue list + flush | postqueue UI list + flush | **done** |
| F20–F22 | Bootstrap honesty · mail SSL · suspend | suspend flags | partial |

### 1.4 SSL
| ID | Work | Notes | Status |
|----|------|-------|--------|
| D5 | Show auto-renew job status | bindings.renewJobs | **done** (API) |
| D7 | Mail domain SSL integration | LE deep-link | partial |
| D8 | Binding overview (cert → projects/mail) | GET /ssl/bindings | **done** |
| D9 | Expiry warnings on dashboard | KPI + alert + notifications | **done** |

### 1.5 Backups
| ID | Work | Notes | Status |
|----|------|-------|--------|
| L2 | Scheduled backups | cron ensureBackupSchedule | **done** |
| L3 | Download archive | GET /backups/download | **done** |
| L4 | Selective restore | full restore only | partial |
| L6 | Remote target config (SFTP/S3) | | pending |
| L10 | Dry-run + honest result panel | | pending |

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
| Global | Enforce written/applied/blocked on every apply path |
| Files | chmod · zip/unzip · search harden (G3/G4/G12) |
| DB | Full dump/import · Adminer or embedded browser entry (I4/I5) |
| Email | Deliverability health UX · external todos (F19) |
| Dashboard | Notification center (A3) · security strip (A5) |
| Sites | Cache purge · HTTP auth · site redirect (B15–B17) |
| Nginx | Template gallery · purge (E4/E5) |
| Fail2ban | Ban list UX · whitelist (N3/N4) |
| Metrics | Per-project usage strip (P3) |
| System | Hostname/timezone panel (T1) |

---

## Phase 3 — Platform

| Area | Work |
|------|------|
| Users/Packages | Q1–Q3 CRUD, quotas, impersonate |
| DNS | DNSSEC (C6) · cluster optional (C7) |
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

## Progress snapshot (2026-07)

| Domain | Est. | Biggest gap |
|--------|------|-------------|
| Projects | 75% | per-site FTP, HTTP auth, redirect, stats (Phase 1 remaining: B18/B20 polish) |
| DNS | 45% | real apply, templates |
| SSL | 55% | renew visibility, bindings |
| Email | 50% | alias/forward/catchall, queue, autodiscover |
| Files | 75% | chmod, archive |
| FTP | 70% | from-project create |
| DB | 70% | dump/import, Adminer |
| Cron | 60% | disable, run-now |
| Backup | 45% | schedule, selective restore, remote |
| Firewall/F2B | 65% | ban/whitelist UX |
| Services/Metrics | 75% | history, per-project |
| Users/Packages | 5% | not started |
| 2FA | 0% | not started |
| AI/Agents | 40% | productize |

Update this table when Phase 1 items close.
