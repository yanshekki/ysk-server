# 整機遷移（Host full migrate）

> 語言：中文 | [English](./host-migrate.md)

> 本頁為對應英文運維文件的香港書面語版；命令與路徑保持原文以便複製。

將 **整台 YSK 控制面 + 專案 + 郵件 + 資料庫 + 帳戶設定** 遷到新伺服器。  
目標：新機 **只換公網 IP**，其餘域名／帳號／路徑／專案 id 不變。

> **實作狀態（2026-07-30）**  
> - ✅ **PR1**：`HostManifest` 盤點 + job 持久化（`ysk-server-shared` + `host-migrate`）  
> - ✅ **PR2**：SSH/rsync transport、臨時金鑰、來源/目標 preflight  
> - ✅ **PR3**：package — quiesce、全量 SQL dump、Redis RDB、fingerprints  
> - ✅ **PR4**：transfer rsync + target bootstrap（minimal → transfer → full）  
> - ✅ **PR5**：restore（users/SQL/Redis）+ reapply + verify  
> - ✅ **PR6**：CLI / API / 面板 `/system/migrate`  

## PR6 操作入口

### CLI

```bash
ysk-server migrate inventory --data-dir /var/lib/ysk-server --json
ysk-server migrate host --target root@NEW_IP --identity-file /root/.ssh/id_ed25519 \
  --execute --maintenance --data-dir /var/lib/ysk-server
# 或密碼（環境變數較安全）：
YSK_MIGRATE_SSH_PASSWORD='…' ysk-server migrate host --target root@NEW_IP --password "$YSK_MIGRATE_SSH_PASSWORD" --execute

# 在目標機（transfer 後若 remote-post 失敗）：
YSK_EXECUTE=1 ysk-server migrate post --job <id> --data-dir /var/lib/ysk-server --execute --json
ysk-server migrate status [--job id]
```

### HTTP

| 方法 | 路徑 | 說明 |
|------|------|------|
| POST | `/api/v1/system/migrate/inventory` | 盤點 |
| GET | `/api/v1/system/migrate/jobs` | 列表 |
| GET | `/api/v1/system/migrate/jobs/:id` | 詳情 |
| POST | `/api/v1/system/migrate/jobs` | 執行/resume（body: target, password?, execute, maintenanceAccepted…） |
| POST | `/api/v1/system/migrate/post` | 目標機 restore+reapply+verify |

### 面板

**系統 → 整機遷移** `/system/migrate`

## PR5 還原 / 重套用 / 驗證（在**目標機** dataDir 上執行）

| 階段 | 函式 | 行為 |
|------|------|------|
| restore | `restoreOnHost` | 確認 ysk.json/secrets；`useradd` 同 UID/GID；import SQL；Redis RDB |
| reapply | `reapplyOnHost` | 清 bind_ip；systemd unit；nginx-sync+reload；email/firewall/fail2ban；cron |
| verify | `verifyOnHost` | 計數/home/maildir/secrets 對帳；readiness；**關鍵 mismatch → 不標 done** |
| 串接 | `runPostTransferOnHost` | restore → reapply → verify |

成功 verify 後 job.phase = `done`，並輸出 DNS cutover 清單。  


## PR4 傳輸與目標 bootstrap

| 順序 | 函式 | 說明 |
|------|------|------|
| 1 | `bootstrapTargetMinimal` | 目標 `apt install rsync curl` |
| 2 | `transferMigratePayload` | rsync `dataDir` + `/home/ysk-server-*` + optional `/etc/letsencrypt` |
| 3 | `verifyRemoteYskJson` | 對帳 `ysk.json` sha256 |
| 4 | `bootstrapTargetFull` | apt `softwareNeeded` + Node≥20 + `npm i -g ysk-server` + enable units |

一鍵：`transferThenBootstrap(...)`。

**誠實：** dataDir/home rsync 失敗 → 中止；optionalEtc 失敗不中止；CLI 安裝失敗記 partial。  


## PR3 打包（package）

| 路徑 | 內容 |
|------|------|
| `{dataDir}/db-dumps/migrate/{jobId}/sql/*.sql` | 每庫 mysqldump / pg_dump |
| `{dataDir}/db-dumps/migrate/{jobId}/redis/*.rdb` | redis-cli `--rdb` 或 BGSAVE+copy |
| `{dataDir}/db-dumps/migrate/{jobId}/package.json` | 打包清單 |
| manifest | 更新 `dumpRelPath` / `rdbRelPath` / `fingerprints` / `packagedAt` |

**誠實：**

- 需 `YSK_EXECUTE=1` + `maintenanceAccepted`  
- 任一 SQL/Redis dump 失敗 → job `failed`，**禁止**進入 transfer  
- apply_status=`written`（dump 檔在 dataDir；尚未上目標機）  


## PR2 模組

| 檔案 | 職責 |
|------|------|
| `host-migrate/transport.ts` | 解析 target、identity/password/agent、`runSshCommand`、`rsyncToRemote` |
| `host-migrate/temp-key.ts` | 產生 ed25519 → 密碼一次寫入目標 `authorized_keys` → 後續用 key |
| `host-migrate/preflight.ts` | 來源（EXECUTE/root/工具/磁碟）+ 目標（Debian、root、空間、既有 ysk.json） |

### 認證

1. **Vault identity**（`identityId`）  
2. **私鑰路徑**  
3. **密碼**（需本機 `sshpass`；不寫入 job.json）→ 建議立刻換成臨時 key  
4. **agent / 預設 key**（BatchMode）

### 預檢阻塞條件（誠實）

- 來源：無 `YSK_EXECUTE`、非 root、缺 ssh/rsync、未確認維護窗  
- 目標：SSH 失敗、非 root、非 Debian/Ubuntu、磁碟不足、已有 `ysk.json` 且未 `forceWipeTarget`  


## 操作員只需提供

1. 目標 `root@新IP`（SSH）  
2. 密碼 **或** 已授權私鑰  
3. 確認維護窗（來源會短暫停服以保證一致性）

**不會自動改 DNS** — 完成後依 cutover 清單改 A/AAAA。

## 無漏清單（Manifest 覆蓋）

| 類別 | 內容 |
|------|------|
| 控制面 | 整個 `dataDir`（`ysk.json`、secrets、email Maildir、nginx 託管、certs、dns、cron…） |
| 專案檔 | `/home/ysk-server-{id}`（及 store 登記的 home） |
| 資料庫 | MySQL/Maria/Postgres dump → 目標 import |
| Redis | RDB snapshot（PR3） |
| OS 用戶 | `ysks_*` 盡量同 UID/GID |
| 軟體 | `softwareNeeded` 依已用功能從 catalog 安裝 |
| 重套用 | nginx / mail / firewall / fail2ban / systemd / cron（PR5） |

## CLI（規劃）

```bash
ysk-server migrate inventory --data-dir /var/lib/ysk-server --json
ysk-server migrate host --target root@NEW_IP --execute --data-dir /var/lib/ysk-server
ysk-server migrate resume --job <id> --execute
```

## Job 目錄

```
{dataDir}/migrate/{jobId}/
  job.json
  manifest.json
  log.jsonl
  progress.json
```

密碼 **永不** 寫入 job.json。

## 誠實契約

- 無 `YSK_EXECUTE=1` / 非 root / SSH 失敗 → `blocked` 或 `failed`，**不**報成功  
- dump 半套 → 不進入 transfer  
- verify 計數不一致 → 不標 `done`

## 人必須做

1. DNS A/AAAA → 新 IP  
2. 雲防火牆 / 安全組（80/443/25/587…）  
3. 郵件 PTR/rDNS  
4. 舊機保留觀察期後下線  

詳見架構設計：code-review / product plan（host full migrate）。
