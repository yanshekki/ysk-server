# 面板 ↔ CLI 對等

> 語言：中文 | [English](./parity.md)

**硬規則：** 面板有嘅生產能力，CLI 必須有入口（或明文標註「僅面板」）。自動化優先 `--json`。

| 標記 | 含義 |
|------|------|
| ✅ | CLI 可用 |
| ⚠️ | 部分／需 flag／有意僅面板（已說明） |
| ❌ | 面板有、CLI 缺（**不可無標記上線**） |

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

## 專案／站點

| 面板 | CLI | 狀態 |
|-------|-----|------|
| 專案列表／建立／詳情 | `projects list\|get\|create` | ✅ |
| 部署／停止／健康 | `projects deploy\|stop\|health` | ✅ |
| Git 部署 | `projects git-deploy` | ✅ |
| 隔離／資源 | `projects isolation …` | ✅ |
| 範本 | `templates list\|apply` | ✅ |
| Nginx | `nginx status\|list\|test\|sync` | ✅ |
| SSL | `ssl list\|get` | ✅ |
| 日誌 | `logs sources\|query\|journal` | ✅ |

## 檔案／公開／FTP／WebDAV

| 面板 | CLI | 狀態 |
|-------|-----|------|
| 檔案 CRUD | `files list\|read\|write\|mkdir\|rm\|…` | ✅ |
| 上載 | `files upload` | ✅ |
| 回收桶 | `files trash …` | ✅ |
| 公開分享列表 | `files shares list` | ✅ |
| WebDAV | `files webdav status\|token\|disable` | ✅ |
| 公開檔案站 | `hosting public-files --domain …` | ✅ |
| FTPS | `hosting ftps-apply` | ✅ |
| 瀏覽器編輯器／媒體預覽 | *（僅面板 UX）* | ⚠️ 有意 |
| 公開分享落地頁 | *（HTTP 公開 API；建立走面板／API）* | ⚠️ 有意 |

## 郵件／DNS／CDN

| 面板 | CLI | 狀態 |
|-------|-----|------|
| 域名／信箱／DNS bundle | `email domains\|mailboxes\|dns\|bootstrap` | ✅ |
| 送達檢查 | `email deliverability` | ✅ |
| 網頁電郵（全域） | `hosting webmail-apply --domain …` | ✅ |
| DNS zone | `dns zone\|zones` | ✅ |
| CDN | `cdn nodes\|sites\|apply\|…` | ✅ |

## 安全／防護／系統

| 面板 | CLI | 狀態 |
|-------|-----|------|
| 工作階段／API 金鑰／2FA | `security status\|sessions\|api-keys` | ✅ |
| 用戶／RBAC | `users` · `packages` · `rbac` | ✅ |
| SSH 金鑰／SSH 2FA | `ssh-key` · `ssh-2fa` | ✅ |
| 防火牆／fail2ban／防護 | `defense …` · `hosting firewall-apply` | ✅ |
| 指標／網絡／主機 | `host overview\|metrics\|network` | ✅ |
| 服務矩陣 | `services` | ✅ |
| 定時工作 | `cron …` | ✅ |
| 備份 | `backup …` | ✅ |
| 遷移 | `migrate …` | ✅ |
| 瀏覽器終端 | *（僅面板 PTY）* | ⚠️ 有意 |

## 人工智能（無面板入口）

| 能力 | CLI | 狀態 |
|------|-----|------|
| 自然語言 → 計劃 | `ask` | ✅ |
| 工具允許清單 | `tools` · `tools run` | ✅ |
| 機群／運行時 | `agents` · `agent run` | ✅ |

---

## 如何查用法

```bash
ysk-server --help
ysk-server help [--locale zh-HK|zh-CN|en]
ysk-server files
ysk-server email
ysk-server readiness --json
```

機器可讀命令表：[../agent/commands.json](../agent/commands.json)。

## 驗收

- [x] 生產面板 in-scope 無未標註 ❌
- [x] 主要 list／status 支援 `--json`
- [x] Files WebDAV + shares 已列入
- [x] 僅面板 UX 以 ⚠️ 標註理由

*最後更新：2026-08-09 — Phase 4。*
