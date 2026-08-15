# Panel ↔ CLI parity matrix

> Language: English | [中文](./panel-parity-matrix-ZH.md)  
> **Status: gated (not sealed)** — top-level CLI present; run `node scripts/cli-panel-parity.mjs --strict`.  
> Inventory: [control-plane-inventory.json](./control-plane-inventory.json) · [parity-inventory.json](./parity-inventory.json)

**Hard rule:** Every production panel capability must have a CLI entry (or an explicit ⚠️ panel-only row).

| Mark | Meaning |
|------|---------|
| ✅ | CLI available |
| ⚠️ | Partial / intentional panel-only (must have note) |
| ❌ | Panel has it, CLI missing — **must implement** |

---

## Open production gaps (priority)

| ID | Panel | Need CLI | Status | Priority |
|----|-------|----------|--------|----------|
| vpn | VPN ensure / peers / clients / monitor / firewall | `vpn …` | ✅ C2 | P0 |
| vnc | VNC accounts / clients / share / novnc / firewall | `vnc …` | ✅ C2 (browser canvas ⚠️) | P0 |
| apache | Apache sites / settings | `apache …` | ✅ C3 | P0 |
| service-exposure | Network service exposure sync | `network exposure …` | ✅ C3 | P0 |
| real-ip | Real-IP apply | `real-ip …` | ✅ C3 | P1 |
| panel-tls | Panel TLS status/apply | `ssl panel-tls …` | ✅ C3 | P1 |
| updates-inventory | Updates inventory / package apply | `updates …` | ✅ C4 | P1 |
| software-install | Feature install banners | `software …` | ✅ C4 (+ `stack`) | P1 |
| db-lifecycle | DB console lifecycle / apply | `db …` | ✅ C5 | P1 |
| sql-engine-switch | MySQL ↔ MariaDB switch | `db sql-engine …` | ✅ C5 | P1 |
| redis-keys | Redis key mutations | `redis keys …` | ✅ C5 | P2 |
| ftp-accounts | FTP account CRUD | `ftp accounts …` | ✅ C6 | P2 |
| files-shares-create | Create public share (direct/BT/both) | `files shares create [--mode …]` | ✅ C6 | P2 |
| files-shares-bt-stats | Share BT swarm stats | `files shares bt-stats --id` | ✅ C6 | P2 |
| bt-tracker | BT tracker service page | `bt-tracker status\|start\|stop\|settings\|torrents\|restore\|jobs` | ✅ C6 | P2 |
| email-depth | aliases / queue / relay | `email …` | ✅ C6 | P2 |
| dns-records | records / dnssec / heal | `dns …` | ✅ C6 | P2 |
| runtimes-full | java/kotlin/bun + switch | `runtimes …` / `hosting runtime-*` | ✅ C7 | P2 |

## Intentional panel-only (⚠️)

| ID | Panel | Rationale |
|----|-------|-----------|
| host-browse | Host Browse Chromium UI | Interactive browser surface; optional session list later |
| terminal-pty | Browser terminal | Not a remote SSH product |
| file-preview-editor | Text/media preview editor | UX-only; use `files read/write` |
| public-share-landing | `/share/:token` page | Public HTTP; create still needs CLI |
| vnc-browser-canvas | In-panel noVNC/RFB viewer | Interactive; CLI has `vnc session mint` + `share` + connection metadata |
| support | Support / donate / YSK Limited | Static; no CLI/API |

---

## Covered domains (high level ✅)

| Domain | CLI entry points |
|--------|------------------|
| Control plane | `setup` `serve` `readiness` `health` `store` `system unit-install` `update` |
| Projects | `projects list\|get\|create\|deploy\|stop\|git-deploy\|git` (status/fetch/checkout/reset/auth/hook) `isolation\|health` |
| Files | `files list\|read\|write\|mkdir\|rm\|…\|trash\|webdav\|shares list\|create\|bt-stats` |
| BT Tracker | `bt-tracker status\|start\|stop\|settings\|torrents\|restore\|jobs` |
| Email | `email domains\|mailboxes\|dns\|bootstrap\|deliverability` |
| Nginx / SSL / DNS zones | `nginx` `ssl` `dns` `hosting …` |
| Defense | `defense` / `protection` |
| CDN / agents / db-cluster | `cdn` `agents` `db-cluster` |
| Cron / backup / migrate | `cron` `backup` `migrate` (`orphan-homes`) |
| Security identity | `security` `ssh-key` `ssh-2fa` `users` `rbac` |
| Services / host / logs | `services` `host` `logs` |
| Stack | `stack plans\|install\|…` |
| VPN | `vpn status\|monitor\|ensure\|peers\|clients\|firewall\|presets` |
| VNC | `vnc status\|settings\|accounts\|clients\|share\|novnc\|session\|firewall` |
| Apache | `apache sites\|settings …` |
| Network exposure / Real-IP | `network exposure …` `real-ip …` |
| Panel TLS | `ssl panel-tls status\|enable\|disable\|issue` |
| Updates / Software | `updates …` `software …` (+ `update` / `stack`) |
| DB / Redis | `db status\|console\|lifecycle\|sql-engine` `redis keys\|get\|set\|del` |
| AI | `ask` `tools` |

---

## Implementation track

| Slice | Deliverable | Target % |
|-------|-------------|----------|
| **C0** | This matrix + `scripts/cli-panel-parity.mjs` | ~10% |
| **C1** | CLI module skeleton | ~20% |
| **C2** | `vpn` + `vnc` | ~40% |
| **C3** | `apache` + `network exposure` + real-ip + panel-tls | ~55% |
| **C4** | `updates` + `software` | ~70% |
| **C5** | `db` depth + redis keys | ~80% |
| **C6** | files/email/dns/ftp gaps | ~90% |
| **C7** | runtimes full + seal + smoke | 100% |

---

## Regenerate inventory

```bash
node scripts/cli-panel-parity.mjs
node scripts/cli-panel-parity.mjs --json
# optional CI later:
# node scripts/cli-panel-parity.mjs --strict   # fails if any ❌ missing remain
```

*Last updated: 2026-08-13 — inventory gated.*
