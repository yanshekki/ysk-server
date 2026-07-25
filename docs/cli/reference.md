# YSK Server CLI Reference

**Binary**: `ysk-server`  
**Package**: `@ysk/server` (monorepo) / root bin after `pnpm build`

## Global

```bash
ysk-server --help
ysk-server --version
ysk-server -V
ysk-server <command> --json          # structured JSON for AI agents
ysk-server <command> --data-dir PATH # many commands accept dataDir
ysk-server <command> --config PATH   # config.json from setup
```

Environment:

| Variable | Purpose |
|----------|---------|
| `YSK_EXECUTE=1` | Allow mutating host commands (apt, systemctl enable, DB provision, WP download, …) |
| `YSK_ADMIN_PASSWORD` | Initial admin password on first boot |
| `YSK_WEB_ROOT` | Override Web UI dist path for `serve` |
| `YSK_DNSBL_ON_START=1` | Run DNSBL job on serve start |
| `YSK_BACKUP_ON_START=1` | Run project backups on start |

---

## setup

Initialize control-plane data directory, admin user, systemd unit template.

```bash
ysk-server setup [--data-dir PATH] [--host HOST] [--port PORT]
                 [--locale zh-TW|en|zh-CN] [--non-interactive]
                 [--dry-run] [--force]
```

## serve

Start HTTP API + packaged Web UI (if `apps/web/dist` built).

```bash
ysk-server serve [--config PATH] [--data-dir PATH]
                 [--host 127.0.0.1] [--port 8787] [--web-root PATH]
```

## update

Self-update check / apply (apply needs network + `YSK_EXECUTE=1`).

```bash
ysk-server update [--check] [--latest VERSION] [--apply] [--json]
```

## system unit-install

Write / optionally enable control-plane systemd unit.

```bash
ysk-server system unit-install [--data-dir PATH] [--enable]
# enable needs root + YSK_EXECUTE=1
```

## templates

List one-click app templates (`node-starter`, `static-site`, `wordpress-php`).

```bash
ysk-server templates [--json]
```

## projects

```bash
# list
ysk-server projects list [--data-dir PATH] [--json]

# create (+ optional template scaffold)
ysk-server projects create --name NAME \
  [--domain D] [--runtime node|php|static] \
  [--template node-starter|static-site|wordpress-php] \
  [--runtime-version VER] [--force] [--data-dir PATH]

# ops
ysk-server projects deploy --id UUID [--data-dir PATH]
ysk-server projects stop --id UUID
ysk-server projects health --id UUID
ysk-server projects backup --id UUID
ysk-server projects template --id UUID --template ID [--force]
```

Deploy selects Node or PHP path from project runtime. Node deploy listens and health-checks; production systemd path needs root + `YSK_EXECUTE=1`.

## hosting

```bash
ysk-server hosting nginx|nginx-list
ysk-server hosting nginx-sync [--system-dir PATH] [--dry-run]

ysk-server hosting redis-provision [--project-id ID] [--db N] [--execute]
ysk-server hosting postgres-provision --db NAME --user USER --password PASS [--execute]
ysk-server hosting mysql-provision --db NAME --user USER --password PASS [--execute]
```

`--execute` still requires `YSK_EXECUTE=1` and the matching client (`redis-cli` / `psql` / `mysql`). Without it, commands return structured failure + plan (never fake success).

## tools

```bash
ysk-server tools --json
ysk-server tools run --tool <name> [--arg key=val] [--dry-run]
```

## ask

Natural-language task plan (optional `--execute` after approval wiring).

```bash
ysk-server ask "check system info" [--execute] [--config PATH]
```

## agents

```bash
ysk-server agents --json              # catalog
ysk-server agents --probe             # host path/systemd probe
ysk-server agents probe --data-dir PATH
```

## agent run

Outbound fleet agent worker (polls control plane).

```bash
ysk-server agent run --control-plane URL --id AGENT_ID [--group g] [--interval MS]
```

---

## AI-agent friendly output

Prefer `--json`. Successful shapes typically include `ok`, and for CLI ops either a DTO payload or `{ ok, items }`. Errors print to stderr with non-zero exit.

## Related docs

- [production-mvp.md](../deploy/production-mvp.md)
- [real-ops.md](../deploy/real-ops.md)
- [npm-publish.md](../deploy/npm-publish.md)
- [API overview](../api/overview.md)
