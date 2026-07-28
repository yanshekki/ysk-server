# 專案隔離契約（Linux User + Home）

每個 **專案** 以獨立 Linux 用戶運作，彼此檔案與行程隔離。

## 命名

| 資源 | 規則 | 範例 |
|------|------|------|
| **Home** | `/home/ysk-server-{projectId}` | `/home/ysk-server-a1b2c3d4-…` |
| **Linux 用戶**（新建） | `ysks_{projectId 去連字號前 12 hex}`（≤32） | `ysks_a1b2c3d4e5f6` |
| **群組** | 與用戶同名 | 同上 |

- 顯示名稱可改；**linuxUser / homeDir 建立後不應手動改**（避免 chown 災難）。
- 舊專案可能仍是 `ysk_{name_slug}` 用戶名；**遷移會保留用戶名**，只把 home 改到意圖路徑。

## 行為模式

### 生產（`YSK_EXECUTE=1` + root）

1. 建立專案 → `useradd` / `groupadd` / home `750`
2. Deploy **要求** `os_provisioned`，否則 403
3. 行程：`systemd User=` / `runuser -u` / PHP-FPM pool user = 專案用戶
4. 限制可在面板 **資源** 分頁套用（Memory/CPU/Tasks/NOFILE/shell/鎖定/配額）

### Degraded（無 root）

- Home 寫在控制面陰影：`{dataDir}/homes/ysk-server-{id}`
- **不**假裝已隔離；Deploy 可繼續但 notes 標 degraded
- 之後用「建立系統用戶」或「遷移到 /home/ysk-server-…」升級

## 面板操作（專案 → 資源）

| 操作 | 說明 |
|------|------|
| 建立／修復系統用戶 | `POST .../os-provision` |
| 遷移到 /home/ysk-server-… | `POST .../os-user/migrate`（確認後） |
| 修復 home 擁有權 | `POST .../os-user/chown-home` |
| 儲存並套用限制 | `PATCH .../os-user` |
| 即時狀態 | `GET .../os-user` |

## 就緒檢查

`GET /api/v1/readiness` 會掃全部專案：

- 是否 `osProvisioned`
- home 是否為 `/home/ysk-server-{id}` 且存在

未隔離專案會列在 `category: isolation` 項目中。

## 安全

- 刪 home 僅允許白名單路徑（canonical / 陰影 / legacy dataDir）
- 指令皆模板化，無任意 shell 注入
- 預設 shell：`/usr/sbin/nologin`
