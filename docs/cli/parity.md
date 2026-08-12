# Panel ↔ CLI parity

> Language: English | [中文](./parity-ZH.md)

**Status: C5 (2026-08-12).** Through **db / redis**. Remaining: ftp/files-shares/email/dns/runtime (C6–C7).

**Hard rule:** Every production panel capability must have a CLI entry (or an explicit, documented intentional gap). Prefer `--json` for automation.

| Mark | Meaning |
|------|---------|
| ✅ | CLI available |
| ⚠️ | Partial / needs flags / intentional panel-only with note |
| ❌ | Panel has it, CLI missing (**must not ship unmarked**) |

Full gap table + track: **[panel-parity-matrix.md](./panel-parity-matrix.md)**  
Machine inventory: **[parity-inventory.json](./parity-inventory.json)** (`node scripts/cli-panel-parity.mjs`)

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
| Self-update | `update` | ⚠️ partial (host package inventory still ❌ → `updates`) |

## High-priority open ❌

| Panel | CLI needed |
|-------|------------|
| VPN | `vpn …` ✅ C2 |
| VNC | `vnc …` ✅ C2 (canvas ⚠️) |
| Apache | `apache …` ✅ C3 |
| Service network exposure | `network exposure …` ✅ C3 |
| Real-IP / Panel TLS | `real-ip …` / `ssl panel-tls …` ✅ C3 |
| SQL engine switch | `db sql-engine …` |
| Redis key browser | `redis …` |

See matrix for P1–P2 partials and panel-only ⚠️ rows.

---

## Help discovery

```bash
ysk-server --help
ysk-server help [--locale zh-HK|zh-CN|en]
node scripts/cli-panel-parity.mjs
```

Machine-readable (partial catalog): [../agent/commands.json](../agent/commands.json) — will grow with C2+.

## Acceptance (reopen)

- [ ] No unmarked production ❌ for Admin panel in-scope features
- [ ] Primary list/status commands support `--json`
- [x] Intentional panel-only UX documented (terminal, noVNC, browse UI, editor)
- [x] Automated inventory script exists

*Last updated: 2026-08-12 — C5 (~80%).*
