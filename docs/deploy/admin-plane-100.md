# Admin 控制面 — in-scope 100%

> Language: English | [中文](./admin-plane-100-ZH.md)

**定義：** 單機伺服器管理員 Day-1～Day-N 運維路徑齊全、誠實 fail-closed、對齊 Hestia 級「Admin」而非 Reseller 商業平台。

## In-scope（視為完成）

| 域 | 狀態 |
|----|------|
| 專案／多 runtime／隔離 | ✓ |
| 網絡 HTTPS／redirect／HTTP auth／cache purge | ✓ |
| 執行環境 php.ini + tuning | ✓ |
| DNS zone/record／checklist／DNSSEC 素材 | ✓（簽署／cluster 可選深度） |
| SSL LE／上傳／bindings／到期通知 | ✓（wildcard 可選） |
| 郵件 domain／mailbox／DNS 建議／外部待辦／queue | ✓（國際 deliverability 永遠外部） |
| DB provision／dump／service | ✓ |
| 檔案／FTPS／SFTP keys | ✓ |
| Cron 可視化 + 專案用戶 | ✓ |
| 備份 tar／遠端／restic／排程 CLI | ✓ |
| 防火牆／F2B／2FA／API keys／審批 | ✓ |
| Sessions / API keys CLI | ✓ `security sessions` · `security api-keys` |
| Document state store | ✓ json 預設 · sqlite · postgres 實驗 · CLI store * |
| CLI ≡ Panel（Admin 運維） | ✓ 見 [panel-parity-matrix.md](../cli/panel-parity-matrix.md) |
| 通知中心（Dashboard） | ✓（EXECUTE、憑證、備份、審批、隔離、journal 磁碟、防護威脅） |
| 日誌中心（System Log Center） | ✓ journal／檔案 allowlist／專案／書籤／SSE／vacuum／設定 |
| 防護中心（Defense） | ✓ 檔位／自動 ban／CF／誠實 fail-closed |
| web-stats 樣本 | ✓ |
| readiness + admin checklist | ✓ |

## Explicitly out of scope（唔計 100% 缺口）

| 項 | 原因 |
|----|------|
| Reseller 多層租戶 | 產品凍結 |
| Web terminal | 安全凍結 |
| 完整商業套餐／計費 | Phase 3 平台產品 |
| 保證國際郵件進 inbox | PTR/Port25/信譽 — 主機商／域名商 |
| 完整 Rspamd/Clam 企業反垃圾 | 可後加 |
| 自動 dnssec 簽署上線 | 素材有；權威簽署操作員負責 |

## 操作員必做（環境，非 code）

見 [admin-ops-checklist.md](./admin-ops-checklist.md)：root、`YSK_EXECUTE=1`、cron install、nginx reload。

## 驗收

```bash
pnpm --filter @yanshekki/core exec vitest run src/hosting src/monitoring
ysk-server readiness --data-dir … --json
```
