# Panel ↔ CLI parity

> Language: English | [中文](./parity-ZH.md)

**Status: gated (not sealed).** Top-level CLI exists for production sidebar domains. Gate: `node scripts/cli-panel-parity.mjs --strict`. Intentional panel-only: terminal PTY, VNC canvas, Host Browse, file preview, public share landing, Support. Files collisions and updates hub: CLI `--if-exists` / `updates hub`.

**Hard rule:** Every production panel capability must have a CLI entry (or an explicit, documented intentional gap). Prefer `--json` for automation.

| Mark | Meaning |
|------|---------|
| ✅ | CLI available |
| ⚠️ | Partial / needs flags / intentional panel-only with note |
| ❌ | Panel has it, CLI missing (**must not ship unmarked**) |

Full gap table + track: **[panel-parity-matrix.md](./panel-parity-matrix.md)**  
Machine inventory: **[parity-inventory.json](./parity-inventory.json)** (`node scripts/cli-panel-parity.mjs`)  
Feature handbooks: **[../docs-inventory.md](../docs-inventory.md)** · **[../docs-standard.md](../docs-standard.md)**

---

## Control plane

| Panel / API | CLI | Status |
|-------------|-----|--------|
| Setup / first admin | `ysk-server setup` | ✅ |
| Serve API+UI | `ysk-server serve` | ✅ |
| Readiness / doctor | `readiness` · `doctor` | ✅ |
| Health | `health [--url]` | ✅ |
| System unit install | `system unit-install` | ✅ |
| Document store | `store status\|export\|import\|migrate` | ✅ |
| Self-update | `update` | ✅ |
| Host package inventory | `updates …` | ✅ |
| Software catalog | `software …` · `stack …` | ✅ |

## High-priority surfaces (sealed)

| Panel | CLI | Status |
|-------|-----|--------|
| VPN | `vpn …` | ✅ C2 |
| VNC | `vnc …` (canvas ⚠️) | ✅ C2 |
| Apache | `apache …` | ✅ C3 |
| Service network exposure | `network exposure …` | ✅ C3 |
| Real-IP / Panel TLS | `real-ip …` / `ssl panel-tls …` | ✅ C3 |
| DB lifecycle / SQL switch | `db …` / `db sql-engine …` | ✅ C5 |
| Redis keys | `redis …` | ✅ C5 |
| FTP accounts | `ftp …` | ✅ C6 |
| File shares create | `files shares create` | ✅ C6 |
| Email aliases / queue / relay | `email aliases\|queue\|relay` | ✅ C6 |
| DNS dnssec / heal | `dns dnssec\|heal\|…` | ✅ C6 |
| Runtimes java/kotlin/bun | `runtimes …` | ✅ C7 |

See matrix for panel-only ⚠️ rows.

---

## Help discovery

```bash
ysk-server --help
ysk-server help [--locale zh-HK|zh-CN|en]
node scripts/cli-panel-parity.mjs
```

Machine-readable catalog: [../agent/commands.json](../agent/commands.json).

## Acceptance

- [x] No unmarked production ❌ for Admin panel in-scope features  
- [x] Primary list/status commands support `--json`  
- [x] Intentional panel-only UX documented  
- [x] Automated inventory script exists  
- [x] Bilingual feature handbooks programme (D0–D5)  

*Last updated: 2026-08-13 — control-plane inventory gated.*
