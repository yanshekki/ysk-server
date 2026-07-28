# 日誌中心（System Log Center）— 100% in-scope

路由：`/logs` · 側欄 **系統 → 日誌中心**

## 能力（SOC UX）

| Tab | 功能 |
|-----|------|
| **探索** | 左側來源軌（journal／檔案／專案）+ 右側工具列與終端風格檢視器；快捷 chip、書籤、KPI 英雄區 |
| **維護** | journal vacuum · logrotate 狀態 · 與防護中心分工 |
| **設定** | 行數／跟隨／遮罩／vacuum／告警／自訂 allow 路徑／書籤管理 |

深鏈相容：`?tab=journal|files|projects` → 探索；`?tab=maintain` → 維護；`?unit=` / `?source=` 仍有效。

### 檢視器

- 深色終端風 · 行號 · **error／warn** 高亮  
- **公網 IP** 可點 → `/protection?tab=bans&ip=…`  
- 跟隨輪詢／SSE · 匯出 text/jsonl · 書籤  
- 服務矩陣 **日誌** → `/logs?unit=…` · 專案日誌 → 深鏈  

## API

| Method | Path |
|--------|------|
| GET | `/api/v1/logs/overview`（含 `settings`、`journalDiskMb`、`logrotate`） |
| GET | `/api/v1/logs/sources` |
| GET | `/api/v1/logs/journal/units` |
| GET | `/api/v1/logs/journal/query?unit=&since=&priority=&grep=&lines=` |
| GET | `/api/v1/logs/query?source=journal:nginx.service` |
| GET | `/api/v1/logs/stream?source=&interval=`（SSE；需 Bearer；最長約 10 分） |
| GET | `/api/v1/logs/projects` |
| POST | `/api/v1/logs/export` `{ source, lines, since, priority, grep, format?: text\|jsonl }` |
| GET | `/api/v1/logs/export/:id`（Bearer 下載 `.log` / `.jsonl`） |
| POST | `/api/v1/logs/journal/vacuum` `{ mode, value }` |
| GET/PUT | `/api/v1/logs/settings` |
| GET/POST | `/api/v1/logs/bookmarks` |
| DELETE | `/api/v1/logs/bookmarks/:id` |
| GET | `/api/v1/logs/logrotate` |

`source` 格式：

| Source | 含義 |
|--------|------|
| `journal:<unit>` | journalctl unit（含 `ysk-project-<linux_user>.service`） |
| `file:auth` / `file:nginx-access` … | 系統 allowlist 檔 |
| `file:managed:<name>` | dataDir managed nginx log |
| `project:<id>:<rel>` | 專案 `home/logs/**` 或 `home/log/**` 相對路徑（支援子目錄） |
| `project-managed:<id>:access.log` | 專案 managed nginx（後備） |
| `project-fpm:<id>` | PHP-FPM pool error log |

`GET /api/v1/logs/projects` 回傳每專案 files（深掃）+ related（journal / nginx / php-fpm）。

深鏈：`/logs?project=<id>` 只顯示該專案；`?source=project:…` 直接開啟檔案。

## 設定欄位（`log_center`）

| 欄位 | 說明 |
|------|------|
| `maxLines` / `maxBytes` | 查詢上限 |
| `followIntervalSec` | 跟隨輪詢／SSE 預設間隔（1–30） |
| `maskSecrets` | password/token 遮罩 |
| `vacuumDefaultDays` | 手動／自動 vacuum 天數 |
| `autoVacuumEnabled` / `autoVacuumTime` | 每日時間窗自動 vacuum（需 root + EXECUTE） |
| `journalWarnMb` | 超過則總覽提示 + 儀表板通知 |
| `customAllowPaths` | 額外套 allow 的 `/var/log`／`/run/log` 路徑 |
| `bookmarks` | 已存查詢 |
| `disabledSources` | 停用內建來源 id |

## 排程

- `log-auto-vacuum`：每 15 分鐘檢查時間窗；成功寫 `log_center_last_auto_vacuum`（同日只跑一次）  
- 同步寫入 `log_center_disk_hint` 供 **通知中心** 顯示 journal 磁碟偏高  

## 安全

- 檔案路徑 allowlist（`/var/log`、`/run/log`、managed nginx logs、自訂白名單）；拒絕 `/etc`、`.ssh`、金鑰  
- journalctl 固定 argv；unit／grep 消毒；ssh.service ↔ sshd.service fallback  
- 輸出有行數／字節上限；可選 secret 遮罩  
- vacuum／自動 vacuum 無 EXECUTE／非 root → blocked（誠實）  
- SSE／export 下載需 Bearer（唔用 window.open）  

## 分工

- **日誌中心** = 觀測  
- **防護中心** = 應變／ban（日誌 IP 深鏈）  
- **專案 → 日誌** = 單站快捷  

## 明確不在 scope

- 任意路徑讀全碟、多機 fleet log 聚合、完整 ELK 取代  
- 多租戶 reseller 日誌隔離（延後）  
