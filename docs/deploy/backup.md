# 備份（in-scope 100%）

## 能力

| 功能 | 說明 | 誠實條件 |
|------|------|----------|
| tar 全專案備份 | `dataDir/backups/<projectId>/backup-*.tar.gz` | home 存在 |
| 全部備份 | `POST /api/v1/backups/run-all` 或 `ysk-server backup all --data-dir …` | 0 專案 = ok（無事可做） |
| 略過 | home 不存在 → `skipped`，唔當失敗 | — |
| 列表／下載／刪除 | 路徑約束於 managed backups | 下載需 Bearer |
| 還原 | full / web / dry-run；chown 需 root+EXECUTE | written ≠ chown |
| 每日排程 | Cron `ysk-server backup all --data-dir '…'` | 要「安裝到系統 crontab」 |
| 遠端推送 | local / sftp / s3 | 未啟用 = skipped；失敗拖 overall ok |
| restic | 可選增量 | 啟用必設 password；未啟用唔能假跑成功 |

## CLI

```bash
ysk-server backup all --data-dir /path/to/data
ysk-server projects backup --id <projectId>
```

## 面板

- **備份檔**：列表、下載（authenticated blob）、預覽／還原／刪除  
- **操作**：全部備份、排程、restic、上次 results + sideResults  
- **遠端／排除**：遠端、restic password、tar 排除  

## 刻意不在 100% in-scope

- 多租戶配額計費備份  
- 跨機自動 failover  
- 無 root 時系統 crontab 自動 install（需操作員 EXECUTE）  
