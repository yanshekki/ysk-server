# Backups & cron

> Language: English | [中文](./backups-cron-ZH.md)

**Panel routes:** `/backups`, `/cron`  
**CLI:** `backup`, `cron`

## Backups

| Capability | Notes |
|------------|--------|
| Project tar | Per-project archives under dataDir |
| Control-plane | Store snapshot / control-plane pack |
| Schedule | Install system schedule (EXECUTE) |
| Remote / restic | Settings + restic helpers when configured |
| Restore | Explicit restore paths (review before execute) |

```bash
ysk-server backup list --q demo --json
ysk-server backup status --json
ysk-server backup all --json
ysk-server backup control-plane --json
ysk-server backup schedule --install --execute
ysk-server backup settings get --json
ysk-server backup restic …          # when remote restic configured
ysk-server backup restore …         # follow CLI help; dry-run first
```

## Cron

Managed jobs in the control plane + optional **crontab install**.

```bash
ysk-server cron list --json
ysk-server cron create --schedule "0 3 * * *" --command "ysk-server backup all" --json
ysk-server cron enable --id JOB --json
ysk-server cron run --id JOB --json
ysk-server cron install --execute   # write user crontab (EXECUTE)
ysk-server cron status --json
```

## Honesty

- `schedule --install` / `cron install` need EXECUTE (often root for system crontab).  
- Backup files under dataDir ≠ offsite success until remote/restic confirms.  
- Restore is destructive: confirm target paths.

## Related

[../deploy/backup.md](../deploy/backup.md) · [../cli/reference.md](../cli/reference.md)
