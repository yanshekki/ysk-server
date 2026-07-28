# YSK 產品完成度 — 定義結案 + 後續債

**更新：** 2026-07-28  

**產品定義完成（100%）**＝當初劃定之 Admin 控制面功能集已齊（不含凍結項）。  
**唔等於** Hestia 全量。後續增量：多 runtime、Linux user 隔離、API key 真認證、公開 Autoconfig、佇列 UI 等見 git log。

---

## 凍結（唔做 = 唔計欠債）

| 項 | 原因 |
|----|------|
| Reseller 層 | 非目標 |
| Web terminal | 安全敏感 |
| UI 競品名 / 空 redirect | 產品規則 |

---

## 本輪（Wave 100）收尾

| 項 | Status |
|----|--------|
| 磁碟配額 Deploy 硬擋 | **done** `assertWithinQuota` |
| 方案 max_projects/mail/db | **done** `package-limits` |
| Roundcube 真 SSO auto-login | **done** token+password → plugin login() |
| 一鍵建立 wizard | **done** `/api/v1/wizard/create` + Dashboard |
| 服務健康 strip | **done** service matrix on Dashboard |
| Web 日統計 | **done** rolling 60 日 |
| AI 生產 playbooks 加碼 | **done** backup/db/ssl checks |
| Apply 誠實 | **done**（Wave 9 + publishNginx） |

---

## 領域完成度（產品定義）

| 領域 | % |
|------|---|
| Dashboard | 100% |
| Projects | 100% |
| DNS / SSL | 100% |
| Email | 100%* |
| Files / FTP | 100% |
| DB | 100% |
| Backup | 100% |
| Security / Users / Auth | 100% |
| System / Updates | 100% |
| AI / Agents | 100%† |

\* Roundcube 自動登入需簽發時附信箱密碼 + 外掛 symlink。  
† Playbook/監督齊全；AI 能力隨模型成長，唔再列功能欠債。

---

## 規則（不變）

- 按鈕 = 實 ops 或 preset  
- `written` / `applied` / `blocked` 誠實  
- 唔寫競品名  
`