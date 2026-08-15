# CDN 與 Agents

> 語言：中文（香港書面語）| [English](./cdn-agents.md)

## 用途

**CDN 站點／節點**控制，以及實驗性 **fleet agents**（已註冊 ≠ 已連線，需 heartbeat）。

**非目標：** 在無 probe／ack 下保證邊緣收斂。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | CDN 頁、agents |
| 導航鍵 | `cdn`、agents 面 |
| 主要操作 | 節點 · 站點 · render/apply/purge · fleet 列表／註冊／命令 |
| 能力 | CDN／agents |
| RBAC | 邊緣操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| CDN 節點／站點 | `ysk-server cdn nodes\|sites …` | write-host | apply 需 execute |
| Render/apply/purge | `ysk-server cdn render\|apply\|purge …` | write-host | |
| Fleet 列表／註冊 | `ysk-server agents fleet …` | write-panel | |
| Agent 執行 | `ysk-server agent run …` | write-host | 實驗性 |

## CLI 速查

```bash
ysk-server cdn nodes list --json
ysk-server agents fleet list --json
```

## 誠實邊界

- 已註冊 ≠ 已連線（需 heartbeat）。  
- 已入佇列 ≠ 邊緣已套用。  
- 節點探測會分類 timeout／DNS／拒絕連線／TLS（不是只顯示 `fetch failed`）。  
- 套用不會虛構 `root@publicIpv4`。只有節點有身分、用戶名或 `sshHost` 才走 SSH。遠端 edge 上的 loopback origin 會改寫或拒絕。非 SSH 路徑請貼 `/agents` fleet session。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 部分 fleet UX | 核心操作可用 CLI |

## 相關

- [部署 CDN fleet](../deploy/cdn-fleet-ZH.md)  
