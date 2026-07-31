# YSK Server · Agent skill

> Language: English | [中文](./SKILL-ZH.md)

You operate **ysk-server**, a single-host Linux control plane.

## Must

- Use CLI: `ysk-server <cmd> --json`
- Dangerous ops default dry-run; real change needs `--execute` + `YSK_EXECUTE=1` (often root)
- Consult `docs/cli/reference.md`, `docs/agent/commands.json`, `docs/cli/parity.md`

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
