# P0 polish list（對標缺口 + 誠實度收尾）

**用途：** 產品定義 Admin 控制面已齊（見 `product-remaining-plan`），呢份係 **parity / 誠實 / UX polish**，唔係「功能全缺」。  
**更新：** 2026-08-05（**P0 100%** — Cov / S6 live data path / Shared DTO / 多用戶套餐基礎）

圖例：`open` = 未收尾 · `partial` = 有但未滿 · `done` = 可當 P0 過。

---

## A. 今輪主線（install / probe / SQL）— 優先收口

| ID | 項 | Status | 說明 |
|----|-----|--------|------|
| S1 | HostSoftwareProbe SSOT | **done** | 全產品 presence/version |
| S2 | install plan/bundle + uninstall keep/purge | **done** | |
| S3 | Nginx edge + Apache backend 8080 | **done** | install rebind |
| S4 | MySQL XOR MariaDB switch + migrate | **done** | dialog + dump/import |
| S5 | unit `activating` 假失敗 | **done** | `waitUnitActive` |
| S6 | 真機 E2E switch（有數據） | **done** | 碼門禁 `pnpm e2e:sql-switch` + **Docker live 資料路徑** `pnpm e2e:sql-switch-live`（MySQL→dump→MariaDB 驗證 row）；本機 apt 互斥仍可用 checklist + root |
| S7 | Cron UI vs 主機 crontab | **done** | 狀態頁顯示非 YSK 行數；install 合併保留主機非 YSK 行 |
| S8 | 本機 Apache 仍佔 :80 | **done** | 就緒探測偵測 Apache 佔 :80；修復提示綁 127.0.0.1:8080 |

---

## B. Projects（matrix partial）

| ID | 項 | Status | 建議 |
|----|-----|--------|------|
| B7–B8 | Rename domain / custom docroot | **done** | domain 衝突／格式校驗；docroot 安全相對路徑；network tab 一級 UI |
| B20 | Access/error log viewer polish | **done** | access/error 預設篩選 + 日誌中心／nginx unit 深鏈 |

---

## C. DNS

| ID | 項 | Status | 建議 |
|----|-----|--------|------|
| C4 | SOA/TTL/NS 編輯 | **done** | 區級 NS/NS2/hostmaster/TTL + SOA refresh/retry/expire/minimum 可存可寫 zone |

---

## D. Email

| ID | 項 | Status | 建議 |
|----|-----|--------|------|
| F6–F7 | DKIM/SPF/DMARC 面板完整度 | **done** | 即時檢查 + 失敗修復提示（SPF/DKIM/DMARC/MX） |
| F10 | Antispam per-domain | **done** | 控制面 + 套用系統誠實提示；mail-policy 映射 |
| F13 | Outbound rate limits | **done** | 每小時外寄限額 UI + applySystem 提示 |
| F20–F22 | Bootstrap honesty · mail SSL · suspend | **done** | bootstrap 誠實說明 + TLS 後續步驟；suspend apply/written；mail SSL 套用 |

---

## E. SSL

| ID | 項 | Status | 建議 |
|----|-----|--------|------|
| D7 | Mail domain SSL 整合 | **done** | LE deep-link i18n + 套用既有憑證路徑到 Postfix/Dovecot |

---

## F. Auth / 多租戶

| ID | 項 | Status | 說明 |
|----|-----|--------|------|
| Phase3 | Users / Packages 多用戶套餐 | **done**（Admin 基礎） | `UsersAdminService` + `UsersPage` + package 配額（`package-limits` 按 owner）+ impersonate；**非**全 isolation SaaS |
| Reseller | — | **out** | 產品凍結（非 P0） |

---

## G. 工程債

| ID | 項 | Status |
|----|-----|--------|
| Cov | line coverage → 90% | **done**（lines/statements **≥90.5%**；functions ~97%；branch ~79.6% 達門檻 79） |
| Shared DTO | ServiceConsole 單共享 type 跨 web/server | **done**（`@ysk-server/shared` `ServiceConsoleDto`） |
| installCrontab | 寫入可能覆蓋用戶整份 crontab — 警告文案 | **done** | 合併安裝 + 保留非 YSK 行 + 狀態 UI |

---

## 驗收指令

```bash
pnpm --filter @ysk-server/core test:coverage   # Cov
pnpm e2e:sql-switch                     # S6 碼門禁
pnpm e2e:sql-switch-live                # S6 Docker 有數據 dump/import
```

---

## 完成度

| 子集 | 完成 |
|------|------|
| A–E 功能 polish | **100%** |
| G 工程債 | **100%** |
| F Admin 多用戶 | **100%**（Reseller out） |
| **整體 P0 polish 清單** | **100%** |
