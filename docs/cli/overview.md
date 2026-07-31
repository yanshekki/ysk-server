# CLI overview

> Language: English | [中文](./overview-ZH.md)

**Binary:** `ysk-server`  
**Full command list:** [reference.md](./reference.md)  
**Machine catalog:** [../agent/commands.json](../agent/commands.json)

## Global flags

| Flag / env | Meaning |
|------------|---------|
| `--json` | Structured JSON on stdout (preferred for AI) |
| `--data-dir PATH` | Control-plane data directory |
| `--config PATH` | `config.json` from setup |
| `--locale CODE` | `zh-HK` · `zh-CN` · `en` (also `YSK_LOCALE` / `LANG`) |
| `--execute` / `--apply` | Attempt real host mutation |
| `--help` / `--version` | Help / version |

Without `--execute`, host-mutating commands stay **dry-run** (plan only). Still need `YSK_EXECUTE=1` (and often root) for real apply.

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
| Lifecycle | `setup` `serve` `update` `system` `version` `help` |
| Projects | `projects` `templates` `hosting` `nginx` `ssl` `dns` |
| Data | `backup` `store` `files` `cron` `migrate` |
| Mail | `email` |
| Security | `users` `packages` `rbac` `audit` `security` `ssh-key` `ssh-2fa` `defense` `protection` |
| Edge | `cdn` `agents` `agent` |
| Observe | `logs` `host` `health` `readiness` `doctor` `services` `db-cluster` |
| AI | `tools` `ask` |
