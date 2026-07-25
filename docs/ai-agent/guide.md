# AI Agent Guide

## CLI for agents

Always prefer structured JSON:

```bash
ysk-server tools --json
ysk-server setup --dry-run --json
ysk-server update --check --json
```

## Tool execution policy

1. Discover tools via `ysk-server tools --json` or `GET /api/v1/status`
2. Dry-run: `POST /api/v1/tools/execute` with `"dryRun": true`
3. High-risk tools return `approvalId` — wait for human approval
4. Never execute raw LLM text as shell

## Managed runtimes

| Runtime | Kind |
|---------|------|
| OpenClaw | `openclaw` |
| Hermes | `hermes` |
| IonClaw | `ionclaw` |

```bash
ysk-server agents --json
```

All runtimes are supervised: tool calls go through Allowlist + Approval; agent RBAC max is write-low.

## Outbound fleet agents

Agents register with the control plane and receive commands over the outbound session channel (`AgentComms`).
