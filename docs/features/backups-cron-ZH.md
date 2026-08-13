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
| 遠端目的地（SFTP／S3／local） | `ysk-server backup settings get\|set\|test` | write-host | 探測需 `--execute` |
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

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| — | 無 |

## 相關

- [部署備份](../deploy/backup-ZH.md)  
