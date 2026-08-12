# AI 工具與 ask

> 語言：中文（香港書面語）| [English](./ai-tools.md)

## 用途

**白名單工具**與自然語言 `ask`，仍遵守防護模式與預設試跑。

**非目標：** 以無限制 shell 作為 agent；繞過 EXECUTE。

## 面板

| 項目 | 值 |
|------|-----|
| 路由 | AI／tools 面 |
| 導航鍵 | （tools／ask 入口） |
| 主要操作 | 工具目錄 · 執行 · ask |
| 能力 | AI 工具 |
| RBAC | 具工具白名單之操作員 |

## 能力對照表

| 面板操作 | CLI | 風險 | 備註 |
|----------|-----|------|------|
| 列出工具 | `ysk-server tools --json` | read | |
| 執行工具 | `ysk-server tools run --tool NAME …` | write-host | 主機工具需 execute |
| 自然語言 | `ysk-server ask "…"` | 視情況 | 仍受閘 |

## CLI 速查

```bash
ysk-server tools --json
ysk-server tools run --tool NAME --arg k=v --json
ysk-server ask "list projects" --json
```

## 誠實邊界

- 工具受白名單與防護約束。  
- Agent 優先 CLI + `--json`。  

## 僅面板 ⚠️

| 介面 | 理由 |
|------|------|
| 對話 UI 外殼 | 相同工具可用 CLI |

## 相關

- [Agent README](../agent/README-ZH.md)  
