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
| Restore / delete | `ysk-server backup restore\|delete` | write-host | |
| Schedule install | `ysk-server backup schedule --install --execute` | write-host | |
| Restic helpers | `ysk-server backup restic …` | write-host | |
| Remote dest (SFTP/S3/local) | `ysk-server backup settings get\|set\|test` | write-host | Panel test can send unsaved form values and the outbound SSH identity. Live connect needs `--execute`. Missing key/password is not “EXECUTE off”. Remote push `mkdir -p`s the dest and copies the `.sql` sidecar next to the tar. |
| Control-plane preview | `ysk-server backup restore` with id `control-plane`, or `POST /api/v1/backups/control-plane/restore` | read | Lists archive (`tar -tzf`). Does not need a project row. |
| Cron list/create/… | `ysk-server cron list\|create\|…` | write-panel | |
| Cron install to host | `ysk-server cron install --execute` | write-host | |

## CLI quick start

```bash
ysk-server backup list --json
ysk-server cron list --json
export YSK_EXECUTE=1
ysk-server backup schedule --install --execute --json
ysk-server cron install --execute --json
```

## Honesty

- Schedule/install without EXECUTE is blocked.  
- Backup “written” path ≠ verified offsite copy.  
- SFTP test uses the same outbound identity as `backup all`. A publickey denial is auth, not panel EXECUTE-off.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| — | None |

## Related

- [Deploy backup](../deploy/backup.md)  
