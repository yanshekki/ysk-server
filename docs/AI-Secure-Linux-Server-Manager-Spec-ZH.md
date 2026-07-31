# AI 安全 Linux 伺服器管理器 — 規格摘要（加厚）

> 語言：中文（香港書面語）| [English full spec](./AI-Secure-Linux-Server-Manager-Spec.md)

**定位：** 英文檔是完整規格；本頁是操作員／工程師用的**結構化中文摘要**（非逐字全文翻譯）。

## 1. 產品是什麼

| 是 | 不是 |
|----|------|
| 單機 Linux 控制平面 + 架站面板 + CLI | 多租戶 Reseller SaaS |
| root + `YSK_EXECUTE=1` 時可真實管主機 | 無權限卻回報成功 |
| 誠實可送達性**檢查** | 保證全球郵件 inbox |
| AI 優先 CLI／JSON | 唯一依賴網頁終端機 |

## 2. 架構要點

- **@ysk/shared** — DTO、ops、錯誤、語言包  
- **@ysk/core** — 領域服務 + HostExecutor  
- **apps/server** — HTTP + CLI  
- **apps/web** — 面板  
- **dataDir document store** — json／sqlite／postgres  

詳見 [architecture/overview-ZH.md](./architecture/overview-ZH.md)。

## 3. 能力域（對齊現行文件）

| 域 | 文件 |
|----|------|
| 專案／部署 | [features/projects-ZH.md](./features/projects-ZH.md) |
| 郵件 | [features/email-ZH.md](./features/email-ZH.md) |
| 檔案／FTPS | [features/files-ftp-ZH.md](./features/files-ftp-ZH.md) |
| 資料庫 | [features/databases-ZH.md](./features/databases-ZH.md) |
| DNS／SSL／Nginx | [features/dns-ssl-nginx-ZH.md](./features/dns-ssl-nginx-ZH.md) |
| 執行環境 | [features/runtimes-ZH.md](./features/runtimes-ZH.md) |
| 安全／2FA | [features/security-auth-ZH.md](./features/security-auth-ZH.md) |
| 防護 | [features/defense-ZH.md](./features/defense-ZH.md) |
| 備份／Cron | [features/backups-cron-ZH.md](./features/backups-cron-ZH.md) |
| 日誌／指標 | [features/logs-metrics-ZH.md](./features/logs-metrics-ZH.md) |
| CDN／Agent | [features/cdn-agents-ZH.md](./features/cdn-agents-ZH.md) |
| 用戶／RBAC | [features/users-rbac-ZH.md](./features/users-rbac-ZH.md) |
| 系統 | [features/system-host-ZH.md](./features/system-host-ZH.md) |
| AI 工具 | [features/ai-tools-ZH.md](./features/ai-tools-ZH.md) |
| 遷移 | [features/migrate-ZH.md](./features/migrate-ZH.md) |

## 4. 誠實運維契約

| 狀態 | 含義 |
|------|------|
| dry-run | 只出計劃 |
| written | dataDir 管理檔已寫 |
| applied | 主機命令成功 |
| blocked | 需 EXECUTE／root |

CLI 結束碼：0 成功 · 1 錯誤 · 2 驗證 · 3 阻擋 · 4 找不到 · 5 主機錯誤。  
詳見 [architecture/ops-honesty-ZH.md](./architecture/ops-honesty-ZH.md)。

## 5. 安全最低要求

1. 強管理員密碼 + 面板 2FA  
2. 謹慎對外 listen（建議 loopback + 反代）  
3. 保護 dataDir 權限與備份  
4. RBAC fail-closed；高危工具 allowlist  
5. SSH 2FA 與面板 2FA 分開理解  

## 6. 上線最短路徑

```bash
ysk-server setup --data-dir /var/lib/ysk --locale zh-HK --json
export YSK_EXECUTE=1
ysk-server system unit-install --enable --execute
ysk-server readiness --json
ysk-server projects create … && ysk-server projects deploy … --execute
ysk-server backup schedule --install --execute
```

見 [getting-started/go-live-ZH.md](./getting-started/go-live-ZH.md) · [user-manual/manual-ZH.md](./user-manual/manual-ZH.md)。

## 7. 與英文全文的關係

章節級驗收條款、歷史演進、細項 API 敘述以 **英文 Spec 全文** 為準。本摘要與現行 `docs/features/*` 對齊實作；若衝突，以**程式 + 誠實 ops 結果**為準並回報文件。
