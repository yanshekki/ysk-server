# P0 polish list（對標缺口 + 誠實度收尾）

**用途：** 產品定義 Admin 控制面已齊（見 `product-remaining-plan`），呢份係 **parity / 誠實 / UX polish**，唔係「功能全缺」。  
**更新：** 2026-08-05（部署 typecheck、SQL E2E 清單、runtime arch、i18n residual）

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
| S6 | 真機 E2E switch（有數據） | **partial** | 清單：`docs/product/sql-switch-e2e-checklist.md`；待運維跑通 |
| S7 | Cron UI vs 主機 crontab | **done** | 狀態頁顯示非 YSK 行數；install 合併保留主機非 YSK 行 |
| S8 | 本機 Apache 仍佔 :80 | **ops** | 環境：rebind/stop apache 後起 nginx |

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
| C4 | SOA/TTL/NS 編輯 | **partial** | 記錄級 TTL 有；SOA/NS 全局編輯 |

---

## D. Email

| ID | 項 | Status | 建議 |
|----|-----|--------|------|
| F6–F7 | DKIM/SPF/DMARC 面板完整度 | **done** | 即時檢查 + 失敗修復提示（SPF/DKIM/DMARC/MX） |
| F10 | Antispam per-domain | **partial** | flag 層 |
| F13 | Outbound rate limits | **partial** | flag 層 |
| F20–F22 | Bootstrap honesty · mail SSL · suspend | **partial** | suspend flags 有；mail SSL 深鏈 |

---

## E. SSL

| ID | 項 | Status | 建議 |
|----|-----|--------|------|
| D7 | Mail domain SSL 整合 | **done** | LE deep-link i18n + 套用既有憑證路徑到 Postfix/Dovecot |

---

## F. Auth / 多租戶（刻意後置）

| ID | 項 | Status | 說明 |
|----|-----|--------|------|
| Phase3 | Users / Packages 多租戶 | **P2 / frozen for P0** | 非 Admin-first 阻塞 |
| Reseller | — | **out** | 產品凍結 |

---

## G. 工程債（唔擋功能 P0）

| ID | 項 | Status |
|----|-----|--------|
| Cov | line coverage → 90% | open track |
| Shared DTO | ServiceConsole 單共享 type 跨 web/server | polish |
| installCrontab | 寫入可能覆蓋用戶整份 crontab — 警告文案 | **done** | 合併安裝 + 保留非 YSK 行 + 狀態 UI |

---

## 建議 sprint 順序（若繼續 polish）

1. **S6** 真機 switch 驗收 checklist（半日）  
2. **S7** Cron 誠實：只讀顯示「主機 crontab 有 N 行 / 含 ysk 標記」或 import  
3. **B7–B8** custom docroot  
4. **D7 + F6–F7** mail TLS / DNS 郵件記錄核對  
5. **installCrontab 警告** + coverage track  

---

## 完成度粗估（P0 polish 本身）

| 子集 | 完成 |
|------|------|
| A 今輪主線碼 | **~95–100%**（差真機 S6 / 環境 S8） |
| B–E matrix partial | **~60–70%** 已有能力，差收口 |
| F 多租戶 | **0%（刻意不做 P0）** |
| 整體「P0 polish 清單收口」 | **約 85%**；若只計 Admin 已交付功能則 **~93%+** |
