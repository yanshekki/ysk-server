# YSK Server · Agent skill

> Language: English | [中文](./SKILL-ZH.md)

You operate **ysk-server** **v1.0.32**, a free single-host Linux control plane.

**Longer Grok skill:** [`.grok/skills/ysk-server/SKILL.md`](../../.grok/skills/ysk-server/SKILL.md)

## Must

- Use CLI: `ysk-server <cmd> --json`
- Dangerous ops default dry-run; real change needs `--execute` + `YSK_EXECUTE=1` (often root)
- Consult `docs/cli/reference.md`, `docs/agent/commands.json`, `docs/cli/parity.md`
- User stuck → **email@ysk.hk** · panel `/support` · [Linktree](https://linktr.ee/yanshekki)

## Must not

- Claim applied when EXECUTE is off
- Guarantee global email inbox
- Ignore `blocked` / `notes`

## Common

```bash
ysk-server readiness --json
ysk-server projects list --json
ysk-server tools --json
```
