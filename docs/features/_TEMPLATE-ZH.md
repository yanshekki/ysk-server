# 功能：&lt;域名&gt;

> 語言：中文（香港書面語）| [English](./_TEMPLATE.md)

> **僅範本** — 請複製為 `<domain>.md`／`<domain>-ZH.md` 並替換占位符。  
> 勿將 `_TEMPLATE` 當成產品頁掛入 INDEX。

## 用途

&lt;一句：此域在單機控制平面上的職責。&gt;

**非目標：** &lt;此功能不是什麼。&gt;

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/path` |
| 導航鍵 | `navKey` |
| 主要分頁／操作 | &lt;列表&gt; |
| 能力 | `capability.id` |
| RBAC | &lt;誰可用&gt; |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 查看狀態 | `ysk-server … status --json` | read | |
| 套用／變更 | `ysk-server … --execute --json` | write-host | 需 `YSK_EXECUTE=1`，常需 root |

風險：`read` · `write-panel` · `write-host`（見 [docs-standard-ZH.md](../docs-standard-ZH.md)）。

## CLI 速查

```bash
# 唯讀
ysk-server <cmd> status --json

# 主機變更（先計劃，再 execute）
ysk-server <cmd> … --json
export YSK_EXECUTE=1
ysk-server <cmd> … --execute --json
```

完整 argv：[../cli/reference-ZH.md](../cli/reference-ZH.md)。

## 誠實邊界

- 未加 `--execute` 時，主機變更類命令維持 **試跑**。  
- 真實套用仍需 `YSK_EXECUTE=1`（常需 root）。  
- **已寫入**（資料目錄）≠ **已套用**（主機生效）。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| &lt;無或名稱&gt; | &lt;為何 CLI 不能取代&gt; |

## 相關

- [面板 ↔ CLI 矩陣](../cli/panel-parity-matrix-ZH.md)  
- [CLI 參考](../cli/reference-ZH.md)  
- [運維誠實](../architecture/ops-honesty-ZH.md)  
