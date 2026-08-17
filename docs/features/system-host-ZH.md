# 系統與主機

> 語言：中文（香港書面語）| [English](./system-host.md)

## 用途

操作 **控制平面主機**：systemd unit、服務矩陣、指標、服務網絡暴露、Real-IP 信任、面板 TLS、主機套件更新與軟件目錄安裝。

**非目標：** 多主機機隊編排（見 CDN／agents）；行銷式「一鍵永久安全」。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/system`、`/services`、`/network`、`/updates`、就緒 |
| 導航鍵 | `services`、`metrics`、`network`、`updates`、`readiness`、`systemd`… |
| 主要操作 | Unit · 服務 · 暴露 · Real-IP · 面板 TLS · 更新 · 軟件橫幅 |
| 能力 | 系統／主機／防火牆（視操作） |
| RBAC | 管理員／系統操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 主機總覽／指標 | `ysk-server host overview\|metrics --json` | read | |
| 服務矩陣 | `ysk-server services … --json` | read | |
| 控制平面 unit | `ysk-server system unit-install --execute` | write-host | |
| 服務暴露 list/put/sync | `ysk-server network exposure …` | write-host | `ysk-svc` 規則 |
| Real-IP 狀態／設定／重新整理 | `ysk-server real-ip status\|set\|refresh` | write-host | refresh 需 execute |
| 面板 TLS | `ysk-server ssl panel-tls status\|enable\|disable\|issue` | write-host | issue 需 execute |
| 更新中心（面板 + 服務 + runtime + apt） | `ysk-server updates hub [--refresh-runtimes] --json` | read | 與 `GET /api/v1/updates` 同一套 `entries` |
| 套件清冊 | `ysk-server updates inventory\|refresh --json` | read | 僅 apt 清單 |
| 套用套件 | `ysk-server updates apply --package … --execute` | write-host | |
| 軟件目錄 | `ysk-server software list\|install\|uninstall …` | write-host | `software get postgresql`：`postgres` 不在 PATH 但 unit 為 active 時仍視為已安裝。 |
| 殘留探測 | `ysk-server hosting leftovers` | read | 亦納入就緒報告。Overlay **不會**改寫 Apache／nginx／vsftpd／Dovecot。 |
| 堆疊計劃 | `ysk-server stack plans\|status\|install …` | write-host | |
| 產品本體更新 | `ysk-server update --check\|--apply` | write-host | 二進位更新 |
| 就緒／doctor | `ysk-server readiness\|doctor --json` | read | |

## CLI 速查

```bash
ysk-server host overview --json
ysk-server network exposure list --json
ysk-server real-ip status --json
ysk-server ssl panel-tls status --json
ysk-server updates hub --json
ysk-server updates inventory --json
ysk-server software list --json
ysk-server readiness --json
export YSK_EXECUTE=1
ysk-server network exposure sync --service nginx --execute --json
```

完整 argv：[../cli/reference-ZH.md](../cli/reference-ZH.md)。

## 誠實邊界

- 無 EXECUTE 時暴露探測可能降級（仍列出期望狀態）。  
- **已寫入** 套件計劃 ≠ 已套用 apt。  
- 就緒可能非零結束，但仍回傳完整 JSON。  
- 產品 overlay 不會自行修復殘留主機檔；殘留會繼續顯示，直至執行對應套用命令。  
- `/system` 匯出分頁可移除殘留 `public-files-*` nginx 設定（確認對話 + EXECUTE + root）。`000-default` 係未使用、唔當殘留，唔會喺此刪除。現用 public-files（meta）當託管。  
- 停止控制面服務與關閉面板 HTTPS 需確認字串。套餐移除在未勾選時停用。  
- 側欄頁尾顯示面板版本；更新中心有新候選時會連到 `/updates` 顯示「有新版本 x.y.z」。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| Host Browse Chromium | 見 [host-browse-ZH.md](./host-browse-ZH.md) |

## 相關

- [資料庫](./databases-ZH.md)  
- [防護](./defense-ZH.md)  
- [就緒](../getting-started/readiness-ZH.md)  
- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
