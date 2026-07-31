# 專案隔離契約（Linux User + Home）

> Language: English | [中文](./project-isolation-ZH.md)

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

## 批量 / CLI（B3）

```bash
# 列表：needsMigration / missingOwner / productionReady
ysk-server projects isolation list --json

# 單站 provision（root + YSK_EXECUTE）
ysk-server projects isolation provision --id <projectId>

# 批量 provision（預設最多 20）
ysk-server projects isolation provision-all --limit 20

# 舊站補 package owner（只改 owner_user_id，唔動 linux user）
ysk-server projects isolation backfill-owners --owner-user-id <panelUserId>
```

HTTP：

| Method | Path | 說明 |
|--------|------|------|
| GET | `/api/v1/projects/isolation` | 全站 isolation report |
| POST | `/api/v1/projects/isolation/provision-all` | 批量 os-provision |
| POST | `/api/v1/projects/isolation/backfill-owners` | body: `{ ownerUserId?, projectIds? }` |

Provision 成功時若未設資源限制，會寫入預設：`MemoryMax=512M`、`CPUQuota=50%`、`TasksMax=256`、`LimitNOFILE=4096`。

## 安全

- 刪 home 僅允許白名單路徑（canonical / 陰影 / legacy dataDir）
- 指令皆模板化，無任意 shell 注入
- 預設 shell：`/usr/sbin/nologin`

## FTPS／檔案／備份（與專案 user 對齊）

| 入口 | 行為 |
|------|------|
| **專案 FTP 帳戶** | 虛擬用戶 `user_conf` 設 `guest_username={linuxUser}`，上傳檔 owner = 專案用戶 |
| **套用 FTPS** | 對每個 jail `chown` 到對應 `linuxUser`（缺 user 則 notes） |
| **檔案管理 project:** | 寫入／上傳後 `chown`（root 模式）；response 含 `chowned` |
| **Git 同步** | 成功後 `chown` home |
| **備份還原** | 成功後 `chown` home（傳入 linuxUser） |
| **Nginx 靜態** | 群組 `ysk-web`：專案 user + www-data；home `750`、public `g+rX` |
| **Cron（專案）** | 指令包 `runuser -u {linuxUser} -- bash -lc '…'` |
| **SFTP 公鑰** | 可綁 `projectId` → 寫入 `{home}/.ssh/authorized_keys` 並 chown |
| **sshd 片段** | `GET/POST /api/v1/sftp/sshd-snippet` → Match ysks_*/ysk_* + internal-sftp |
| **FTPS 密碼** | crypt 雜湊（openssl passwd -6）；唔存 `password_plain` |

degraded（無 root）時仍可寫控制面，但 **不會假裝** 已對齊 owner。

### Nginx 讀取（ysk-web）

provision 時自動：

```bash
groupadd --system ysk-web
usermod -aG ysk-web www-data
usermod -aG ysk-web $linuxUser
chgrp -R ysk-web $home && chmod 750 $home
chmod -R g+rX $home/app/public   # 等
```

www-data 需重新登入/session 才載入新群組（重啟 php-fpm/nginx 或重開 session）。
