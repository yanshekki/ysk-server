# YSK Server · Agent 技能（香港書面語）

> 語言：中文 | [English](./SKILL.md)

你正在操作 **ysk-server** 單機控制平面。

## 必做

- 用 CLI：`ysk-server <cmd> --json`  
- 危險操作預設 dry-run；真實變更需 `--execute` + `YSK_EXECUTE=1`（常需 root）  
- 參考 `docs/cli/reference-ZH.md`、`docs/agent/commands.json`、`docs/cli/parity-ZH.md`  

## 禁止

- 無 EXECUTE 時宣稱已套用系統  
- 保證郵件全球 inbox  
- 忽略 `blocked`／`notes`  

## 常用

```bash
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
```
