# Backups & cron

> Language: English | [中文](./backups-cron-ZH.md)

## Purpose

**Control-plane and host backup** jobs (including restic helpers) and **managed cron** entries.

**Non-goals:** Infinite retention without storage limits; silent backup “success” without EXECUTE.

## Panel

| Item | Value |
|------|--------|
| Routes | `/backups`, `/cron` |
| Nav keys | `backups`, `cron` |
| Main actions | Backup list/run/restore · schedule · restic · cron CRUD/install |
| Capability | Backup / cron |
| RBAC | Operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| Backup list/status/all | `ysk-server backup list\|status\|all` | write-host | all may need execute |
| Restore / delete | `ysk-server backup restore\|delete` | write-host | Delete **moves** the archive to `dataDir/backups/.trash` (7-day recycle). Permanent delete / restore / empty is the `/backups` trash tab (`GET/POST/DELETE /api/v1/backups/trash`). |
| Schedule install | `ysk-server backup schedule --install --execute` | write-host | |
| Restic helpers | `ysk-server backup restic …` | write-host | |
| Remote dest (SFTP/S3/local) | `ysk-server backup settings get\|set\|test` | write-host | Panel test can send unsaved form values and the outbound SSH identity. Live connect needs `--execute`. Missing key/password is not “EXECUTE off”. Remote push `mkdir -p`s the dest and copies the `.sql` sidecar next to the tar. |
| Control-plane preview | `ysk-server backup restore` with id `control-plane`, or `POST /api/v1/backups/control-plane/restore` | read | Lists archive (`tar -tzf`). Does not need a project row. |
| Cron list/create/update/… | `ysk-server cron list\|create\|update\|…` | write-panel | `update` patches schedule/command/user/project (same as panel PATCH) |
| Cron install to host | `ysk-server cron install --execute` | write-host | |
| Host crontab line edit | `ysk-server cron host edit\|disable\|enable\|delete\|run\|adopt --execute` | write-host | In-place line replace for that user; not `install` |

## CLI quick start

```bash
ysk-server backup list --json
ysk-server cron list --json
ysk-server cron update --id JOB_ID --schedule '0 4 * * *' --command '/usr/bin/true' --json
export YSK_EXECUTE=1
ysk-server backup schedule --install --execute --json
ysk-server cron install --execute --json
ysk-server cron host list --json
YSK_EXECUTE=1 ysk-server cron host edit --user root --old-schedule '*/15 * * * *' --old-command '/usr/bin/true' --schedule '0 * * * *' --command '/usr/bin/true' --execute --json
```

## Honesty

- Schedule/install without EXECUTE is blocked.  
- Host crontab **edit** writes that user’s live crontab (`crontab -u`). Preview only when EXECUTE is off.  
- Panel PATCH of a managed job is not live until **Install to system**. Do not mix the two.  
- Backup “written” path ≠ verified offsite copy.  
- Panel delete is not an immediate unlink: the file stays in trash for **7 days**, then `purgeExpired` removes it. Empty-trash and permanent delete still type-to-confirm.  
- SFTP test uses the same outbound identity as `backup all`. A publickey denial is auth, not panel EXECUTE-off.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None |

## Related

- [Deploy backup](../deploy/backup.md)  
