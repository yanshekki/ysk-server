# YSK Server

**YSK Server** (`ysk-server`) is an AI-centric, security-first Linux server management platform with a web hosting control panel.

| Item | Value |
|------|--------|
| CLI | `ysk-server` |
| Repository | https://github.com/yanshekki/ysk-server |
| Spec | [docs/AI-Secure-Linux-Server-Manager-Spec.md](docs/AI-Secure-Linux-Server-Manager-Spec.md) |

## Honest capability matrix (do not over-claim)

### Implemented now (usable)

- Control plane API + CLI (`setup`, `serve`, `tools`, `projects`, `update`, `system unit-install`)
- Auth (admin bootstrap), RBAC hooks, Allowlist, Approval queue, Audit log
- **Web UI served from the same `serve` process** when `apps/web` is built
- Projects on disk under `dataDir`; **Deploy Node** with real TCP listen + HTTP health (pidfile mode always; **systemd production** when root + `YSK_EXECUTE=1`)
- Nginx conf generation under `dataDir`; system `nginx -t` + reload when EXECUTE
- Email: DKIM keygen, DNS checklist, live checks, config templates, apply status write-back
- Files manager (sandbox under dataDir)
- Protection probes, metrics, AI task planner (untrusted LLM gateway)
- Self-update check / plan (`update --apply` needs EXECUTE)

### Partial / needs root + `YSK_EXECUTE=1`

- Linux `useradd` project isolation
- Systemd enable for project units & control plane
- apt install email stack, certbot run, ufw apply, Apache PHP enable
- MySQL **real** provision via `mysql` CLI (otherwise returns SQL plan with `ok: false`)

### Spec backlog (not production-ready yet)

- Multi-version Node/PHP runtime install matrix, PM2 fleet
- Full Postfix/Dovecot operational mail (beyond templates + optional apt)
- PowerDNS, FTPS production, fail2ban automation
- OpenClaw/Hermes/IonClaw installers
- ≥90% test coverage; full Feature-Sliced frontend refactor
- npm global publish as single package (use `install.sh --from-source` today)

See [docs/deploy/production-mvp.md](docs/deploy/production-mvp.md) for the Phase 2 Hosting MVP checklist.

## Quick start (development)

```bash
pnpm install
pnpm build
export YSK_ADMIN_PASSWORD=admin
node apps/server/dist/cli.js setup --data-dir .ysk --non-interactive --force
node apps/server/dist/cli.js serve --data-dir .ysk --port 8787
# Open http://127.0.0.1:8787/  (Web UI + API)
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
ysk-server serve --data-dir .ysk --port 8787
ysk-server system unit-install --data-dir .ysk
ysk-server update --check
ysk-server tools --json
ysk-server --help
```

## Documentation

| Doc | Path |
|-----|------|
| Production MVP | [docs/deploy/production-mvp.md](docs/deploy/production-mvp.md) |
| Real ops vertical | [docs/deploy/real-ops.md](docs/deploy/real-ops.md) |
| Root apply | [docs/deploy/root-apply.md](docs/deploy/root-apply.md) |
| Spec | [docs/AI-Secure-Linux-Server-Manager-Spec.md](docs/AI-Secure-Linux-Server-Manager-Spec.md) |
| API | [docs/api/overview.md](docs/api/overview.md) |
| Security | [docs/security/overview.md](docs/security/overview.md) |

## License

MIT
