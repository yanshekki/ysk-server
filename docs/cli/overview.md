# CLI overview

> Language: English | [中文](./overview-ZH.md)

**Binary:** `ysk-server`  
**Full command list:** [reference.md](./reference.md)  
**Machine catalog:** [../agent/commands.json](../agent/commands.json)

## Global flags

| Flag / env | Meaning |
|------------|---------|
| `--json` | Structured JSON on stdout (preferred for AI) |
| `--data-dir PATH` | Control-plane data directory (`--data-dir=PATH` and `YSK_DATA_DIR` also work). Root uses `/var/lib/ysk-server` when that store exists |
| `--config PATH` | `config.json` from setup |
| `--locale CODE` | CLI messages only (default **en**, never `LANG`). Also `YSK_LOCALE`. Codes: `en` `zh-HK` `zh-CN` `ja` `ko` `hi` `es` `ar` `fr` `bn` `pt` `id` `ur`. Command names and flags stay English |
| `--limit N` / `--offset N` | Slice large JSON lists (`software list`, `updates inventory`, `host metrics`, `rbac audit`) |
| `--execute` / `--apply` | Attempt real host mutation |
| `--help` / `--version` | Help / version (`--help` never runs the command) |

Without `--execute`, host-mutating commands stay **dry-run** (plan only). Still need `YSK_EXECUTE=1` (and often root) for real apply.

Empty or invalid Nginx `server_name` is validation (exit 2 / `ok: false`), not a silent `localhost` write.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | OK (including successful dry-run plan) |
| 1 | Error |
| 2 | Validation / bad usage |
| 3 | Blocked (EXECUTE / root / permission) |
| 4 | Not found |
| 5 | Host command failed |

Parse JSON: `ok`, `blocked`, `dryRun`, `executed`, `code`, `message`, `notes`.

## Safety

1. Prefer read-only probes first (`readiness`, `host`, `projects list`).  
2. Review plan JSON before `--execute`.  
3. Never assume `written` means live nginx/mail.

## Locale

```bash
ysk-server help --locale zh-HK
ysk-server security help --locale en
YSK_LOCALE=zh-CN ysk-server store status --json
```

## Command groups

| Group | Commands |
|-------|----------|
| Lifecycle | `setup` `serve` `update` `system` `stack` `version` `help` |
| Projects | `projects` `templates` `hosting` `nginx` `ssl` `dns` `apache` `runtimes` |
| Data | `backup` `store` `files` `ftp` `cron` `migrate` `db` `redis` `db-cluster` |
| Mail | `email` |
| Security | `users` `packages` `rbac` `audit` `security` `ssh-key` `ssh-2fa` `defense` `protection` `vpn` `vnc` |
| Network / system | `network` `real-ip` `host` `services` `updates` `software` |
| Edge | `cdn` `agents` `agent` |
| Observe | `logs` `health` `readiness` `doctor` |
| AI | `tools` `ask` |

Full encyclopedia: [reference.md](./reference.md).  
Panel mapping: [panel-parity-matrix.md](./panel-parity-matrix.md).  
Doc standard: [../docs-standard.md](../docs-standard.md).
