# CDN & fleet agents

> Language: English | [中文](./cdn-agents-ZH.md)

**Panel:** CDN pages · `/agents`  
**CLI:** `cdn`, `agents`, `agent run`

## CDN

Nodes and sites: upsert, render conf, apply/purge, DNS sync helpers, health loops.

```bash
ysk-server cdn nodes list --json
ysk-server cdn nodes upsert --name edge1 --base-url https://edge.example.com --json
ysk-server cdn sites list --json
ysk-server cdn render --site-id ID --json
ysk-server cdn apply --site-id ID --execute --json
ysk-server cdn purge --site-id ID --json
ysk-server cdn from-project --project-id UUID --json
```

## Fleet agents

| Concept | Meaning |
|---------|---------|
| Register | Session row on control plane |
| Connected | Heartbeat recent |
| Commands | Queue for edge poller |
| `agent run` | Outbound poller process |

```bash
ysk-server agents fleet list --json
ysk-server agents fleet register --id edge-1 --json
ysk-server agents fleet commands --session SESSION --json
ysk-server agent run --control-plane http://CP:9287 --id edge-1
```

## Honesty

**Registered ≠ connected.** Queued command ≠ applied on edge. Enqueue needs auth; only limited poller paths are public. Experimental UI — prefer CLI/API.

## Related

[../deploy/cdn-fleet.md](../deploy/cdn-fleet.md) · [../cli/reference.md](../cli/reference.md)
