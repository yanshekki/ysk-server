# 資料庫

> 語言：中文（香港書面語）| [English](./databases.md)

## 用途

在控制平面主機操作 **MySQL／MariaDB／PostgreSQL／Redis** 服務與資料面：安裝、生命週期、主控台設定、SQL 引擎互斥切換、Redis 鍵瀏覽，以及可選 HA 叢集規劃。

**非目標：** 託管雲 DBaaS；在無 plan／apply 下靜默組成多節點叢集。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/databases/mysql`、`/mariadb`、`/postgres`、`/redis`（及服務主控台） |
| 導航鍵 | `mysql`、`mariadb`、`postgres`、`redis`（及 service 變體） |
| 主要操作 | 狀態 · 安裝 · 啟停 · 主控台套用 · SQL 切換 · Redis 鍵 · 叢集 |
| 能力 | 資料庫／託管服務能力 |
| RBAC | 具資料庫服務權限之操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 引擎／主控台狀態 | `ysk-server db status [--engine …] --json` | read | |
| 讀取主控台 | `ysk-server db console --engine … --json` | read | |
| 套用主控台設定 | `ysk-server db apply --engine … --set k=v --execute` | write-host | |
| 生命週期啟停 | `ysk-server db lifecycle --engine … --action start --execute` | write-host | |
| 安裝引擎套件 | `ysk-server db install --engine … --execute` | write-host | |
| SQL 引擎切換預覽 | `ysk-server db sql-engine preview --target mariadb --json` | read | MySQL 與 MariaDB 互斥 |
| SQL 引擎切換 | `ysk-server db sql-engine switch --target … --confirm … --acknowledge-exclusive --execute` | write-host | 具破壞性 |
| Redis 服務狀態 | `ysk-server redis status --json` | read | |
| Redis 設定 | `ysk-server redis settings get\|set\|apply` | write-panel／write-host | |
| Redis 鍵列表／讀取 | `ysk-server redis keys\|get …` | read | |
| Redis 寫入／刪除 | `ysk-server redis set\|del … --execute` | write-host | |
| 佈建計劃 | `ysk-server hosting mysql-provision\|postgres-provision\|redis-provision` | write-host | 預設試跑 |
| 資料庫叢集 | `ysk-server db-cluster list\|plan\|apply …` | write-host | 先計劃後套用。`create --kind postgres-…` 會推斷 `--engine postgres`。精靈可貼 `/agents` fleet session（非 SSH）。Redis 對等 README 是 Redis，不是 Galera。 |
| 遠端資料庫主機 | `POST /api/v1/db/remote-hosts/:id/test` | read | TCP 可達性。面板：測試連線。 |

## CLI 速查

```bash
ysk-server db status --json
ysk-server db console --engine mysql --json
ysk-server redis keys --pattern '*' --json
ysk-server db sql-engine preview --target mariadb --json
export YSK_EXECUTE=1
ysk-server db lifecycle --engine redis --action start --execute --json
ysk-server hosting mysql-provision --execute --json
```

完整 argv：[../cli/reference-ZH.md](../cli/reference-ZH.md#db--redis--db-cluster)。

## 誠實邊界

- 無 EXECUTE 時，安裝／生命週期／套用維持已阻擋或試跑。  
- SQL 切換為 **互斥**（MySQL XOR MariaDB）；務必預覽並確認短語。  
- 叢集模組不會靜默組成多節點叢集。  
- Postgres 叢集探測以 `postgres` 系統用戶執行（`runuser -u postgres -- psql`）。  
- 試跑叢集推送說明不會顯示成「系統變更已關閉」。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 豐富主控台表單元件 | 相同設定可用 `db apply --set` |

## 相關

- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
- [系統與主機](./system-host-ZH.md)  
- [CLI 參考](../cli/reference-ZH.md)  
