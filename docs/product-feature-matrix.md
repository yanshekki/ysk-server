# YSK Product Feature Matrix

> Language: English | [中文](./product-feature-matrix-ZH.md)

**Status:** product contract (source of truth)  
**Rescored:** 2026-08-13 — marks match shipped 1.0.7 code (zip/WebDAV/versions/operator 2FA/users were stale ✗).  
**Research basis:** Hestia Control Panel v1.9.x (docs + UI pages + 524 `v-*` CLI) and DirectAdmin (official docs: unique features, hosting services, spam, backup, MSS, CustomBuild) — 2026-07.  
**Rule:** UI never markets competitors. Buttons = real ops or preset deep-links only.

## Legend

| Symbol | Meaning |
|--------|---------|
| **H** | Hestia has it |
| **D** | DirectAdmin has it |
| **兩** | Both have it → **YSK must have** |
| **✓** | YSK usable |
| **△** | YSK partial / honesty gap |
| **✗** | YSK missing |
| **P0** | Required for release parity |
| **P1** | Should have soon |
| **P2** | Later |
| **Better** | Both weak/absent → YSK differentiator |

---

## Core model

| Dimension | Hestia | DirectAdmin | YSK |
|-----------|--------|-------------|-----|
| Tenancy | Admin → User + Package | Admin → Reseller → User + Package + feature sets | Admin-first; Users/Packages P2 |
| Sites | Web domain (PHP-FPM + Nginx/Apache) | Domain / subdomain / pointer | **Projects** (Node / PHP / static + Nginx) |
| DNS | BIND + DNSSEC + cluster | named + multi-server sync | DNS page (`written` ≠ authority until apply) |
| Mail | Exim/Dovecot + SA/Clam + webmail | Exim/Dovecot + Rspamd/SA + strong outbound controls | Email domain console |
| DB | MySQL/Maria + optional PG + PMA | MySQL/Maria + PMA SSO; Redis optional | MySQL/Maria/PG/Redis **data + service** pages |
| Files | FileGator | Built-in FM + FTP + Git | Files (trash/share) + FTP |
| System | Services / firewall / IP / updates / RRD | CustomBuild / BFM / MSS / task queue | Service matrix + firewall/f2b + updates |

---

## A — Dashboard `/`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| A1 | Live service health (web/mail/dns/db) | H | D | △ | P0 |
| A2 | Resource usage CPU/RAM/disk/net | H | D | ✓ | P0 |
| A3 | Notification center (backup, cert expiry, approvals) | H | D | ✗ | P1 |
| A4 | Quick create wizard (site/mail/db) | H | D | △ | P1 |
| A5 | Security alerts (f2b, disk full) | H | D | △ | P1 |
| A6 | Honest readiness (executeEnabled/root/mode) | — | — | ✓ | Better |

---

## B — Projects `/projects`, `/projects/:id`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| B1 | Site list + status badges | 兩 | 兩 | ✓ | P0 |
| B2 | Create site (domain + runtime) | 兩 | 兩 | ✓ | P0 |
| B3 | Delete / **suspend** site | 兩 | 兩 | △ | P0 |
| B4 | Domain aliases | 兩 | 兩 | △ | P0 |
| B5 | Subdomains | H | D | ✗ | P0 |
| B6 | Domain pointer / parked | — | D | ✗ | P1 |
| B7 | Rename domain / move path | H | D | △ | P0 |
| B8 | Custom document root | H | D | △ | P0 |
| B9 | Bind IP / multi-IP | 兩 | 兩 | ✗ | P2 |
| B10 | Nginx publish + reload | 兩 | 兩 | ✓ | P0 |
| B11 | Force HTTPS + HSTS | H | D | △ | P0 |
| B12 | Let’s Encrypt (web + mail/webmail) | 兩 | 兩 | △ | P0 |
| B13 | Upload certificate | 兩 | 兩 | ✓ | P0 |
| B14 | Reverse proxy / proxy templates | H | D | △ | P0 |
| B15 | Cache (FastCGI/proxy) + purge | H | D | ✗ | P1 |
| B16 | HTTP auth on path | H | D | ✗ | P1 |
| B17 | Whole-site 301/302 redirect | H | D | ✗ | P1 |
| B18 | Per-site FTP account (jailed path) | H | D | △ | P0 |
| B19 | Web stats (AWStats-class) | H | D | ✗ | P1 |
| B20 | Access / error logs in panel | H | D | △ | P0 |
| B21 | One-click apps (e.g. WordPress) | H | D | ✗ | P2 |
| B22 | Per-site PHP version + FPM pool | H | D | △ | P0 |
| B23 | Multi-runtime lifecycle (Node first-class) | 弱 | D | ✓ | Better |
| B24 | Deploy / stop / health / git | 弱 | 弱 | ✓ | Better |
| B25 | One-click publish Nginx+SSL for this project | 弱 | 弱 | ✓ | Better |
| B26 | Project quotas (mem/cpu/disk) | H | D | △ | P0 |
| B27 | Create-time link DNS + mail checkboxes | H | D | ✓ | P0 |

**Project detail tabs (required):** Overview · Deploy · Network · Resources · Logs · Advanced

---

## C — DNS `/dns`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| C1 | Zone list CRUD | 兩 | 兩 | ✓ | P0 |
| C2 | Record CRUD (A/AAAA/CNAME/MX/TXT/NS/SRV/CAA) | 兩 | 兩 | ✓ | P0 |
| C3 | Zone templates (www/mail/ftp/**cdn**) | H | D | ✓ | P0 |
| C4 | SOA / TTL / NS edit | 兩 | 兩 | △ | P0 |
| C5 | Write zone + **real named reload status** | H | D | △ | P0 |
| C6 | DNSSEC keys / sign | H | D | △ | P1 |
| C7 | DNS cluster push + **remote reload** + peer probe | H | D | ✓ | P2 |
| C8 | External-DNS “records to add” list | H | D | △ | P0 |
| C9 | Record set validation (CNAME conflict / A format) | — | D | ✓ | Better |
| C9b | Zone validation (named-checkzone) | — | D | △ | Better |
| C10 | Zone → SSL LE preset deep-link | — | — | ✓ | Better |
| C11 | dig / DNS lookup tool (UI + API) | — | D | ✓ | P1 |
| C12 | CDN-managed RRset (`managedBy=cdn`) | — | — | ✓ | P1 |

> DNS + multi-node CDN 產品設計：[`docs/product/dns-cdn-design.md`](./product/dns-cdn-design.md)

---

## C′ — CDN `/cdn`（自建邊緣 · 多 ysk-server + Nginx）

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| CDN1 | Node registry (roles control/origin/edge/dns) | — | — | ✓ | P0 |
| CDN2 | Node health probe + drain | — | — | ✓ | P0 |
| CDN3 | Site policy (domains, origin, edges, cache) | — | — | ✓ | P0 |
| CDN4 | Nginx edge renderer (proxy_cache + bypass) | — | — | ✓ | P0 |
| CDN5 | Fan-out apply (fleet/SSH) + partial honesty | — | — | ✓ | P0 |
| CDN6 | Multi-A / failover DNS sync | — | — | ✓ | P0 |
| CDN7 | Cache purge all edges | H | D | ✓ | P1 |
| CDN8 | Weighted DNS (RR expand) / geo | — | — | ✓ | P2 |
| CDN9 | SSL distribute / LE on edge | — | — | ✓ | P1 |
| CDN10 | Hit-rate / status dashboard | — | — | ✓ | P1 |
| CDN11 | Project one-click enable CDN | — | — | ✓ | P1 |

---

## D — SSL `/ssl`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| D1 | Certificate list + expiry + status | 兩 | 兩 | ✓ | P0 |
| D2 | Let’s Encrypt issue / renew | 兩 | 兩 | ✓ | P0 |
| D3 | Wildcard LE | H | D | ✗ | P1 |
| D4 | Upload fullchain + privkey | 兩 | 兩 | ✓ | P0 |
| D5 | Auto-renew cron visibility | 兩 | 兩 | △ | P0 |
| D6 | Panel hostname SSL | H | D | ✗ | P1 |
| D7 | Mail domain SSL | H | D | △ | P0 |
| D8 | Cert ↔ site binding overview | 兩 | 兩 | △ | P0 |
| D9 | Expiry alert + one-click renew | 弱 | 弱 | ✗ | Better |

---

## E — Nginx `/nginx`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| E1 | Vhost list | 兩 | 兩 | ✓ | P0 |
| E2 | Global nginx settings | H | D | △ | P0 |
| E3 | `nginx -t` + reload result panel | 弱 | 弱 | ✓ | Better |
| E4 | Template management (proxy/php/static) | H | D | ✗ | P1 |
| E5 | Cache purge | H | D | ✗ | P1 |

---

## F — Email `/email`, `/email/domains/:id`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| F1 | Mail domain list CRUD | 兩 | 兩 | ✓ | P0 |
| F2 | Mailbox CRUD + quota + password | 兩 | 兩 | ✓ | P0 |
| F3 | Alias / forward | 兩 | 兩 | △ | P0 |
| F4 | Catch-all | H | D | ✗ | P0 |
| F5 | Autoreply / vacation | H | D | ✗ | P0 |
| F6 | DKIM generate + DNS display | 兩 | 兩 | △ | P0 |
| F7 | SPF / DMARC suggested records | 兩 | 兩 | △ | P0 |
| F8 | Webmail link | 兩 | 兩 | ✓ | P1 |
| F9 | Webmail SSO | — | D | ✓ | Better |
| F10 | Anti-spam per domain | H | D | ✗ | P0 |
| F11 | Anti-virus toggle | H | D | ✗ | P1 |
| F12 | SMTP relay | H | D | ✓ | P0 |
| F13 | Outbound rate limit (user/mailbox) | H | D | △ | P0 |
| F14 | RBL / global spam policy | H | D | ✗ | P1 |
| F15 | Black/white lists | — | D | ✗ | P1 |
| F16 | Sieve filters | H | D | ✗ | P1 |
| F17 | Autodiscover / autoconfig | — | D | ✗ | P0 |
| F18 | Mail queue view / flush | H | D | △ | P0 |
| F19 | Live deliverability check (MX/PTR/25) | 弱 | 弱 | △ | Better |
| F20 | One-click mail stack install | H | D | △ | P0 |
| F21 | Mail SSL | 兩 | 兩 | △ | P0 |
| F22 | Suspend domain/mailbox | 兩 | 兩 | ✗ | P0 |

**Email domain tabs (required):** DNS · Mailboxes · Health · Relay · Advanced

---

## G — Files `/files`, `/files/public`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| G1 | Browse / upload / download / delete | 兩 | 兩 | ✓ | P0 |
| G2 | Mkdir / rename / move / copy | 兩 | 兩 | ✓ | P0 |
| G3 | chmod | 兩 | 兩 | ✓ | P0 |
| G4 | Archive zip/unzip | H | D | ✓ | P0 |
| G5 | Text edit / preview | 兩 | 兩 | ✓ | P0 |
| G6 | Trash + restore | 弱 | 弱 | ✓ | Better |
| G7 | Public share links | 弱 | 弱 | ✓ | Better |
| G8 | Favorites | 弱 | 弱 | ✓ | Better |
| G9 | Multi-root (public + per-project) | 弱 | 弱 | ✓ | Better |
| G10 | Versions / history | 弱 | 弱 | ✓ | P2 |
| G11 | WebDAV | 弱 | 弱 | ✓ | P2 |
| G12 | Search | H | D | △ | P0 |

---

## H — FTP `/ftp` (service merged; `/ftp/service` → redirect)

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| H1 | Account list CRUD | 兩 | 兩 | ✓ | P0 |
| H2 | Path jail / chroot | 兩 | 兩 | ✓ | P0 |
| H3 | Password reset | 兩 | 兩 | ✓ | P0 |
| H4 | FTPS + passive ports | 兩 | 兩 | ✓ | P0 |
| H5 | Service install/start/stop/reload | 兩 | 兩 | ✓ | P0 |
| H6 | SFTP keys / jail | H | D | △ | P1 |
| H7 | Create FTP from project | H | D | ✗ | P0 |

---

## I — Databases `/databases/*`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| I1 | Create / delete database | 兩 | 兩 | ✓ | P0 |
| I2 | DB user + grants | 兩 | 兩 | ✓ | P0 |
| I3 | Change password | 兩 | 兩 | ✓ | P0 |
| I4 | Dump export / import | 兩 | 兩 | △ | P0 |
| I5 | Adminer/phpMyAdmin entry or SSO | 兩 | 兩 | ✗ | P1 |
| I6 | Remote DB host | H | D | ✗ | P2 |
| I7 | PostgreSQL parity | H | 弱 | ✓ | Better |
| I8 | Redis browse + service | — | D | ✓ | Better |
| I9 | Service console (lifecycle + settings + apply) | 弱 | 弱 | ✓ | Better |
| I10 | Live metrics (connections/memory) | 弱 | 弱 | ✓ | Better |
| I11 | Temporary read-only user | H | — | ✗ | Better |

Each engine: **data page** + **service page**.

---

## J — Runtimes `/runtimes/php`, `/runtimes/node`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| J1 | Multi-PHP install / default | H | D | △ | P0 |
| J2 | PHP-FPM pool settings | H | D | △ | P0 |
| J3 | Node probe / install | 弱 | D | ✓ | Better |
| J4 | Composer / WP-CLI availability | H | D | ✗ | P1 |
| J5 | Extension list | H | D | ✗ | P1 |

---

## K — Cron `/cron`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| K1 | Cron list CRUD | 兩 | 兩 | ✓ | P0 |
| K2 | Schedule generator UI | H | D | △ | P0 |
| K3 | Enable / disable job | H | D | △ | P0 |
| K4 | Job notifications on/off | H | D | ✗ | P1 |
| K5 | Run once from UI (test) | 弱 | 弱 | ✗ | Better |
| K6 | Managed file vs system crontab split | 弱 | 弱 | ✓ | Better |

---

## L — Backups `/backups`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| L0 | Full host migrate (SSH target) | — | — | ✓ | P0 |
| L1 | Manual backup (project/user) | 兩 | 兩 | ✓ | P0 |
| L2 | Scheduled backup | 兩 | 兩 | △ | P0 |
| L3 | Download backup | 兩 | 兩 | △ | P0 |
| L4 | Restore full / selective (web/db/mail/dns) | 兩 | 兩 | △ | P0 |
| L5 | Exclusion lists | H | D | ✗ | P1 |
| L6 | Remote storage (S3/SFTP/…) | H | D | ✗ | P0 |
| L7 | Incremental (restic/borg-class) | H | D | ✗ | P1 |
| L8 | Import migrations (cPanel/DA) | H | D | ✗ | P2 |
| L9 | Backup failure alerts | 弱 | 弱 | ✗ | Better |
| L10 | Restore dry-run + honest result | 弱 | 弱 | △ | Better |

---

## M — Firewall `/firewall`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| M1 | Rule list CRUD | H | D | ✓ | P0 |
| M2 | Common port presets | H | D | ✓ | P0 |
| M3 | Ban list | H | D | △ | P0 |
| M4 | ipset bulk | H | — | ✗ | P1 |
| M5 | Apply to host + honest status | 弱 | 弱 | ✓ | Better |
| M6 | Anti-lockout (keep SSH) | 弱 | 弱 | △ | Better |

---

## N — Fail2ban `/fail2ban`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| N1 | Status + jail list | H | D | ✓ | P0 |
| N2 | Jail enable + params | H | D | ✓ | P0 |
| N3 | Banned IPs + unban | H | D | △ | P0 |
| N4 | Whitelist IPs | H | D | △ | P0 |

---

## O — Services `/services`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| O1 | Matrix: active/enabled/installed | H | D | ✓ | P0 |
| O2 | start/stop/restart/reload | 兩 | 兩 | ✓ | P0 |
| O3 | Enable on boot | 兩 | 兩 | ✓ | P0 |
| O4 | Deep-link to service console | 弱 | 弱 | ✓ | Better |
| O5 | Log tail entry | H | D | △ | P0 |

---

## P — Metrics `/metrics`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| P1 | Live load/mem/disk/net | H | D | ✓ | P0 |
| P2 | History charts | H | D | △ | P1 |
| P3 | Per-project usage | H | D | △ | P0 |
| P4 | Bandwidth stats | H | D | ✗ | P1 |
| P5 | Alert thresholds | 弱 | 弱 | △ | Better |

---

## Q — Users / Packages (future)

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| Q1 | User CRUD | 兩 | 兩 | ✓ | P2 |
| Q2 | Package quotas | 兩 | 兩 | △ | P2 |
| Q3 | Impersonate / login-as | H | D | ✓ | P2 |
| Q4 | 2FA (users) | H | D | ✗ | P0* |
| Q5 | SSH key / shell | H | D | △ | P1 |
| Q6 | Feature sets (email-only) | — | D | ✗ | P2 |
| Q7 | Reseller tier | — | D | ✗ | **Out** (not planned) |
| Q8 | API access keys | H | D | △ | P0 |

\*2FA for admin operator is P0 even in single-admin mode.

---

## R — Security / Auth `/security`, login

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| R1 | Change password | 兩 | 兩 | ✓ | P0 |
| R2 | 2FA | 兩 | 兩 | ✓ | P0 |
| R3 | Login / audit log | H | D | ✓ | P0 |
| R4 | Tool allowlist + human approval | — | — | ✓ | Better |
| R5 | Session / API token management | H | D | △ | P0 |

---

## S — Updates `/updates`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| S1 | Panel self-update | H | D | ✓ | P0 |
| S2 | System package updates | H | D | ✓ | P0 |
| S3 | Component pin / rebuild (CustomBuild-class) | — | D | ✗ | P2 |
| S4 | CVE / risk advisories | 弱 | 弱 | ✓ | Better |
| S5 | Approvable update execution | — | — | ✓ | Better |

---

## T — System `/system`, `/system/unit`, `/system/readiness`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| T1 | Hostname / timezone / language | H | D | △ | P0 |
| T2 | Panel port / SSL | H | D | ✗ | P1 |
| T3 | IP address management | H | D | ✗ | P1 |
| T4 | Control-plane systemd unit | 弱 | 弱 | ✓ | Better |
| T5 | Production readiness checks | 弱 | 弱 | ✓ | Better |
| T6 | Web terminal | H | D | ✗ | Out / optional later |
| T7 | Global object search | H | D | ✗ | P1 |
| T8 | Config export / rebuild | H | D | ✗ | P1 |

---

## U — AI / Agents `/ai`, `/agents`

| ID | Feature | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| U1 | AI tasks / playbooks | — | — | △ | Better |
| U2 | Agent install + supervision | — | — | △ | Better |
| U3 | High-risk ops require approval | — | — | ✓ | Better |

---

## P0 contract (must not ship without)

1. Projects: CRUD, deploy, nginx publish, SSL, logs, backup, health, files root  
2. DNS: zone+record CRUD, templates, honest write/apply, external DNS list  
3. SSL: list, LE, upload, renew status, domain binding  
4. Email: domains, mailboxes, alias/forward, DKIM/SPF/DMARC, relay, rate limit, health  
5. Files: full CRUD + trash + share + project root  
6. FTP: accounts + FTPS service control  
7. DB engines: db/user/dump + service console  
8. Cron: CRUD + enable/disable  
9. Backup: manual/schedule, restore, download  
10. Firewall + Fail2ban: rules, ban, honest apply  
11. Services matrix: real systemctl  
12. Metrics: live resources  
13. Updates: packages + risk  
14. Auth: password + **2FA** + audit  

---

## Better-than-both (non-negotiable product pillars)

| Pillar | Requirement |
|--------|-------------|
| Honest status | `written` / `applied` / `blocked` everywhere |
| Fail-closed | No fake success without execute/root |
| Ops result panel | steps + notes + retry |
| Multi-runtime projects | Node/PHP/static first-class |
| Service consoles | SettingField categories + applyMode |
| Files | trash / share / multi-root |
| Security model | allowlist + approval; AI untrusted |
| Smart updates | CVE advice + approvable apply |
| Mail deliverability | structured external todos + live checks |
| UI | no fluff; buttons = ops or preset only |

---

## Related docs

- [`product-page-map.md`](./product-page-map.md) — IA, routes, tabs, required actions  
- [`product-gap-backlog.md`](./product-gap-backlog.md) — phased implementation backlog  
