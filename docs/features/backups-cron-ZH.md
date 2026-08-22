# 備份與 Cron

> 語言：中文（香港書面語）| [English](./backups-cron.md)

## 用途

**控制平面與主機備份**作業（含 restic 輔助）與 **受管 cron** 項目。

**非目標：** 無儲存上限的無限保留；無 EXECUTE 時靜默宣稱備份成功。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/backups`、`/cron` |
| 導航鍵 | `backups`、`cron` |
| 主要操作 | 備份列表／執行／還原 · 排程 · restic · cron CRUD／安裝 |
| 能力 | 備份／cron |
| RBAC | 操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 備份列表／狀態／全部 | `ysk-server backup list\|status\|all` | write-host | all 可能需 execute |
| 還原／刪除 | `ysk-server backup restore\|delete` | write-host | 刪除會**移去** `dataDir/backups/.trash`（7 日回收區）。永久刪／還原／清空在 `/backups` 回收區分頁（`GET/POST/DELETE /api/v1/backups/trash`）。 |
| 排程安裝 | `ysk-server backup schedule --install --execute` | write-host | |
| Restic 輔助 | `ysk-server backup restic …` | write-host | |
| 遠端目的地（SFTP／S3／local） | `ysk-server backup settings get\|set\|test` | write-host | 面板測試可送未儲存表單與出站 SSH 身分。真正連線需 `--execute`。缺金鑰／密碼不是「未開 EXECUTE」。遠端推送會 `mkdir -p` 目的目錄，並把 `.sql` sidecar 放在 tar 旁邊。 |
| 控制平面預覽 | `ysk-server backup restore`（id 為 `control-plane`），或 `POST /api/v1/backups/control-plane/restore` | read | 列出封存（`tar -tzf`）。不需專案列。 |
| Cron 列表／建立／更新… | `ysk-server cron list\|create\|update\|…` | write-panel | `update` 可改 schedule／command／user／project（與面板 PATCH 相同） |
| Cron 安裝至主機 | `ysk-server cron install --execute` | write-host | |
| 主機 crontab 行修改 | `ysk-server cron host edit\|disable\|enable\|delete\|run\|adopt --execute` | write-host | 就地改該用戶的那一行；不是 `install` |

## CLI 速查

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

## 誠實邊界

- 無 EXECUTE 時排程／安裝會被阻擋。  
- 主機 crontab **修改**會寫入該用戶的線上 crontab（`crontab -u`）。未開 EXECUTE 只預覽。  
- 面板 PATCH 受管工作要再 **安裝到系統** 才生效。兩種不要混為一談。  
- 備份「已寫入」路徑 ≠ 已驗證異地副本。  
- 面板刪除唔會即刻 `unlink`：檔案留喺回收區 **7 日**，之後 `purgeExpired` 先清。清空與永久刪仍要打字確認。  
- SFTP 測試與 `backup all` 使用同一出站身分。公鑰被拒是認證問題，不是面板未開 EXECUTE。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [部署備份](../deploy/backup-ZH.md)  
