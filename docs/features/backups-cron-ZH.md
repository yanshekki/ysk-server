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
| 還原／刪除 | `ysk-server backup restore\|delete` | write-host | |
| 排程安裝 | `ysk-server backup schedule --install --execute` | write-host | |
| Restic 輔助 | `ysk-server backup restic …` | write-host | |
| 遠端目的地（SFTP／S3／local） | `ysk-server backup settings get\|set\|test` | write-host | 面板測試可送未儲存表單與出站 SSH 身分。真正連線需 `--execute`。缺金鑰／密碼不是「未開 EXECUTE」。遠端推送會 `mkdir -p` 目的目錄，並把 `.sql` sidecar 放在 tar 旁邊。 |
| 控制平面預覽 | `ysk-server backup restore`（id 為 `control-plane`），或 `POST /api/v1/backups/control-plane/restore` | read | 列出封存（`tar -tzf`）。不需專案列。 |
| Cron 列表／建立… | `ysk-server cron list\|create\|…` | write-panel | |
| Cron 安裝至主機 | `ysk-server cron install --execute` | write-host | |

## CLI 速查

```bash
ysk-server backup list --json
ysk-server cron list --json
export YSK_EXECUTE=1
ysk-server backup schedule --install --execute --json
ysk-server cron install --execute --json
```

## 誠實邊界

- 無 EXECUTE 時排程／安裝會被阻擋。  
- 備份「已寫入」路徑 ≠ 已驗證異地副本。  
- SFTP 測試與 `backup all` 使用同一出站身分。公鑰被拒是認證問題，不是面板未開 EXECUTE。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [部署備份](../deploy/backup-ZH.md)  
