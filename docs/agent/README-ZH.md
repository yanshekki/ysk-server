# AI Agent

> 語言：中文 | [English](./README.md)

## 規則

1. 優先 **CLI + `--json`**，不要只靠實驗性 fleet UI。  
2. 先 `readiness` 與唯讀 `list`，再 `--execute`。  
3. 解析 `ok`、`blocked`、`dryRun`、`executed`、`notes`。  
4. 閱讀 [../cli/reference-ZH.md](../cli/reference-ZH.md) 與 [commands.json](./commands.json)。  

## 常用命令

```bash
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
ysk-server defense status --json
ysk-server email deliverability --domain example.com --json
```

## 技能貼入

系統提示請用 [SKILL-ZH.md](./SKILL-ZH.md)。

## Fleet（實驗）

```bash
ysk-server agents fleet list --json
ysk-server agent run --control-plane URL --id AGENT_ID
```

已註冊 ≠ 已連線（需 heartbeat）。已入佇列 ≠ 邊緣已套用。

## 誠實邊界

無 EXECUTE／root 時勿宣稱主機已套用。勿保證全球郵件 inbox 送達。
