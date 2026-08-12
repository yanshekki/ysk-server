# 整機遷移

> 語言：中文（香港書面語）| [English](./migrate.md)

## 用途

**整機遷移**清冊、傳輸、後置步驟與續跑輔助。

**非目標：** 零停機多 DC 即時遷移產品。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | `/migrate` |
| 導航鍵 | `migrate` |
| 主要操作 | 清冊 · 主機遷移 · 後置 · 狀態 · 續跑 |
| 能力 | 遷移 |
| RBAC | 管理員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 清冊／狀態 | `ysk-server migrate inventory\|status` | read | |
| 主機遷移／後置／續跑 | `ysk-server migrate host\|post\|resume` | write-host | 需 execute |

## CLI 速查

```bash
ysk-server migrate inventory --json
ysk-server migrate status --json
```

## 誠實邊界

- 長時間主機搬遷需 EXECUTE 與審慎規劃。  
- 未完成後置檢查前不可宣稱完成。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 精靈進度 UX | 相同步驟可用 CLI |

## 相關

- [部署 host-migrate](../deploy/host-migrate-ZH.md)  
