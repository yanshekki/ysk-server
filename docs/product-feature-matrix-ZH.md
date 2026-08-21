# YSK Product 功能 矩陣

> 語言：中文 | [English](./product-feature-matrix.md)

**狀態:** 產品契約（準則來源）  
**重計：** 2026-08-20 — 對齊 **1.1.22**（驗證者精靈記憶體不足仍可安裝，須輸入節點識別碼確認）。只連官方網站，不接錢包。shared／core／產品同一版本。標記對齊已交付程式（面板 + CLI + API），不是行銷。    
**研究基礎：** Hestia Control Panel v1.9.x（文件 + UI + 524 個 `v-*` CLI）與 DirectAdmin（官方文件：獨特功能、託管服務、垃圾郵件、備份、MSS、CustomBuild）— 2026-07。  
**Rule:** UI never markets competitors. Buttons = 真實操作 or preset deep-links only.

## 圖例

| 符號 | 含義 |
|--------|---------|
| **H** | Hestia 有 |
| **D** | DirectAdmin 有 |
| **兩** | 兩者皆有 → **YSK 必須有** |
| **✓** | YSK 可用 |
| **△** | YSK 部分／誠實缺口 |
| **✗** | YSK 未有 |
| **P0** | 發行對等必要 |
| **P1** | 應盡快具備 |
| **P2** | 其後 |
| **Better** | 兩者皆弱／無 → YSK 差異化 |

---

## 核心模型

| 維度 | Hestia | DirectAdmin | YSK |
|-----------|--------|-------------|-----|
| 租戶模型 | Admin → User + Package | Admin → Reseller → User + Package + feature sets | Admin-first; Users/Packages P2 |
| 站點 | Web domain (PHP-FPM + Nginx/Apache) | Domain / subdomain / pointer | **專案** (Node / PHP / static + Nginx) |
| DNS | BIND + DNSSEC + cluster | named + multi-server sync | DNS page (`written` ≠ authority until apply) |
| 郵件 | Exim/Dovecot + SA/Clam + webmail | Exim/Dovecot + Rspamd/SA + strong outbound controls | Email domain console |
| DB | MySQL/Maria + optional PG + PMA | MySQL/Maria + PMA SSO; Redis optional | MySQL/Maria/PG/Redis **data + service** pages |
| 檔案 | FileGator | Built-in FM + FTP + Git | 檔案 (trash/share) + FTP |
| 系統 | Services / firewall / IP / updates / RRD | CustomBuild / BFM / MSS / task queue | 服務矩陣 + firewall/f2b + updates |

---

## A — 儀表板 `/`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| A1 | 即時服務健康 (web/mail/dns/db) | H | D | △ | P0 |
| A2 | 資源用量 CPU/RAM/disk/net | H | D | ✓ | P0 |
| A3 | 通知中心 (backup, cert expiry, approvals) | H | D | ✓ | P1 |
| A4 | 快速建立精靈 (site/mail/db) | H | D | ✓ | P1 |
| A5 | 安全告警 (f2b, disk full) | H | D | ✓ | P1 |
| A6 | 誠實就緒 (executeEnabled/root/mode) | — | — | ✓ | Better |

---

## B — 專案 `/projects`, `/projects/:id`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| B1 | 站點列表 + 狀態徽章 | 兩 | 兩 | ✓ | P0 |
| B2 | 建立站點 (domain + runtime) | 兩 | 兩 | ✓ | P0 |
| B3 | 刪除／**暫停**站點 | 兩 | 兩 | ✓ | P0 |
| B4 | 域名別名 | 兩 | 兩 | ✓ | P0 |
| B5 | 子域名 | H | D | ✓ | P0 |
| B6 | 域名指向／停放 | — | D | ✗ | P1 |
| B7 | 重新命名域名／搬移路徑 | H | D | △ | P0 |
| B8 | 自訂文件根 | H | D | △ | P0 |
| B9 | 綁定 IP／多 IP | 兩 | 兩 | ✗ | P2 |
| B10 | Nginx 發布 + reload | 兩 | 兩 | ✓ | P0 |
| B11 | 強制 HTTPS + HSTS | H | D | ✓ | P0 |
| B12 | Let’s Encrypt (web + mail/webmail) | 兩 | 兩 | △ | P0 |
| B13 | 上傳憑證 | 兩 | 兩 | ✓ | P0 |
| B14 | 反向代理／代理範本 | H | D | △ | P0 |
| B15 | 快取（FastCGI／proxy）+ purge | H | D | ✓ | P1 |
| B16 | 路徑 HTTP 認證 | H | D | ✓ | P1 |
| B17 | 整站 301／302 轉向 | H | D | ✓ | P1 |
| B18 | 每站 FTP 帳戶 (jailed path) | H | D | ✓ | P0 |
| B19 | 網站統計 (AWStats-class) | H | D | ✗ | P1 |
| B20 | 面板內 access／error 日誌 | H | D | △ | P0 |
| B21 | 一鍵應用 (e.g. WordPress) | H | D | ✗ | P2 |
| B22 | 每站 PHP 版本 + FPM pool | H | D | △ | P0 |
| B23 | 多 runtime 生命週期 (Node first-class) | 弱 | D | ✓ | Better |
| B24 | 部署／停止／健康／git | 弱 | 弱 | ✓ | Better |
| B25 | One-click publish Nginx+SSL for this project | 弱 | 弱 | ✓ | Better |
| B26 | Project quotas (mem/cpu/disk) | H | D | △ | P0 |
| B27 | Create-time link DNS + mail checkboxes | H | D | ✓ | P0 |

**專案詳情 tabs (required):** 概覽 · Deploy · Network · Resources · Logs · Advanced

---

## C — DNS `/dns`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| C1 | Zone list CRUD | 兩 | 兩 | ✓ | P0 |
| C2 | Record CRUD (A/AAAA/CNAME/MX/TXT/NS/SRV/CAA) | 兩 | 兩 | ✓ | P0 |
| C3 | Zone templates (www/mail/ftp/**cdn**) | H | D | ✓ | P0 |
| C4 | SOA / TTL / NS edit | 兩 | 兩 | △ | P0 |
| C5 | Write zone + **real named reload status** | H | D | ✓ | P0 |
| C6 | DNSSEC keys / sign | H | D | △ | P1 |
| C7 | DNS cluster push + **remote reload** + peer probe | H | D | ✓ | P2 |
| C8 | External-DNS “records to add” list | H | D | ✓ | P0 |
| C9 | Record set validation (CNAME conflict / A format) | — | D | ✓ | Better |
| C9b | Zone validation (named-checkzone) | — | D | ✓ | Better |
| C10 | Zone → SSL LE preset deep-link | — | — | ✓ | Better |
| C11 | dig / DNS lookup tool (UI + API) | — | D | ✓ | P1 |
| C12 | CDN-managed RRset (`managedBy=cdn`) | — | — | ✓ | P1 |

> DNS + multi-node CDN 產品設計：[`docs/product/dns-cdn-design.md`](./product/dns-cdn-design.md)

---

## C′ — CDN `/cdn`（自建邊緣 · 多 ysk-server + Nginx）

| ID | 功能 | H | D | YSK | Pri |
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

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| D1 | Certificate list + expiry + status | 兩 | 兩 | ✓ | P0 |
| D2 | Let’s Encrypt issue / renew | 兩 | 兩 | ✓ | P0 |
| D3 | Wildcard LE | H | D | ✗ | P1 |
| D4 | Upload fullchain + privkey | 兩 | 兩 | ✓ | P0 |
| D5 | Auto-renew cron visibility | 兩 | 兩 | ✓ | P0 |
| D6 | Panel hostname SSL | H | D | ✓ | P1 |
| D7 | 郵件 domain SSL | H | D | △ | P0 |
| D8 | Cert ↔ site binding overview | 兩 | 兩 | ✓ | P0 |
| D9 | Expiry alert + one-click renew | 弱 | 弱 | ✓ | Better |

---

## E — Nginx `/nginx`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| E1 | Vhost list | 兩 | 兩 | ✓ | P0 |
| E2 | Global nginx settings | H | D | △ | P0 |
| E3 | `nginx -t` + reload result panel | 弱 | 弱 | ✓ | Better |
| E4 | Template management (proxy/php/static) | H | D | ✗ | P1 |
| E5 | Cache purge | H | D | ✗ | P1 |

---

## F — Email `/email`, `/email/domains/:id`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| F1 | 郵件 domain list CRUD | 兩 | 兩 | ✓ | P0 |
| F2 | 郵件box CRUD + quota + password | 兩 | 兩 | ✓ | P0 |
| F3 | Alias / forward | 兩 | 兩 | ✓ | P0 |
| F4 | Catch-all | H | D | ✓ | P0 |
| F5 | Autoreply / vacation | H | D | ✓ | P0 |
| F6 | DKIM generate + DNS display | 兩 | 兩 | △ | P0 |
| F7 | SPF / DMARC suggested records | 兩 | 兩 | △ | P0 |
| F8 | Webmail link | 兩 | 兩 | ✓ | P1 |
| F9 | Webmail SSO | — | D | ✓ | Better |
| F10 | Anti-spam per domain | H | D | ✓ | P0 |
| F11 | Anti-virus toggle | H | D | ✗ | P1 |
| F12 | SMTP relay | H | D | ✓ | P0 |
| F13 | Outbound rate limit (user/mailbox) | H | D | △ | P0 |
| F14 | RBL / global spam policy | H | D | ✗ | P1 |
| F15 | Black/white lists | — | D | ✗ | P1 |
| F16 | Sieve filters | H | D | ✗ | P1 |
| F17 | Autodiscover / autoconfig | — | D | ✓ | P0 |
| F18 | 郵件 queue view / flush | H | D | ✓ | P0 |
| F19 | Live deliverability check (MX/PTR/25) | 弱 | 弱 | ✓ | Better |
| F20 | One-click mail stack install | H | D | △ | P0 |
| F21 | 郵件 SSL | 兩 | 兩 | △ | P0 |
| F22 | Suspend domain/mailbox | 兩 | 兩 | ✓ | P0 |

**Email domain tabs (required):** DNS · 郵件boxes · Health · Relay · Advanced

---

## G — 檔案 `/files`, `/files/public`

| ID | 功能 | H | D | YSK | Pri |
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

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| H1 | Account list CRUD | 兩 | 兩 | ✓ | P0 |
| H2 | Path jail / chroot | 兩 | 兩 | ✓ | P0 |
| H3 | Password reset | 兩 | 兩 | ✓ | P0 |
| H4 | FTPS + passive ports | 兩 | 兩 | ✓ | P0 |
| H5 | Service install/start/stop/reload | 兩 | 兩 | ✓ | P0 |
| H6 | SFTP keys / jail | H | D | △ | P1 |
| H7 | Create FTP from project | H | D | ✓ | P0 |

---

## I — 資料庫 `/databases/*`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| I1 | Create / delete database | 兩 | 兩 | ✓ | P0 |
| I2 | DB user + grants | 兩 | 兩 | ✓ | P0 |
| I3 | Change password | 兩 | 兩 | ✓ | P0 |
| I4 | Dump export / import | 兩 | 兩 | △ | P0 |
| I5 | Adminer/phpMyAdmin entry or SSO | 兩 | 兩 | ✓ | P1 |
| I6 | Remote DB host | H | D | ✗ | P2 |
| I7 | PostgreSQL parity | H | 弱 | ✓ | Better |
| I8 | Redis browse + service | — | D | ✓ | Better |
| I9 | Service console (lifecycle + settings + apply) | 弱 | 弱 | ✓ | Better |
| I10 | Live metrics (connections/memory) | 弱 | 弱 | ✓ | Better |
| I11 | Temporary read-only user | H | — | ✗ | Better |

Each engine: **data page** + **service page**.

---

## J — 執行環境 `/runtimes/php`, `/runtimes/node`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| J1 | Multi-PHP install / default | H | D | △ | P0 |
| J2 | PHP-FPM pool settings | H | D | △ | P0 |
| J3 | Node probe / install | 弱 | D | ✓ | Better |
| J4 | Composer / WP-CLI availability | H | D | ✗ | P1 |
| J5 | Extension list | H | D | ✗ | P1 |

---

## K — Cron `/cron`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| K1 | Cron list CRUD | 兩 | 兩 | ✓ | P0 |
| K2 | Schedule generator UI | H | D | ✓ | P0 |
| K3 | Enable / disable job | H | D | ✓ | P0 |
| K4 | Job notifications on/off | H | D | ✗ | P1 |
| K5 | Run once from UI (test) | 弱 | 弱 | ✓ | Better |
| K6 | Managed file vs system crontab split | 弱 | 弱 | ✓ | Better |

---

## L — 備份 `/backups`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| L0 | Full host migrate (SSH target) | — | — | ✓ | P0 |
| L1 | Manual backup (project/user) | 兩 | 兩 | ✓ | P0 |
| L2 | Scheduled backup | 兩 | 兩 | ✓ | P0 |
| L3 | Download backup | 兩 | 兩 | ✓ | P0 |
| L4 | Restore full / selective (web/db/mail/dns) | 兩 | 兩 | △ | P0 |
| L5 | Exclusion lists | H | D | ✓ | P1 |
| L6 | Remote storage (S3/SFTP/…) | H | D | ✓ | P0 |
| L7 | Incremental (restic/borg-class) | H | D | ✓ | P1 |
| L8 | Import migrations (cPanel/DA) | H | D | ✗ | P2 |
| L9 | Backup failure alerts | 弱 | 弱 | ✗ | Better |
| L10 | Restore dry-run + honest result | 弱 | 弱 | ✓ | Better |

---

## M — 防火牆 `/firewall`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| M1 | Rule list CRUD | H | D | ✓ | P0 |
| M2 | Common port presets | H | D | ✓ | P0 |
| M3 | Ban list | H | D | △ | P0 |
| M4 | ipset bulk | H | — | ✗ | P1 |
| M5 | Apply to host + honest status | 弱 | 弱 | ✓ | Better |
| M6 | Anti-lockout (keep SSH) | 弱 | 弱 | △ | Better |

---

## N — Fail2ban `/fail2ban`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| N1 | 狀態 + jail list | H | D | ✓ | P0 |
| N2 | Jail enable + params | H | D | ✓ | P0 |
| N3 | Banned IPs + unban | H | D | △ | P0 |
| N4 | Whitelist IPs | H | D | △ | P0 |

---

## O — Services `/services`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| O1 | 矩陣: active/enabled/installed | H | D | ✓ | P0 |
| O2 | start/stop/restart/reload | 兩 | 兩 | ✓ | P0 |
| O3 | Enable on boot | 兩 | 兩 | ✓ | P0 |
| O4 | Deep-link to service console | 弱 | 弱 | ✓ | Better |
| O5 | Log tail entry | H | D | △ | P0 |

---

## P — 指標 `/metrics`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| P1 | Live load/mem/disk/net | H | D | ✓ | P0 |
| P2 | History charts | H | D | △ | P1 |
| P3 | Per-project usage | H | D | △ | P0 |
| P4 | Bandwidth stats | H | D | ✗ | P1 |
| P5 | Alert thresholds | 弱 | 弱 | △ | Better |

---

## Q — Users / Packages (future)

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| Q1 | User CRUD | 兩 | 兩 | ✓ | P2 |
| Q2 | Package quotas | 兩 | 兩 | △ | P2 |
| Q3 | Impersonate / login-as | H | D | ✓ | P2 |
| Q4 | 2FA (users) | H | D | ✓ | P0* |
| Q5 | SSH key / shell | H | D | △ | P1 |
| Q6 | 功能 sets (email-only) | — | D | ✗ | P2 |
| Q7 | Reseller tier | — | D | ✗ | **Out** (not planned) |
| Q8 | API access keys | H | D | ✓ | P0 |

\*2FA for admin operator is P0 even in single-admin mode.

---

## R — 安全 / Auth `/security`, login

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| R1 | Change password | 兩 | 兩 | ✓ | P0 |
| R2 | 2FA | 兩 | 兩 | ✓ | P0 |
| R3 | Login / audit log | H | D | ✓ | P0 |
| R4 | Tool allowlist + human approval | — | — | ✓ | Better |
| R5 | Session / API token management | H | D | ✓ | P0 |

---

## S — 更新 `/updates`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| S1 | Panel self-update | H | D | ✓ | P0 |
| S2 | 系統 package updates | H | D | ✓ | P0 |
| S3 | Component pin / rebuild (CustomBuild-class) | — | D | ✗ | P2 |
| S4 | CVE / risk advisories | 弱 | 弱 | ✓ | Better |
| S5 | Approvable update execution | — | — | ✓ | Better |

---

## T — 系統 `/system`, `/system/unit`, `/system/readiness`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| T1 | Hostname / timezone / language | H | D | △ | P0 |
| T2 | Panel port / SSL | H | D | ✓ | P1 |
| T3 | IP address management | H | D | ✗ | P1 |
| T4 | 控制平面 systemd unit | 弱 | 弱 | ✓ | Better |
| T5 | 生產 readiness checks | 弱 | 弱 | ✓ | Better |
| T6 | Web terminal | H | D | ✓ | Out / optional later |
| T7 | Global object search | H | D | ✓ | P1 |
| T8 | Config export / rebuild | H | D | ✗ | P1 |

---

## U — AI / Agent `/ai`, `/agents`

| ID | 功能 | H | D | YSK | Pri |
|----|---------|---|---|-----|-----|
| U1 | AI 任務 / playbooks | — | — | △ | Better |
| U2 | Agent install + supervision | — | — | △ | Better |
| U3 | High-risk ops require approval | — | — | ✓ | Better |

---

## Seal

標記對齊 Waves A–C 之後已出貨的面板、CLI、API。

| YSK | 數量 |
|-----|-------|
| ✓ 可用 | 133 |
| △ 部份／誠實邊界 | 36 |
| ✗ 未做 | 25 |

**P0 ✗：** 無。

**P0 △**（可用，深度／誠實邊界仍開）：A1 · B7 · B8 · B12 · B14 · B20 · B22 · B26 · C4 · D7 · E2 · F6 · F7 · F13 · F20 · F21 · G12 · I4 · J1 · J2 · L4 · M3 · N3 · N4 · O5 · P3 · T1。

其餘 **✗** 屬 P1／P2／Out（或 Better 加項）。

---

## P0 contract (must not ship without)

1. 專案: CRUD, deploy, nginx publish, SSL, logs, backup, health, files root  
2. DNS: zone+record CRUD, templates, honest write/apply, external DNS list  
3. SSL: list, LE, upload, renew status, domain binding  
4. Email: domains, mailboxes, alias/forward, DKIM/SPF/DMARC, relay, rate limit, health  
5. 檔案: full CRUD + trash + share + project root  
6. FTP: accounts + FTPS service control  
7. DB engines: db/user/dump + service console  
8. Cron: CRUD + enable/disable  
9. Backup: manual/schedule, restore, download  
10. 防火牆 + Fail2ban: rules, ban, honest apply  
11. Services matrix: real systemctl  
12. 指標: live resources  
13. 更新: packages + risk  
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
| 檔案 | trash / share / multi-root |
| 安全 model | allowlist + approval; AI untrusted |
| Smart updates | CVE advice + approvable apply |
| 郵件 deliverability | structured external todos + live checks |
| UI | no fluff; buttons = ops or preset only |
| L1 nodes (Beta) | Validators page + CLI; Docker Compose; no key custody |
| Docker 引擎 | `/docker` + `ysk-server docker`；apt docker.io；誠實閘 |

---

## 相關 docs

- [`product-page-map.md`](./product-page-map.md) — IA, routes, tabs, required actions  
- [`product-gap-backlog.md`](./product-gap-backlog.md) — phased implementation backlog
