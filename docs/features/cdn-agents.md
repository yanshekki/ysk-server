# CDN & agents

> Language: English | [中文](./cdn-agents-ZH.md)

## Purpose

**CDN site/node** control and experimental **fleet agents** (registered ≠ connected until heartbeat).

**Non-goals:** Guaranteed edge convergence without probe/ack.

## Panel

| Item | Value |
|------|--------|
| Routes | `/cdn`, `/agents` |
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
- `/agents` is the fleet page. Unknown other paths are a 404, not the dashboard.  
- Node probe classifies timeout / DNS / refused / TLS (not only `fetch failed`).  
- Apply does not invent `root@publicIpv4`. SSH runs only when the node has an identity, username, or `sshHost`. Loopback origin is rewritten or refused on a remote edge. A fleet session id is the non-SSH path.  

## Panel-only ⚠️

| Surface | Rationale |
|---------|-----------|
| Some fleet UX polish | Core ops via CLI |

## Related

- [Deploy CDN fleet](../deploy/cdn-fleet.md)  
