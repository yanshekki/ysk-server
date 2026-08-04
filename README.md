# YSK Server

> Language: English | [中文](./README-ZH.md)

**YSK Server** (`ysk-server`) is a **security-first, single-host Linux control plane** with a web hosting panel and an AI-friendly CLI.

| Item | Value |
|------|--------|
| CLI | `ysk-server` |
| Default UI locale | **zh-HK** (Hong Kong written Chinese), plus zh-CN and en |
| Spec | [docs/AI-Secure-Linux-Server-Manager-Spec.md](docs/AI-Secure-Linux-Server-Manager-Spec.md) · [docs/INDEX.md](docs/INDEX.md) |
| Docs index | [docs/INDEX.md](docs/INDEX.md) |

## What it is / is not

| Is | Is not |
|----|--------|
| One server you control (VPS / bare metal) | Multi-tenant reseller SaaS |
| Real host ops when **root** + **`YSK_EXECUTE=1`** | Fake “success” without apply |
| Panel + HTTP API + CLI (same core) | Full web terminal product |
| Honest deliverability *checks* for mail | Guaranteed Gmail/Outlook inbox |

## Quick start

### Production / VPS (plan / bundle wizard)

`install.sh` walks through **plans** (`recommended` / `full` / `minimal` / custom bundles). Non-interactive default is **recommended** (control-plane + web + database + defense). Use `uninstall.sh` for partial/full removal with keep-data or purge-data. See [install.md](docs/getting-started/install.md) · [uninstall.md](docs/getting-started/uninstall.md).

```bash
curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh | bash -s -- --non-interactive
# Full stack:  … | bash -s -- --non-interactive --plan full
# Minimal:     … | bash -s -- --non-interactive --plan minimal
# Uninstall:   ./uninstall.sh
ysk-server readiness --json
ysk-server serve --data-dir /var/lib/ysk-server --port 9287
```

### From monorepo (development)

```bash
pnpm install
pnpm build
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts setup --data-dir .ysk --json
pnpm --filter @ysk/server exec node --import tsx/esm src/cli.ts serve --data-dir .ysk
# Open http://127.0.0.1:9287/  (build apps/web for UI assets)
# Or: ./install.sh --from-source
```

Production mutations:

```bash
export YSK_EXECUTE=1   # and run as root for system changes
ysk-server readiness --data-dir /var/lib/ysk --json
ysk-server projects deploy --id <UUID> --execute --json
```

## CLI-first for AI agents

```bash
ysk-server help --locale en
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
```

- [docs/cli/reference.md](docs/cli/reference.md) — full command list  
- [docs/agent/README.md](docs/agent/README.md) · [docs/agent/commands.json](docs/agent/commands.json)  
- [docs/cli/parity.md](docs/cli/parity.md) — Panel ≡ CLI  

Global: `--json`, `--data-dir`, `--config`, `--locale` / `YSK_LOCALE`, `--execute` (dangerous ops default dry-run).

## Architecture (one glance)

```
apps/web  ──DTO──►  @ysk/shared
apps/server (HTTP + CLI)  ──►  @ysk/core  ──►  @ysk/shared
                                    │
                              dataDir store (json|sqlite|postgres)
                              HostExecutor (EXECUTE / root gates)
```

Details: [docs/architecture/overview.md](docs/architecture/overview.md).

## Feature map

| Domain | Docs |
|--------|------|
| Projects / deploy | [features/projects.md](docs/features/projects.md) |
| Email | [features/email.md](docs/features/email.md) |
| Files / FTPS | [features/files-ftp.md](docs/features/files-ftp.md) |
| Databases | [features/databases.md](docs/features/databases.md) |
| DNS / SSL / Nginx | [features/dns-ssl-nginx.md](docs/features/dns-ssl-nginx.md) |
| Security / 2FA | [features/security-auth.md](docs/features/security-auth.md) |
| Defense | [features/defense.md](docs/features/defense.md) |
| Backups / Cron | [features/backups-cron.md](docs/features/backups-cron.md) |
| CDN / Agents | [features/cdn-agents.md](docs/features/cdn-agents.md) |
| … | [docs/INDEX.md](docs/INDEX.md) |

## Honesty rules

1. **Dry-run by default** on host-mutating CLI.  
2. **`written` ≠ `applied`** — managed files under `dataDir` are not live until EXECUTE applies them.  
3. **Fail closed** without root/EXECUTE; never report fake applied success.  
4. **Mail PTR / Port 25 / registrar DNS** remain external — panel cannot “finish” them for you.  

See [docs/architecture/ops-honesty.md](docs/architecture/ops-honesty.md).

## Development gates

```bash
pnpm gates          # honesty, UI, i18n keys/glossary, …
pnpm i18n:check-keys && pnpm i18n:check-glossary
```

## License / repo

MIT-oriented monorepo packages; repository: https://github.com/yanshekki/ysk-server  
