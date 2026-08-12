# 面板 ↔ CLI 對齊

> 語言：中文（香港書面語）| [English](./parity.md)

**狀態：C7 封板（2026-08-12）。** 生產面板 mutation/list 均有 CLI。刻意僅面板：終端 PTY、VNC 畫布、Host Browse、檔案預覽編輯器、公開 share 落地頁。

**硬規則：** 面板每一項生產能力都必須有 CLI 入口（或明確標為 ⚠️ 僅面板 UX）。自動化優先 `--json`。

| 標記 | 含義 |
|------|------|
| ✅ | CLI 可用 |
| ⚠️ | 部分／需 flag／刻意僅面板（已說明） |
| ❌ | 面板有、CLI 缺（**不可無標記上線**） |

完整缺口表 + 軌跡：**[panel-parity-matrix-ZH.md](./panel-parity-matrix-ZH.md)**  
機器盤點：**[parity-inventory.json](./parity-inventory.json)**（`node scripts/cli-panel-parity.mjs`）  
功能手冊：**[../docs-inventory-ZH.md](../docs-inventory-ZH.md)** · **[../docs-standard-ZH.md](../docs-standard-ZH.md)**

---

## 控制平面

| 面板 / API | CLI | 狀態 |
|-------------|-----|------|
| 初始化／管理員 | `ysk-server setup` | ✅ |
| 啟動 API+UI | `ysk-server serve` | ✅ |
| 就緒／doctor | `readiness` · `doctor` | ✅ |
| 健康 | `health [--url]` | ✅ |
| 系統單元安裝 | `system unit-install` | ✅ |
| 文件庫 | `store status\|export\|import\|migrate` | ✅ |
| 自我更新 | `update` | ✅ |
| 主機套件清冊 | `updates …` | ✅ |
| 軟件目錄 | `software …` · `stack …` | ✅ |

## 高優先面（已封板）

| 面板 | CLI | 狀態 |
|------|-----|------|
| VPN | `vpn …` | ✅ C2 |
| VNC | `vnc …`（畫布 ⚠️） | ✅ C2 |
| Apache | `apache …` | ✅ C3 |
| 服務網絡暴露 | `network exposure …` | ✅ C3 |
| Real-IP／面板 TLS | `real-ip …`／`ssl panel-tls …` | ✅ C3 |
| DB 生命週期／SQL 切換 | `db …`／`db sql-engine …` | ✅ C5 |
| Redis 鍵 | `redis …` | ✅ C5 |
| FTP 帳戶 | `ftp …` | ✅ C6 |
| 檔案分享建立 | `files shares create` | ✅ C6 |
| 郵件別名／佇列／中繼 | `email aliases\|queue\|relay` | ✅ C6 |
| DNS dnssec／heal | `dns dnssec\|heal\|…` | ✅ C6 |
| Runtimes java/kotlin/bun | `runtimes …` | ✅ C7 |

僅面板 ⚠️ 列見矩陣。

---

## 說明探索

```bash
ysk-server --help
ysk-server help [--locale zh-HK|zh-CN|en]
node scripts/cli-panel-parity.mjs
```

機器可讀目錄：[../agent/commands.json](../agent/commands.json)。

## 驗收

- [x] 管理面板範圍內無未標記生產 ❌  
- [x] 主要 list/status 支援 `--json`  
- [x] 刻意僅面板 UX 已記錄  
- [x] 自動化盤點腳本存在  
- [x] 雙語功能手冊計劃（D0–D5）  

*最後更新：2026-08-12 — 文件 D4。*
