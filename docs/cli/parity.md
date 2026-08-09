# Panel ↔ CLI parity

> Language: English | [中文](./parity-ZH.md)

**Hard rule:** Every production panel capability must have a CLI entry (or an explicit, documented intentional gap). Prefer `--json` for automation.

| Mark | Meaning |
|------|---------|
| ✅ | CLI available |
| ⚠️ | Partial / needs flags / intentional panel-only with note |
| ❌ | Panel has it, CLI missing (**must not ship unmarked**) |

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

## Projects / sites

| Panel | CLI | Status |
|-------|-----|--------|
| Projects list/create/detail | `projects list\|get\|create` | ✅ |
| Deploy / stop / health | `projects deploy\|stop\|health` | ✅ |
| Git deploy | `projects git-deploy` | ✅ |
| Isolation / resources | `projects isolation …` | ✅ |
| Templates | `templates list\|apply` | ✅ |
| Nginx publish / status | `nginx status\|list\|test\|sync` · hosting | ✅ |
| SSL | `ssl list\|get` | ✅ |
| Logs | `logs sources\|query\|journal` | ✅ |

## Files / public / FTP / WebDAV

| Panel | CLI | Status |
|-------|-----|--------|
| File browser CRUD | `files list\|read\|write\|mkdir\|rm\|stat\|rename\|copy\|move\|chmod` | ✅ |
| Upload | `files upload` | ✅ |
| Trash | `files trash list\|restore\|purge` | ✅ |
| Public shares list | `files shares list` | ✅ |
| WebDAV enable/token/disable | `files webdav status\|token\|disable` | ✅ |
| Public-files site | `hosting public-files --domain …` | ✅ |
| FTPS accounts / service | `hosting ftps-apply` | ✅ |
| Browser text editor / media preview | *(panel UX only)* | ⚠️ intentional UI |
| Public share landing `/share/:token` | *(HTTP public API; create via panel/API)* | ⚠️ panel create + public GET |

## Email / DNS / CDN

| Panel | CLI | Status |
|-------|-----|--------|
| Domains / mailboxes / DNS bundle | `email domains\|mailboxes\|dns\|bootstrap` | ✅ |
| Deliverability | `email deliverability` | ✅ |
| Webmail install (global) | `hosting webmail-apply --domain webmail.example.com` | ✅ |
| DNS zones | `dns zone\|zones` · hosting | ✅ |
| CDN nodes/sites | `cdn nodes\|sites\|apply\|…` | ✅ |

## Security / defense / system

| Panel | CLI | Status |
|-------|-----|--------|
| Sessions / API keys / 2FA flags | `security status\|sessions\|api-keys` | ✅ |
| Users / RBAC | `users` · `packages` · `rbac` | ✅ |
| SSH keys / SSH 2FA | `ssh-key` · `ssh-2fa` | ✅ |
| Firewall / fail2ban / protection | `defense …` · `hosting firewall-apply` | ✅ |
| Metrics / network / host | `host overview\|metrics\|network` | ✅ |
| Services matrix | `services` | ✅ |
| Cron | `cron list\|create\|install\|status` | ✅ |
| Backups | `backup list\|status\|all\|schedule\|…` | ✅ |
| Migrate | `migrate inventory\|host\|status\|…` | ✅ |
| Browser terminal (PTY) | *(panel only; no remote SSH)* | ⚠️ intentional UI |

## AI / agents (no panel chrome)

| Surface | CLI | Status |
|---------|-----|--------|
| NL → plan | `ask` | ✅ |
| Tools allowlist run | `tools` · `tools run` | ✅ |
| Fleet / runtimes | `agents` · `agent run` | ✅ |

---

## Help discovery

```bash
ysk-server --help
ysk-server help [--locale zh-HK|zh-CN|en]
ysk-server files          # usage for files + webdav + shares
ysk-server email          # usage for mail domain ops
ysk-server readiness --json
```

Machine-readable command list: [../agent/commands.json](../agent/commands.json).

## Acceptance

- [x] No unmarked production ❌ for Admin panel in-scope features
- [x] Primary list/status commands support `--json`
- [x] Files WebDAV + shares documented
- [x] Panel-only UX (editor, terminal, share landing) marked ⚠️ with rationale

*Last updated: 2026-08-09 — Phase 4 seal.*
