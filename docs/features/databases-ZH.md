# 資料庫

> 語言：中文（香港書面語）| [English](./databases.md)

**面板路由：** `/databases/mysql|mariadb|postgres|redis`（+ 服務主控台）  
**CLI：** `hosting mysql-provision|postgres-provision|redis-provision`、`db-cluster`

## 功能

| 引擎 | 能力 |
|------|------|
| MySQL／MariaDB | provision 計劃、用戶／庫資料列、服務主控台 |
| PostgreSQL | provision 計劃、服務狀態 |
| Redis | 實例計劃、工具允許時 PING |
| 叢集 | **先計劃** 的 HA 草圖（`db-cluster`） |

## CLI

```bash
ysk-server hosting mysql-provision --json
ysk-server hosting mysql-provision --execute --json
ysk-server hosting postgres-provision --execute --json
ysk-server hosting redis-provision --execute --json
ysk-server db-cluster list --json
ysk-server db-cluster plan --json
```

## 流程

1. 探測服務／用戶端二進位（`services`、readiness）。  
2. provision **dry-run** JSON。  
3. 僅在 EXECUTE 下 `--execute`（裝套件／unit 常需 root）。  
4. 保存結果中的憑證；限制面板存取。  

## 誠實邊界

無 EXECUTE 時拒絕真實伺服器變更。叢集模組不會靜默組成多節點叢集。

## 相關

[system-host-ZH.md](./system-host-ZH.md) · [../cli/reference-ZH.md](../cli/reference-ZH.md)
