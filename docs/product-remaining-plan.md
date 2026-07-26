# YSK 未完成清單 + 執行排程

**更新：** 2026-07-26  
**依據：** `product-feature-matrix.md` + `product-gap-backlog.md` + 已合入 `main`/`c855a88` 與本地未推送 Phase 1 補洞  

**規則（不變）**  
- 按鈕 = 實 ops 或 preset 深連結  
- `written` / `applied` / `blocked` 誠實  
- 唔寫競品名／廢話  

---

## A. 已完成（唔再排）

| 區塊 | 已做 |
|------|------|
| 產品契約 | matrix / page-map / backlog |
| Projects | suspend、aliases、force HTTPS/HSTS、建立聯動 DNS/mail |
| DNS | templates、named-checkzone、誠實 written/applied |
| Email | 別名/轉發/catchall、autoreply 旗標、suspend 旗標 |
| Cron | 啟停、立即執行 |
| Backup | 每日排程登記、下載 |
| Auth | 操作員 TOTP 2FA |
| SSL | bindings API（cert↔project/mail）、renewJobs 探測 |
| 基建 | 服務矩陣、DB 控制台、Files trash/share、fail-closed 主幹 |

*註：Email/2FA/Backup/Cron 補洞部分可能仍喺本地 uncommitted — 下一波開波前先 commit。*

---

## B. 未做清單（按優先級）

### Wave 1 — 收完 Phase 1 邊角（P0 缺口）

| # | ID | 項 | 範圍 | 估 | Status |
|---|-----|-----|------|----|--------|
| 1.1 | B18 | 從專案建立 jailed FTP | Project advanced → FTP | M | **done** |
| 1.2 | B20 | 專案 log 加強 | 分檔切換、複製 | S | **done** |
| 1.3 | B22 | PHP 版本 per-site | Project + php-fpm | M | pending |
| 1.4 | B8 | 自訂 document root | network + nginx | M | pending |
| 1.5 | C8 | Email↔DNS 應加紀錄 | copy-all + DNS 入口 | S | **done** |
| 1.6 | F17 | Autodiscover / autoconfig | XML API | M | **done** |
| 1.7 | F18 | 郵件佇列 list + flush | postqueue | M | **done** |
| 1.8 | D9 | Dashboard 證書到期 | 30 日內告警 | S | **done** |
| 1.9 | D5 UI | SSL bindings + renew notes | SSL 頁 | S | **done** |
| 1.10 | L4 | 選擇性還原 full/web/dry-run | restore mode | M | **done** |
| 1.11 | R5 | API access keys | Security 頁 | M | **done** |
| 1.12 | — | Commit + push | git | S | **done** (895f6c4 + this wave) |

### Wave 2 — 體驗拉過兩邊（P1 / Better）

| # | ID | 項 | 範圍 | Status |
|---|-----|-----|------|--------|
| 2.1 | G3/G4/G12 | Files chmod + zip/unzip（搜尋已有） | manager + UI | **done** |
| 2.2 | I4/I5 | DB dump（Adminer 入口後做） | dump API + SqlEngine 按鈕 | **done** (dump) |
| 2.3 | B15–B17 | redirect / HTTP auth / docroot | project network + nginx | **done** |
| 2.4 | E4/E5 | Nginx purge cache | Nginx 頁 | **done** (purge) |
| 2.5 | N3/N4 | Fail2ban ban 列表 + 白名單 | 頁面 | **done** |
| 2.6 | A3/A5 | Dashboard 憑證到期 strip | 已有 + Summary | **done** partial |
| 2.7 | F19 | Email 健檢 UX | 已有 live check | partial |
| 2.8 | P3 | Per-project 用量 | | pending |
| 2.9 | T1 | Hostname / timezone | System 頁 | **done** |
| 2.10 | L10 | Backup dry-run | Wave1 已做 | **done** |
| 2.11 | 全域 | apply 審計 | | pending |

### Wave 3 — 平台級（P2）

| # | ID | 項 |
|---|-----|-----|
| 3.1 | Q1–Q3 | Users + Packages + impersonate |
| 3.2 | L6 | 遠端備份 SFTP/S3 |
| 3.3 | L5/L7 | 排除清單 + 增量（restic 類） |
| 3.4 | C6/C7 | DNSSEC · cluster |
| 3.5 | B21/B9 | 一鍵 App / 多 IP |
| 3.6 | J4/J5 | Composer/WP-CLI · PHP modules |
| 3.7 | T2/T3/T7/T8 | Panel SSL/port · IP · 全域搜尋 · rebuild |
| 3.8 | H6 | SFTP keys |
| 3.9 | D3/D6 | Wildcard LE · panel hostname cert |

### Wave 4 — 差異化加深

| # | 項 |
|---|-----|
| 4.1 | AI/Agents 生產化 |
| 4.2 | CVE 更新流水線打磨 |
| 4.3 | Files 版本 / WebDAV |
| 4.4 | Webmail SSO · sieve/RBL 深度 |
| 4.5 | DB 臨時只讀 user · remote host |

### 明確不做（凍結）

| 項 | 原因 |
|----|------|
| Reseller 層 | 非目標 |
| Web terminal | 安全敏感 |
| UI 競品名 / 空 redirect 工具列 | 產品規則 |

---

## C. 執行排程（按波次）

```
Wave 0  先 commit/push 本地 Phase1 補洞（Email/2FA/Backup/Cron/SSL API）
   ↓
Wave 1  P0 邊角（上表 1.1→1.11）— 每完成 2–3 項可推一次
   ↓
Wave 2  體驗（Files/DB/Nginx/Dashboard/F2B）
   ↓
Wave 3  平台（Users/遠端備份/DNSSEC…）
   ↓
Wave 4  差異化
```

### Wave 1 建議開工順序（本日／下一 session）

1. **Git 落地** — commit 未推送補洞  
2. **D5 UI + D9** — SSL 頁 bindings + Dashboard 到期  
3. **B18** — 專案→FTP  
4. **B20** — log 加強  
5. **C8** — Email DNS 清單共用  
6. **F17 + F18** — autodiscover + mail queue  
7. **L4** — 選擇性還原  
8. **B8 + B22** — docroot + PHP per-site  
9. **R5** — API keys  

---

## D. 完成定義（每項）

- [ ] API + 誠實狀態（唔假 applied）  
- [ ] UI 有實 ops / preset（無空跳）  
- [ ] 單元測試或手動可驗證路徑  
- [ ] 更新本檔 + `product-gap-backlog.md` status  

---

## E. 進度快照（修正）

| 領域 | 約 | 最大剩餘 |
|------|-----|----------|
| Projects | 80% | FTP from project、docroot、PHP per-site、logs |
| DNS | 75% | C8 共用清單、SOA UI |
| Email | 70% | queue、autodiscover、rate-limit 真正生效 |
| SSL | 70% | dashboard 告警 UI、wildcard |
| Backup | 65% | 選擇性還原、遠端 |
| Cron | 85% | 排程產生器 UX |
| Auth | 75% | API keys |
| Files | 75% | chmod/zip |
| DB | 70% | dump/Adminer |
| Users | 5% | Wave 3 |
| AI | 40% | Wave 4 |
