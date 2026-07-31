# AI Secure Linux Server Manager — 完整需求與設計規格

> Language: English | [中文摘要](./AI-Secure-Linux-Server-Manager-Spec-ZH.md)

**版本**: 0.9 (Draft)  
**日期**: 2026-07-23  
**狀態**: 需求收集完成，準備進入專業架構開發  
**目標**: 作為 Grok Build / 開發團隊的唯一權威規格文件

---


---

## 0. 正式命名（已確認）

| 項目 | 名稱 |
|------|------|
| **產品名稱** | YSK Server |
| **CLI 指令** | `ysk-server` |
| **GitHub 倉庫** | https://github.com/yanshekki/ysk-server |
| **npm 套件** | https://www.npmjs.com/package/ysk-server |
| **npm 包名** | `ysk-server` |
| **一鍵安裝腳本** | `curl -fsSL https://raw.githubusercontent.com/yanshekki/ysk-server/main/install.sh \| bash` |
| **設定指令** | `ysk-server setup` |
| **更新指令** | `ysk-server update` |

之後所有文件、程式碼、CLI help、網頁標題都統一使用以上命名。

## 1. 專案願景與目標

### 1.1 願景
開發一套**以 AI 為核心、安全優先**的 Linux Server 管理平台，同時具備**完整 Web Hosting Control Panel** 能力。

核心支援：
- 自然語言操作 + 多層硬性安全約束
- 本地私有 LLM + 所有 OpenAI-compatible API
- 遠端 Fleet 管理
- 管理主流 AI Agent 運行時（OpenClaw、Hermes、IonClaw 等）
- 網絡中斷 / DDoS 情況下仍能自動保護與運作
- 完整 Web 管理介面 + AI Agent 友好 CLI
- 多語言支援（優先繁體中文）
- **完整 Web Hosting 功能**（Node.js / PHP / Database / File / SSL / DNS / Firewall / Proxy 等）
- **智能軟件更新與漏洞管理**（每日 LLM 分析 + 自動/確認更新）
- **專業 Email Server 一鍵建立**（含完整反 Spam 與外部設定指引）

### 1.2 核心原則
1. **LLM 被視為完全不信任組件**（Untrusted LLM）
2. **安全優先於便利**（Defense-in-Depth）
3. **Local-First + Graceful Degradation**
4. **人類最終決策權**（Human-in-the-loop for high-risk actions）
5. **可審計、可回滾、可權限分工**
6. **Project 級隔離**（每個網站/項目使用獨立 Linux 用戶運行）
7. **專業可維護架構**（高度模組化、可測試、可擴展）

---

## 2. 技術棧與開發架構要求（強制）

### 2.1 強制技術棧
- **後端 / 控制平面 / CLI / Agent**：Node.js + TypeScript
- **前端 Web UI**：React.js + TypeScript
- **全棧 TypeScript**，禁止混用其他主要語言（除非極特殊情況並經批准）
- 套件管理：pnpm 或 npm（建議 pnpm）
- 建構工具：tsup / unbuild / esbuild 等現代工具
- 測試：Vitest 或 Jest（必須支援 TypeScript）
- 文件：Typedoc + 自建 Markdown

### 2.2 專業分層架構（必須嚴格遵守）
專案必須高度模組化，建議目錄與職責如下（可再細分）：

```
src/
├── interfaces/          # 所有介面定義（Interface）
├── types/               # 共用型別、Enum、Utility Types
├── dto/                 # Data Transfer Objects（請求/回應結構）
├── entities/            # 領域實體（Domain Entities）
├── repositories/        # 資料存取層
├── services/            # 業務邏輯服務層
├── controllers/         # HTTP / API 控制器
├── cli/                 # CLI 命令與處理邏輯
├── agents/              # 遠端 Agent 相關邏輯
├── skills/              # AI Skill 定義與執行
├── security/            # 權限、Allowlist、Sandbox、RBAC
├── hosting/             # Web Hosting 相關模組（Project、PHP、Node、DB 等）
├── llm/                 # LLM Gateway、Provider、Tool Calling
├── update/              # 智能更新與漏洞分析模組
├── errors/              # 統一錯誤類型與處理
├── utils/               # 純工具函數
├── config/              # 配置載入與驗證
├── middlewares/         # Express/Fastify 中介層
└── tests/               # 或與原始碼同層的 *.test.ts
```

**額外強制要求**：
- 每個資料夾職責單一、清晰
- 依賴方向必須正確（Controller → Service → Repository）
- 禁止循環依賴
- 大量使用 Interface 與 Dependency Injection
- 錯誤處理必須統一（自訂 Error Class + 錯誤碼）
- 所有公開函數必須有完整 JSDoc / TSDoc

### 2.3 一鍵安裝與更新

#### A. 最終正式安裝方式（有 Node.js 環境後）
- 支援以 `npm install -g @ysk/server`（或最終包名）方式全域安裝
- 安裝後提供 `ysk-server setup` 一鍵初始化整個控制平面與必要依賴

#### B. 全新 Ubuntu Server 快速引導安裝（無 Node.js 時）
- **必須提供官方 `install.sh` 腳本**，支援以下一鍵安裝方式：
  ```bash
  curl -fsSL https://get.ysk.hk/server-manager | bash
  ```
  或
  ```bash
  curl -fsSL https://raw.githubusercontent.com/.../install.sh | bash
  ```
- `install.sh` 必須具備以下能力：
  - 檢測作業系統（優先完美支援 Ubuntu 22.04 / 24.04）
  - 自動安裝 Node.js（使用 NodeSource 或 fnm / nvm 等可靠方式，安裝 LTS 版本）
  - 自動安裝必要系統依賴（build-essential、curl、git 等）
  - 安裝本軟體（全域）
  - 可選擇立即執行 `ysk-server setup`
  - 清晰的進度提示與錯誤處理
  - 支援非互動模式（適合腳本化部署）
  - 安裝完成後顯示後續步驟與文件連結
- 腳本必須安全：使用 `set -euo pipefail`、驗證下載內容（checksum / signature 更佳）、避免危險操作

#### C. 自我更新功能
- **必須有完整的一鍵自我更新功能**（`ysk-server update`）
  - 檢查最新版本
  - 下載、驗證、替換 binary / 檔案
  - 資料庫 migration 自動處理
  - 回滾機制
  - 更新過程完整日誌與審計
- 更新機制本身也應可透過 `install.sh` 的升級模式觸發


### 2.5 Frontend 專業架構要求（與 Backend 同等嚴格）

Frontend（`apps/web`）必須同樣採用高度模組化、可維護的專業架構，不能只是普通的 React 堆砌。

#### 推薦目錄結構（Feature-Sliced + Layered）

```text
apps/web/src/
├── app/                       # 應用入口、Providers、Router、全域樣式
│   ├── providers/
│   ├── router/
│   └── styles/
│
├── pages/                     # 路由頁面（只負責組合，盡量薄）
│
├── features/                  # 按業務功能拆分（核心）
│   ├── auth/
│   ├── servers/
│   ├── projects/
│   ├── hosting/
│   ├── email/
│   ├── agents/
│   ├── security/
│   ├── updates/
│   ├── llm/
│   └── dashboard/
│
├── entities/                  # 業務實體相關（可選，較複雜時使用）
│
├── shared/                    # 跨功能共用
│   ├── components/            # 可重用 UI 元件（Button、Table、Modal...）
│   ├── hooks/                 # 共用自訂 Hooks
│   ├── services/              # API 呼叫層（對應 Backend 的 services）
│   ├── types/                 # 前端專用型別
│   ├── interfaces/            # 前端介面定義
│   ├── utils/
│   ├── constants/
│   ├── lib/                   # 第三方封裝（axios/fetch instance、i18n...）
│   ├── stores/                # 全域狀態（Zustand / Jotai 等）
│   └── errors/                # 前端錯誤處理
│
└── widgets/                   # 複雜組合元件（可選）
```

#### Frontend 分層原則（必須遵守）

| 層級 | 職責 | 說明 |
|------|------|------|
| **pages/** | 路由入口 | 只負責組合 features，本身幾乎無邏輯 |
| **features/** | 業務功能 | 每個功能獨立，包含自己的 components、hooks、api 呼叫 |
| **shared/services/** | API 通訊層 | 所有對 Backend 的請求都集中在這裡，對應 DTO |
| **shared/types & interfaces/** | 型別定義 | 與 Backend shared 套件對齊，避免重複 |
| **shared/components/** | 純 UI 元件 | 無業務邏輯，可高度重用 |
| **shared/hooks/** | 邏輯重用 | 資料獲取、權限判斷、表單等 |
| **shared/stores/** | 狀態管理 | 全域狀態（用戶資訊、主題、權限等） |

#### 額外強制要求
- 所有 API 呼叫必須經過 `shared/services`，禁止在 component 直接寫 fetch/axios
- 大量使用 TypeScript 嚴格型別，與 Backend 的 DTO / Interfaces 保持同步（透過 `packages/shared`）
- 錯誤處理統一（API 錯誤、權限錯誤、網路錯誤）
- 支援多語言（next-intl 或 react-i18next）
- 元件必須可測試（重要邏輯要有 unit test）
- 權限控制在前端也要做（但真正安全仍以後端為準）
- 清晰的 Loading / Empty / Error 狀態處理

#### 狀態管理建議
- 伺服器狀態：TanStack Query (React Query)
- 客戶端全域狀態：Zustand 或 Jotai
- 表單：React Hook Form + Zod


### 2.4 測試要求（強制）
- **每一個 function、每一個檔案都必須有對應的 Unit Test**
- 測試覆蓋率目標：核心業務邏輯 ≥ 90%，整體 ≥ 80%
- 使用 Vitest 或 Jest
- 重要流程需有 Integration Test
- CI 必須跑完整測試，測試失敗禁止合併

---

## 3. 功能需求總覽

### 3.1 核心 AI 管理能力
- 自然語言下達任務
- 多步驟規劃（Plan → Review → Execute）
- Tool Calling 執行實際指令
- 根因分析（RCA）
- 常見問題自動修復 Playbook
- 生成 Ansible / 腳本 / 配置建議
- 預測性監控與異常偵測

### 3.2 安全管理與約束
多層硬性限制（Code 層強制 Allowlist + 預設 Read-only + Human Approval + Kernel Sandbox 等）

### 3.3 權限分工（RBAC）
三維模型：用戶角色 + 資源範圍（Server / Project）+ 操作等級（Read / Write-Low / Write-High / Destructive / Privilege）

### 3.4 遠端管理與 Fleet
Outbound Agent、一鍵安裝、分組、批量操作、實時狀態

### 3.5 AI Agent 運行時管理
OpenClaw、Hermes、IonClaw 等遠端安裝、配置、監控、監督

### 3.6 LLM 整合
完整支援所有 OpenAI-compatible API（透過 LiteLLM 或自建統一層）

### 3.7 網絡中斷 / DDoS 韌性
自動保護模式 + 本地 LLM + 緊急 Playbook

### 3.8 CLI（AI Agent 友好）
結構化輸出、schema 發現、Dry-run、完整權限控制

### 3.9 Web 管理介面
現代化 Dashboard + Hosting 管理 + 審批隊列 + 多語言

### 3.10 多語言
Web UI 與所有文件支援繁中（優先）、英文、簡中

---

## 4. Web Hosting 完整功能需求

### 4.1 Project / Site 管理
- 每個 Project 使用**獨立 Linux 用戶與群組**運行
- 域名綁定、資源限制、Staging/Production、Git 部署

### 4.2 Node.js Hosting
- 多版本 Node.js（不同 Project 可選不同版本）
- PM2 / systemd 管理
- 環境變數、自動重啟、可選 Serverless 風格

### 4.3 PHP Hosting
- Apache 運作
- 多版本 PHP（不同 Project 可選不同版本）
- 獨立 pool / VirtualHost、php.ini 覆蓋

### 4.4 資料庫
- MySQL/MariaDB 多 Database + 多 User + 精細權限
- Redis 多實例 / 多 DB

### 4.5 檔案管理與公用 File Server
- Project 獨立目錄 + 公用 File Server（提供 API 給不同 Project）
- FTPS、Web 檔案管理器、配額

### 4.6 SSL
- Let’s Encrypt 自動簽發與續期
- 用戶自行上傳憑證
- Cloudflare 相容

### 4.7 Nginx Reverse Proxy
- 代理到 Project 或其他服務
- 完整支援 Cloudflare（真實 IP、Proxy 模式等）

### 4.8 DNS Server
- 內建或強力整合（PowerDNS / Cloudflare API）

### 4.9 Firewall 管理
- 系統級 + Project 級規則、fail2ban 整合

### 4.10 其他
- Cron、日誌、備份、資源監控、環境變數、一鍵應用安裝等

---


---

## 5. 專業 Email Server 快速建立功能（新增）

系統必須提供**一鍵 / 引導式快速建立專業 Email Server** 的能力，並把「如何避免被當成 Spam」的完整知識與檢查流程內建。

### 5.1 核心目標
- 快速部署可用的專業郵件伺服器（收發信）
- 盡最大努力提高郵件到達率（Deliverability）
- **清楚告知用戶「Server 以外必須自己處理的事項」**
- 提供自動化檢查與修復建議

### 5.2 建議技術堆疊（可配置）
- **MTA**：Postfix
- **IMAP/POP3**：Dovecot
- **反垃圾**：Rspamd（推薦）或 SpamAssassin
- **DKIM 簽署**：OpenDKIM
- **DMARC 報告**：OpenDMARC 或同等
- **Webmail**（可選）：SnappyMail 或 Roundcube
- **憑證**：Let’s Encrypt（SMTP/IMAP 端口）
- 資料儲存：系統用戶家目錄或獨立 vmail 用戶

### 5.3 系統可自動完成的部分
- 安裝與基本安全配置 Postfix + Dovecot
- 建立郵件用戶（與系統 Linux 用戶或虛擬用戶整合）
- 自動產生 DKIM 金鑰對
- 配置 OpenDKIM / DMARC
- 設定正確的 myhostname、myorigin、TLS
- 基本速率限制、連線限制
- 防火牆開放必要端口（25, 587, 465, 993, 995 等，可配置）
- 產生完整的 DNS 記錄建議清單
- 定期檢查本機郵件佇列與日誌
- 提供測試發送功能

### 5.4 必須清楚告知用戶「Server 以外要處理的事項」（極重要）

系統必須在設定過程與儀表板中，用醒目方式列出並檢查以下項目：

#### A. DNS 記錄（用戶必須在域名 DNS 服務商新增）
系統會自動產生並顯示需要新增的記錄，並提供「一鍵複製」：

| 記錄類型 | 名稱/主機 | 內容說明 | 重要性 |
|----------|-----------|----------|--------|
| MX | @ | 指向郵件伺服器主機名 | 必須 |
| TXT (SPF) | @ | `v=spf1 mx a ip4:伺服器IP ~all` 或更嚴格 | 必須 |
| TXT (DKIM) | `default._domainkey` | 系統產生的公鑰 | 必須 |
| TXT (DMARC) | `_dmarc` | `v=DMARC1; p=none/quarantine/reject; rua=mailto:...` | 強烈建議 |
| A/AAAA | mail（或選用主機名） | 指向伺服器 IP | 必須 |

另外可選但建議：
- BIMI 記錄
- MTA-STS
- TLS-RPT

**注意**：如果域名使用 Cloudflare，MX 相關記錄通常需要設定為「DNS only」（灰色雲），否則可能有問題。

#### B. Reverse DNS（PTR Record）— 最容易被忽略但極關鍵
- PTR 必須由**IP 擁有者**（VPS / 雲端供應商）設定
- PTR 主機名應該與 Postfix 的 HELO/EHLO 名稱一致
- 系統必須檢測目前 PTR 是否正確，並明確告訴用戶「請到你的 VPS 控制台 / 向供應商申請設定 PTR」
- 許多供應商（AWS、GCP、部分 VPS）預設沒有可用的 PTR，或需要工單申請

#### C. 出站 Port 25 限制
- 很多雲端供應商預設封鎖出站 TCP 25
- 系統應檢測能否連線到外部 25 端口
- 若被封鎖，清楚告知用戶需要：
  1. 向供應商申請解除 Port 25 封鎖，或
  2. 使用外部 SMTP Relay（系統可支援設定 Relay）

#### D. IP 與域名聲譽（Reputation）
- 新 IP / 新域名不應一開始就大量發信
- 建議用戶監控黑名單（Spamhaus、Barracuda、MSRBL 等）
- 系統可定期檢查主要黑名單狀態並顯示
- 建議「暖機」（Warm-up）策略提示

#### E. 其他外部注意事項
- 不要使用被濫用過的 IP 段
- 域名註冊時間太短時提高風險
- 正確設定 From / Return-Path 一致性
- 避免購買「便宜郵件伺服器」IP

### 5.5 系統提供的檢查與引導功能
- **DNS 健康檢查**：自動查詢目前 SPF、DKIM、DMARC、MX、PTR 狀態，顯示通過/失敗 + 修復指令
- **一鍵產生所有需要的 DNS 記錄**（可複製）
- **發送測試信**並分析是否進入垃圾郵件夾的建議
- **黑名單檢查**
- **設定完成度評分**（例如目前 70/100，缺少 PTR 與 DMARC）
- 清晰的「外部待辦事項」清單，讓用戶知道還有哪些事情必須自己去域名商與 VPS 商處理

### 5.6 與整體系統的整合
- Email 設定同樣受到 RBAC 與 Approval 機制約束
- 郵件相關操作記錄進 Audit Log
- 可納入每日智能更新檢查（Postfix、Dovecot、Rspamd 等）
- 支援多域名、多郵箱
- 與現有 Project / 用戶系統可選擇整合或獨立

### 5.7 文件要求
必須有獨立且清晰的文件章節，用繁體中文詳細說明：
- 為什麼需要這些外部設定
- 每一步在不同常見服務商（Cloudflare、Namecheap、阿里雲、AWS Route53、VPS 商）的操作提示
- 常見問題（信進垃圾箱、被拒信、Port 25 問題等）


## 6. 智能軟件更新與漏洞管理（新增重點）

### 5.1 每日自動檢查
- 系統每日排程檢查受管理 Server 上所有已安裝軟件（系統套件 + 常用服務）
- 收集目前版本資訊

### 5.2 LLM 分析是否應該更新
- 使用 LLM 分析：
  - 新版本變更內容（Changelog）
  - 是否包含重要安全修復
  - 是否有已知破壞性變更（Breaking Changes）
  - 與當前環境的相容性風險
- 輸出結構化建議（建議更新 / 觀望 / 緊急更新）

### 5.3 自由上網查最新漏洞
- 系統可主動查詢公開漏洞資料來源（NVD、GitHub Advisory、發行版安全公告、相關 CVE 資料庫等）
- 結合 LLM 判斷漏洞嚴重程度與是否影響當前安裝版本
- 結果記錄並可生成報告

### 5.4 更新執行策略
- **自動更新**：低風險、有明確安全修復、已測試過的更新可設定自動執行
- **需用戶確認**：中高風險或可能影響服務的更新，進入 Approval Queue，通知用戶確認後才執行
- 所有更新過程完整記錄（前版本、後版本、執行結果、回滾資訊）
- 支援一鍵回滾

### 5.5 與安全系統整合
- 更新操作同樣受到 Allowlist、權限、Approval 機制約束
- 緊急漏洞可觸發更高優先級通知與保護模式建議

---

## 7. 技術棧總表

| 層級 | 技術 | 備註 |
|------|------|------|
| 前端 | React.js + TypeScript | 強制 |
| 後端 / CLI / Agent | Node.js + TypeScript | 強制 |
| 測試 | Vitest 或 Jest | 每個 function 都要有 unit test |
| LLM Gateway | LiteLLM 或自建 OpenAI-compatible 層 | |
| 資料庫 | PostgreSQL + Redis | |
| Web Server | Nginx + Apache | Hosting 用 |
| 套件發佈 | npm 全域套件 | 支援 npm install -g + 一鍵 setup / update |
| 文件 | Docusaurus + Typedoc | 多語言 |

---

## 8. 開發優先級建議

### Phase 1 – 專業架構骨架 + MVP
- 完整 TypeScript 專案結構（interfaces, dto, services, controllers, errors, cli...）
- 單元測試框架與強制覆蓋
- 基本 Web UI（React）+ 認證
- 遠端 Agent 通訊
- 硬性 Allowlist + Approval 流程
- OpenAI-compatible LLM 支援
- 基本 CLI
- 一鍵 setup 骨架
- 繁中 + 英文

### Phase 2 – Hosting 核心 + 安全強化
- Project 隔離（獨立 Linux 用戶）
- Node.js 多版本 + PHP 多版本
- MySQL + Redis
- Nginx Proxy + Let’s Encrypt
- Kernel Sandbox、完整 RBAC
- Offline / Protection Mode

### Phase 3 – 完整 Hosting + 智能更新 + Agent 生態
- 公用 File Server + FTPS + DNS + Firewall
- 智能軟件更新與漏洞分析系統（每日 LLM 檢查）
- OpenClaw / Hermes / IonClaw 管理
- 完整一鍵自我更新
- 高覆蓋率測試與文件

---

## 9. 文件與交付物要求

- 本規格文件（持續更新）
- 完整 API 文件
- CLI Reference（多語言）
- 架構設計文件（說明每一層職責）
- 用戶使用手冊（多語言）
- 安全架構說明
- 部署與一鍵安裝 / 更新指南
- AI Agent 使用指南
- 測試報告與覆蓋率

---

## 10. 後續行動

1. 確認本規格（特別是技術棧、架構分層、測試要求、智能更新）
2. 設計詳細資料模型與資料庫 Schema
3. 設計核心 API 與 CLI 命令清單
4. 建立專案骨架（符合上述分層 + 測試）
5. 實作一鍵 setup 與自我更新機制
6. 開始 Phase 1 開發

---

**本文件為開發權威來源。任何重大變更需更新此文件並記錄版本。**

*Version 0.4 — 加入強制 Node.js + React + TypeScript 專業架構、完整單元測試要求、npm 全域一鍵安裝/更新、以及智能軟件更新與漏洞管理系統。*
