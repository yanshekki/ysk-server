# YSK 未完成清單 + 執行排程

**更新：** 2026-07-26（Wave 0–4 已推 `main` @ `09f0a72`）  
**依據：** matrix / gap-backlog / 實 code 核實  

**規則（不變）**  
- 按鈕 = 實 ops 或 preset 深連結  
- `written` / `applied` / `blocked` 誠實  
- 唔寫競品名／廢話  

---

## A. 已完成（唔再排）

| 波次 | 內容 |
|------|------|
| Wave 0–1 | Email 別名/2FA/backup 下載排程/cron run-now、專案 FTP、logs、SSL bindings、autodiscover、queue、API keys… |
| Wave 2 | Files chmod/zip、fail2ban、site redirect/auth、host identity、dump、nginx purge… |
| Wave 3 | Users/Packages/impersonate、遠端備份/排除、DNSSEC、搜尋、SFTP keys、host IP、runtime tools、wildcard LE |
| Wave 4 | AI playbooks 監督、CVE apply+OSV、file versions+WebDAV、webmail SSO token、sieve、multi-IP RBL、temp RO DB、remote hosts |

### 部分已有 UI/API（唔當未開始）

| ID | 狀態 |
|----|------|
| B8 docroot | Network 頁有欄位 + API patch；需確認 nginx publish 全路徑用 `doc_root` |
| B21 WordPress | `downloadWordpressCore` + templates 已有；專案 UI 一鍵體驗未打磨 |
| L4/L6 | 選擇性還原 + SFTP/local 遠端 **done**；S3 / restic 未做 |
| F9 SSO | 面板簽 token **done**；Roundcube 外掛真 SSO 未接 |

---

## B. 未做清單（核實後）

### Wave 5 — 收 P0/P1 剩餘邊角（優先）

| # | ID | 項 | 估 | Status |
|---|-----|-----|----|--------|
| 5.1 | B22 | PHP per-site 版本 + FPM pool | M | **done** Deploy 選版本 + deploy-php/FPM |
| 5.2 | B8 | docroot 端到端 | S | **done** `resolveProjectDocRoot` 用於 static/php |
| 5.3 | P3 | Per-project 用量 strip | M | **done** Overview + `/usage` |
| 5.4 | — | Apply 路徑抽樣審計 | M | **partial** docroot/php/FPM/adminer/rebuild 誠實 |
| 5.5 | F19 | Email 健檢 UX | S | **done** SummaryStrip + 外部 todos |
| 5.6 | I5 | Adminer 入口 | M | **done** download + managed nginx plan |
| 5.7 | B21 | 一鍵 App UI | M | **done**（Advanced WP 已有；Deploy 強化 PHP） |
| 5.8 | T8 | Config export / rebuild | M | **done** export + rebuild nginx 選項 |

### Wave 6 — 平台加深（可後做）

| # | ID | 項 | 說明 |
|---|-----|-----|------|
| 6.1 | L7 | restic 類增量備份 | 本地 restic repo + 誠實 notes |
| 6.2 | L6 | 遠端 S3 | 在 SFTP 後；需 credentials |
| 6.3 | C7 | DNS cluster | 多機 sync（可選） |
| 6.4 | B9 | 專案 bind multi-IP | vhost listen 選 IP |
| 6.5 | C4 | SOA/NS UI | zone 級編輯 |
| 6.6 | B19 | Web stats | AWStats-class 或簡化 access 統計 |
| 6.7 | F13/F10 | 出站 rate / antispam 真生效 | 而家多為旗標 |
| 6.8 | I4 | DB import | dump 已有，import SQL |
| 6.9 | — | 臨時 RO user 到期 auto DROP | Wave4 只登記撤銷 |
| 6.10 | F9+ | Roundcube 真 SSO 外掛 | 接 panel token |

### 明確不做（凍結）

| 項 | 原因 |
|----|------|
| Reseller 層 | 非目標 |
| Web terminal | 安全敏感 |
| UI 競品名 / 空 redirect | 產品規則 |

---

## C. 執行排程

```
Wave 5.1  B22 PHP per-site
   ↓
Wave 5.2  B8 docroot 核實
   ↓
Wave 5.3  P3 專案用量
   ↓
Wave 5.4  Apply 抽樣審計（修洞）
   ↓
Wave 5.5  F19 Email 健檢 UX
   ↓
Wave 5.6  I5 Adminer 入口
   ↓
Wave 5.7  B21 一鍵 App UI
   ↓
Wave 5.8  T8 rebuild/export
   ↓
Wave 6    增量 / S3 / cluster / …（按需）
```

### 完成定義（每項）

- [ ] API + 誠實狀態  
- [ ] UI 有實 ops / preset  
- [ ] 可驗證路徑  
- [ ] 更新本檔 status  

---

## D. 領域進度（2026-07-26）

| 領域 | 約 | 最大剩餘 |
|------|-----|----------|
| Projects | 85% | PHP per-site、用量、一鍵 App UI |
| DNS | 85% | SOA UI、cluster |
| Email | 85% | rate/antispam 真生效、Roundcube SSO |
| SSL | 90% | — |
| Backup | 80% | restic、S3 |
| Files | 90% | — |
| DB | 85% | Adminer、import、auto DROP |
| Users | 90% | 配額 enforce 運行時 |
| AI | 75% | 更深 agent fleet |
| System | 85% | rebuild/export |
| Auth | 90% | — |
`