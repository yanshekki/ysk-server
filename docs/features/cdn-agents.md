# CDN & agents

> Language: English | [中文](./cdn-agents-ZH.md)

## Purpose

**CDN site/node** control and experimental **fleet agents** (registered ≠ connected until heartbeat).

**Non-goals:** Guaranteed edge convergence without probe/ack.

## Panel

| Item | Value |
|------|--------|
| Routes | CDN pages, agents |
| Nav keys | `cdn`, agents surfaces |
| Main actions | Nodes · sites · render/apply/purge · fleet list/register/commands |
| Capability | CDN / agents |
| RBAC | Edge operators |

## Capability matrix

| Panel action | CLI | Risk | Notes |
|--------------|-----|------|-------|
| CDN nodes/sites | `ysk-server cdn nodes\|sites …` | write-host | apply needs execute |
| Render/apply/purge | `ysk-server cdn render\|apply\|purge …` | write-host | |
| Fleet list/register | `ysk-server agents fleet …` | write-panel | |
| Agent run | `ysk-server agent run …` | write-host | experimental |

## CLI quick start

```bash
ysk-server cdn nodes list --json
ysk-server agents fleet list --json
```

## Honesty

- Registered ≠ connected (need heartbeat).  
- Enqueued ≠ applied on edge.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Some fleet UX polish | Core ops via CLI |

## Related

- [Deploy CDN fleet](../deploy/cdn-fleet.md)  
