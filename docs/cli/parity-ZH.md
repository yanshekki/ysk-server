# 面板 ↔ CLI 對等矩陣

> 語言：中文（香港書面語）| [English](./parity.md)


**硬規則：** 面板有的能力，CLI 必須有對等入口；AI agents 優先用 CLI + 本檔 + [reference.md](./reference.md) + [../agent/commands.json](../agent/commands.json)。

| 標記 | 含義 |
|------|------|
| ✅ | CLI 已有可用命令 |
| ⚠️ | 有部分 / 需 flag / 間接 |
| ❌ | 面板有、CLI 缺（缺口） |
| · | 雙方都弱 / 實驗 |

---

## 控制平面

| Panel / API | CLI | 狀態 |
|-------------|-----|------|
| Setup / first admin | `ysk-server setup` | ✅ |
| Serve API+UI | `ysk-server serve` | ✅ |
| Readiness | `ysk-server readiness` · `doctor` | ✅ |
| Health | `ysk-server health [--url]` | ✅ |
| System unit install | `ysk-server system unit-install` | ✅ |
| State store json/sqlite/pg | `store status\|export\|import\|migrate` | ✅ |

## 專案 / 架站

| Panel | CLI | 狀態 |
|-------|-----|------|
| Projects list/create | `projects list\|create` | ✅ |
| Deploy node/php/static | `projects deploy` [--entry|--port|--fpm] | ✅ |
| Git deploy | `projects git-deploy` | ✅ |
| Nginx publish | `nginx` / hosting | ✅ |
| SSL | `ssl` | ✅ |
| Logs | `logs` | ✅ |
| Templates | `templates` | ✅ |

## 備份

| Panel / API | CLI | 狀態 |
|-------------|-----|------|
| 列表 / 搜尋 | `backup list --q` | ✅ |
| 狀態 / lastRun | `backup status` | ✅ |
| 全部備份 + side | `backup all` | ✅ |
| 專案 tar / restore | `projects backup` · `backup restore` | ✅ |
| 排程 + install | `backup schedule [--install]` | ✅ |
| 控制平面 | `backup control-plane` | ✅ |
| restic | `backup restic …` | ✅ |
| 遠端 / exclusions / restic 設定 | `backup settings get|set` | ✅ |

## 安全 / 用戶

| Panel | CLI | 狀態 |
|-------|-----|------|
| Login / sessions | `security sessions list\|revoke\|revoke-others` | ✅ |
| API keys | `security api-keys list\|create\|delete` | ✅ |
| Users / packages | `users` · `packages` | ✅ |
| RBAC | `rbac` | ✅ |
| 2FA / security | `security status` | ✅ |
| SSH keys / 2FA | `ssh-key` · `ssh-2fa` | ✅ |
| Audit | `audit list --q` | ✅ |

## 郵件 / DNS / CDN

| Panel | CLI | 狀態 |
|-------|-----|------|
| Email domains/mailboxes | `email domains\|mailboxes\|…` | ✅ |
| Deliverability | `email deliverability` | ✅ |
| DNS zones | `dns` / hosting | ✅ |
| CDN nodes/sites/apply | `cdn nodes\|sites\|apply\|…` | ✅ |
| Fleet agents | `agents fleet …` · `agent run` | ✅ |

## 防護 / 系統

| Panel | CLI | 狀態 |
|-------|-----|------|
| Firewall UFW | `defense firewall` | ✅ |
| Fail2ban | `defense fail2ban` | ✅ |
| Defense center | `defense status\|stack-apply\|presets\|timeline` | ✅ |
| Metrics / network | `host metrics|network|overview` | ✅ |
| Updates | `update` | ✅ |
| Cron | `cron list\|create\|install\|status` | ✅ |
| Files | `files list\|read\|write\|…` | ✅ |
| Files multi-upload / WebDAV | `files upload` · `files webdav token` | ✅ |
| DB provision | `hosting mysql-provision|postgres-provision`（plan 預設） | ✅ |
| Migrate host | `migrate` | ✅ |

---

## 驗收

- [x] 矩陣無 ❌ / 無 ⚠️（Admin 運維 in-scope 全 ✅）
- [x] `commands.json` 覆蓋主命令（含 sessions / api-keys）
- [x] 主 list 支援 `--json` + 可選 `--q`
- [x] AI SKILL.md 指向本矩陣
- [x] document store 文件 + CLI 完整（[state-store.md](../deploy/state-store.md)）

## Wave 歷史

| 波 | 狀態 |
|----|------|
| A–D（14 項） | ✅ |
| E（Files / CDN ack / parity） | ✅ |
| F（Cron / Email / Defense / fleet routes） | ✅ |
| G（parity→CLI 深化 8 項） | ✅ |
| H（sessions/api-keys CLI · misc 拆 · coverage · store docs · seal） | ✅ |

*Last updated: 2026-07-31 — Wave H complete → Admin ops / CLI parity **100%**（in-scope）。*
