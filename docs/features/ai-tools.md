# AI tools & ask

> Language: English | [中文](./ai-tools-ZH.md)

## Purpose

**Allowlisted tools** and natural-language `ask` that still respect protection mode and dry-run defaults.

**Non-goals:** Unrestricted shell as the agent; bypassing EXECUTE.

## Panel

| Item | Value |
|------|--------|
| Route | AI / tools surfaces |
| Nav key | (tools / ask entry points) |
| Main actions | Tool catalog · run · ask |
| Capability | AI tools |
| RBAC | Operators with tool allowlist |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| List tools | `ysk-server tools --json` | read | |
| Run tool | `ysk-server tools run --tool NAME …` | write-host | needs execute for host tools |
| Natural language | `ysk-server ask "…"` | varies | still gated |

## CLI quick start

```bash
ysk-server tools --json
ysk-server tools run --tool NAME --arg k=v --json
ysk-server ask "list projects" --json
```

## Honesty

- Tools respect allowlist + protection.  
- Prefer CLI + `--json` for agents.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Chat chrome | Same tools via CLI |

## Related

- [Agent README](../agent/README.md)  
