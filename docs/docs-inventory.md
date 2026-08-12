# Documentation inventory (Panel + CLI)

> Language: English | [中文](./docs-inventory-ZH.md)

Tracks **documentation** gaps after code parity seal (C7).  
Standards: [docs-standard.md](./docs-standard.md). Programme slices: **D0–D5**.

| Status | Meaning |
|--------|---------|
| ⬜ | Not started against L2/L3 template |
| 🔶 | Partial / outdated |
| ✅ | Meets template (EN+ZH parallel) |

---

## Programme progress

| Slice | Deliverable | % | Status |
|-------|-------------|---|--------|
| **D0** | Standard + template + this inventory + INDEX links | ~10% | ✅ done |
| **D1** | `cli/overview` + `cli/reference` + `commands.json` | ~35% | ✅ done |
| **D2** | New-domain handbooks (vpn, vnc, apache, system-host, databases, runtimes) | ~55% | ✅ done |
| **D3** | Remaining `features/*` deepen | ~75% | ✅ done |
| **D4** | INDEX polish, user-manual Day-N, agent docs, parity ZH | ~90% | ✅ done |
| **D5** | bilingual-check seal + cross-links | 100% | ✅ done |

---

## L3 — CLI encyclopedia

| File | Gap | Slice |
|------|-----|-------|
| `cli/overview{,-ZH}.md` | Command groups missing C2–C7 tops | D1 |
| `cli/reference{,-ZH}.md` | No full sections for vpn/vnc/apache/network/real-ip/updates/software/db/redis/ftp/runtimes; files shares/email/dns depth weak | D1 |
| `agent/commands.json` | Partial catalog | D1 |
| `cli/parity{,-ZH}.md` | ZH structure lag | D4 |
| `cli/panel-parity-matrix{,-ZH}.md` | ZH structure lag | D4 |

### Top-level CLI commands (code SSOT, n=51)

`setup` `update` `serve` `system` `stack` `tools` `ask` `projects` `users` `packages` `rbac` `audit` `security` `backup` `templates` `hosting` `dns` `logs` `host` `nginx` `ssl` `db-cluster` `ssh-key` `ssh-2fa` `services` `defense` `protection` `cdn` `agents` `agent` `store` `files` `cron` `email` `health` `readiness` `doctor` `migrate` **`vpn`** **`vnc`** **`apache`** **`network`** **`real-ip`** **`updates`** **`software`** **`db`** **`redis`** **`ftp`** **`runtimes`** `version` `help`

Bold = post-C2 surface that reference still under-documents.

---

## L2 — Feature handbooks

| Domain | Files | Panel route(s) | Primary CLI | Doc status | Slice |
|--------|-------|----------------|-------------|------------|-------|
| projects | `projects{,-ZH}.md` | `/projects` | `projects` | ✅ | D3 |
| email | `email{,-ZH}.md` | `/email` | `email` | ✅ | D3 |
| files-ftp | `files-ftp{,-ZH}.md` | `/files`, `/ftp`, `/bt-tracker` | `files`, `ftp`, `bt-tracker` | ✅ | D3 |
| bt-tracker | `bt-tracker{,-ZH}.md` | `/bt-tracker` | `bt-tracker` | ✅ | D3 |
| databases | `databases{,-ZH}.md` | MySQL/Maria/PG/Redis | `db`, `redis`, `db-cluster` | ✅ | D2 |
| dns-ssl-nginx | `dns-ssl-nginx{,-ZH}.md` | `/dns`, `/ssl`, `/nginx` | `dns`, `ssl`, `nginx` | ✅ | D3 |
| nginx-sites | `nginx-sites{,-ZH}.md` | nginx sites UI | `nginx` | ✅ | D3 |
| apache | `apache{,-ZH}.md` | `/apache` | `apache` | ✅ | D2 |
| runtimes | `runtimes{,-ZH}.md` | runtime pages | `runtimes`, `hosting runtime-*` | ✅ | D2 |
| security-auth | `security-auth{,-ZH}.md` | `/security` | `security`, `ssh-key`, `ssh-2fa` | ✅ | D3 |
| defense | `defense{,-ZH}.md` | `/protection` | `defense`, `protection` | ✅ | D3 |
| vpn | `vpn{,-ZH}.md` | `/vpn` | `vpn` | ✅ | D2 |
| vnc | `vnc{,-ZH}.md` | `/vnc` | `vnc` | ✅ | D2 |
| users-rbac | `users-rbac{,-ZH}.md` | `/users` | `users`, `packages`, `rbac` | ✅ | D3 |
| system-host | `system-host{,-ZH}.md` | system, network, updates | `host`, `network`, `real-ip`, `updates`, `software`, `ssl panel-tls` | ✅ | D2 |
| backups-cron | `backups-cron{,-ZH}.md` | backups, cron | `backup`, `cron` | ✅ | D3 |
| logs-metrics | `logs-metrics{,-ZH}.md` | logs, metrics | `logs`, `host` | ✅ | D3 |
| cdn-agents | `cdn-agents{,-ZH}.md` | CDN, agents | `cdn`, `agents` | ✅ | D3 |
| ai-tools | `ai-tools{,-ZH}.md` | AI | `tools`, `ask` | ✅ | D3 |
| migrate | `migrate{,-ZH}.md` | migrate | `migrate` | ✅ | D3 |
| host-browse | `host-browse{,-ZH}.md` | host browse | ⚠️ panel-only | ✅ | D3 |

---

## L0 / L1

| File | Gap | Slice |
|------|-----|-------|
| `INDEX{,-ZH}.md` | Missing vpn/vnc/apache rows; no docs-standard link | D0 skeleton · D4 polish |
| `user-manual/manual{,-ZH}.md` | Day-1 only; no Day-N for new domains | D4 |
| `agent/README{,-ZH}.md`, `SKILL{,-ZH}.md` | Sparse new-domain examples | D4 |
| `README{,-ZH}.md` | Point to docs-standard when ready | D5 |

---

## Explicit panel-only (document, do not invent CLI)

| ID | Rationale |
|----|-----------|
| Browser terminal PTY | Interactive surface |
| In-panel VNC canvas | Interactive RFB UI (`vnc session mint` is metadata only) |
| Host Browse Chromium UI | Interactive browser |
| File preview editor | UX-only; use `files read/write` |
| Public `/share/:token` landing | Public HTTP; **create** via `files shares create` |

---

## Checks

```bash
node scripts/cli-panel-parity.mjs
node scripts/docs-bilingual-check.mjs
```

*Last updated: 2026-08-12 — D0.*
