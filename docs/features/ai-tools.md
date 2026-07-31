# AI tools & playbooks

> Language: English | [中文](./ai-tools-ZH.md)

**Panel routes:** `/ai`, tools / allowlist UI  
**CLI:** `tools`, `ask`

## What it does

| Piece | Role |
|-------|------|
| Tool catalog | Allowlisted host/control-plane tools |
| `tools run` | Execute one tool with args (dry-run default for risky) |
| `ask` | Natural language → planned tool steps |
| Playbooks | Built-in emergency/ops sequences |
| Protection mode | Restricts tools when defense posture requires |

## CLI

```bash
ysk-server tools --json
ysk-server tools run --tool sys.info --json
ysk-server tools run --tool service.status --arg name=nginx --json
ysk-server ask "check nginx and disk" --json
ysk-server ask "restart nginx" --execute --json   # only after reviewing plan
```

## Agent rules

1. Prefer CLI + `--json` over experimental fleet UI.  
2. Read `blocked` / `notes` / allowlist denials.  
3. Never claim applied when dry-run.  

See [../agent/README.md](../agent/README.md) · [../agent/commands.json](../agent/commands.json).

## Related

[../cli/reference.md](../cli/reference.md) · [defense.md](./defense.md)
