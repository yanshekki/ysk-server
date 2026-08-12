# 面板 ↔ CLI 對等矩陣

> 語言：中文（香港書面語）| [English](./panel-parity-matrix.md)  
> **狀態：已封板（C7）** — 生產面板缺口已關閉（僅面板 UX 列維持 ⚠️）。  
> 機器盤點：[parity-inventory.json](./parity-inventory.json) · 重新產生：`node scripts/cli-panel-parity.mjs`

**硬規則：** 每一項生產面板能力都必須有 CLI 入口（或明確標為 ⚠️ 僅面板）。

| 標記 | 含義 |
|------|------|
| ✅ | CLI 可用 |
| ⚠️ | 部分／刻意僅面板（須有說明） |
| ❌ | 面板有、CLI 缺 — **必須實作** |

---

## 生產缺口（優先序）

| ID | 面板 | 需要 CLI | 狀態 | 優先 |
|----|------|----------|------|------|
| vpn | VPN ensure／peers／clients／monitor／firewall | `vpn …` | ✅ C2 | P0 |
| vnc | VNC accounts／clients／share／novnc／firewall | `vnc …` | ✅ C2（瀏覽器畫布 ⚠️） | P0 |
| apache | Apache 站點／設定 | `apache …` | ✅ C3 | P0 |
| service-exposure | 服務網絡暴露同步 | `network exposure …` | ✅ C3 | P0 |
| real-ip | Real-IP 套用 | `real-ip …` | ✅ C3 | P1 |
| panel-tls | 面板 TLS 狀態／套用 | `ssl panel-tls …` | ✅ C3 | P1 |
| updates-inventory | 更新清冊／套件套用 | `updates …` | ✅ C4 | P1 |
| software-install | 功能軟件安裝橫幅 | `software …` | ✅ C4（+ `stack`） | P1 |
| db-lifecycle | DB 主控台生命週期／套用 | `db …` | ✅ C5 | P1 |
| sql-engine-switch | MySQL ↔ MariaDB 切換 | `db sql-engine …` | ✅ C5 | P1 |
| redis-keys | Redis 鍵變更 | `redis keys …` | ✅ C5 | P2 |
| ftp-accounts | FTP 帳戶 CRUD | `ftp accounts …` | ✅ C6 | P2 |
| files-shares-create | 建立公開分享（直接／BT／兩者） | `files shares create [--mode …]` | ✅ C6 | P2 |
| files-shares-bt-stats | 分享 BT swarm 統計 | `files shares bt-stats --id` | ✅ C6 | P2 |
| bt-tracker | BT Tracker 服務頁 | `bt-tracker status\|start\|stop\|settings\|torrents\|restore\|jobs` | ✅ C6 | P2 |
| email-depth | 別名／佇列／中繼 | `email …` | ✅ C6 | P2 |
| dns-records | 記錄／dnssec／heal | `dns …` | ✅ C6 | P2 |
| runtimes-full | java/kotlin/bun + 切換 | `runtimes …`／`hosting runtime-*` | ✅ C7 | P2 |

## 刻意僅面板（⚠️）

| ID | 面板 | 理由 |
|----|------|------|
| host-browse | Host Browse Chromium UI | 互動瀏覽器面 |
| terminal-pty | 瀏覽器終端 | 非遠端 SSH 產品 |
| file-preview-editor | 文字／媒體預覽編輯器 | 僅 UX；用 `files read/write` |
| public-share-landing | `/share/:token` 頁 | 公開 HTTP；建立仍需 CLI |
| vnc-browser-canvas | 面板內 noVNC／RFB 檢視器 | 互動；CLI 有 `vnc session mint` + `share` + connection 元資料 |

---

## 已覆蓋域（高層 ✅）

| 域 | CLI 入口 |
|----|----------|
| 控制平面 | `setup` `serve` `readiness` `health` `store` `system unit-install` `update` |
| 專案 | `projects list\|get\|create\|deploy\|stop\|git-deploy\|isolation\|health` |
| 檔案 | `files list\|read\|write\|mkdir\|rm\|…\|trash\|webdav\|shares list\|create\|bt-stats` |
| BT Tracker | `bt-tracker status\|start\|stop\|settings\|torrents\|restore\|jobs` |
| 郵件 | `email domains\|mailboxes\|dns\|bootstrap\|deliverability` |
| Nginx／SSL／DNS 區域 | `nginx` `ssl` `dns` `hosting …` |
| 防護 | `defense`／`protection` |
| CDN／agents／db-cluster | `cdn` `agents` `db-cluster` |
| Cron／備份／遷移 | `cron` `backup` `migrate` |
| 安全身分 | `security` `ssh-key` `ssh-2fa` `users` `rbac` |
| 服務／主機／日誌 | `services` `host` `logs` |
| 堆疊 | `stack plans\|install\|…` |
| VPN | `vpn status\|monitor\|ensure\|peers\|clients\|firewall\|presets` |
| VNC | `vnc status\|settings\|accounts\|clients\|share\|novnc\|session\|firewall` |
| Apache | `apache sites\|settings …` |
| 網絡暴露／Real-IP | `network exposure …` `real-ip …` |
| 面板 TLS | `ssl panel-tls status\|enable\|disable\|issue` |
| 更新／軟件 | `updates …` `software …`（+ `update`／`stack`） |
| DB／Redis | `db status\|console\|lifecycle\|sql-engine` `redis keys\|get\|set\|del` |
| AI | `ask` `tools` |

---

## 實作軌跡

| 切片 | 交付 | 目標 % |
|------|------|--------|
| **C0** | 本矩陣 + `scripts/cli-panel-parity.mjs` | ~10% |
| **C1** | CLI 模組骨架 | ~20% |
| **C2** | `vpn` + `vnc` | ~40% |
| **C3** | `apache` + `network exposure` + real-ip + panel-tls | ~55% |
| **C4** | `updates` + `software` | ~70% |
| **C5** | `db` 深度 + redis keys | ~80% |
| **C6** | files/email/dns/ftp 缺口 | ~90% |
| **C7** | runtimes 全量 + 封板 + smoke | 100% |

---

## 重新產生盤點

```bash
node scripts/cli-panel-parity.mjs
node scripts/cli-panel-parity.mjs --json
# optional CI later:
# node scripts/cli-panel-parity.mjs --strict   # fails if any ❌ missing remain
```

*最後更新：2026-08-12 — C7 封板（100%）。*
