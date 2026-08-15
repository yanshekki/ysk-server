# 統一主機軟件探測

> 語言：中文 | [English](./software-probe.md)

## 規則

**所有產品級「是否已安裝」「版本」「可否升級」必須經 `HostSoftwareProbe`。**

禁止在 service-console、db-engine、redis、stack、頁面各自重寫 `command -v`／`hasBin`／SQL flavor。

| 用途 | API |
|------|-----|
| 是否已安裝 | `probe.presence(id)` / `probe.isInstalled(id)` |
| 版本 | `probe.version(id)` |
| 升級候選 | `probe.upgrade(id)` / `probe.upgrades()` |
| 非 catalog 二進位 | `probe.resolveBin` / `probe.binPresent`（同一 PATH 規則） |

模組：`packages/core/src/hosting/software-probe/`  
類：`HostSoftwareProbe`

## MySQL / MariaDB 互斥

- `mysql-server` 與 `mariadb-server` **互斥**。
- 主機是 MariaDB → MySQL server **未安裝**（`blockedByExclusive`）。
- MySQL **服務頁**與**資料庫頁**必須用同一 `presence('mysql-server')`，不可以再「有 mysql client 就算已安裝 MySQL」。

## PostgreSQL

`software get postgresql`：若 `postgres` 不在 PATH，但 `postgresql` unit 為 **active**，仍視為已安裝（二進位常在 `/usr/lib/postgresql/*/bin`）。有版本路徑時仍優先用該路徑。

## 新增軟件

1. 寫入 `SOFTWARE_CATALOG`
2. 可選在 `registry.ts` 加 version／dpkg／exclusive
3. 業務碼只呼叫 `HostSoftwareProbe`
