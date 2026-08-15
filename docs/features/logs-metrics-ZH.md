# 日誌與指標

> 語言：中文（香港書面語）| [English](./logs-metrics.md)

## 用途

**日誌中心**查詢（來源、journal）與 **主機指標**總覽。

**非目標：** 完整 SIEM 替代；無限日誌外送。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/logs`、`/metrics` |
| 導航鍵 | `logs`、`metrics` |
| 主要操作 | 來源 · 查詢 · journal · 指標圖表 |
| 能力 | 日誌／主機指標 |
| RBAC | 操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 日誌來源／查詢／journal | `ysk-server logs sources\|query\|journal\|overview` | read | |
| 主機指標／總覽 | `ysk-server host metrics\|overview` | read | |

## CLI 速查

```bash
ysk-server logs sources --json
ysk-server logs query --json
ysk-server host metrics --json
```

## 誠實邊界

- 唯讀探測；不靜默宣稱「故障已修復」。  
- 查詢結果為 0 行會明寫，不會看起來像尚未查詢。  
- 即時進程表會去掉採樣自己的 `ps` 列（不是 100% CPU）。  
- 閾值告警只在頁內顯示。沒有 Slack、webhook 或電郵渠道。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 即時圖表／串流 UX | CLI 回傳快照 |

## 相關

- [系統主機](./system-host-ZH.md)  
