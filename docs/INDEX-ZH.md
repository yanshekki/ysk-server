# YSK Server 文件索引

> 語言：中文 | [English](./INDEX.md)

**產品：** 單機 Linux 控制平面 + 架站面板（`ysk-server`）  
**不是：** 多租戶 Reseller SaaS、網頁終端機、或保證全球郵件 inbox 送達。

## 由此開始

| 文件 | 用途 |
|------|------|
| [../README-ZH.md](../README-ZH.md) | 產品概覽與快速上手 |
| [testing/README-ZH.md](./testing/README-ZH.md) | 單元測試、90% 覆蓋率、誠實教條 |
| [getting-started/install-ZH.md](./getting-started/install-ZH.md) | **install.sh** 完整系統堆疊 + monorepo／npm |
| [getting-started/setup-ZH.md](./getting-started/setup-ZH.md) | 首次初始化 |
| [getting-started/go-live-ZH.md](./getting-started/go-live-ZH.md) | 生產上線清單 |
| [getting-started/readiness-ZH.md](./getting-started/readiness-ZH.md) | 就緒探測 |

## 架構

| 文件 | 用途 |
|------|------|
| [architecture/overview-ZH.md](./architecture/overview-ZH.md) | 分層、HTTP／CLI、誠實運維 |
| [architecture/monorepo-ZH.md](./architecture/monorepo-ZH.md) | 套件邊界 |
| [architecture/ops-honesty-ZH.md](./architecture/ops-honesty-ZH.md) | 已寫入 ≠ 已套用 |
| [architecture/state-store-ZH.md](./architecture/state-store-ZH.md) | json／sqlite／postgres |

## 文件工程

| 文件 | 用途 |
|------|------|
| [docs-standard-ZH.md](./docs-standard-ZH.md) | **如何撰寫**面板 + CLI 文件（EN／香港書面語） |
| [docs-inventory-ZH.md](./docs-inventory-ZH.md) | 域 × 檔案 × 缺口（D0–D5 切片） |

## CLI（優先給 AI）

| 文件 | 用途 |
|------|------|
| [cli/overview-ZH.md](./cli/overview-ZH.md) | 全域旗標、結束碼、語言 |
| [cli/reference-ZH.md](./cli/reference-ZH.md) | **全部命令** |
| [cli/parity-ZH.md](./cli/parity-ZH.md) | 面板 ≡ CLI 摘要 |
| [cli/panel-parity-matrix-ZH.md](./cli/panel-parity-matrix-ZH.md) | 缺口矩陣（inventory `--strict`） |
| [api/overview-ZH.md](./api/overview-ZH.md) | 面板 × CLI × API 分組 |
| [agent/README-ZH.md](./agent/README-ZH.md) | Agent 規則與 runbook |
| [agent/commands.json](./agent/commands.json) | 機器可讀目錄 |

## 功能

| 文件 | 面板／域 |
|------|----------|
| [features/projects-ZH.md](./features/projects-ZH.md) | 站點／部署／隔離 |
| [features/email-ZH.md](./features/email-ZH.md) | 郵件與可送達性 |
| [features/files-ftp-ZH.md](./features/files-ftp-ZH.md) | 檔案、WebDAV、FTPS |
| [features/bt-tracker-ZH.md](./features/bt-tracker-ZH.md) | BT Tracker 與 WebTorrent 分享 |
| [features/databases-ZH.md](./features/databases-ZH.md) | MySQL／MariaDB／Postgres／Redis |
| [features/dns-ssl-nginx-ZH.md](./features/dns-ssl-nginx-ZH.md) | DNS、SSL、Nginx |
| [features/nginx-sites-ZH.md](./features/nginx-sites-ZH.md) | Nginx 站點控制台 |
| [features/apache-ZH.md](./features/apache-ZH.md) | Apache 站點與設定 |
| [features/runtimes-ZH.md](./features/runtimes-ZH.md) | Node／PHP／Python／Go／Rust／Java／Kotlin／Bun |
| [features/vpn-ZH.md](./features/vpn-ZH.md) | VPN 伺服器與客戶端 |
| [features/docker-ZH.md](./features/docker-ZH.md) | Docker 引擎控制面 |
| [features/validators-ZH.md](./features/validators-ZH.md) | L1 驗證者節點 (Beta) |
| [features/vnc-ZH.md](./features/vnc-ZH.md) | VNC 帳戶與分享 |
| [features/security-auth-ZH.md](./features/security-auth-ZH.md) | 登入、2FA、API 金鑰、審計 |
| [features/defense-ZH.md](./features/defense-ZH.md) | 防火牆、fail2ban、防護中心 |
| [features/backups-cron-ZH.md](./features/backups-cron-ZH.md) | 備份與排程 |
| [features/logs-metrics-ZH.md](./features/logs-metrics-ZH.md) | 日誌中心與指標 |
| [features/cdn-agents-ZH.md](./features/cdn-agents-ZH.md) | CDN 與 fleet agent |
| [features/users-rbac-ZH.md](./features/users-rbac-ZH.md) | 用戶、方案、RBAC |
| [features/system-host-ZH.md](./features/system-host-ZH.md) | 主機、網絡、更新、面板 TLS |
| [features/host-browse-ZH.md](./features/host-browse-ZH.md) | Host Browse（僅面板 UI） |
| [features/ai-tools-ZH.md](./features/ai-tools-ZH.md) | 工具、ask、playbook |
| [features/migrate-ZH.md](./features/migrate-ZH.md) | 整機遷移 |

## 運維與安全

| 文件 | 用途 |
|------|------|
| [deploy/root-execute-ZH.md](./deploy/root-execute-ZH.md) | root + `YSK_EXECUTE=1` |
| [deploy/systemd-ZH.md](./deploy/systemd-ZH.md) | 控制平面 unit |
| [deploy/backup-ZH.md](./deploy/backup-ZH.md) | 備份操作 |
| [deploy/real-ops-ZH.md](./deploy/real-ops-ZH.md) | 真實套用與降級 |
| [deploy/isolation-ZH.md](./deploy/isolation-ZH.md) | 專案 OS 隔離 |
| [security/overview-ZH.md](./security/overview-ZH.md) | 安全模型 |
| [security/audit-1.0.8-ZH.md](./security/audit-1.0.8-ZH.md) | 1.0.8 安全審計 |
| [security/2fa-ZH.md](./security/2fa-ZH.md) | 面板與 SSH 2FA |
| [security/ssh-ZH.md](./security/ssh-ZH.md) | SSH 身分 |
| [api/overview-ZH.md](./api/overview-ZH.md) | HTTP API 地圖 |
| [i18n-ZH.md](./i18n-ZH.md) | 13 種語言（zh-HK／zh-CN／en + 全球語言 + RTL）；說明 tab 每語一份 |

## 法律文件

| 文件 | 用途 |
|------|------|
| [legal/README-ZH.md](./legal/README-ZH.md) | 使用條款、私隱政策、免責聲明 — 正式英文 + 香港書面中文 |
| [../LICENSE](../LICENSE) | MIT 原始碼授權 |

## 操作員手冊

| 文件 | 用途 |
|------|------|
| [user-manual/manual-ZH.md](./user-manual/manual-ZH.md) | 操作員手冊 |
| [user-manual/manual.md](./user-manual/manual.md) | Operator handbook (EN) |

## 規格與歷史

| 文件 | 說明 |
|------|------|
| [AI-Secure-Linux-Server-Manager-Spec.md](./AI-Secure-Linux-Server-Manager-Spec.md) | 產品規格（英文全文） |
| [AI-Secure-Linux-Server-Manager-Spec-ZH.md](./AI-Secure-Linux-Server-Manager-Spec-ZH.md) | 規格摘要 |
| [_archive/](./_archive/) | 舊缺口清單、階段筆記、code review |

## 慣例

## 雙語品質

- 英文檔為英文；中文檔（`*-ZH.md`）為書面中文。
- 結構必須對等：相同標題層級、表格與代碼塊數量。
- 檢查：`node scripts/docs-bilingual-check.mjs`



- 正式文件均有 **`-ZH.md`** 中文版本。  
- AI 優先用 **CLI + `--json`**。  
- 主機變更預設 **dry-run**，直至 `--execute` 且 `YSK_EXECUTE=1`（通常需 root）。
- [安全 Phase 0](security/phase-0-review-ZH.md)
- [安全審計 1.0.8](security/audit-1.0.8-ZH.md)
