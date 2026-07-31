# AI 工具與 Playbook

> 語言：中文（香港書面語）| [English](./ai-tools.md)

**面板路由：** `/ai`、工具／allowlist 介面  
**CLI：** `tools`、`ask`

## 功能

| 部件 | 角色 |
|------|------|
| 工具目錄 | 允許清單內的主機／控制平面工具 |
| `tools run` | 執行單一工具（高危預設 dry-run） |
| `ask` | 自然語言 → 計劃步驟 |
| Playbook | 內建緊急／運維序列 |
| 防護模式 | 姿勢收緊時限制工具 |

## CLI

```bash
ysk-server tools --json
ysk-server tools run --tool sys.info --json
ysk-server tools run --tool service.status --arg name=nginx --json
ysk-server ask "check nginx and disk" --json
ysk-server ask "restart nginx" --execute --json   # 覆核計劃後才執行
```

## Agent 規則

1. 優先 CLI + `--json`，勿只靠實驗性 fleet UI。  
2. 閱讀 `blocked`／`notes`／allowlist 拒絕。  
3. dry-run 時勿宣稱已套用。  

見 [../agent/README-ZH.md](../agent/README-ZH.md) · [../agent/commands.json](../agent/commands.json)。

## 相關

[../cli/reference-ZH.md](../cli/reference-ZH.md) · [defense-ZH.md](./defense-ZH.md)
