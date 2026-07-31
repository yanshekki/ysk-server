# Backup operations

> Language: English | [中文](./backup-ZH.md)

## Daily commands

```bash
ysk-server backup list --json
ysk-server backup status --json
ysk-server backup all --json
ysk-server backup control-plane --json
ysk-server backup schedule --install --execute
```

Feature deep-dive: [../features/backups-cron.md](../features/backups-cron.md).

## Honesty

Install schedule needs EXECUTE. dataDir archives ≠ offsite until remote/restic OK.
