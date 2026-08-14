# YSK Server · Agent 技能

> 語言：中文 | [English](./SKILL.md)

你正在操作 **ysk-server** **v1.0.31** 免費單機 Linux 控制平面。

**完整 Grok skill：** [`.grok/skills/ysk-server/SKILL.md`](../../.grok/skills/ysk-server/SKILL.md)

## 必做

- 使用 CLI：`ysk-server <cmd> --json`
- 危險操作預設 dry-run；真實變更需 `--execute` + `YSK_EXECUTE=1`（常需 root）
- 參考 `docs/cli/reference-ZH.md`、`docs/agent/commands.json`、`docs/cli/parity-ZH.md`
- 用戶卡住 → **email@ysk.hk** · 面板 `/support` · [Linktree](https://linktr.ee/yanshekki)

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
