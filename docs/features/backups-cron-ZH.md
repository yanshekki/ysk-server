# 備份與 Cron

> 語言：中文（香港書面語）| [English](./backups-cron.md)

**面板路由：** `/backups`、`/cron`  
**CLI：** `backup`、`cron`

## 備份

| 能力 | 說明 |
|------|------|
| 專案 tar | dataDir 下每專案封存 |
| 控制平面 | store 快照／控制平面包 |
| 排程 | 安裝系統排程（EXECUTE） |
| 遠端／restic | 設定後可用 restic 輔助 |
| 還原 | 明確還原路徑（執行前覆核） |

```bash
ysk-server backup list --q demo --json
ysk-server backup status --json
ysk-server backup all --json
ysk-server backup control-plane --json
ysk-server backup schedule --install --execute
ysk-server backup settings get --json
ysk-server backup restic …
ysk-server backup restore …         # 先看 help；先 dry-run
```

## Cron

控制平面託管工作 + 可選 **crontab 安裝**。

```bash
ysk-server cron list --json
ysk-server cron create --schedule "0 3 * * *" --command "ysk-server backup all" --json
ysk-server cron enable --id JOB --json
ysk-server cron run --id JOB --json
ysk-server cron install --execute
ysk-server cron status --json
```

## 誠實邊界

- `schedule --install`／`cron install` 需 EXECUTE（系統 crontab 常需 root）。  
- dataDir 內備份檔 ≠ 異地成功，直至遠端／restic 確認。  
- 還原具破壞性：確認目標路徑。  

## 相關

[../deploy/backup-ZH.md](../deploy/backup-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
