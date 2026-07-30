# YSK Server

**YSK Server** (`ysk-server`) is an AI-centric, security-first Linux server management platform with a web hosting control panel.

| Item | Value |
|------|--------|
| CLI | `ysk-server` |
| Repository | https://github.com/yanshekki/ysk-server |
| Spec | [docs/AI-Secure-Linux-Server-Manager-Spec.md](docs/AI-Secure-Linux-Server-Manager-Spec.md) |

## AI agents (CLI-first)

Prefer **CLI + docs**, not the experimental fleet UI:

- [docs/agent/README.md](docs/agent/README.md) — rules + runbooks  
- [docs/agent/SKILL.md](docs/agent/SKILL.md) — paste into Cursor/Claude/Codex  
- [docs/agent/commands.json](docs/agent/commands.json) — machine catalog  
- [docs/cli/reference.md](docs/cli/reference.md) — full CLI  

```bash
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
```

Panel **AI Agent** is experimental (register/queue only). Edge poller: `ysk-server agent run`. Real ops = CLI.

## Production readiness (Spec gate)

```bash
ysk-server readiness --data-dir .ysk --json
# HTTP 200 only when productionReady (root + YSK_EXECUTE + nginx + node)
curl -sS http://127.0.0.1:9287/api/v1/readiness | jq '.productionReady,.summary'
```

See [docs/deploy/spec-readiness.md](docs/deploy/spec-readiness.md). Degraded mode is intentional fail-closed, not a fake complete product.

## Honest capability matrix (do not over-claim)

### Implemented now (usable)

- Control plane API + CLI (`setup`, `serve`, `tools`, `projects`, `update`, `system unit-install`)
- Auth (admin bootstrap), RBAC hooks, Allowlist, Approval queue, Audit log
- **Web UI served from the same `serve` process** when `apps/web` is built
- Projects on disk under `dataDir`; **Deploy Node** with real TCP listen + HTTP health: **systemd** (root + `YSK_EXECUTE=1`) → **PM2** (`YSK_EXECUTE=1` + `pm2` on PATH) → **pidfile** fallback; ecosystem always written
- **Deploy PHP**: FPM+nginx or `php -S`; **Deploy static**: nginx `root` + try_files (optional system reload)
- **Deploy PHP** artifacts + Apache vhost templates
- **Git deploy** (clone/pull → redeploy), **env vars** (`.env`), **tar backup** under `dataDir/backups`
- **Cron** jobs stored + managed crontab file; enable/disable + install needs `YSK_EXECUTE=1`
- **Daily scheduler**: inventory snapshot + project backups (`daily-inventory`, `daily-backup`)
- **Logs tail** per project; **Updates** page refresh inventory; Dashboard project/backup summary
- **SSL PEM upload** to `dataDir/certs/` + nginx SSL conf with managed paths
- **PHP-FPM pool** conf under dataDir (enable with root+EXECUTE); **project quota** via `du`
- **FTPS** vsftpd config generation under dataDir
- **Cloudflare DNS apply** (`CF_API_TOKEN`); dry-run without token (never fake success)
- **BIND zone files** under `dataDir/dns/zones/` (+ optional `named-checkzone` when EXECUTE)
- **PowerDNS** install script + load dual-mode (`pdnsutil` / apt needs root+EXECUTE)
- **Email MTA** managed Postfix/Dovecot/OpenDKIM + milter + `install-mta.sh` (fail-closed install)
- **Mailboxes**: real Maildir + `virtual_mailbox` maps under dataDir; optional system user (root+EXECUTE)
- **Dovecot passdb** export (passwd-file + auth snippet) from managed mailboxes
- **Multi-version runtime probe** (Node 18/20/22, PHP 8.1–8.3) + install helpers (fail-closed)
- **PHP deploy dual-mode**: PHP-FPM + nginx fastcgi (root+EXECUTE) → `php -S` degraded fallback
- **Mailbox passwords**: `{SHA512-CRYPT}` via openssl when available (else YSK-SCRYPT)
- **Webmail (Roundcube)**: managed config + install helper + nginx; download needs EXECUTE
- **Email bootstrap** (`POST /api/v1/email/bootstrap` / `hosting email-bootstrap`): domain+DKIM+MTA+mailbox+passdb+webmail plan
- **CI**: GitHub Actions `pnpm gates` (honesty + UI primitives) → typecheck → build → test → `e2e:real-ops`
- **FTPS**: vsftpd config + install helper (fail-closed install)
- **UFW script** under `dataDir/firewall/ufw-apply.sh` (apply needs root+EXECUTE; no fake ok)
- **systemd resource limits** (MemoryMax / CPUQuota) on Node units
- **Multi DNSBL** (Spamhaus / SpamCop / Barracuda) + email live-check UI
- **fail2ban** jail.local under dataDir; install needs root + `YSK_EXECUTE=1`
- **Web FSD**: projects, email, agents, dashboard, updates, system, security, files, AI/llm
- **Email warm-up plan** + scheduled multi-DNSBL job (`email-dnsbl`)
- **PM2** ecosystem + optional start (never fake success without EXECUTE)
- **Agent runtime probe** (path/systemd/PATH) + unit template write
- **Agent install apply** (`execute` needs `YSK_EXECUTE`; never fake success)
- **SMTP relay** config for blocked Port 25 + settings write-back
- **Dashboard summary** API (projects / agents / DNSBL / relay / scheduler)
- **App templates**: node-starter / static-site / wordpress-php one-click scaffold
- **Redis provision** probe + optional redis-cli PING (refuse without EXECUTE)
- **PostgreSQL provision** via psql (refuse without EXECUTE; never fake ok)
- **WordPress download** optional (`YSK_EXECUTE=1` + network) into project public/
- **CLI**: `projects create --template`, deploy/stop/backup, `templates`, hosting db provision
- Nginx conf generation under `dataDir`; system `nginx -t` + reload when EXECUTE
- Email: DKIM keygen, DNS checklist, live checks, config templates, apply status write-back
- Files manager (sandbox under dataDir)
- Protection probes, metrics, AI task planner (untrusted LLM gateway)
- Self-update check / plan (`update --apply` needs EXECUTE)
- **Production readiness** probe (`readiness` / `GET /api/v1/readiness`) — Spec-aligned, honest score
- **Public File Server** nginx apply under dataDir/files/public
- **OS project isolation re-apply** (`POST /projects/:id/os-provision`) via bash useradd/chown

### Partial / needs root + `YSK_EXECUTE=1`

- Linux `useradd` project isolation (attempted on create + re-apply API)
- Systemd enable for project units & control plane
- apt install email stack, certbot run, ufw apply, Apache PHP enable
- MySQL **real** provision via `mysql` CLI (otherwise returns SQL plan with `ok: false`)

### Spec backlog (not production-ready yet)

- Roundcube SSO / full mailbox UX polish
- Full vendor AI agent installers; PowerDNS apt auto on bare metal polish
- ≥90% unit coverage (mandatory Spec §2.4 — in progress)
- Public npm single-package global install (use `install.sh --from-source` today)

See [docs/deploy/production-mvp.md](docs/deploy/production-mvp.md) for the Phase 2 Hosting MVP checklist.

## Quick start (development)

```bash
pnpm install
pnpm build
export YSK_ADMIN_PASSWORD=admin
node apps/server/dist/cli.js setup --data-dir .ysk --non-interactive --force
node apps/server/dist/cli.js serve --data-dir .ysk --port 9287
# Open http://127.0.0.1:9287/  (Web UI + API)
```

## Install script (Ubuntu 22.04 / 24.04)

```bash
./install.sh --from-source --non-interactive
# optional: YSK_EXECUTE=1 sudo ./install.sh --from-source --non-interactive  # then system unit-install
```

```bash
# Production mutations
export YSK_EXECUTE=1
sudo -E node apps/server/dist/cli.js system unit-install --enable --data-dir /var/lib/ysk-server
```

## Verify real ops

```bash
pnpm test
pnpm e2e:real-ops
# optional root path:
# sudo bash scripts/e2e-hosting-root.sh
```

## CLI

```bash
ysk-server setup --non-interactive
ysk-server serve --data-dir .ysk --port 9287
ysk-server system unit-install --data-dir .ysk
ysk-server templates --json
ysk-server projects create --name demo --template node-starter --data-dir .ysk
ysk-server projects deploy --id <uuid> --data-dir .ysk
ysk-server projects backup --id <uuid> --data-dir .ysk
ysk-server hosting redis-provision --db 1
ysk-server hosting postgres-provision --db app --user appuser --password longpass99
ysk-server dns zone --zone example.com --ip YOUR.PUBLIC.IP [--ipv6 …]
ysk-server logs query --source journal: --lines 50 --json
ysk-server hosting email-apply --domain example.com
ysk-server agents --probe
ysk-server readiness --json
ysk-server update --check
ysk-server tools --json
ysk-server --help
```

## Documentation

| Doc | Path |
|-----|------|
| Spec readiness | [docs/deploy/spec-readiness.md](docs/deploy/spec-readiness.md) |
| Production MVP | [docs/deploy/production-mvp.md](docs/deploy/production-mvp.md) |
| Real ops vertical | [docs/deploy/real-ops.md](docs/deploy/real-ops.md) |
| npm publish | [docs/deploy/npm-publish.md](docs/deploy/npm-publish.md) |
| Root apply | [docs/deploy/root-apply.md](docs/deploy/root-apply.md) |
| CLI reference | [docs/cli/reference.md](docs/cli/reference.md) |
| Spec | [docs/AI-Secure-Linux-Server-Manager-Spec.md](docs/AI-Secure-Linux-Server-Manager-Spec.md) |
| API | [docs/api/overview.md](docs/api/overview.md) |
| Security | [docs/security/overview.md](docs/security/overview.md) |

## License

MIT

## 專案隔離

見 [docs/deploy/project-isolation.md](./docs/deploy/project-isolation.md) — 每專案獨立 Linux 用戶與 `/home/ysk-server-{id}`。
