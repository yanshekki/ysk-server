# YSK 產品完成度 — 定義結案 + 後續債

**更新：** 2026-07-28（Log Center + Defense + core tests 全綠）

**產品定義完成（100%）**＝當初劃定之 Admin 控制面功能集已齊（不含凍結項）。  
**唔等於** Hestia 全量 · **唔等於** line coverage ≥90%。

**驗收：**

```bash
pnpm --filter ysk-server-core exec vitest run   # 253 tests pass
ysk-server readiness --data-dir … --json
```

---

## 凍結（唔做 = 唔計欠債）

| 項 | 原因 |
|----|------|
| Reseller 層 | 非目標 |
| Web terminal | 安全敏感 |
| UI 競品名 / 空 redirect | 產品規則 |
| 任意路徑讀全碟 log / ELK | 安全邊界 |
| Defense multi-host fleet | 單機 scope |

---

## 本輪收尾（含 2026-07-28）

| 項 | Status |
|----|--------|
| 磁碟配額 Deploy 硬擋 | **done** |
| 方案 max_projects/mail/db | **done** |
| Roundcube 真 SSO | **done** |
| 一鍵 wizard + Dashboard | **done** |
| 通知中心 | **done** |
| **防護中心**（自動化／CF／誠實 apply） | **done** |
| **日誌中心**（journal／allowlist／書籤／SSE／vacuum） | **done** |
| Apply 誠實 written≠applied | **done** |
| **ysk-server-core 測試全綠（中文化訊息）** | **done** 253/253 |

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
| Security / Auth / Approvals | 100% |
| Firewall / F2B / Defense | 100% |
| Log Center | 100% |
| System / Updates | 100% |
| AI / Agents | 100%† |

\* Roundcube SSO 需密碼 + 外掛；國際 deliverability 永遠外部。  
† Playbook 齊；vendor fleet installers 唔計。

---

## 工程債（唔阻擋功能 100%）

| 項 | 說明 |
|----|------|
| Line coverage → 90% | 大量 0% 模組（users-admin、部分 DB engines…）；另開 track |
| Phase 3 platform | Users/Packages 多租戶、商業套餐 — 新產品線 |

---

## 規則（不變）

- 按鈕 = 實 ops 或 preset  
- `written` / `applied` / `blocked` 誠實  
- 唔寫競品名  
`