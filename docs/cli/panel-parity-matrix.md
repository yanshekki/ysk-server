# Panel ↔ CLI parity matrix

> Language: English | [中文](./parity-ZH.md)  
> **Status: C2 in progress** — C0 inventory + C2 `vpn`/`vnc` landed.  
> Machine inventory: [parity-inventory.json](./parity-inventory.json) · regenerate: `node scripts/cli-panel-parity.mjs`

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
| apache | Apache sites / settings | `apache …` | ❌ | P0 |
| service-exposure | Network service exposure sync | `network exposure …` | ❌ | P0 |
| real-ip | Real-IP apply | `real-ip …` | ❌ | P1 |
| panel-tls | Panel TLS status/apply | `ssl panel-tls …` | ⚠️ partial | P1 |
| updates-inventory | Updates inventory / package apply | `updates …` | ⚠️ partial (`update` self only) | P1 |
| software-install | Feature install banners | `software …` | ⚠️ partial (`stack` only) | P1 |
| db-lifecycle | DB console lifecycle / apply | `db …` | ⚠️ partial | P1 |
| sql-engine-switch | MySQL ↔ MariaDB switch | `db sql-engine …` | ❌ | P1 |
| redis-keys | Redis key mutations | `redis keys …` | ❌ | P2 |
| ftp-accounts | FTP account CRUD | `ftp accounts …` | ⚠️ partial | P2 |
| files-shares-create | Create public share | `files shares create` | ⚠️ list only | P2 |
| email-depth | aliases / queue / relay | `email …` | ⚠️ partial | P2 |
| dns-records | records / dnssec / heal | `dns …` | ⚠️ zones only | P2 |
| runtimes-full | java/kotlin/bun + switch | `hosting runtime-install` expand | ⚠️ partial | P2 |

## Intentional panel-only (⚠️)

| ID | Panel | Rationale |
|----|-------|-----------|
| host-browse | Host Browse Chromium UI | Interactive browser surface; optional session list later |
| terminal-pty | Browser terminal | Not a remote SSH product |
| file-preview-editor | Text/media preview editor | UX-only; use `files read/write` |
| public-share-landing | `/share/:token` page | Public HTTP; create still needs CLI |
| vnc-browser-canvas | In-panel noVNC/RFB viewer | Interactive; CLI has `vnc session mint` + `share` + connection metadata |

---

## Covered domains (high level ✅)

| Domain | CLI entry points |
|--------|------------------|
| Control plane | `setup` `serve` `readiness` `health` `store` `system unit-install` `update` |
| Projects | `projects list\|get\|create\|deploy\|stop\|git-deploy\|isolation\|health` |
| Files | `files list\|read\|write\|mkdir\|rm\|…\|trash\|webdav\|shares list` |
| Email | `email domains\|mailboxes\|dns\|bootstrap\|deliverability` |
| Nginx / SSL / DNS zones | `nginx` `ssl` `dns` `hosting …` |
| Defense | `defense` / `protection` |
| CDN / agents / db-cluster | `cdn` `agents` `db-cluster` |
| Cron / backup / migrate | `cron` `backup` `migrate` |
| Security identity | `security` `ssh-key` `ssh-2fa` `users` `rbac` |
| Services / host / logs | `services` `host` `logs` |
| Stack | `stack plans\|install\|…` |
| VPN | `vpn status\|monitor\|ensure\|peers\|clients\|firewall\|presets` |
| VNC | `vnc status\|settings\|accounts\|clients\|share\|novnc\|session\|firewall` |
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

*Last updated: 2026-08-12 — C2 vpn+vnc full panel surface.*
