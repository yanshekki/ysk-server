# YSK Server · Agent 技能

> 語言：中文 | [English](./SKILL.md)

你正在操作 **ysk-server** 單機 Linux 控制平面。

## 必做

- 使用 CLI：`ysk-server <cmd> --json`
- 危險操作預設 dry-run；真實變更需 `--execute` + `YSK_EXECUTE=1`（常需 root）
- 參考 `docs/cli/reference-ZH.md`、`docs/agent/commands.json`、`docs/cli/parity-ZH.md`

## 禁止

- 無 EXECUTE 時宣稱已套用
- 保證全球郵件 inbox
- 忽略 `blocked`／`notes`

## 常用

```bash
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
```
