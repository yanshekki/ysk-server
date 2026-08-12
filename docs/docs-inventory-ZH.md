# 文件盤點（面板 + CLI）

> 語言：中文（香港書面語）| [English](./docs-inventory.md)

追蹤 **程式對等封板（C7）之後** 的**文件**缺口。  
標準：[docs-standard-ZH.md](./docs-standard-ZH.md)。計劃切片：**D0–D5**。

| 狀態 | 含義 |
|------|------|
| ⬜ | 尚未按 L2/L3 範本完成 |
| 🔶 | 部分／過時 |
| ✅ | 符合範本（EN+ZH 對等） |

---

## 計劃進度

| 切片 | 交付 | % | 狀態 |
|------|------|---|------|
| **D0** | 標準 + 範本 + 本盤點 + INDEX 連結骨架 | ~10% | ✅ 完成 |
| **D1** | `cli/overview` + `cli/reference` + `commands.json` | ~35% | ✅ 完成 |
| **D2** | 新域手冊（vpn、vnc、apache、system-host、databases、runtimes） | ~55% | ✅ 完成 |
| **D3** | 其餘 `features/*` 加深 | ~75% | ✅ 完成 |
| **D4** | INDEX、操作員手冊 Day-N、agent、parity 中文對齊 | ~90% | ✅ 完成 |
| **D5** | bilingual-check 封板 + 交叉連結 | 100% | ✅ 完成 |

---

## L3 — CLI 百科

| 檔案 | 缺口 | 切片 |
|------|------|------|
| `cli/overview{,-ZH}.md` | 分組缺 C2–C7 一級命令 | D1 |
| `cli/reference{,-ZH}.md` | 缺 vpn/vnc/apache/network/real-ip/updates/software/db/redis/ftp/runtimes 完整章；files shares／email／dns 偏淺 | D1 |
| `agent/commands.json` | 目錄不完整 | D1 |
| `cli/parity{,-ZH}.md` | 中文結構落後 | D4 |
| `cli/panel-parity-matrix{,-ZH}.md` | 中文結構落後 | D4 |

### 一級 CLI 命令（程式 SSOT，共 51）

`setup` `update` `serve` `system` `stack` `tools` `ask` `projects` `users` `packages` `rbac` `audit` `security` `backup` `templates` `hosting` `dns` `logs` `host` `nginx` `ssl` `db-cluster` `ssh-key` `ssh-2fa` `services` `defense` `protection` `cdn` `agents` `agent` `store` `files` `cron` `email` `health` `readiness` `doctor` `migrate` **`vpn`** **`vnc`** **`apache`** **`network`** **`real-ip`** **`updates`** **`software`** **`db`** **`redis`** **`ftp`** **`runtimes`** `version` `help`

粗體 = C2 後新增面，reference 仍欠完整章節。

---

## L2 — 功能手冊

| 域 | 檔案 | 面板路由 | 主要 CLI | 文件狀態 | 切片 |
|----|------|----------|----------|----------|------|
| projects | `projects{,-ZH}.md` | `/projects` | `projects` | 🔶 | D3 |
| email | `email{,-ZH}.md` | `/email` | `email` | 🔶 | D3 |
| files-ftp | `files-ftp{,-ZH}.md` | `/files`、`/ftp` | `files`、`ftp` | 🔶 | D3 |
| databases | `databases{,-ZH}.md` | MySQL/Maria/PG/Redis | `db`、`redis`、`db-cluster` | 🔶 | D2 |
| dns-ssl-nginx | `dns-ssl-nginx{,-ZH}.md` | `/dns`、`/ssl`、`/nginx` | `dns`、`ssl`、`nginx` | 🔶 | D3 |
| nginx-sites | `nginx-sites{,-ZH}.md` | nginx 站點 UI | `nginx` | 🔶 | D3 |
| apache | `apache{,-ZH}.md` | `/apache` | `apache` | 🔶 薄且中文偏口語 | D2 |
| runtimes | `runtimes{,-ZH}.md` | 各 runtime 頁 | `runtimes`、`hosting runtime-*` | 🔶 | D2 |
| security-auth | `security-auth{,-ZH}.md` | `/security` | `security`、`ssh-key`、`ssh-2fa` | 🔶 | D3 |
| defense | `defense{,-ZH}.md` | `/protection` | `defense`、`protection` | 🔶 | D3 |
| vpn | `vpn{,-ZH}.md` | `/vpn` | `vpn` | 🔶 無 CLI 表 | D2 |
| vnc | `vnc{,-ZH}.md` | `/vnc` | `vnc` | 🔶 CLI 不完整 | D2 |
| users-rbac | `users-rbac{,-ZH}.md` | `/users` | `users`、`packages`、`rbac` | 🔶 | D3 |
| system-host | `system-host{,-ZH}.md` | 系統、網絡、更新 | `host`、`network`、`real-ip`、`updates`、`software`、`ssl panel-tls` | 🔶 | D2 |
| backups-cron | `backups-cron{,-ZH}.md` | 備份、cron | `backup`、`cron` | 🔶 | D3 |
| logs-metrics | `logs-metrics{,-ZH}.md` | 日誌、指標 | `logs`、`host` | 🔶 | D3 |
| cdn-agents | `cdn-agents{,-ZH}.md` | CDN、agents | `cdn`、`agents` | 🔶 | D3 |
| ai-tools | `ai-tools{,-ZH}.md` | AI | `tools`、`ask` | 🔶 | D3 |
| migrate | `migrate{,-ZH}.md` | 遷移 | `migrate` | 🔶 | D3 |
| host-browse | `host-browse{,-ZH}.md` | Host Browse | ⚠️ 僅面板 | 🔶 | D3 |

---

## L0／L1

| 檔案 | 缺口 | 切片 |
|------|------|------|
| `INDEX{,-ZH}.md` | 缺 vpn/vnc/apache 列；無 docs-standard 連結 | D0 骨架 · D4 潤飾 |
| `user-manual/manual{,-ZH}.md` | 僅 Day-1；無新域 Day-N | D4 |
| `agent/README{,-ZH}.md`、`SKILL{,-ZH}.md` | 新域示例少 | D4 |
| `README{,-ZH}.md` | 就緒後指向 docs-standard | D5 |

---

## 明確僅面板（只記錄，不虛構 CLI）

| ID | 理由 |
|----|------|
| 瀏覽器終端 PTY | 互動畫面 |
| 面板內 VNC 畫布 | 互動 RFB UI（`vnc session mint` 僅元資料） |
| Host Browse Chromium UI | 互動瀏覽器 |
| 檔案預覽編輯器 | 僅 UX；用 `files read/write` |
| 公開 `/share/:token` 落地頁 | 公開 HTTP；**建立**用 `files shares create` |

---

## 檢查

```bash
node scripts/cli-panel-parity.mjs
node scripts/docs-bilingual-check.mjs
```

*最後更新：2026-08-12 — D0。*
